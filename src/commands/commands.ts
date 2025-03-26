import * as vscode from 'vscode';
import { AIProvider } from '../ai/aiProvider';
import { ChatViewProvider } from '../ui/chatView';

export function registerCommands(
    context: vscode.ExtensionContext,
    aiProvider: AIProvider,
    chatView: ChatViewProvider
) {
    // Command to configure API key
    const configureApiKeyCommand = vscode.commands.registerCommand(
        'brain-reducer.configureApiKey',
        async () => {
            const configured = await aiProvider.configureApiKey();
            if (configured) {
                vscode.window.showInformationMessage('Anthropic API key configured successfully!');
            } else {
                vscode.window.showWarningMessage('API key configuration was cancelled or failed.');
            }
        }
    );

    // Command to open the chat view
    const openChatViewCommand = vscode.commands.registerCommand(
        'brain-reducer.openChat',
        () => {
            // Instead of opening the sidebar view, create a webview panel on the right side
            if (chatView && typeof chatView.openChatPanel === 'function') {
                chatView.openChatPanel();
            } else {
                vscode.window.showErrorMessage('Chat view is not properly initialized');
            }
        }
    );
    
    // Register all commands
    context.subscriptions.push(
        configureApiKeyCommand,
        openChatViewCommand,
    );
}