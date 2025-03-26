import * as vscode from "vscode";
import { ContextManager } from "../context/contextManager";
import Anthropic from "@anthropic-ai/sdk";
import { MessageParam, Model } from "@anthropic-ai/sdk/resources/index.mjs";
import { Stream } from "@anthropic-ai/sdk/streaming.mjs";
import { encode } from "gpt-tokenizer";
import { ContextItem } from "./context-item";
import * as path from "path";
import * as fs from "fs";
import { AIProvider } from "./aiProvider";

export class AnthropicProvider implements AIProvider {
    private apiKey: string | undefined;
    private contextManager: ContextManager;
    private anthropic: Anthropic | undefined;
    private readonly MAX_TOKENS_PER_REQUEST = 100000; // Adjust based on Claude's limits
    private readonly MAX_FILES_PER_BATCH = 10; // Maximum number of files to include in a batch
    private readonly AI_MODEL: Model = "claude-3-5-sonnet-20241022";
    private readonly AI_PROMPT =
        'You are an AI coding assistant. When providing code from specific files, always include a comment at the beginning of the code block with the filename like this: "// filename: example.js" or "# filename: example.py". If you\'re providing a general code snippet without a specific file context, no filename comment is needed. Provide clear, concise explanations and practical code solutions.';

    constructor(
        context: vscode.ExtensionContext,
        contextManager: ContextManager
    ) {
        this.contextManager = contextManager;
        this.apiKey = context.globalState.get<string>("anthropic.apiKey");

        if (this.apiKey) {
            this.anthropic = new Anthropic({
                apiKey: this.apiKey,
            });
        }
    }

