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
                case 'fileBrowser':
                    await this._handleFileBrowserAction(data, webviewView.webview);
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
                case 'fileBrowser':
                    await this._handleFileBrowserAction(data, panel.webview);
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
            let isDirectory = false;
            try {
                isDirectory = fs.existsSync(item) && fs.statSync(item).isDirectory();
            } catch (error) {
                console.error(`Error checking if path is directory: ${item}`, error);
            }
            
            return {
                path: item,
                name: path.basename(item),
                isDirectory: isDirectory
            };
        });
        
        console.log('Sending context to webview:', formattedItems);
        
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
            // This branch is no longer used for the main "Add Files/Folders" button
            // but we'll keep it for backward compatibility or other potential uses
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
        } else if (message.action === 'addCustom' && message.paths && message.paths.length > 0) {
            console.log('Adding custom paths to context:', message.paths);
            
            // Handle custom paths from file browser
            for (const itemPath of message.paths) {
                this._contextManager.addToSelectedContext(itemPath);
            }
            
            // Use the dedicated method to update all webviews
            this._sendContextToAllWebviews();
            
            vscode.window.showInformationMessage(`Added ${message.paths.length} item(s) to context`);
        }
    }
    
    /**
     * Send context updates to all available webviews
     */
    private _sendContextToAllWebviews() {
        // Update panel webview if it exists
        if (this._panel && this._panel.webview) {
            this._sendContextToWebview(this._panel.webview);
        }
        
        // Update sidebar webview if it exists
        if (this._view && this._view.webview) {
            this._sendContextToWebview(this._view.webview);
        }
    }
    
    /**
     * Handle file browser actions from the webview
     */
    private async _handleFileBrowserAction(message: any, webview?: vscode.Webview) {
        const targetWebview = webview || 
                             (this._panel ? this._panel.webview : undefined) || 
                             (this._view ? this._view.webview : undefined);
        
        if (!targetWebview) {
            return;
        }
        
        if (message.action === 'listDirectory') {
            try {
                // Get workspace root
                const workspaceRoot = this._getWorkspaceRoot();
                if (!workspaceRoot) {
                    throw new Error('No workspace folder is open');
                }
                
                // If empty path or trying to navigate outside workspace, use workspace root
                let requestedPath = message.path || workspaceRoot;
                
                // Ensure the requested path is within the workspace
                if (!this._isPathWithinWorkspace(requestedPath, workspaceRoot)) {
                    requestedPath = workspaceRoot;
                }
                
                const items = await this._listDirectory(requestedPath);
                targetWebview.postMessage({
                    type: 'fileBrowserUpdate',
                    items: items,
                    currentPath: requestedPath
                });
            } catch (error) {
                console.error('Error listing directory:', error);
                vscode.window.showErrorMessage(`Error listing directory: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    
    /**
     * Get the workspace root path
     */
    private _getWorkspaceRoot(): string | undefined {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
        return undefined;
    }
    
    /**
     * Check if a path is within the workspace
     */
    private _isPathWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
        const normalizedFilePath = path.normalize(filePath);
        const normalizedWorkspacePath = path.normalize(workspaceRoot);
        return normalizedFilePath.startsWith(normalizedWorkspacePath);
    }
    
    /**
     * List files and directories at the given path
     */
    private async _listDirectory(dirPath: string): Promise<{name: string, path: string, isDirectory: boolean}[]> {
        try {
            const items: {name: string, path: string, isDirectory: boolean}[] = [];
            const files = fs.readdirSync(dirPath);
            
            for (const file of files) {
                try {
                    const fullPath = path.join(dirPath, file);
                    const stats = fs.statSync(fullPath);
                    
                    // Skip hidden files and folders (starting with .)
                    if (file.startsWith('.')) {
                        continue;
                    }
                    
                    items.push({
                        name: file,
                        path: fullPath,
                        isDirectory: stats.isDirectory()
                    });
                } catch (error) {
                    // Skip files that can't be accessed
                    console.warn(`Skipping inaccessible file: ${file}`, error);
                }
            }
            
            // Sort directories first, then files alphabetically
            return items.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });
        } catch (error) {
            console.error(`Error listing directory ${dirPath}:`, error);
            throw new Error(`Could not access directory: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * List Windows drives
     */
    private _listWindowsDrives(): {name: string, path: string, isDirectory: boolean}[] {
        const drives: {name: string, path: string, isDirectory: boolean}[] = [];
        
        // Common drive letters
        const driveLetters = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
        
        for (const letter of driveLetters) {
            const drivePath = `${letter}:\\`;
            try {
                // Check if drive exists by trying to read its contents
                fs.readdirSync(drivePath);
                drives.push({
                    name: `${letter}: Drive`,
                    path: drivePath,
                    isDirectory: true
                });
            } catch (error) {
                // Drive doesn't exist or is not accessible, skip it
            }
        }
        
        return drives;
    }
    
    /**
     * Handle user message and generate AI response
     */
    private async _handleUserMessage(message: string, webview?: vscode.Webview) {
        // Get the target webview
        const targetWebview = webview || 
                             (this._panel ? this._panel.webview : undefined) || 
                             (this._view ? this._view.webview : undefined);
        
        if (!targetWebview) {
            return;
        }
        
        // Add user message to UI
        targetWebview.postMessage({
            type: 'addMessage',
            message: message,
            sender: 'user'
        });
        
        // Add to history
        this._contextManager.addToHistory('user', message);
        
        // Show typing indicator
        targetWebview.postMessage({
            type: 'showTyping'
        });
        
        try {
            // Get context items
            const contextItems = await this._getContextForPrompt(message);
            console.log('Current file context:', vscode.window.activeTextEditor?.document.fileName);
            
            if (vscode.window.activeTextEditor) {
                console.log('Added current file context to items:', vscode.window.activeTextEditor.document.fileName);
            }
            
            console.log('Created', contextItems.length, 'batches of context items');
            console.log('Start of response');
            
            // Start AI message
            targetWebview.postMessage({
                type: 'startAIMessage'
            });
            
            // Generate response with streaming
            const response = await this._aiProvider.generateResponse(
                message,
                contextItems,
                (partialResponse) => {
                    targetWebview.postMessage({
                        type: 'appendToAIMessage',
                        message: partialResponse
                    });
                }
            );
            
            // Complete AI message
            targetWebview.postMessage({
                type: 'completeAIMessage'
            });
            
            // Hide typing indicator
            targetWebview.postMessage({
                type: 'hideTyping'
            });
        } catch (error) {
            console.error('Error generating response:', error);
            
            // Hide typing indicator
            targetWebview.postMessage({
                type: 'hideTyping'
            });
            
            // Show error message
            targetWebview.postMessage({
                type: 'addMessage',
                message: `Error: ${error instanceof Error ? error.message : String(error)}`,
                sender: 'ai'
            });
        }
    }
    
    /**
     * Get context items for the prompt
     */
    private async _getContextForPrompt(prompt: string): Promise<(string | ContextItem)[]> {
        const contextItems: (string | ContextItem)[] = [];
        
        // Add current file if available
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const document = activeEditor.document;
            const fileName = path.basename(document.fileName);
            const fileContent = document.getText();
            
            contextItems.push({
                type: 'current-file',
                content: fileContent,
                metadata: {
                    fileName: fileName,
                    path: document.fileName,
                    language: document.languageId
                }
            });
            
            console.log('Added current file context to items:', document.fileName);
        }
        
        // Add selected context items
        const selectedItems = this._contextManager.getSelectedContextItems();
        
        for (const itemPath of selectedItems) {
            try {
                if (!fs.existsSync(itemPath)) {
                    console.warn(`Context item does not exist: ${itemPath}`);
                    continue;
                }
                
                const stats = fs.statSync(itemPath);
                const fileName = path.basename(itemPath);
                
                if (stats.isFile()) {
                    // Get file extension to determine language
                    const ext = path.extname(itemPath).toLowerCase();
                    let language = '';
                    
                    // Map common extensions to languages
                    if (['.js', '.jsx'].includes(ext)) language = 'javascript';
                    else if (['.ts', '.tsx'].includes(ext)) language = 'typescript';
                    else if (['.py'].includes(ext)) language = 'python';
                    else if (['.html'].includes(ext)) language = 'html';
                    else if (['.css'].includes(ext)) language = 'css';
                    else if (['.json'].includes(ext)) language = 'json';
                    else if (['.md'].includes(ext)) language = 'markdown';
                    
                    // Read file content
                    const content = fs.readFileSync(itemPath, 'utf8');
                    
                    contextItems.push({
                        type: 'file',
                        content: content,
                        metadata: {
                            fileName: fileName,
                            path: itemPath,
                            language: language
                        }
                    });
                    
                    console.log(`Added file to context: ${itemPath}`);
                } else if (stats.isDirectory()) {
                    // For directories, add a structure overview
                    const files = this._getDirectoryFiles(itemPath, 2); // Get files up to 2 levels deep
                    
                    contextItems.push({
                        type: 'text',
                        content: `Directory structure for ${itemPath}:\n${files.join('\n')}`,
                        metadata: {
                            fileName: fileName,
                            path: itemPath
                        }
                    });
                    
                    console.log(`Added directory structure to context: ${itemPath}`);
                }
            } catch (error) {
                console.error(`Error processing context item ${itemPath}:`, error);
            }
        }
        
        return contextItems;
    }
    
    /**
     * Get files in a directory recursively up to a certain depth
     */
    private _getDirectoryFiles(dirPath: string, maxDepth: number, currentDepth = 0): string[] {
        if (currentDepth > maxDepth) {
            return [];
        }
        
        try {
            const entries = fs.readdirSync(dirPath);
            let result: string[] = [];
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                const indent = '  '.repeat(currentDepth);
                
                try {
                    const stats = fs.statSync(fullPath);
                    
                    if (stats.isDirectory()) {
                        result.push(`${indent}📁 ${entry}/`);
                        // Recursively get files in subdirectory
                        const subFiles = this._getDirectoryFiles(fullPath, maxDepth, currentDepth + 1);
                        result = result.concat(subFiles);
                    } else {
                        result.push(`${indent}📄 ${entry}`);
                    }
                } catch (error) {
                    console.error(`Error processing ${fullPath}:`, error);
                }
            }
            
            return result;
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
            return [];
        }
    }
    
    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get path to HTML file
        const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'ui', 'chatView.html');
        
        // Get paths to CSS and JS files
        const cssPath = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'ui', 'chatView.css'));
        const jsPath = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'ui', 'chatView.js'));
        
        // Read the HTML file
        let html = fs.readFileSync(htmlPath, 'utf8');
        
        // Replace placeholders with actual URIs
        html = html.replace('{{cssUri}}', cssPath.toString());
        html = html.replace('{{jsUri}}', jsPath.toString());
        
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