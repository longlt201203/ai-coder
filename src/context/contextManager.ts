import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ContextManager {
    private chatHistory: { role: string, content: string }[] = [];
    private selectedContextItems: string[] = []; // Store user-selected files/folders
    
    constructor(private context: vscode.ExtensionContext) {
        // Load saved context items
        const savedContext = this.context.globalState.get<string[]>('ai-coder.selectedContext');
        if (savedContext) {
            this.selectedContextItems = savedContext.filter(item => fs.existsSync(item));
        }
    }
    
    /**
     * Add a message to the chat history
     */
    addToHistory(role: 'user' | 'assistant', content: string): void {
        this.chatHistory.push({ role, content });
        
        // Limit history size to control token usage
        if (this.chatHistory.length > 20) {
            this.chatHistory.shift();
        }
    }
    
    /**
     * Get the current chat history
     */
    getHistory(): { role: string, content: string }[] {
        return [...this.chatHistory];
    }
    
    /**
     * Get the currently active editor content
     */
    async getCurrentEditorContent(): Promise<string | null> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return null;
        }
        
        const document = editor.document;
        const content = document.getText();
        const fileName = path.basename(document.fileName);
        
        return `File: ${fileName}\n\n${content}`;
    }
    
    /**
     * Get relevant files based on the user query
     */
    async getRelevantFiles(query: string): Promise<string[]> {
        // This is a simplified implementation
        // A more advanced implementation would use embeddings or other techniques
        // to find truly relevant files based on the query
        
        const relevantFiles: string[] = [];
        
        if (!vscode.workspace.workspaceFolders) {
            return relevantFiles;
        }
        
        // For now, just get the active file and a few related files
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            relevantFiles.push(activeEditor.document.fileName);
            
            // Get files in the same directory
            const currentDir = path.dirname(activeEditor.document.fileName);
            try {
                const files = fs.readdirSync(currentDir);
                for (const file of files.slice(0, 3)) { // Limit to 3 files to control context size
                    const filePath = path.join(currentDir, file);
                    if (fs.statSync(filePath).isFile() && filePath !== activeEditor.document.fileName) {
                        relevantFiles.push(filePath);
                    }
                }
            } catch (error) {
                console.error('Error reading directory:', error);
            }
        }
        
        return relevantFiles;
    }
    
    /**
     * Get file content
     */
    async getFileContent(filePath: string): Promise<string | null> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            return document.getText();
        } catch (error) {
            console.error('Error reading file:', error);
            return null;
        }
    }
    
    /**
     * Get relevant context based on user query
     */
    async getRelevantContext(query: string): Promise<string[]> {
        const contextItems: string[] = [];
        
        // Add current editor content
        const currentContent = await this.getCurrentEditorContent();
        if (currentContent) {
            contextItems.push(currentContent);
        }
        
        // Add user-selected context items
        for (const itemPath of this.selectedContextItems) {
            try {
                const stats = fs.statSync(itemPath);
                
                if (stats.isFile()) {
                    // If it's a file, add its content
                    const content = await this.getFileContent(itemPath);
                    if (content) {
                        const fileName = path.basename(itemPath);
                        contextItems.push(`File: ${fileName}\n\n${content}`);
                    }
                } else if (stats.isDirectory()) {
                    // If it's a directory, add content of up to 5 files
                    const files = fs.readdirSync(itemPath)
                        .filter(file => !file.startsWith('.'))
                        .slice(0, 5)
                        .map(file => path.join(itemPath, file));
                    
                    for (const file of files) {
                        if (fs.statSync(file).isFile()) {
                            const content = await this.getFileContent(file);
                            if (content) {
                                const fileName = path.basename(file);
                                contextItems.push(`File: ${fileName}\n\n${content}`);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing context item ${itemPath}:`, error);
            }
        }
        
        // Add relevant files (keep this for automatic context)
        const relevantFiles = await this.getRelevantFiles(query);
        for (const file of relevantFiles) {
            const content = await this.getFileContent(file);
            if (content) {
                const fileName = path.basename(file);
                contextItems.push(`File: ${fileName}\n\n${content}`);
            }
        }
        
        return contextItems;
    }

    /**
     * Add a file or folder to the selected context
     */
    addToSelectedContext(itemPath: string): void {
        if (!this.selectedContextItems.includes(itemPath)) {
            this.selectedContextItems.push(itemPath);
            // Persist selected context
            this.context.globalState.update('ai-coder.selectedContext', this.selectedContextItems);
        }
    }
    
    /**
     * Remove a file or folder from the selected context
     */
    removeFromSelectedContext(itemPath: string): void {
        this.selectedContextItems = this.selectedContextItems.filter(item => item !== itemPath);
        // Persist selected context
        this.context.globalState.update('ai-coder.selectedContext', this.selectedContextItems);
    }
    
    /**
     * Clear all selected context items
     */
    clearSelectedContext(): void {
        this.selectedContextItems = [];
        // Persist selected context
        this.context.globalState.update('ai-coder.selectedContext', this.selectedContextItems);
    }
    
    /**
     * Get the list of selected context items
     */
    getSelectedContextItems(): string[] {
        return [...this.selectedContextItems];
    }
    
    /**
     * Get the content of all context files
     * This recursively processes folders to include all relevant files
     */
    async getContextFilesContent(): Promise<string[]> {
        const result: string[] = [];
        const processedPaths = new Set<string>();
        
        // Process all selected items
        for (const itemPath of this.selectedContextItems) {
            if (!fs.existsSync(itemPath)) {
                continue;
            }
            
            if (fs.statSync(itemPath).isDirectory()) {
                // Process directory recursively
                await this.processDirectory(itemPath, result, processedPaths);
            } else {
                // Process single file
                await this.processFile(itemPath, result, processedPaths);
            }
        }
        
        return result;
    }
    
    /**
     * Process a directory recursively to extract file contents
     */
    private async processDirectory(dirPath: string, result: string[], processedPaths: Set<string>, depth: number = 0): Promise<void> {
        // Limit recursion depth to avoid processing too many files
        if (depth > 3) {
            return;
        }
        
        try {
            const entries = fs.readdirSync(dirPath);
            
            // Process files first, then directories
            const files = entries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
            });
            
            const dirs = entries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
            });
            
            // Process files
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                await this.processFile(filePath, result, processedPaths);
            }
            
            // Process directories
            for (const dir of dirs) {
                const subDirPath = path.join(dirPath, dir);
                await this.processDirectory(subDirPath, result, processedPaths, depth + 1);
            }
        } catch (error) {
            console.error(`Error processing directory ${dirPath}:`, error);
        }
    }
    
    /**
     * Process a single file to extract its content
     */
    private async processFile(filePath: string, result: string[], processedPaths: Set<string>): Promise<void> {
        // Skip if already processed
        if (processedPaths.has(filePath)) {
            return;
        }
        
        // Skip files that are too large or binary
        try {
            const stats = fs.statSync(filePath);
            
            // Skip files larger than 100KB
            if (stats.size > 100 * 1024) {
                return;
            }
            
            // Skip files with certain extensions
            const ext = path.extname(filePath).toLowerCase();
            const skipExtensions = ['.exe', '.dll', '.obj', '.bin', '.jpg', '.png', '.gif', '.mp3', '.mp4', '.zip', '.rar'];
            if (skipExtensions.includes(ext)) {
                return;
            }
            
            // Read file content
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Add file content to result
            result.push(`File: ${filePath}\n\`\`\`\n${content}\n\`\`\``);
            
            // Mark as processed
            processedPaths.add(filePath);
        } catch (error) {
            console.error(`Error processing file ${filePath}:`, error);
        }
    }
}