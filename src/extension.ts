// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { openChatCommand } from './commands/open-chat.command';
import { ContextManager } from './context/context-manager';

function registerCommands() {
    vscode.commands.registerCommand('ai-coder.openChat', openChatCommand)
}

// Create an output channel for logging
const outputChannel = vscode.window.createOutputChannel('AI Coder');

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    outputChannel.appendLine('AI-Coder extension is now activating...');
    
    try {
        ContextManager.initialize(context);
        registerCommands()

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
