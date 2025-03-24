// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { initializeAIProvider } from './ai/aiProvider';
import { registerChatView } from './ui/chatView';
import { registerCommands } from './commands/commands';
import { ContextManager } from './context/contextManager';

// Create an output channel for logging
const outputChannel = vscode.window.createOutputChannel('AI Coder');

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    outputChannel.appendLine('AI-Coder extension is now activating...');
    
    try {
        // Initialize the context manager to handle workspace, files, and history
        const contextManager = new ContextManager(context);
        
        // Initialize the AI provider with the context manager
        const aiProvider = initializeAIProvider(context, contextManager);
        
        // Register the chat view in the sidebar
        const chatView = registerChatView(context, aiProvider, contextManager);
        
        // Register all commands
        registerCommands(context, aiProvider, chatView);
        
        // Register a simple hello world command directly here as a fallback
        const helloWorldCommand = vscode.commands.registerCommand('ai-coder.helloWorld', () => {
            vscode.window.showInformationMessage('Hello from AI Coder!');
            outputChannel.appendLine('Hello World command executed');
        });
        context.subscriptions.push(helloWorldCommand);
        
        // Register direct commands for each feature to ensure they're available
        const directConfigureCommand = vscode.commands.registerCommand('ai-coder.directConfigureApiKey', async () => {
            outputChannel.appendLine('Direct configure API key command executed');
            if (aiProvider) {
                const configured = await aiProvider.configureApiKey();
                if (configured) {
                    vscode.window.showInformationMessage('Anthropic API key configured successfully!');
                } else {
                    vscode.window.showWarningMessage('API key configuration was cancelled or failed.');
                }
            }
        });
        context.subscriptions.push(directConfigureCommand);
        
        outputChannel.appendLine('AI-Coder extension successfully activated!');
        outputChannel.show();
    } catch (error) {
        outputChannel.appendLine(`Error during activation: ${error}`);
        console.error('Error during activation:', error);
    }
}

// This method is called when your extension is deactivated
export function deactivate() {
    outputChannel.appendLine('AI-Coder extension is being deactivated...');
}
