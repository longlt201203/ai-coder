import * as vscode from 'vscode';
import * as path from 'path';
import { AIProvider } from '../ai/aiProvider';
import { ContextManager } from '../context/contextManager';

export function registerCommands(
    context: vscode.ExtensionContext,
    aiProvider: AIProvider,
    chatView: any,
    contextManager: ContextManager
) {
    // Command to configure API key
    const configureApiKeyCommand = vscode.commands.registerCommand(
        'ai-coder.configureApiKey',
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
        'ai-coder.openChat',
        () => {
            // Instead of opening the sidebar view, create a webview panel on the right side
            if (chatView && typeof chatView.openChatPanel === 'function') {
                chatView.openChatPanel();
            } else {
                vscode.window.showErrorMessage('Chat view is not properly initialized');
            }
        }
    );

    // Command to explain selected code
    const explainCodeCommand = vscode.commands.registerCommand(
        'ai-coder.explainCode',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('No editor is active');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showInformationMessage('Please select some code to explain');
                return;
            }

            const selectedText = editor.document.getText(selection);
            const fileName = editor.document.fileName;
            const prompt = `Explain this code from ${fileName}:\n\n${selectedText}`;
            
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'AI Coder',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Analyzing code...' });
                
                const response = await aiProvider.generateResponse(prompt, []);
                
                // Show the explanation in a new editor
                const document = await vscode.workspace.openTextDocument({
                    content: response,
                    language: 'markdown'
                });
                
                await vscode.window.showTextDocument(document, { preview: true });
            });
        }
    );

    // Command to generate code based on a comment
    const generateCodeCommand = vscode.commands.registerCommand(
        'ai-coder.generateCode',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('No editor is active');
                return;
            }

            const userInput = await vscode.window.showInputBox({
                prompt: 'Describe the code you want to generate',
                placeHolder: 'E.g., Create a function that sorts an array of objects by a property'
            });

            if (!userInput) {
                return;
            }

            const fileName = editor.document.fileName;
            const fileContent = editor.document.getText();
            const prompt = `Generate code based on this request: "${userInput}"\n\nCurrent file: ${fileName}\n\nFile content:\n${fileContent}`;
            
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'AI Coder',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Generating code...' });
                
                const response = await aiProvider.generateResponse(prompt, []);
                
                // Insert the generated code at the cursor position
                editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, response);
                });
            });
        }
    );

    // Command to optimize selected code
    const optimizeCodeCommand = vscode.commands.registerCommand(
        'ai-coder.optimizeCode',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('No editor is active');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showInformationMessage('Please select some code to optimize');
                return;
            }

            const selectedText = editor.document.getText(selection);
            const fileName = editor.document.fileName;
            const prompt = `Optimize this code from ${fileName} for better performance and readability. Explain the optimizations made:\n\n${selectedText}`;
            
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'AI Coder',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Optimizing code...' });
                
                const response = await aiProvider.generateResponse(prompt, []);
                
                // Show the optimized code in a diff editor
                const document = await vscode.workspace.openTextDocument({
                    content: response,
                    language: editor.document.languageId
                });
                
                await vscode.window.showTextDocument(document, { preview: true });
            });
        }
    );

    // Command to add a file to context
    const addFileToContextCommand = vscode.commands.registerCommand('ai-coder.addFileToContext', async () => {
        const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: 'Add to AI Context'
        });
        
        if (fileUris && fileUris.length > 0) {
            for (const uri of fileUris) {
                contextManager.addToSelectedContext(uri.fsPath);
            }
            vscode.window.showInformationMessage(`Added ${fileUris.length} file(s) to AI context`);
        }
    });
    
    // Command to add a folder to context
    const addFolderToContextCommand = vscode.commands.registerCommand('ai-coder.addFolderToContext', async () => {
        const folderUris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: true,
            openLabel: 'Add to AI Context'
        });
        
        if (folderUris && folderUris.length > 0) {
            for (const uri of folderUris) {
                contextManager.addToSelectedContext(uri.fsPath);
            }
            vscode.window.showInformationMessage(`Added ${folderUris.length} folder(s) to AI context`);
        }
    });
    
    // Command to clear context
    const clearContextCommand = vscode.commands.registerCommand('ai-coder.clearContext', () => {
        contextManager.clearSelectedContext();
        vscode.window.showInformationMessage('Cleared AI context');
    });
    
    // Command to show current context
    const showContextCommand = vscode.commands.registerCommand('ai-coder.showContext', () => {
        const contextItems = contextManager.getSelectedContextItems();
        if (contextItems.length === 0) {
            vscode.window.showInformationMessage('No files or folders added to AI context');
            return;
        }
        
        // Create a quick pick to show and manage context items
        const quickPick = vscode.window.createQuickPick();
        quickPick.items = contextItems.map(item => ({
            label: path.basename(item),
            description: item,
            buttons: [{
                iconPath: new vscode.ThemeIcon('trash'),
                tooltip: 'Remove from context'
            }]
        }));
        
        quickPick.title = 'AI Context Items';
        quickPick.placeholder = 'Select an item to remove from context';
        
        quickPick.onDidTriggerItemButton(event => {
            const itemPath = event.item.description;
            if (itemPath) {
                contextManager.removeFromSelectedContext(itemPath);
                quickPick.items = quickPick.items.filter(item => item.description !== itemPath);
                
                if (quickPick.items.length === 0) {
                    quickPick.dispose();
                    vscode.window.showInformationMessage('All items removed from AI context');
                }
            }
        });
        
        quickPick.show();
    });
    
    // Register all commands
    context.subscriptions.push(
        configureApiKeyCommand,
        openChatViewCommand,
        explainCodeCommand,
        generateCodeCommand,
        optimizeCodeCommand,
        addFileToContextCommand,
        addFolderToContextCommand,
        clearContextCommand,
        showContextCommand
    );
}