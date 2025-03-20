import * as vscode from 'vscode';
import { ContextManager } from '../context/contextManager';
import Anthropic from '@anthropic-ai/sdk';
import { MessageParam, ToolUnion } from '@anthropic-ai/sdk/resources/index.mjs';
import * as fs from 'fs';
import * as path from 'path';
import { Stream } from '@anthropic-ai/sdk/streaming.mjs';
import { aiTools } from './aiTools';

// Define a context item interface for more structured context
export interface ContextItem {
    type: 'file' | 'selection' | 'text' | 'current-file';
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
    replaceEditorContent(editor: vscode.TextEditor, newContent: string): Promise<void>;
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
    
    constructor(context: vscode.ExtensionContext, contextManager: ContextManager) {
        this.contextManager = contextManager;
        this.apiKey = context.globalState.get<string>('anthropic.apiKey');
        
        if (this.apiKey) {
            this.anthropic = new Anthropic({
                apiKey: this.apiKey
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
                    apiKey: this.apiKey
                });
            }
            
            // Prepare context and messages
            const contextText = this.prepareContextText(contextItems);
            const messages = this.prepareMessages(contextText, prompt);
            const tools = this.prepareTools();
            
            // For streaming response
            let fullResponse = '';
            
            // Call Anthropic API with streaming and tools
            const stream = await this.anthropic!.messages.create({
                model: "claude-3-5-sonnet-latest",
                max_tokens: 4000,
                messages: messages,
                temperature: 0.7,
                tools: tools,
                stream: true,
            });
            
            // Process the stream and handle tool uses
            fullResponse = await this.processResponseStream(stream, onPartialResponse);
            
            return fullResponse;
        } catch (error) {
            console.error('Error calling Anthropic API:', error);
            return `Error generating response: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    
    /**
     * Prepare context text from context items
     */
    private prepareContextText(contextItems?: (string | ContextItem)[]): string {
        let contextText = '';
        if (contextItems && contextItems.length > 0) {
            contextText = "Here is some relevant context:\n\n";
            
            // Process each context item
            for (const item of contextItems) {
                if (typeof item === 'string') {
                    // Handle legacy string items
                    contextText += item + "\n\n";
                } else {
                    // Handle structured context items
                    switch (item.type) {
                        case 'file':
                            const fileName = item.metadata?.fileName || 'unknown';
                            const language = item.metadata?.language || '';
                            contextText += `File: ${fileName}\n\`\`\`${language}\n${item.content}\n\`\`\`\n\n`;
                            break;
                        case 'current-file':
                            const currentFileName = item.metadata?.fileName || 'current file';
                            const currentLanguage = item.metadata?.language || '';
                            contextText += `Current file: ${currentFileName}\n\`\`\`${currentLanguage}\n${item.content}\n\`\`\`\n\n`;
                            break;
                        case 'selection':
                            const selectionFile = item.metadata?.fileName || 'selection';
                            const selectionLang = item.metadata?.language || '';
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
            content: "I am an AI coding assistant. I can help you with programming tasks, explain code, and provide suggestions."
        });
        
        // Add history messages
        for (const msg of history) {
            messages.push({
                role: msg.role,
                content: msg.content
            });
        }
        
        // Add the current message with context
        messages.push({
            role: "user",
            content: contextText + prompt
        });
        
        return messages as MessageParam[];
    }
    
    /**
     * Prepare tools for the API call
     */
    private prepareTools(): ToolUnion[] {
        return [{
            name: "write_file",
            description: "Write or modify a file with the given content",
            input_schema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "The path to the file (absolute or relative to workspace)"
                    },
                    content: {
                        type: "string",
                        description: "The content to write to the file"
                    },
                    mode: {
                        type: "string",
                        enum: ["replace", "insert"],
                        description: "Whether to replace the entire file or insert at cursor"
                    }
                },
                required: ["path", "content"]
            }
        }];
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
        let fullResponse = '';
        
        // Store tool use information
        let currentToolName = '';
        let currentStrParams = '';
    
        // Process the stream
        for await (const chunk of stream) {
            console.log(`Received chunk type: ${chunk.type}`, JSON.stringify(chunk, null, 2));
            
            switch (chunk.type) {
                case 'message_start': {
                    console.log('Start of response');
                    break;
                }
                case 'message_delta': {
                    console.log('Begin a new message');
                    break;
                }
                case 'content_block_start': {
                    console.log('Begin a content block');
                    if (chunk.content_block.type === 'tool_use') {
                        currentToolName = chunk.content_block.name;
                        currentStrParams = '';
                    }
                    break;
                }
                case 'content_block_delta': {
                    console.log('Content block delta');
                    if (chunk.delta.type === 'text_delta') {
                        const textChunk = chunk.delta.text || '';
                        fullResponse += textChunk;
                        
                        // Call the callback if provided
                        if (onPartialResponse) {
                            onPartialResponse(textChunk);
                        }
                    } else if (chunk.delta.type === 'input_json_delta') {
                        currentStrParams += chunk.delta.partial_json;
                    }
                    break;
                }
                case 'content_block_stop': {
                    console.log('End of content block');
                    if (currentToolName && currentStrParams) {
                        // Execute the tool function
                        await this.executeToolFunction(currentToolName, currentStrParams, onPartialResponse);
                        
                        // Reset tool tracking variables
                        currentToolName = '';
                        currentStrParams = '';
                    }
                    break;
                }
                case 'message_stop': {
                    console.log('End of response');
                    break;
                }
            }
        }
        
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
                throw new Error(`AI tool '${toolName}' not found!`)
            }
        } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            if (onPartialResponse) {
                onPartialResponse(`\n\n*Error executing tool '${toolName}': ${error instanceof Error ? error.message : String(error)}*\n\n`);
            }
        }
    }
    
    /**
     * Resolve a file path against the workspace folder if it's relative
     */
    private resolveFilePath(filePath: string): string {
        if (path.isAbsolute(filePath) || !vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
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
            ignoreFocusOut: true
        });
        
        if (apiKey) {
            this.apiKey = apiKey;
            // Store the API key in global state
            await vscode.commands.executeCommand('setContext', 'ai-coder.apiKeyConfigured', true);
            
            // Initialize the Anthropic client with the new API key
            this.anthropic = new Anthropic({
                apiKey: this.apiKey
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
    context.globalState.update('ai-coder.apiKeyConfigured', provider.isConfigured());
    
    return provider;
}