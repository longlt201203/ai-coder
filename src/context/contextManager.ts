import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Add this interface for directory metadata
interface DirectoryMetadata {
    lastAnalyzed: string;
    fileCount: number;
    files: Array<{
        path: string;
        size: number;
        type: string;
    }>;
}

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
                if (!fs.existsSync(itemPath)) {
                    console.warn(`Skipping non-existent context item: ${itemPath}`);
                    continue;
                }
                
                const stats = fs.statSync(itemPath);
                
                if (stats.isFile()) {
                    // If it's a file, add its content
                    const content = await this.getFileContent(itemPath);
                    if (content) {
                        const fileName = path.basename(itemPath);
                        contextItems.push(`File: ${fileName}\n\n${content}`);
                    }
                } else if (stats.isDirectory()) {
                    // Check if we have pre-analyzed metadata
                    const metadataKey = `ai-coder.dirMetadata.${this.sanitizePathForKey(itemPath)}`;
                    const metadata = this.context.globalState.get<DirectoryMetadata>(metadataKey);
                    
                    if (metadata && metadata.files) {
                        // Add directory summary
                        contextItems.push(`Directory: ${itemPath}\nContains ${metadata.fileCount} files. Last analyzed: ${metadata.lastAnalyzed}\n`);
                        
                        // Add most relevant files based on the query
                        // For now, just take the first 5 files
                        const relevantFiles = metadata.files.slice(0, 5);
                        
                        for (const fileInfo of relevantFiles) {
                            try {
                                if (fs.existsSync(fileInfo.path)) {
                                    const content = await this.getFileContent(fileInfo.path);
                                    if (content) {
                                        const fileName = path.basename(fileInfo.path);
                                        contextItems.push(`File: ${fileName}\n\n${content}`);
                                    }
                                }
                            } catch (fileError) {
                                console.error(`Error processing file ${fileInfo.path}:`, fileError);
                            }
                        }
                    } else {
                        // No metadata, use the old method
                        await this.processDirectoryWithoutMetadata(itemPath, contextItems);
                    }
                }
            } catch (error) {
                console.error(`Error processing context item ${itemPath}:`, error);
            }
        }
        
        // Add relevant files (keep this for automatic context)
        const relevantFiles = await this.getRelevantFiles(query);
        for (const file of relevantFiles) {
            try {
                if (fs.existsSync(file)) {
                    const content = await this.getFileContent(file);
                    if (content) {
                        const fileName = path.basename(file);
                        contextItems.push(`File: ${fileName}\n\n${content}`);
                    }
                }
            } catch (error) {
                console.error(`Error processing relevant file ${file}:`, error);
            }
        }
        
        return contextItems;
    }
    
    /**
     * Process a directory without metadata (fallback method)
     */
    private async processDirectoryWithoutMetadata(dirPath: string, contextItems: string[]): Promise<void> {
        // If it's a directory, add content of up to 5 files
        const files = fs.readdirSync(dirPath)
            .filter(file => !file.startsWith('.'))
            .slice(0, 5)
            .map(file => path.join(dirPath, file));
        
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

    /**
     * Add a file or folder to the selected context
     */
    /**
     * Add an item to the selected context with pre-analysis for folders
     */
    async addToSelectedContext(itemPath: string): Promise<void> {
        // First validate that the path exists before trying to add it
        if (!fs.existsSync(itemPath)) {
            console.error(`Cannot add non-existent path to context: ${itemPath}`);
            vscode.window.showErrorMessage(`Cannot add non-existent path to context: ${itemPath}`);
            return;
        }

        if (!this.selectedContextItems.includes(itemPath)) {
            // Check if it's a directory and pre-analyze it
            try {
                const stats = fs.statSync(itemPath);
                
                if (stats.isDirectory()) {
                    console.log(`Pre-analyzing directory: ${itemPath}`);
                    
                    try {
                        // Create a metadata file in memory first, don't write to the directory
                        // Analyze the directory structure and files
                        const fileList: {path: string, size: number, type: string}[] = [];
                        this.analyzeDirectory(itemPath, fileList);
                        
                        // Store metadata about the directory
                        const metadata: DirectoryMetadata = {
                            lastAnalyzed: new Date().toISOString(),
                            fileCount: fileList.length,
                            files: fileList
                        };
                        
                        // Store metadata in extension storage instead of writing to the directory
                        const metadataKey = `ai-coder.dirMetadata.${this.sanitizePathForKey(itemPath)}`;
                        this.context.globalState.update(metadataKey, metadata);
                        console.log(`Directory analysis complete: ${fileList.length} files found`);
                    } catch (analyzeError) {
                        console.error(`Error analyzing directory ${itemPath}:`, analyzeError);
                        // Continue adding the directory even if analysis fails
                    }
                }
            } catch (error) {
                console.error(`Error pre-analyzing context item ${itemPath}:`, error);
                vscode.window.showErrorMessage(`Error adding item to context: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
            
            // Add to selected context
            this.selectedContextItems.push(itemPath);
            
            // Persist selected context
            this.context.globalState.update('ai-coder.selectedContext', this.selectedContextItems);
        }
    }
    
    /**
     * Sanitize a path for use as a storage key
     */
    private sanitizePathForKey(path: string): string {
        // Replace characters that might cause issues in keys
        return path.replace(/[\/\\:*?"<>|]/g, '_');
    }
    
    /**
     * Analyze a directory recursively and collect file information
     */
    private analyzeDirectory(
        dirPath: string, 
        fileList: {path: string, size: number, type: string}[], 
        maxDepth: number = 3,
        currentDepth: number = 0
    ): void {
        if (currentDepth > maxDepth) {
            return;
        }
        
        try {
            const entries = fs.readdirSync(dirPath);
            
            for (const entry of entries) {
                // Skip hidden files and directories
                if (entry.startsWith('.')) {
                    continue;
                }
                
                const fullPath = path.join(dirPath, entry);
                
                try {
                    const stats = fs.statSync(fullPath);
                    
                    if (stats.isDirectory()) {
                        // Recursively analyze subdirectories
                        this.analyzeDirectory(fullPath, fileList, maxDepth, currentDepth + 1);
                    } else if (stats.isFile()) {
                        // Skip files that are too large or binary
                        if (stats.size > 100 * 1024) {
                            continue;
                        }
                        
                        // Skip files with certain extensions
                        const ext = path.extname(fullPath).toLowerCase();
                        const skipExtensions = ['.exe', '.dll', '.obj', '.bin', '.jpg', '.png', '.gif', '.mp3', '.mp4', '.zip', '.rar'];
                        if (skipExtensions.includes(ext)) {
                            continue;
                        }
                        
                        // Add file info to the list
                        fileList.push({
                            path: fullPath,
                            size: stats.size,
                            type: ext
                        });
                    }
                } catch (error) {
                    console.error(`Error analyzing ${fullPath}:`, error);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
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