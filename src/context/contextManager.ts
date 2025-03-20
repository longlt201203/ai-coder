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
        relevanceScore?: number;
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
                        contextItems.push(content);
                    }
                } else if (stats.isDirectory()) {
                    // If it's a directory, add directory structure information
                    const dirStructure = await this.getDirectoryStructure(itemPath);
                    if (dirStructure) {
                        contextItems.push(dirStructure);
                    }
                    
                    // Then add relevant files from the directory
                    const dirFiles = await this.getRelevantFiles(query);
                    contextItems.push(...dirFiles);
                }
            } catch (error) {
                console.error(`Error processing context item ${itemPath}:`, error);
            }
        }
        
        return contextItems;
    }

    /**
     * Generate a structured representation of a directory
     */
    async getDirectoryStructure(dirPath: string): Promise<string> {
        try {
            const dirName = path.basename(dirPath);
            let result = `Directory Structure: ${dirName} (${dirPath})\n`;
            
            // Get metadata if available
            const metadataKey = `ai-coder.dirMetadata.${this.sanitizePathForKey(dirPath)}`;
            const metadata = this.context.globalState.get<DirectoryMetadata>(metadataKey);
            
            if (metadata) {
                result += `Last analyzed: ${metadata.lastAnalyzed}\n`;
                result += `Total files: ${metadata.fileCount}\n\n`;
                
                // Create a tree-like structure of files and subdirectories
                const filesByDir = new Map<string, Array<{name: string, type: string, size: number}>>();
                
                for (const file of metadata.files) {
                    const relativePath = path.relative(dirPath, file.path);
                    const dirName = path.dirname(relativePath);
                    
                    if (!filesByDir.has(dirName)) {
                        filesByDir.set(dirName, []);
                    }
                    
                    filesByDir.get(dirName)!.push({
                        name: path.basename(file.path),
                        type: file.type,
                        size: file.size
                    });
                }
                
                // Output the directory structure
                for (const [dir, files] of filesByDir.entries()) {
                    if (dir === '.') {
                        result += `Files in root:\n`;
                    } else {
                        result += `Files in ${dir}/:\n`;
                    }
                    
                    for (const file of files) {
                        const sizeKB = (file.size / 1024).toFixed(1);
                        result += `  - ${file.name} (${file.type}, ${sizeKB} KB)\n`;
                    }
                    result += '\n';
                }
            } else {
                // If no metadata, do a simple listing
                result += await this.generateSimpleDirectoryListing(dirPath);
            }
            
            return result;
        } catch (error) {
            console.error(`Error generating directory structure for ${dirPath}:`, error);
            return `Directory: ${dirPath} (Error: Unable to analyze structure)`;
        }
    }

    /**
     * Generate a simple directory listing when metadata is not available
     */
    private async generateSimpleDirectoryListing(dirPath: string, maxDepth: number = 2): Promise<string> {
        let result = '';
        
        const listDir = async (currentPath: string, depth: number = 0): Promise<void> => {
            if (depth > maxDepth) {
                return;
            }
            
            try {
                const entries = fs.readdirSync(currentPath);
                const indent = '  '.repeat(depth);
                
                for (const entry of entries) {
                    if (entry.startsWith('.')) {
                        continue; // Skip hidden files
                    }
                    
                    const fullPath = path.join(currentPath, entry);
                    const stats = fs.statSync(fullPath);
                    
                    if (stats.isDirectory()) {
                        result += `${indent}📁 ${entry}/\n`;
                        await listDir(fullPath, depth + 1);
                    } else {
                        const ext = path.extname(entry).toLowerCase();
                        const sizeKB = (stats.size / 1024).toFixed(1);
                        result += `${indent}📄 ${entry} (${ext || 'no extension'}, ${sizeKB} KB)\n`;
                    }
                }
            } catch (error) {
                console.error(`Error listing directory ${currentPath}:`, error);
                result += `  Error listing directory: ${currentPath}\n`;
            }
        };
        
        await listDir(dirPath);
        return result;
    }

    /**
     * Score files by their relevance to the query keywords
     */
    private scoreFilesByQueryRelevance(
        files: Array<{path: string, size: number, type: string, relevanceScore?: number}>,
        queryKeywords: string[]
    ): Array<{path: string, size: number, type: string, relevanceScore: number}> {
        // If no query keywords, return files with their original relevance scores
        if (queryKeywords.length === 0) {
            return files.map(file => ({
                ...file,
                relevanceScore: file.relevanceScore || 0
            })).sort((a, b) => b.relevanceScore - a.relevanceScore);
        }
        
        // Score files based on query keywords
        return files.map(file => {
            const fileName = path.basename(file.path).toLowerCase();
            const fileExt = path.extname(file.path).toLowerCase();
            const fileDir = path.dirname(file.path).toLowerCase();
            
            // Start with the original relevance score or 0
            let score = file.relevanceScore || 0;
            
            // Boost score based on keyword matches in filename
            for (const keyword of queryKeywords) {
                if (fileName.includes(keyword)) {
                    score += 30;
                }
                
                if (fileDir.includes(keyword)) {
                    score += 15;
                }
                
                // Check file content for keywords (for smaller files)
                if (file.size < 50 * 1024) { // Only for files smaller than 50KB
                    try {
                        const content = fs.readFileSync(file.path, 'utf8');
                        const contentLower = content.toLowerCase();
                        
                        if (contentLower.includes(keyword)) {
                            // More matches = higher score
                            const matches = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
                            score += Math.min(25, matches * 5); // Cap at 25 points
                        }
                    } catch (error) {
                        // Ignore errors reading file content
                    }
                }
            }
            
            return {
                ...file,
                relevanceScore: score
            };
        }).sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    /**
     * Extract keywords from a query
     */
    private extractKeywords(query: string): string[] {
        // Remove common words and punctuation
        const stopWords = ['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'as', 'of', 'how', 'what', 'why', 'when', 'where', 'who', 'which'];
        
        // Split the query into words
        const words = query.toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .split(/\s+/) // Split by whitespace
            .filter(word => word.length > 2 && !stopWords.includes(word)); // Filter out stop words and short words
        
        return words;
    }
    
    /**
     * Process a directory without metadata (fallback method)
     */
    private async processDirectoryWithoutMetadata(dirPath: string, contextItems: string[]): Promise<void> {
        // First, add a directory structure summary to provide context
        try {
            const dirName = path.basename(dirPath);
            let dirSummary = `Directory: ${dirName}\nPath: ${dirPath}\n`;
            
            const entries = fs.readdirSync(dirPath);
            
            // Add subdirectory list to the summary
            const dirs = entries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
            });
            
            if (dirs.length > 0) {
                dirSummary += `Subdirectories: ${dirs.join(', ')}\n`;
            }
            
            // Add file list to the summary
            const files = entries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
            });
            
            if (files.length > 0) {
                dirSummary += `Files: ${files.join(', ')}\n`;
            }
            
            // Add the directory summary to the result
            contextItems.push(dirSummary);
            
            // Process more files (increased from 5 to 10 for better coverage)
            const filesToProcess = files
                .filter(file => !file.startsWith('.'))
                .slice(0, 10)
                .map(file => path.join(dirPath, file));
            
            for (const file of filesToProcess) {
                if (fs.statSync(file).isFile()) {
                    const content = await this.getFileContent(file);
                    if (content) {
                        const fileName = path.basename(file);
                        contextItems.push(`File: ${fileName}\n\n${content}`);
                    }
                }
            }
            
            // Process subdirectories (limited to 3 to avoid too much content)
            const subDirsToProcess = dirs
                .slice(0, 3)
                .map(dir => path.join(dirPath, dir));
            
            for (const subDir of subDirsToProcess) {
                await this.processDirectoryWithoutMetadata(subDir, contextItems);
            }
        } catch (error) {
            console.error(`Error processing directory without metadata ${dirPath}:`, error);
        }
    }

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
    
        // Normalize the path to ensure consistent handling
        const normalizedPath = path.normalize(itemPath);
        
        if (!this.selectedContextItems.includes(normalizedPath)) {
            // Check if it's a directory and pre-analyze it
            try {
                const stats = fs.statSync(normalizedPath);
                
                if (stats.isDirectory()) {
                    console.log(`Pre-analyzing directory: ${normalizedPath}`);
                    
                    try {
                        // Create a metadata file in memory first, don't write to the directory
                        // Analyze the directory structure and files
                        const fileList: {path: string, size: number, type: string, relevanceScore?: number}[] = [];
                        this.analyzeDirectory(normalizedPath, fileList);
                        
                        // Store metadata about the directory
                        const metadata: DirectoryMetadata = {
                            lastAnalyzed: new Date().toISOString(),
                            fileCount: fileList.length,
                            files: fileList
                        };
                        
                        // Store metadata in extension storage instead of writing to the directory
                        const metadataKey = `ai-coder.dirMetadata.${this.sanitizePathForKey(normalizedPath)}`;
                        await this.context.globalState.update(metadataKey, metadata);
                        console.log(`Directory analysis complete: ${fileList.length} files found`);
                        
                        // Show success message to user
                        vscode.window.showInformationMessage(
                            `Added to context: ${path.basename(normalizedPath)} (${fileList.length} files analyzed)`
                        );
                    } catch (analyzeError) {
                        console.error(`Error analyzing directory ${normalizedPath}:`, analyzeError);
                        // Continue adding the directory even if analysis fails
                    }
                }
            } catch (error) {
                console.error(`Error pre-analyzing context item ${normalizedPath}:`, error);
                vscode.window.showErrorMessage(`Error adding item to context: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
            
            // Add to selected context
            this.selectedContextItems.push(normalizedPath);
            
            // Persist selected context
            await this.context.globalState.update('ai-coder.selectedContext', this.selectedContextItems);
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
     * Analyzes a directory with smart file selection
     */
    private analyzeDirectory(
        dirPath: string, 
        fileList: {path: string, size: number, type: string, relevanceScore?: number}[], 
        maxDepth: number = 3,
        currentDepth: number = 0
    ): void {
        if (currentDepth > maxDepth) {
            return;
        }
        
        try {
            const entries = fs.readdirSync(dirPath);
            
            // First pass: collect basic info about all files
            const fileInfos: {
                path: string, 
                size: number, 
                type: string, 
                name: string,
                ext: string,
                isImportant: boolean
            }[] = [];
            
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
                        
                        // Determine if this is an important file
                        const fileName = path.basename(fullPath);
                        const isImportant = this.isImportantFile(fileName, ext);
                        
                        // Add file info to the collection
                        fileInfos.push({
                            path: fullPath,
                            size: stats.size,
                            type: ext.replace('.', '') || 'txt',
                            name: fileName,
                            ext: ext,
                            isImportant: isImportant
                        });
                    }
                } catch (error) {
                    console.error(`Error analyzing file ${fullPath}:`, error);
                }
            }
            
            // Second pass: score and sort files by importance
            const scoredFiles = this.scoreFilesByImportance(fileInfos, dirPath);
            
            // Add the top files to the file list
            for (const file of scoredFiles) {
                fileList.push({
                    path: file.path,
                    size: file.size,
                    type: file.type,
                    relevanceScore: file.relevanceScore
                });
            }
        } catch (error) {
            console.error(`Error analyzing directory ${dirPath}:`, error);
        }
    }
    
    /**
     * Score files by their importance for context
     */
    private scoreFilesByImportance(
        files: {
            path: string, 
            size: number, 
            type: string, 
            name: string,
            ext: string,
            isImportant: boolean
        }[],
        dirPath: string
    ): {path: string, size: number, type: string, relevanceScore: number}[] {
        // Get the active file to compare with
        const activeEditor = vscode.window.activeTextEditor;
        const activeFilePath = activeEditor?.document.fileName;
        const activeFileExt = activeFilePath ? path.extname(activeFilePath).toLowerCase() : '';
        
        // Score each file
        const scoredFiles = files.map(file => {
            let score = 0;
            
            // Important files get a high base score
            if (file.isImportant) {
                score += 50;
            }
            
            // Files with the same extension as the active file get a bonus
            if (activeFileExt && file.ext === activeFileExt) {
                score += 30;
            }
            
            // Smaller files are preferred (easier to process)
            score += Math.max(0, 20 - Math.floor(file.size / 1024));
            
            // Files in the same directory as the active file get a bonus
            if (activeFilePath && path.dirname(activeFilePath) === path.dirname(file.path)) {
                score += 20;
            }
            
            // Files that match common patterns get bonuses
            if (this.matchesCommonPattern(file.name)) {
                score += 15;
            }
            
            return {
                path: file.path,
                size: file.size,
                type: file.type,
                relevanceScore: score
            };
        });
        
        // Sort by score (highest first)
        return scoredFiles.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }
    
    /**
     * Check if a file is important based on its name and extension
     */
    private isImportantFile(fileName: string, ext: string): boolean {
        // Common important files
        const importantFiles = [
            'package.json', 'tsconfig.json', 'webpack.config.js', 'vite.config.js',
            'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
            'README.md', 'CHANGELOG.md', '.env.example', 'Dockerfile', 'docker-compose.yml',
            'extension.ts', 'extension.js'
        ];
        
        if (importantFiles.includes(fileName)) {
            return true;
        }
        
        // Important file patterns
        const importantPatterns = [
            /^index\.[a-z]+$/, // index.* files
            /^main\.[a-z]+$/, // main.* files
            /^app\.[a-z]+$/, // app.* files
            /^config\.[a-z]+$/, // config.* files
            /^\.env(\.[a-z]+)?$/, // .env files
        ];
        
        for (const pattern of importantPatterns) {
            if (pattern.test(fileName)) {
                return true;
            }
        }
        
        // Important extensions
        const importantExtensions = [
            '.ts', '.js', '.tsx', '.jsx', '.vue', '.svelte',
            '.py', '.rb', '.go', '.java', '.cs', '.php'
        ];
        
        if (importantExtensions.includes(ext)) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Check if a file matches common patterns that indicate relevance
     */
    private matchesCommonPattern(fileName: string): boolean {
        // Common patterns for relevant files
        const relevantPatterns = [
            /component/i, // UI components
            /service/i, // Services
            /provider/i, // Providers
            /context/i, // Context
            /hook/i, // Hooks
            /util/i, // Utilities
            /helper/i, // Helpers
            /model/i, // Models
            /schema/i, // Schemas
            /type/i, // Types
            /interface/i, // Interfaces
            /constant/i, // Constants
            /config/i, // Configurations
            /route/i, // Routes
            /controller/i, // Controllers
            /middleware/i, // Middleware
            /test/i, // Tests
            /spec/i, // Specs
        ];
        
        for (const pattern of relevantPatterns) {
            if (pattern.test(fileName)) {
                return true;
            }
        }
        
        return false;
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
            // First, add a directory structure summary
            const dirName = path.basename(dirPath);
            let dirSummary = `Directory: ${dirName}\nPath: ${dirPath}\n`;
            
            const entries = fs.readdirSync(dirPath);
            
            // Add subdirectory list to the summary
            let dirs = entries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
            });
            
            if (dirs.length > 0) {
                dirSummary += `Subdirectories: ${dirs.join(', ')}\n`;
            }
            
            // Add file list to the summary
            let files = entries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
            });
            
            if (files.length > 0) {
                dirSummary += `Files: ${files.join(', ')}\n`;
            }
            
            // Add the directory summary to the result
            result.push(dirSummary);
            
            // Process files first, then directories
            files = entries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
            });
            
            dirs = entries.filter(entry => {
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