    private addFilesFromDirectory(dirPath: string, contextPaths: string[], maxDepth: number = 2, currentDepth: number = 0): void {
        if (currentDepth > maxDepth || !fs.existsSync(dirPath)) {
            return;
        }

        try {
            const entries = fs.readdirSync(dirPath);

            // Get gitignore rules if available
            let ignorePatterns: string[] = [];
            const gitignorePath = path.join(dirPath, '.gitignore');
            if (fs.existsSync(gitignorePath)) {
                try {
                    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
                    ignorePatterns = gitignoreContent.split('\n')
                        .filter(line => line.trim() && !line.startsWith('#'));
                } catch (error) {
                    console.warn(`Error reading .gitignore at ${gitignorePath}:`, error);
                }
            }

            // Helper function to check if a path should be ignored
            const shouldIgnore = (entryPath: string): boolean => {
                const relativePath = path.relative(dirPath, entryPath).replace(/\\/g, '/');
                return ignorePatterns.some(pattern => {
                    if (pattern.endsWith('/')) {
                        // Directory pattern
                        return relativePath.startsWith(pattern) || relativePath === pattern.slice(0, -1);
                    }
                    // File pattern or wildcard
                    if (pattern.includes('*')) {
                        const regexPattern = pattern
                            .replace(/\./g, '\\.')
                            .replace(/\*/g, '.*');
                        return new RegExp(`^${regexPattern}$`).test(relativePath);
                    }
                    return relativePath === pattern;
                });
            };

            for (const entry of entries) {
                // Skip hidden files except .gitignore
                if (entry.startsWith('.') && entry !== '.gitignore') {
                    continue;
                }

                const entryPath = path.join(dirPath, entry);

                // Skip if should be ignored by gitignore
                if (shouldIgnore(entryPath)) {
                    continue;
                }

                const stats = fs.statSync(entryPath);

                if (stats.isDirectory()) {
                    // Recursively process subdirectories
                    this.addFilesFromDirectory(entryPath, contextPaths, maxDepth, currentDepth + 1);
                } else if (stats.isFile()) {
                    // Check file extension to filter out binary files
                    const ext = path.extname(entry).toLowerCase();
                    const isTextFile = [
                        '.ts', '.js', '.jsx', '.tsx', '.html', '.css', '.scss', '.json', '.md',
                        '.txt', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.php', '.rb', '.go',
                        '.yaml', '.yml', '.xml', '.sh', '.bat', '.ps1', '.gitignore'
                    ].includes(ext);

                    // Skip large files
                    const MAX_FILE_SIZE = 1024 * 1024; // 1MB
                    if (isTextFile && stats.size < MAX_FILE_SIZE) {
                        contextPaths.push(entryPath);
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing directory ${dirPath}:`, error);
        }
    }

    async analyzeContextWithAI(
        prompt: string,
        contextPaths: string[]
    ): Promise<string[]> {
        if (!this.apiKey) {
            const configured = await this.configureApiKey();
            if (!configured) {
                throw new Error("API key not configured");
            }
        }

        // Initialize Anthropic client if not already done
        if (!this.anthropic && this.apiKey) {
            this.anthropic = new Anthropic({
                apiKey: this.apiKey,
            });
        }

        try {
            // Prepare a list of files and directories
            const filesList = contextPaths.map((path) => {
                const stats = fs.statSync(path);
                const isDir = stats.isDirectory();
                return {
                    path,
                    name: path.split(/[\/\\]/).pop() || path,
                    type: isDir ? "directory" : "file",
                    size: isDir ? 0 : stats.size,
                };
            });

            // Create a message for the AI to select relevant files
            const messages: MessageParam[] = [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `I need to answer the following question: "${prompt}"
                                I have access to these files and directories:
                                ${filesList
                                    .map(
                                        (f) =>
                                            `- ${f.name} (${f.type}, ${f.size} bytes): ${f.path}`
                                    )
                                    .join("\n")}
                                
                                Please select up to 20 files that would be most relevant to answer this question. 
                                Return ONLY a valid JSON array of file paths with proper escaping for backslashes and special characters.
                                Do not include any explanation or markdown formatting, just the raw JSON array.
                                Example response format: ["C:\\\\path\\\\to\\\\file1.js", "C:\\\\path\\\\to\\\\file2.js"]`,
                        },
                    ],
                },
            ];

            // Call Anthropic API to get file selection
            const response = await this.anthropic!.messages.create({
                model: "claude-3-haiku-20240307", // Using a smaller model for this task
                max_tokens: 1000,
                messages: messages,
                temperature: 0.2,
            });

            // Parse the response to get the selected files
            const responseText =
                response.content[0].type === "text" ? response.content[0].text : "[]";

            // Extract JSON array from the response
            const jsonMatch = responseText.match(/\[.*\]/s);
            if (!jsonMatch) {
                console.error(
                    "Failed to parse file selection from AI response:",
                    responseText
                );
                return [];
            }

            try {
                const selectedFiles = JSON.parse(jsonMatch[0]) as string[];

                // Validate the selected files exist
                const validFiles = selectedFiles.filter((file) => fs.existsSync(file));
                console.log(`AI selected ${validFiles.length} files for context`);

                return validFiles;
            } catch (parseError) {
                console.error("Error parsing JSON from AI response:", parseError);
                return [];
            }
        } catch (error: any) {
            // Handle API key errors specifically
            if (error.status === 401 || 
                (error.message && error.message.includes("auth")) || 
                (error.message && error.message.includes("API key"))) {
                
                console.error("Authentication error with Anthropic API:", error);
                
                // Clear the invalid API key
                this.apiKey = undefined;
                
                // Update VS Code context
                await vscode.commands.executeCommand(
                    "setContext",
                    "brain-reducer.apiKeyConfigured",
                    false
                );
                
                throw new Error("Authentication failed with Anthropic API. Please reconfigure your API key.");
            }
            
            // Rethrow other errors
            throw error;
        }
    }

    async generateResponse(
        prompt: string,
        contextItems?: (string | ContextItem)[],
        onPartialResponse?: (text: string) => void
    ): Promise<string> {
        if (!this.apiKey) {
            const configured = await this.configureApiKey();
            if (!configured) {
                return "Please configure your Anthropic API key first.";
            }
        }

        try {
            // Initialize Anthropic client if not already done
            if (!this.anthropic && this.apiKey) {
                this.anthropic = new Anthropic({
                    apiKey: this.apiKey,
                });
            }

            // Extract paths from context items
            const contextPaths: string[] = [];
            if (contextItems) {
                for (const item of contextItems) {
                    if (typeof item === "string") {
                        // If it's a file path string
                        if (fs.existsSync(item)) {
                            if (fs.statSync(item).isDirectory()) {
                                // If it's a directory, add files from it
                                this.addFilesFromDirectory(item, contextPaths);
                            } else {
                                contextPaths.push(item);
                            }
                        }
                    } else if (item.type === "file" && item.metadata?.path) {
                        // If it's a file context item
                        contextPaths.push(item.metadata.path);
                    } else if (item.type === "directory" && item.metadata?.path) {
                        // If it's a directory context item, add files from it
                        this.addFilesFromDirectory(item.metadata.path, contextPaths);
                    }
                }
            }

            // Use AI to analyze which files are relevant
            if (onPartialResponse) {
                onPartialResponse("Analyzing context for relevant files...\n\n");
            }

            const relevantFilePaths = await this.analyzeContextWithAI(
                prompt,
                contextPaths
            );

            // Read content of relevant files
            const relevantContextItems: (string | ContextItem)[] = [];

            for (const filePath of relevantFilePaths) {
                try {
                    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                        const content = fs.readFileSync(filePath, "utf8");
                        const fileName = path.basename(filePath);

                        relevantContextItems.push({
                            type: "file",
                            path: filePath,
                            content: `File: ${fileName}\n\n${content}`,
                            metadata: { fileName },
                        });
                    }
                } catch (error) {
                    console.error(`Error reading file ${filePath}:`, error);
                }
            }

            if (onPartialResponse) {
                onPartialResponse(`Using context: ${relevantContextItems.map(item => typeof item === "string" ? item : item.metadata?.fileName).join(", ")}`)

                onPartialResponse("\nGenerating response...\n\n");
            }

            // Process context items in batches with the AI-selected files
            const batchedResponse = await this.processBatchedRequest(
                prompt,
                relevantContextItems,
                onPartialResponse
            );

            // Add the response to history
            this.contextManager.addToHistory("assistant", batchedResponse);

            return batchedResponse;
        } catch (error: any) {
            // Handle API key errors specifically
            if (error.status === 401 || 
                (error.message && error.message.includes("auth")) || 
                (error.message && error.message.includes("API key"))) {
                
                console.error("Authentication error with Anthropic API:", error);
                
                // Clear the invalid API key
                this.apiKey = undefined;
                
                // Update VS Code context
                await vscode.commands.executeCommand(
                    "setContext",
                    "brain-reducer.apiKeyConfigured",
                    false
                );
                
                // Prompt user to reconfigure
                const action = await vscode.window.showErrorMessage(
                    "Invalid or expired Anthropic API key. Would you like to reconfigure it now?",
                    "Yes", "No"
                );
                
                if (action === "Yes") {
                    const configured = await this.configureApiKey();
                    if (configured) {
                        // Retry the request with the new API key
                        return this.generateResponse(prompt, contextItems, onPartialResponse);
                    }
                }
                
                throw new Error("Authentication failed with Anthropic API. Please reconfigure your API key.");
            }
            
            // Rethrow other errors
            throw error;
        }
    }

    private async processRequestWithContext(
        prompt: string,
        contextItems: (string | ContextItem)[],
        onPartialResponse?: (text: string) => void
    ): Promise<string> {
        // Prepare context text from the context items
        const contextText = this.prepareContextText(contextItems);

        // Prepare messages with context
        const messages = this.prepareMessages(contextText, prompt);

        try {
            // Call Anthropic API with streaming and tools
            const stream = await this.anthropic!.messages.create({
                model: this.AI_MODEL,
                max_tokens: 4000,
                messages: messages,
                temperature: 0.7,
                stream: true,
            });

            // Process the stream and handle tool uses
            return await this.processResponseStream(stream, onPartialResponse);
        } catch (error) {
            console.error("Error in processRequestWithContext:", error);

            // Handle rate limiting and overloaded errors
            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                if (
                    errorMessage.includes("overloaded") ||
                    errorMessage.includes("rate limit") ||
                    (error as any)?.status === 429
                ) {
                    // Notify the user about the error
                    if (onPartialResponse) {
                        onPartialResponse(
                            "\n\nThe AI service is currently overloaded. Waiting to retry...\n\n"
                        );
                    }

                    // Wait for 3 seconds before retrying
                    await new Promise((resolve) => setTimeout(resolve, 3000));

                    // Retry the request with reduced context if possible
                    if (contextItems.length > 1) {
                        // Try with half the context items
                        const reducedContext = contextItems.slice(
                            0,
                            Math.ceil(contextItems.length / 2)
                        );
                        if (onPartialResponse) {
                            onPartialResponse("Retrying with reduced context...\n\n");
                        }
                        return this.processRequestWithContext(
                            prompt,
                            reducedContext,
                            onPartialResponse
                        );
                    }
                }
            }

            // If we can't handle the error, rethrow it
            throw error;
        }
    }

    /**
     * Process the request in batches to handle large context
     */
    // Update the processBatchedRequest method to better handle context items
    private async processBatchedRequest(
        prompt: string,
        contextItems?: (string | ContextItem)[],
        onPartialResponse?: (text: string) => void
    ): Promise<string> {
        // If no context items, just process the prompt directly
        if (!contextItems || contextItems.length === 0) {
            return this.processSimpleRequest(prompt, onPartialResponse);
        }

        // Add the user message to history before processing
        this.contextManager.addToHistory("user", prompt);

        // Sort context items by relevance (prioritize current file and user-selected items)
        const sortedItems = this.sortContextItemsByRelevance(contextItems);

        // Calculate tokens for the prompt and system message
        const systemMessage = this.AI_PROMPT;
        const promptTokens = this.countTokens(prompt);
        const systemTokens = this.countTokens(systemMessage);
        const baseTokens = promptTokens + systemTokens + 500; // Add buffer for message formatting

        // Create batches of context items that fit within token limits
        const batches = this.createContextBatches(
            sortedItems,
            this.MAX_TOKENS_PER_REQUEST - baseTokens
        );

        console.log(`Created ${batches.length} batches of context items`);

        // If we have multiple batches, inform the user
        if (batches.length > 1 && onPartialResponse) {
            onPartialResponse(
                "Processing your request with multiple context batches...\n\n"
            );
        }

        // Process each batch and collect responses
        let fullResponse = "";

        // Create a wrapper for onPartialResponse that we can use for all batches
        const batchPartialResponseHandler = onPartialResponse
            ? (text: string) => {
                if (onPartialResponse) {
                    onPartialResponse(text);
                }
            }
            : undefined;

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];

            // Process this batch
            const batchResponse = await this.processRequestWithContext(
                prompt,
                batch,
                batchPartialResponseHandler
            );

            // Add to the full response
            fullResponse += batchResponse;
        }

        return fullResponse;
    }

    /**
     * Process a simple request without context batching
     */
    private async processSimpleRequest(
        prompt: string,
        onPartialResponse?: (text: string) => void
    ): Promise<string> {
        const messages = this.prepareMessages("", prompt);

        // Call Anthropic API with streaming and tools
        const stream = await this.anthropic!.messages.create({
            model: this.AI_MODEL,
            max_tokens: 4000,
            messages: messages,
            temperature: 0.7,
            stream: true,
        });

        // Process the stream and handle tool uses
        return await this.processResponseStream(stream, onPartialResponse);
    }

    /**
     * Sort context items by relevance
     */
    private sortContextItemsByRelevance(
        contextItems: (string | ContextItem)[]
    ): (string | ContextItem)[] {
        // Create a copy to avoid modifying the original array
        const items = [...contextItems];

        // Sort items: current file first, then user-selected items, then others
        return items.sort((a, b) => {
            // Current file gets highest priority
            if (typeof a !== "string" && a.type === "current-file") return -1;
            if (typeof b !== "string" && b.type === "current-file") return 1;

            // User-selected items get second priority (assuming they're marked in some way)
            // You might need to adjust this based on how you identify user-selected items
            if (typeof a !== "string" && a.metadata?.fileName) return -1;
            if (typeof b !== "string" && b.metadata?.fileName) return 1;

            return 0;
        });
    }

    /**
     * Create batches of context items that fit within token limits
     */
    private createContextBatches(
        contextItems: (string | ContextItem)[],
        maxTokensPerBatch: number
    ): (string | ContextItem)[][] {
        const batches: (string | ContextItem)[][] = [];
        let currentBatch: (string | ContextItem)[] = [];
        let currentBatchTokens = 0;

        // Always include the first item (usually the current file) in the first batch
        if (contextItems.length > 0) {
            const firstItem = contextItems[0];
            currentBatch.push(firstItem);
            currentBatchTokens += this.countContextItemTokens(firstItem);
        }

        // Process remaining items
        for (let i = 1; i < contextItems.length; i++) {
            const item = contextItems[i];
            const itemTokens = this.countContextItemTokens(item);

            // If adding this item would exceed the token limit or max files per batch,
            // start a new batch
            if (
                currentBatchTokens + itemTokens > maxTokensPerBatch ||
                currentBatch.length >= this.MAX_FILES_PER_BATCH
            ) {
                batches.push(currentBatch);
                currentBatch = [item];
                currentBatchTokens = itemTokens;
            } else {
                currentBatch.push(item);
                currentBatchTokens += itemTokens;
            }
        }

        // Add the last batch if it's not empty
        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }

        return batches;
    }

    /**
     * Count tokens in a context item
     */
    private countContextItemTokens(item: string | ContextItem): number {
        if (typeof item === "string") {
            return this.countTokens(item);
        } else {
            return this.countTokens(item.content);
        }
    }

    /**
     * Count tokens in a string using the tokenizer
     */
    private countTokens(text: string): number {
        try {
            return encode(text).length;
        } catch (error) {
            console.error("Error counting tokens:", error);
            // Fallback: estimate tokens as 4 characters per token
            return Math.ceil(text.length / 4);
        }
    }

    /**
     * Prepare context text from context items
     */
    private prepareContextText(contextItems?: (string | ContextItem)[]): string {
        console.log("Context items:", contextItems);

        let contextText = "";
        if (contextItems && contextItems.length > 0) {
            contextText = "Here is some relevant context:\n\n";

            // Process each context item
            for (const item of contextItems) {
                if (typeof item === "string") {
                    try {
                        // Check if this is an in-memory image from the context manager
                        const inMemoryImages = this.contextManager.getInMemoryImages();
                        if (inMemoryImages.has(item)) {
                            // This is an in-memory image, use its data URL
                            const dataUrl = inMemoryImages.get(item);
                            contextText += `\n[Image: ${item}]\n`;

                            // Add the image to the history so it can be included in the message
                            this.addImageToHistory(item, dataUrl || "");
                            continue;
                        }

                        // Check if the file exists
                        if (!fs.existsSync(item)) {
                            console.warn(`File does not exist: ${item}`);
                            contextText += `\n[File not found: ${item}]\n`;
                            continue;
                        }

                        // Check if it's a directory
                        const stats = fs.statSync(item);
                        if (stats.isDirectory()) {
                            contextText += `\n[Directory: ${path.basename(item)}]\n`;
                            continue;
                        }

                        // Check if the file is an image by extension
                        const ext = path.extname(item).toLowerCase();
                        const isImage = [
                            ".jpg",
                            ".jpeg",
                            ".png",
                            ".gif",
                            ".bmp",
                            ".webp",
                        ].includes(ext);

                        if (isImage) {
                            // For image files, just add a reference instead of trying to read the content
                            contextText += `\n[Image file: ${path.basename(item)}]\n`;
                            continue;
                        }

                        // For regular files, read and process as before
                        const content = fs.readFileSync(item, "utf8");
                        const fileName = path.basename(item);
                        const fileExt = path.extname(fileName).substring(1);

                        contextText += `\n--- ${fileName} ---\n\`\`\`${fileExt}\n${content}\n\`\`\`\n`;
                    } catch (error) {
                        console.error(`Error reading file ${item}:`, error);
                        contextText += `\n[Error reading file: ${path.basename(
                            item
                        )}]: ${error}\n`;
                    }
                } else {
                    // Handle structured context items
                    switch (item.type) {
                        case "file":
                            const fileName = item.metadata?.fileName || "unknown";
                            const language = item.metadata?.language || "";
                            contextText += `File: ${fileName}\n\`\`\`${language}\n${item.content}\n\`\`\`\n\n`;
                            break;
                        case "current-file":
                            const currentFileName = item.metadata?.fileName || "current file";
                            const currentLanguage = item.metadata?.language || "";
                            contextText += `Current file: ${currentFileName}\n\`\`\`${currentLanguage}\n${item.content}\n\`\`\`\n\n`;
                            break;
                        case "selection":
                            const selectionFile = item.metadata?.fileName || "selection";
                            const selectionLang = item.metadata?.language || "";
                            contextText += `Selected code from ${selectionFile}:\n\`\`\`${selectionLang}\n${item.content}\n\`\`\`\n\n`;
                            break;
                        default:
                            contextText += item.content + "\n\n";
                    }
                }
            }
        }
        return contextText;
    }

