import * as vscode from "vscode";
import { ContextManager } from "../context/contextManager";
import Anthropic from "@anthropic-ai/sdk";
import {
  MessageParam,
  Model,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/index.mjs";
import * as fs from "fs";
import * as path from "path";
import { Stream } from "@anthropic-ai/sdk/streaming.mjs";
import { aiTools } from "./aiTools";
import { encode } from "gpt-tokenizer"; // You'll need to add this package

// Define a context item interface for more structured context
export interface ContextItem {
  type: "file" | "selection" | "text" | "current-file";
  content: string;
  metadata?: {
    fileName?: string;
    language?: string;
    path?: string;
    lineStart?: number;
    lineEnd?: number;
  };
}

export interface FileModificationHandler {
  applyCodeToFile(filePath: string, code: string): Promise<void>;
  replaceEditorContent(
    editor: vscode.TextEditor,
    newContent: string
  ): Promise<void>;
  insertAtCursor(editor: vscode.TextEditor, code: string): Promise<void>;
}

export interface AIProvider {
  generateResponse(
    prompt: string,
    contextItems?: (string | ContextItem)[],
    onPartialResponse?: (text: string) => void
  ): Promise<string>;
  isConfigured(): boolean;
  configureApiKey(): Promise<boolean>;
  setFileModificationHandler(handler: FileModificationHandler): void;
}

class AnthropicProvider implements AIProvider {
  private apiKey: string | undefined;
  private contextManager: ContextManager;
  private anthropic: Anthropic | undefined;
  private fileModificationHandler: FileModificationHandler | undefined;
  private readonly MAX_TOKENS_PER_REQUEST = 100000; // Adjust based on Claude's limits
  private readonly MAX_FILES_PER_BATCH = 10; // Maximum number of files to include in a batch
  private readonly AI_MODEL: Model = "claude-3-5-sonnet-20241022";

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

  setFileModificationHandler(handler: FileModificationHandler): void {
    this.fileModificationHandler = handler;
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

      // Process context items in batches
      const batchedResponse = await this.processBatchedRequest(
        prompt,
        contextItems,
        onPartialResponse
      );

      // Add the response to history
      this.contextManager.addToHistory("assistant", batchedResponse);

      return batchedResponse;
    } catch (error) {
      console.error("Error generating response:", error);
      return `Error generating response: ${
        error instanceof Error ? error.message : String(error)
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

    // Prepare messages with context
    const messages = this.prepareMessages(contextText, prompt);
    const tools = this.prepareTools();

    try {
      // Call Anthropic API with streaming and tools
      const stream = await this.anthropic!.messages.create({
        model: this.AI_MODEL,
        max_tokens: 4000,
        messages: messages,
        temperature: 0.7,
        tools: tools,
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
    const systemMessage =
      "I am an AI coding assistant. I can help you with programming tasks, explain code, and provide suggestions.";
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
    const tools = this.prepareTools();

    // Call Anthropic API with streaming and tools
    const stream = await this.anthropic!.messages.create({
      model: this.AI_MODEL,
      max_tokens: 4000,
      messages: messages,
      temperature: 0.7,
      tools: tools,
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
    let contextText = "";
    if (contextItems && contextItems.length > 0) {
      contextText = "Here is some relevant context:\n\n";

      // Process each context item
      for (const item of contextItems) {
        if (typeof item === "string") {
          // Handle legacy string items
          contextText += item + "\n\n";
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
      content:
        "I am an AI coding assistant. I can help you with programming tasks, explain code, and provide suggestions.",
    });

    // Add history messages
    for (const msg of history) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add the current message with context
    messages.push({
      role: "user",
      content: contextText + prompt,
    });

    return messages as MessageParam[];
  }

  /**
   * Prepare tools for the API call
   */
  private prepareTools(): ToolUnion[] {
    return [
      {
        name: "write_file",
        description: "Write or modify a file with the given content",
        input_schema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "The path to the file (absolute or relative to workspace)",
            },
            content: {
              type: "string",
              description: "The content to write to the file",
            },
            mode: {
              type: "string",
              enum: ["replace", "insert"],
              description:
                "Whether to replace the entire file or insert at cursor",
            },
          },
          required: ["path", "content"],
        },
      },
    ];
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
            await this.executeToolFunction(
              currentToolName,
              currentStrParams,
              onPartialResponse
            );

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

  /**
   * Execute a tool function based on the tool name and parameters
   */
  private async executeToolFunction(
    toolName: string,
    paramString: string,
    onPartialResponse?: (text: string) => void
  ): Promise<void> {
    console.log(`Executing tool: ${toolName} with params: ${paramString}`);

    try {
      // Parse the JSON parameters
      const params = JSON.parse(paramString);
      if (aiTools[toolName]) {
        await aiTools[toolName](params);
      } else {
        throw new Error(`AI tool '${toolName}' not found!`);
      }
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      if (onPartialResponse) {
        onPartialResponse(
          `\n\n*Error executing tool '${toolName}': ${
            error instanceof Error ? error.message : String(error)
          }*\n\n`
        );
      }
    }
  }

  /**
   * Resolve a file path against the workspace folder if it's relative
   */
  private resolveFilePath(filePath: string): string {
    if (
      path.isAbsolute(filePath) ||
      !vscode.workspace.workspaceFolders ||
      vscode.workspace.workspaceFolders.length === 0
    ) {
      return filePath;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    return path.resolve(workspaceFolder, filePath);
  }

  /**
   * Ensure a directory exists before writing a file
   */
  private ensureDirectoryExists(filePath: string): void {
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
      console.log(`Created directory: ${directory}`);
    }
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
        "ai-coder.apiKeyConfigured",
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

export function initializeAIProvider(
  context: vscode.ExtensionContext,
  contextManager: ContextManager
): AIProvider {
  const provider = new AnthropicProvider(context, contextManager);

  // Store the provider in extension context for access from other modules
  context.globalState.update(
    "ai-coder.apiKeyConfigured",
    provider.isConfigured()
  );

  return provider;
}
