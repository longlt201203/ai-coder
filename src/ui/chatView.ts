import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AIProvider, FileModificationHandler } from '../ai/aiProvider';
import { ContextManager } from '../context/contextManager';
import { ContextItem } from '../ai/aiProvider';

export class ChatViewProvider implements vscode.WebviewViewProvider, FileModificationHandler {
    public static readonly viewType = 'ai-coder.chatView';
    private _view?: vscode.WebviewView;
    private _panel?: vscode.WebviewPanel;
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _aiProvider: AIProvider,
        private readonly _contextManager: ContextManager
    ) {
        // Register this class as the file modification handler
        this._aiProvider.setFileModificationHandler(this);
    }
    
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // Initialize context items
        this._sendContextToWebview(webviewView.webview);
        
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    this._handleUserMessage(data.message);
                    break;
                case 'configureApiKey':
                    await this._aiProvider.configureApiKey();
                    break;
                case 'contextAction':
                    await this._handleContextSelection(data, webviewView.webview);
                    break;
            }
        });
    }
    
    public openChatPanel() {
        // Create and show panel
        const panel = vscode.window.createWebviewPanel(
            'aiCoderChat',
            'AI Coder Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );
        
        this._panel = panel;
        
        // Set the HTML content
        panel.webview.html = this._getHtmlForWebview(panel.webview);
        
        // Initialize context items
        this._sendContextToWebview(panel.webview);
        
        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    this._handleUserMessage(data.message, panel.webview);
                    break;
                case 'configureApiKey':
                    await this._aiProvider.configureApiKey();
                    break;
                case 'contextAction':
                    await this._handleContextSelection(data, panel.webview);
                    break;
            }
        });
        
        // Clean up when the panel is closed
        panel.onDidDispose(() => {
            this._panel = undefined;
        });
    }
    
    /**
     * Send the current context items to the webview
     */
    private _sendContextToWebview(webview?: vscode.Webview) {
        const targetWebview = webview || 
                             (this._panel ? this._panel.webview : undefined) || 
                             (this._view ? this._view.webview : undefined);
        
        if (!targetWebview) {
            return;
        }
        
        const contextItems = this._contextManager.getSelectedContextItems();
        const formattedItems = contextItems.map(item => {
            const isDirectory = fs.existsSync(item) && fs.statSync(item).isDirectory();
            return {
                path: item,
                name: path.basename(item),
                isDirectory: isDirectory
            };
        });
        
        targetWebview.postMessage({
            type: 'updateContext',
            contextItems: formattedItems
        });
    }
    
    /**
     * Handle context selection actions from the webview
     */
    private async _handleContextSelection(message: any, webview?: vscode.Webview) {
        console.log('Handling context action:', message);
        
        if (message.action === 'add') {
            // Show file/folder picker
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: true,
                openLabel: 'Add to Context'
            });
            
            if (uris && uris.length > 0) {
                for (const uri of uris) {
                    this._contextManager.addToSelectedContext(uri.fsPath);
                }
                this._sendContextToWebview(webview);
                vscode.window.showInformationMessage(`Added ${uris.length} item(s) to context`);
            }
        } else if (message.action === 'remove' && message.path) {
            this._contextManager.removeFromSelectedContext(message.path);
            this._sendContextToWebview(webview);
        } else if (message.action === 'clear') {
            this._contextManager.clearSelectedContext();
            this._sendContextToWebview(webview);
            vscode.window.showInformationMessage('Context cleared');
        }
    }
    
    private async _handleUserMessage(message: string, webview?: vscode.Webview) {
        const targetWebview = webview || (this._view ? this._view.webview : undefined);
        if (!targetWebview) {
            return;
        }
        
        // Add user message to the UI
        targetWebview.postMessage({ 
            type: 'addMessage', 
            message, 
            sender: 'user' 
        });
        
        // Show typing indicator
        targetWebview.postMessage({ type: 'showTyping' });
        
        try {
            // Store the last active editor when chat is opened
            const lastActiveEditor = vscode.window.activeTextEditor || this._getLastActiveEditor();
            
            // Get current editor context if available
            const currentFileContext = lastActiveEditor ? this._getFileContextFromEditor(lastActiveEditor) : null;
            console.log('Current file context:', currentFileContext ? currentFileContext.metadata?.fileName : 'none'); 
            
            // Check if this is a folder analysis request
            const folderAnalysisMatch = message.match(/analyze\s+(?:the\s+)?(?:folder|directory)\s+['"]?([^'"]+)['"]?/i);
            let specificFolderContext: ContextItem | null = null;
            
            if (folderAnalysisMatch && folderAnalysisMatch[1]) {
                const folderName = folderAnalysisMatch[1].trim();
                console.log(`Detected folder analysis request for: ${folderName}`);
                
                // Try to find the folder in the workspace
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    for (const wsFolder of workspaceFolders) {
                        const potentialPath = path.join(wsFolder.uri.fsPath, folderName);
                        if (fs.existsSync(potentialPath) && fs.statSync(potentialPath).isDirectory()) {
                            // Add this specific folder to the context manager temporarily
                            this._contextManager.addToSelectedContext(potentialPath);
                            
                            // Create a context item for this folder
                            const dirStructure = await this._contextManager.getDirectoryStructure(potentialPath);
                            specificFolderContext = {
                                type: 'text',
                                content: dirStructure,
                                metadata: {
                                    fileName: folderName,
                                    path: potentialPath
                                }
                            };
                            
                            console.log(`Added specific folder to context: ${potentialPath}`);
                            break;
                        }
                    }
                }
            }
            
            // Get relevant context from the context manager
            const contextItems = await this._contextManager.getRelevantContext(message);
            
            // Create a new array with the current file context if available
            const allContextItems: (string | ContextItem)[] = [...contextItems];
            
            // Add specific folder context if available (with highest priority)
            if (specificFolderContext) {
                allContextItems.unshift(specificFolderContext);
            }
            
            // Add current file context if available
            if (currentFileContext) {
                // Insert at the beginning for higher priority
                allContextItems.unshift(currentFileContext);
                console.log('Added current file context to items:', currentFileContext.metadata?.fileName);
            }
            
            // Hide typing indicator
            targetWebview.postMessage({ type: 'hideTyping' });
            
            // Create a message element for the AI response
            targetWebview.postMessage({ 
                type: 'startAIMessage'
            });
            
            // Add the user message to history
            this._contextManager.addToHistory('user', message);
            
            // Variable to collect the full response
            let fullResponse = '';
            
            try {
                // Generate AI response with streaming
                const response = await this._aiProvider.generateResponse(
                    message, 
                    allContextItems,
                    (partialText) => {
                        // Send each chunk to the webview
                        targetWebview.postMessage({
                            type: 'appendToAIMessage',
                            message: partialText
                        });
                        
                        // Collect the full response
                        fullResponse += partialText;
                    }
                );
                
                // Add the AI response to history
                this._contextManager.addToHistory('assistant', fullResponse || response);
                
                // Mark the message as complete ONLY after the entire response is received
                targetWebview.postMessage({
                    type: 'completeAIMessage'
                });
            } catch (error) {
                console.error('Error generating AI response:', error);
                
                // If we have a partial response, still complete it
                if (fullResponse) {
                    this._contextManager.addToHistory('assistant', fullResponse);
                    targetWebview.postMessage({
                        type: 'completeAIMessage'
                    });
                } else {
                    // Show error message if no response was generated
                    targetWebview.postMessage({
                        type: 'addMessage',
                        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        sender: 'system'
                    });
                }
            }
        } catch (error) {
            console.error('Error handling user message:', error);
            
            // Hide typing indicator
            targetWebview.postMessage({ type: 'hideTyping' });
            
            // Show error message
            targetWebview.postMessage({
                type: 'addMessage',
                message: `Error: ${error instanceof Error ? error.message : String(error)}`,
                sender: 'system'
            });
        }
    }
    
    /**
     * Gets the last active editor from VS Code
     */
    private _getLastActiveEditor(): vscode.TextEditor | undefined {
        // Try to get the visible text editors
        const visibleEditors = vscode.window.visibleTextEditors;
        if (visibleEditors.length > 0) {
            // Return the first visible editor
            return visibleEditors[0];
        }
        return undefined;
    }
    
    /**
     * Gets the file context from a specific editor
     */
    private _getFileContextFromEditor(editor: vscode.TextEditor): ContextItem {
        const document = editor.document;
        const fileName = document.fileName;
        const fileExtension = path.extname(fileName).replace('.', '');
        const selection = editor.selection;
        
        // If there's a selection, include just that part
        if (!selection.isEmpty) {
            const selectedText = document.getText(selection);
            return {
                type: 'selection',
                content: selectedText,
                metadata: {
                    fileName: path.basename(fileName),
                    language: fileExtension,
                    path: fileName,
                    lineStart: selection.start.line,
                    lineEnd: selection.end.line
                }
            };
        }
        
        // Otherwise include the visible portion of the file
        const visibleRanges = editor.visibleRanges;
        if (visibleRanges.length > 0) {
            const visibleText = document.getText(visibleRanges[0]);
            return {
                type: 'current-file',
                content: visibleText,
                metadata: {
                    fileName: path.basename(fileName),
                    language: fileExtension,
                    path: fileName,
                    lineStart: visibleRanges[0].start.line,
                    lineEnd: visibleRanges[0].end.line
                }
            };
        }
        
        // Fallback to just the file name
        return {
            type: 'current-file',
            content: '',
            metadata: {
                fileName: path.basename(fileName),
                path: fileName
            }
        };
    }
    
    // Update the existing _getCurrentFileContext method to use the new helper method
    private _getCurrentFileContext(): ContextItem | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return null;
        }
        
        return this._getFileContextFromEditor(editor);
    }
    
    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get path to HTML file
        const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'ui', 'chatView.html');
        
        // Read the HTML file
        let html = fs.readFileSync(htmlPath, 'utf8');
        
        // Return the HTML content
        return html;
    }
    
    /**
     * Process the AI response for file modification commands
     */
    private async _processResponseForFileModifications(response: string, editor?: vscode.TextEditor): Promise<void> {
        if (!editor) {
            return;
        }
        
        // Look for code blocks with file paths in the response
        const codeBlockRegex = /```([a-zA-Z0-9_\-+]+)(?::([^\n]+))?\n([\s\S]*?)```/g;
        let match;
        
        while ((match = codeBlockRegex.exec(response)) !== null) {
            const language = match[1];
            const filePath = match[2];
            const code = match[3];
            
            // If there's a file path specified, try to modify that file
            if (filePath) {
                await this.applyCodeToFile(filePath, code);
            } 
            // Otherwise, if it's a code block without a path, offer to apply it to the current file
            else if (editor) {
                const fileName = path.basename(editor.document.fileName);
                const fileExtension = path.extname(fileName).replace('.', '');
                
                // Only suggest applying if the language matches the file extension
                if (language.toLowerCase() === fileExtension.toLowerCase()) {
                    const applyChanges = await vscode.window.showInformationMessage(
                        `Apply the suggested code to ${fileName}?`,
                        'Apply',
                        'Cancel'
                    );
                    
                    if (applyChanges === 'Apply') {
                        await this.replaceEditorContent(editor, code);
                    }
                }
            }
        }
    }
    
    // Implement the FileModificationHandler interface methods
    
    /**
     * Apply code to a specific file
     */
    public async applyCodeToFile(filePath: string, code: string): Promise<void> {
        try {
            // Handle relative paths
            let absolutePath = filePath;
            if (!path.isAbsolute(filePath)) {
                // If workspace is available, use it as base
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    absolutePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
                } else {
                    throw new Error(`Cannot resolve relative path: ${filePath}`);
                }
            }
            
            // Check if the file exists
            let document: vscode.TextDocument;
            let fileExists = false;
            
            try {
                document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
                fileExists = true;
            } catch (error) {
                fileExists = false;
            }
            
            if (!fileExists) {
                // File doesn't exist, ask if we should create it
                const createFile = await vscode.window.showInformationMessage(
                    `File ${path.basename(absolutePath)} doesn't exist. Create it?`,
                    'Create',
                    'Cancel'
                );
                
                if (createFile !== 'Create') {
                    throw new Error('File creation cancelled by user');
                }
                
                // Ensure directory exists
                const directory = path.dirname(absolutePath);
                if (!fs.existsSync(directory)) {
                    fs.mkdirSync(directory, { recursive: true });
                }
                
                // Create the file with the code
                fs.writeFileSync(absolutePath, code);
                
                // Open the newly created file
                document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
                await vscode.window.showTextDocument(document);
                
                // Return success without throwing an error
                return;
            }
            
            // File exists, ask if we should modify it
            const modifyFile = await vscode.window.showInformationMessage(
                `Modify ${path.basename(absolutePath)}?`,
                'Replace entire file',
                'Insert at cursor',
                'Cancel'
            );
            
            if (modifyFile === 'Cancel') {
                throw new Error('File modification cancelled by user');
            }
            
            // Open the document in an editor
            const editor = await vscode.window.showTextDocument(vscode.Uri.file(absolutePath));
            
            if (modifyFile === 'Replace entire file') {
                await this.replaceEditorContent(editor, code);
            } else if (modifyFile === 'Insert at cursor') {
                await this.insertAtCursor(editor, code);
            }
            
            // Return success without throwing an error
            return;
        } catch (error) {
            vscode.window.showErrorMessage(`Error applying code: ${error instanceof Error ? error.message : String(error)}`);
            throw error; // Re-throw to allow the caller to handle it
        }
    }
    
    /**
     * Replace the entire content of an editor
     */
    public async replaceEditorContent(editor: vscode.TextEditor, newContent: string): Promise<void> {
        // This is the same as your existing _replaceEditorContent method
        const document = editor.document;
        const fullRange = new vscode.Range(
            0, 0,
            document.lineCount - 1,
            document.lineAt(document.lineCount - 1).text.length
        );
        
        await editor.edit(editBuilder => {
            editBuilder.replace(fullRange, newContent);
        });
    }
    
    /**
     * Insert code at the current cursor position
     */
    public async insertAtCursor(editor: vscode.TextEditor, code: string): Promise<void> {
        // This is the same as your existing _insertAtCursor method
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, code);
        });
    }
}

export function registerChatView(
    context: vscode.ExtensionContext,
    aiProvider: AIProvider,
    contextManager: ContextManager
): ChatViewProvider {
    const chatViewProvider = new ChatViewProvider(
        context.extensionUri,
        aiProvider,
        contextManager
    );
    
    const registration = vscode.window.registerWebviewViewProvider(
        ChatViewProvider.viewType,
        chatViewProvider
    );
    
    context.subscriptions.push(registration);
    
    return chatViewProvider;
}