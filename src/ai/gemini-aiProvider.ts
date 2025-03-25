import * as vscode from "vscode";
import { ContextManager } from "../context/contextManager";
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { ContextItem } from "./context-item";
import * as path from "path";
import * as fs from "fs";
import { AIProvider } from "./aiProvider";
import { encode } from "gpt-tokenizer";

export class GeminiProvider implements AIProvider {
    private apiKey: string | undefined;
    private contextManager: ContextManager;
    private genAI: GoogleGenerativeAI | undefined;
    private model: GenerativeModel | undefined;
    private readonly MAX_TOKENS_PER_REQUEST = 30000; // Adjust based on Gemini's limits
    private readonly MAX_FILES_PER_BATCH = 10; // Maximum number of files to include in a batch
    private readonly AI_MODEL = "gemini-2.0-flash";
    private readonly AI_PROMPT =
        'You are an AI coding assistant. When providing code from specific files, always include a comment at the beginning of the code block with the filename like this: "// filename: example.js" or "# filename: example.py". If you\'re providing a general code snippet without a specific file context, no filename comment is needed. Provide clear, concise explanations and practical code solutions.';

    constructor(
        context: vscode.ExtensionContext,
        contextManager: ContextManager
    ) {
        this.contextManager = contextManager;
        this.apiKey = context.globalState.get<string>("gemini.apiKey");

        if (this.apiKey) {
            this.initializeClient();
        }
    }
    isConfigured(): boolean {
        throw new Error("Method not implemented.");
    }
    addImageToHistory(name: string, dataUrl: string): void {
        throw new Error("Method not implemented.");
    }

    private initializeClient() {
        if (!this.apiKey) return;

        this.genAI = new GoogleGenerativeAI(this.apiKey);
        this.model = this.genAI.getGenerativeModel({ model: this.AI_MODEL });
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

        // Initialize client if not already done
        if (!this.genAI && this.apiKey) {
            this.initializeClient();
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

            // Create a prompt for the AI to select relevant files
            const selectionPrompt = `I need to answer the following question: "${prompt}"
      
I have access to these files and directories:
${filesList
                    .map((f) => `- ${f.name} (${f.type}, ${f.size} bytes): ${f.path}`)
                    .join("\n")}

Please select up to 20 files that would be most relevant to answer this question. 
Return ONLY a valid JSON array of file paths with proper escaping for backslashes and special characters.
Do not include any explanation or markdown formatting, just the raw JSON array.
Example response format: ["C:\\\\path\\\\to\\\\file1.js", "C:\\\\path\\\\to\\\\file2.js"]`;

            // Call Gemini API to get file selection
            const result = await this.model!.generateContent(selectionPrompt);
            const responseText = result.response.text();

            console.log("Raw AI response:", responseText);

            // Try to extract and clean the JSON array from the response
            try {
                // First attempt: try to parse the entire response as JSON
                const selectedFiles = JSON.parse(responseText.trim()) as string[];
                const validFiles = selectedFiles.filter((file) => fs.existsSync(file));
                console.log(`AI selected ${validFiles.length} files for context`);
                return validFiles;
            } catch (firstError) {
                console.log("First parsing attempt failed, trying to extract JSON array");

                // Second attempt: try to extract JSON array using regex
                const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    try {
                        // Clean the extracted JSON string
                        const jsonStr = jsonMatch[0]
                            .replace(/\\(?!["\\/bfnrt])/g, "\\\\") // Properly escape backslashes
                            .replace(/\n/g, "\\n"); // Handle newlines

                        const selectedFiles = JSON.parse(jsonStr) as string[];
                        const validFiles = selectedFiles.filter((file) => fs.existsSync(file));
                        console.log(`AI selected ${validFiles.length} files for context`);
                        return validFiles;
                    } catch (secondError) {
                        console.error("Error parsing extracted JSON:", secondError);
                    }
                }

                // Third attempt: manually extract file paths
                console.log("Trying to manually extract file paths");
                const pathRegex = /"([^"]+\.[a-zA-Z0-9]+)"/g;
                const matches = [...responseText.matchAll(pathRegex)];
                if (matches.length > 0) {
                    const extractedPaths = matches.map(m => m[1]);
                    const validFiles = extractedPaths.filter((file) => fs.existsSync(file));
                    console.log(`Manually extracted ${validFiles.length} files from response`);
                    return validFiles;
                }

                console.error("All parsing attempts failed:", firstError);
                return [];
            }
        } catch (error) {
            console.error("Error in analyzeContextWithAI:", error);
            return [];
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
                return "Please configure your Gemini API key first.";
            }
        }

        try {
            // Initialize client if not already done
            if (!this.genAI && this.apiKey) {
                this.initializeClient();
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

                        if (onPartialResponse) {
                            onPartialResponse(`Including file: ${fileName}\n`);
                        }
                    }
                } catch (error) {
                    console.error(`Error reading file ${filePath}:`, error);
                }
            }

            if (onPartialResponse) {
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
        } catch (error) {
            console.error("Error in generateResponse:", error);
            return `Error generating response: ${error instanceof Error ? error.message : String(error)
                }`;
        }
    }

    private async processRequestWithContext(
        prompt: string,
        contextItems: (string | ContextItem)[],
        onPartialResponse?: (text: string) => void
    ): Promise<string> {
        // Prepare context text from the context items
        const contextText = this.prepareContextText(contextItems);

        // Prepare the full prompt with context
        const fullPrompt = `${this.AI_PROMPT}\n\n${contextText}\n\n${prompt}`;

        try {
            // Call Gemini API with streaming
            const result = await this.model!.generateContentStream(fullPrompt);

            let fullResponse = "";

            // Process the stream
            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                fullResponse += chunkText;

                if (onPartialResponse) {
                    onPartialResponse(chunkText);
                }
            }

            return fullResponse;
        } catch (error) {
            console.error("Error in processRequestWithContext:", error);

            // Handle rate limiting and overloaded errors
            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                if (
                    errorMessage.includes("quota") ||
                    errorMessage.includes("rate limit") ||
                    errorMessage.includes("resource exhausted")
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
        const fullPrompt = `${this.AI_PROMPT}\n\n${prompt}`;

        try {
            // Call Gemini API with streaming
            const result = await this.model!.generateContentStream(fullPrompt);

            let fullResponse = "";

            // Process the stream
            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                fullResponse += chunkText;

                if (onPartialResponse) {
                    onPartialResponse(chunkText);
                }
            }

            return fullResponse;
        } catch (error) {
            console.error("Error in processSimpleRequest:", error);
            throw error;
        }
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

            // User-selected items get second priority
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
                            contextText += `\n[Image: ${item}]\n`;
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
                            // For image files, just add a reference
                            contextText += `\n[Image file: ${path.basename(item)}]\n`;
                            continue;
                        }

                        // For regular files, read and process
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
     * Recursively adds files from a directory to the context paths array
     */
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

    async configureApiKey(): Promise<boolean> {
        const apiKey = await vscode.window.showInputBox({
            prompt: "Enter your Google Gemini API Key",
            password: true,
            ignoreFocusOut: true,
        });

        if (apiKey) {
            this.apiKey = apiKey;
            // Store the API key in global state
            await vscode.commands.executeCommand(
                "setContext",
                "ai-coder.geminiApiKeyConfigured",
                true
            );
            // Initialize the client with the new API key
            this.initializeClient();
            return true;
        }
        return false;
    }
}