    /**
     * Prepare messages for the API call
     */
    private prepareMessages(contextText: string, prompt: string): MessageParam[] {
        // Get chat history
        const history = this.contextManager.getHistory();

        // Create messages array for the API
        const messages = [];

        // Add system message
        messages.push({
            role: "assistant",
            content: this.AI_PROMPT,
        });

        // Add history messages
        for (const msg of history) {
            if (
                typeof msg.content === "object" &&
                msg.content.type === "image_message"
            ) {
                // This is an image message
                const imageData = msg.content;

                // Create a message with both image and text content
                messages.push({
                    role: msg.role,
                    content: [
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: `image/${imageData.imageType}`,
                                data: imageData.base64Data,
                            },
                        },
                        {
                            type: "text",
                            text: prompt || "Please analyze this image.",
                        },
                    ],
                });
            } else {
                // Regular text message
                messages.push({
                    role: msg.role,
                    content: msg.content,
                });
            }
        }

        const lastMessage = messages[messages.length - 1];
        const isImageMessageJustAdded =
            lastMessage &&
            lastMessage.role === "user" &&
            Array.isArray(lastMessage.content) &&
            lastMessage.content.some((item) => item.type === "image");

        if (!isImageMessageJustAdded) {
            messages.push({
                role: "user",
                content: contextText + prompt,
            });
        }

        return messages as MessageParam[];
    }

    /**
     * Process the response stream and handle tool uses
     */
    private async processResponseStream(
        stream: Stream<Anthropic.Messages.RawMessageStreamEvent> & {
            _request_id?: string | null;
        },
        onPartialResponse?: (text: string) => void
    ): Promise<string> {
        let fullResponse = "";

        // Store tool use information
        let currentToolName = "";
        let currentStrParams = "";

        // Process the stream
        console.log("Start of response");
        for await (const chunk of stream) {
            console.log(
                `Received chunk type: ${chunk.type}`,
                JSON.stringify(chunk, null, 2)
            );

            switch (chunk.type) {
                case "message_start": {
                    console.log("Start of message block");
                    break;
                }
                case "message_delta": {
                    console.log("Begin a new message");
                    break;
                }
                case "content_block_start": {
                    console.log("Begin a content block");
                    if (chunk.content_block.type === "tool_use") {
                        currentToolName = chunk.content_block.name;
                        currentStrParams = "";
                    }
                    break;
                }
                case "content_block_delta": {
                    console.log("Content block delta");
                    if (chunk.delta.type === "text_delta") {
                        const textChunk = chunk.delta.text || "";
                        fullResponse += textChunk;

                        // Call the callback if provided
                        if (onPartialResponse) {
                            onPartialResponse(textChunk);
                        }
                    } else if (chunk.delta.type === "input_json_delta") {
                        currentStrParams += chunk.delta.partial_json;
                    }
                    break;
                }
                case "content_block_stop": {
                    console.log("End of content block");
                    if (currentToolName && currentStrParams) {
                        // Execute the tool function

                        // Reset tool tracking variables
                        currentToolName = "";
                        currentStrParams = "";
                    }
                    break;
                }
                case "message_stop": {
                    console.log(
                        "End of message block - continuing to process any remaining chunks"
                    );
                    // We'll continue processing any remaining chunks
                    break;
                }
            }
        }
        console.log("End of response stream - all chunks processed");

        return fullResponse;
    }

    addImageToHistory(name: string, dataUrl: string): void {
        console.log(`Adding image ${name} to history`);

        // Extract the base64 data from the data URL
        const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            console.error("Invalid image data format");
            return;
        }

        const imageType = matches[1];
        const base64Data = matches[2];

        // Store the image data in the conversation history
        // We'll use a special format that we can detect later when preparing messages
        this.contextManager.addToHistory("user", {
            type: "image_message",
            name: name,
            imageType: imageType,
            base64Data: base64Data,
        });
    }

    async configureApiKey(): Promise<boolean> {
        const apiKey = await vscode.window.showInputBox({
            prompt: "Enter your Anthropic API Key",
            password: true,
            ignoreFocusOut: true,
        });

        if (apiKey) {
            this.apiKey = apiKey;
            // Store the API key in global state
            await vscode.commands.executeCommand(
                "setContext",
                "brain-reducer.apiKeyConfigured",
                true
            );

            // Initialize the Anthropic client with the new API key
            this.anthropic = new Anthropic({
                apiKey: this.apiKey,
            });

            return true;
        }

        return false;
    }

    isConfigured(): boolean {
        return !!this.apiKey;
    }
}
