import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from '../../ai/aiProvider';
import { ContextManager } from '../../context/contextManager';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ai-coder.chatView';
    private _view?: vscode.WebviewView;
    private _panel?: vscode.WebviewPanel;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _aiProvider: AIProvider,
        private readonly _contextManager: ContextManager
    ) {
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

        // Give the webview time to initialize before sending messages
        setTimeout(() => {
            // Initialize context items
            this._sendContextToWebview(webviewView.webview);
        }, 500);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    this._handleUserMessage(data.message);
                    break;
                case 'uploadImage':
                    await this._handleImageUploadData(data.imageData);
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

        // Give the webview time to initialize before sending messages
        setTimeout(() => {
            // Initialize context items
            this._sendContextToWebview(panel.webview);
        }, 500);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    this._handleUserMessage(data.message, panel.webview);
                    break;
                case 'uploadImage':
                    await this._handleImageUploadData(data.imageData);
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

    private async _handleImageUploadData(imageData: any): Promise<void> {
        try {
            console.log('Handling image upload from webview');

            // Extract the image data from the data URL
            const matches = imageData.dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                throw new Error('Invalid image data format');
            }

            const imageExt = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // Create a unique filename in the workspace
            const workspaceRoot = this._getWorkspaceRoot();
            if (!workspaceRoot) {
                throw new Error('No workspace folder is open');
            }

            // Create an images directory in the workspace if it doesn't exist
            const imagesDir = path.join(workspaceRoot, '.ai-coder-images');
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }

            // Create a unique filename
            const timestamp = new Date().getTime();
            const filename = `${imageData.name.replace(/\.[^/.]+$/, '')}_${timestamp}.${imageExt}`;
            const filePath = path.join(imagesDir, filename);

            // Write the image to disk
            fs.writeFileSync(filePath, buffer);

            // Add to image context instead of regular context
            this._contextManager.addImageToContext(filePath);

            // Also add to AI provider's history with the full data URL
            this._aiProvider.addImageToHistory(filename, imageData.dataUrl);

            // Update context items in the UI
            this._sendContextToWebview();

            // Show a message to the user to prompt for a question about the image
            const targetWebview =
                (this._panel ? this._panel.webview : undefined) ||
                (this._view ? this._view.webview : undefined);

            if (targetWebview) {
                targetWebview.postMessage({
                    type: 'systemMessage',
                    content: `Image "${filename}" uploaded. Please ask a question about it.`
                });
            }

            console.log(`Image saved to ${filePath} and added to image context`);
        } catch (error) {
            console.error('Error handling image upload:', error);
            vscode.window.showErrorMessage(`Error uploading image: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Format file size in a human-readable format
     */
    private _formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        } else {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
    }

    /**
     * Check if the webview is responsive by sending a ping
     */
    private _checkWebviewResponsive(webview: vscode.Webview): void {
        console.log('Checking if webview is responsive...');
        webview.postMessage({
            type: 'ping',
            timestamp: Date.now()
        });
    }

    /**
     * Send the current context items to the webview
     */
    private async _sendContextToWebview(webview?: vscode.Webview) {
        const targetWebview = webview ||
            (this._panel ? this._panel.webview : undefined) ||
            (this._view ? this._view.webview : undefined);

        if (!targetWebview) {
            return;
        }

        // Check if webview is responsive
        this._checkWebviewResponsive(targetWebview);

        // Get regular context items
        const contextItems = await this._contextManager.getSelectedContextItems();

        // Split items into regular and image items
        const imageItems = [];
        const regularItems = [];

        for (const item of contextItems) {
            let isDirectory = false;
            let isImage = false;

            try {
                if (fs.existsSync(item)) {
                    isDirectory = fs.statSync(item).isDirectory();

                    // Check if it's an image file
                    if (!isDirectory) {
                        const ext = path.extname(item).toLowerCase();
                        isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext);
                    }
                }
            } catch (error) {
                console.error(`Error checking path: ${item}`, error);
            }

            const formattedItem = {
                path: item,
                name: path.basename(item),
                isDirectory: isDirectory,
                isImage: isImage
            };

            if (isImage) {
                imageItems.push(formattedItem);
            } else {
                regularItems.push(formattedItem);
            }
        }

        console.log('Sending context to webview:', {
            regularItems,
            imageItems
        });

        targetWebview.postMessage({
            type: 'updateContext',
            contextItems: regularItems,
            imageItems: imageItems
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
        } else if (message.action === 'removeImage' && message.path) {
            this._contextManager.removeImageFromContext(message.path);
            this._sendContextToWebview(webview);
        } else if (message.action === 'clear') {
            this._contextManager.clearSelectedContext();
            this._sendContextToWebview(webview);
            vscode.window.showInformationMessage('Context cleared');
        } else if (message.action === 'clearImageContext') {
            this._contextManager.clearImageContext();
            this._sendContextToWebview(webview);
            vscode.window.showInformationMessage('Image context cleared');
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
    private async _listDirectory(dirPath: string): Promise<{ name: string, path: string, isDirectory: boolean }[]> {
        try {
            const items: { name: string, path: string, isDirectory: boolean }[] = [];
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
     * Handle user message and generate AI response
     */
    private async _handleUserMessage(message: string, webview?: vscode.Webview) {
        const targetWebview = webview ||
            (this._panel ? this._panel.webview : undefined) ||
            (this._view ? this._view.webview : undefined);

        if (!targetWebview) {
            return;
        }

        console.log('Handling user message:', message);

        // Add user message to UI
        targetWebview.postMessage({
            type: 'addMessage',
            content: message,
            role: 'user'
        });

        // Show typing indicator
        targetWebview.postMessage({
            type: 'typingIndicator',
            isTyping: true
        });

        try {
            // Get context for the query
            const contextItems = await this._contextManager.getRelevantContext(message);

            // Create a message ID for this response
            const messageId = `msg-${Date.now()}`;

            // Initialize an empty AI message
            targetWebview.postMessage({
                type: 'startAIMessage',
                messageId: messageId
            });

            // Define a callback for handling partial responses
            const onPartialResponse = (text: string) => {
                targetWebview.postMessage({
                    type: 'appendToAIMessage',
                    content: text,
                    messageId: messageId
                });
            };

            // Send message to AI provider with streaming callback
            console.log('Sending message to AI provider with context items:', contextItems.length);
            const response = await this._aiProvider.generateResponse(message, contextItems, onPartialResponse);
            console.log('Received complete response from AI provider');

            // Hide typing indicator
            targetWebview.postMessage({
                type: 'typingIndicator',
                isTyping: false
            });

            // Finalize the AI message
            targetWebview.postMessage({
                type: 'finalizeAIMessage',
                messageId: messageId
            });

            // Add to context manager history
            this._contextManager.addToHistory('user', message);
            this._contextManager.addToHistory('assistant', response);
        } catch (error) {
            console.error('Error sending message to AI:', error);

            // Hide typing indicator
            targetWebview.postMessage({
                type: 'typingIndicator',
                isTyping: false
            });

            // Show error message
            targetWebview.postMessage({
                type: 'addMessage',
                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                role: 'assistant'
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get path to HTML file
        const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'ui', 'chatView', 'chatView.html');

        // Get paths to CSS and JS files
        const cssPath = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'ui', 'chatView', 'chatView.css'));
        const jsPath = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'ui', 'chatView', 'chatView.js'));

        // Read the HTML file
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Replace placeholders with actual URIs
        html = html.replace('{{cssUri}}', cssPath.toString());
        html = html.replace('{{jsUri}}', jsPath.toString());

        console.log('Generated HTML with JS path:', jsPath.toString());

        // Return the HTML content
        return html;
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