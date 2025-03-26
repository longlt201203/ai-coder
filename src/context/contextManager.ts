import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DirectoryMetadata } from './directory-metadata';
import ignore from 'ignore';
import { ChatHistoryItem } from './chat-history-item';
import { ChatContent } from './chat-content';

export class ContextManager {
    private chatHistory: ChatHistoryItem[] = [];
    private selectedContextItems: string[] = []; // Store user-selected files/folders
    private imageContextItems: Set<string> = new Set();
    private inMemoryImages: Map<string, string> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        // Load saved context items
        const savedContext = this.context.globalState.get<string[]>('brain-reducer.selectedContext');
        if (savedContext) {
            this.selectedContextItems = savedContext.filter(item => fs.existsSync(item));
        }
    }
    
    getVSCodeContext(): vscode.ExtensionContext {
        return this.context;
    }

    addImageToContext(imageId: string, dataUrl: string): void {
        this.inMemoryImages.set(imageId, dataUrl);
        // Trigger change event if needed
    }

    getImageContextItems(): string[] {
        return Array.from(this.imageContextItems);
    }

    getInMemoryImages(): Map<string, string> {
        return this.inMemoryImages;
    }

    removeImageFromContext(imageId: string): void {
        this.inMemoryImages.delete(imageId);
        // Also remove from selected context if it exists there
        this.removeFromSelectedContext(imageId);
        // Trigger change event if needed
    }

    clearImageContext(): void {
        this.imageContextItems.clear();
        this.inMemoryImages.clear();
    }

    /**
     * Add a message to the chat history
     */
    addToHistory(role: 'user' | 'assistant', content: ChatContent): void {
        this.chatHistory.push({ role, content });

        // Limit history size to control token usage
        if (this.chatHistory.length > 20) {
            this.chatHistory.shift();
        }
    }

    private getGitignoreRules(dirPath: string): any {
        // Create a new ignore instance
        const ig = ignore();

        try {
            // Find all .gitignore files in this directory and parent directories
            let currentDir = dirPath;
            const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

            // Add common patterns that should always be ignored
            ig.add([
                'node_modules',
                'dist',
                'build',
                'out',
                '.git',
                '*.min.js',
                '*.bundle.js'
            ]);

            // Traverse up to find all applicable .gitignore files
            while (currentDir && currentDir.startsWith(rootDir)) {
                const gitignorePath = path.join(currentDir, '.gitignore');

                if (fs.existsSync(gitignorePath)) {
                    try {
                        const content = fs.readFileSync(gitignorePath, 'utf8');
                        const lines = content.split(/\r?\n/)
                            .filter(line => line.trim() && !line.startsWith('#'));

                        ig.add(lines);
                        console.log(`Loaded ${lines.length} rules from ${gitignorePath}`);
                    } catch (error) {
                        console.error(`Error reading .gitignore at ${gitignorePath}:`, error);
                    }
                }

                // Move up to parent directory
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir) {
                    break; // Prevent infinite loop at root
                }
                currentDir = parentDir;
            }
        } catch (error) {
            console.error(`Error loading gitignore rules for ${dirPath}:`, error);
        }

        return ig;
    }

    /**
     * Checks if a file should be ignored based on gitignore rules
     * @param filePath Path to the file to check
     * @param rootDir Root directory for relative path calculation
     * @returns True if the file should be ignored
     */
    private shouldIgnoreFile(filePath: string, rootDir: string): boolean {
        const ig = this.getGitignoreRules(rootDir);

        // Get relative path from root directory
        const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');

        // Special case: never ignore .gitignore files themselves
        if (path.basename(filePath) === '.gitignore') {
            return false;
        }

        return ig.ignores(relativePath);
    }

    /**
     * Get the current chat history
     */
    getHistory(): ChatHistoryItem[] {
        return [...this.chatHistory];
    }

    /**
 * Add a file or folder to the context
 * @param path Path to the file or folder
 */
    addToContext(path: string): void {
        // This is a convenience method that adds to the selected context
        this.addToSelectedContext(path);
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
    async getRelevantFiles(): Promise<string[]> {
        // Get existing context items
        const contextItems = await this.getSelectedContextItems();

        // Add image context items
        const imageItems = this.getImageContextItems();

        // Combine both types of context
        return [...contextItems, ...imageItems];
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
        // Simply return the selected context items
        return this.selectedContextItems;
    }

    /**
     * Generate a structured representation of a directory
     */
    async getDirectoryStructure(dirPath: string): Promise<string> {
        try {
            const dirName = path.basename(dirPath);
            let result = `Directory Structure: ${dirName} (${dirPath})\n`;

            // Get metadata if available
            const metadataKey = `brain-reducer.dirMetadata.${this.sanitizePathForKey(dirPath)}`;
            const metadata = this.context.globalState.get<DirectoryMetadata>(metadataKey);

            if (metadata) {
                result += `Last analyzed: ${metadata.lastAnalyzed}\n`;
                result += `Total files: ${metadata.fileCount}\n\n`;

                // Create a tree-like structure of files and subdirectories
                const filesByDir = new Map<string, Array<{ name: string, type: string, size: number }>>();

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
        const ig = this.getGitignoreRules(dirPath);

        const listDir = async (currentPath: string, depth: number = 0): Promise<void> => {
            if (depth > maxDepth) {
                return;
            }

            try {
                const entries = fs.readdirSync(currentPath);
                const indent = '  '.repeat(depth);

                for (const entry of entries) {
                    // Skip hidden files except .gitignore
                    if (entry.startsWith('.') && entry !== '.gitignore') {
                        continue;
                    }

                    const fullPath = path.join(currentPath, entry);

                    // Check if file should be ignored by gitignore rules
                    const relativePath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
                    if (entry !== '.gitignore' && ig.ignores(relativePath)) {
                        continue;
                    }

                    try {
                        const stats = fs.statSync(fullPath);

                        if (stats.isDirectory()) {
                            result += `${indent}📁 ${entry}/\n`;
                            await listDir(fullPath, depth + 1);
                        } else {
                            const ext = path.extname(entry).toLowerCase();
                            const sizeKB = (stats.size / 1024).toFixed(1);
                            result += `${indent}📄 ${entry} (${ext || 'no extension'}, ${sizeKB} KB)\n`;
                        }
                    } catch (error) {
                        console.error(`Error processing entry ${fullPath}:`, error);
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
        files: Array<{ path: string, size: number, type: string, relevanceScore?: number }>,
        queryKeywords: string[]
    ): Array<{ path: string, size: number, type: string, relevanceScore: number }> {
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

    addToSelectedContext(itemPath: string): void {
        // Check if the item exists
        if (!fs.existsSync(itemPath)) {
            console.warn(`Cannot add non-existent item to context: ${itemPath}`);
            return;
        }
    
        // Check if the item is already in the context
        if (!this.selectedContextItems.includes(itemPath)) {
            this.selectedContextItems.push(itemPath);
    
            // Save the updated context
            this.context.globalState.update('brain-reducer.selectedContext', this.selectedContextItems);
    
            // We no longer analyze directories here
            console.log(`Added to context: ${itemPath}`);
        }
    }

    private analyzeAndStoreDirectoryMetadata(dirPath: string): void {
        // Create a list to store file information
        const fileList: { path: string, size: number, type: string, relevanceScore?: number }[] = [];

        // Analyze the directory structure
        this.analyzeDirectory(dirPath, fileList);

        // Create metadata object
        const metadata: DirectoryMetadata = {
            lastAnalyzed: new Date().toISOString(),
            fileCount: fileList.length,
            files: fileList
        };

        // Store metadata in extension state
        const metadataKey = `brain-reducer.dirMetadata.${this.sanitizePathForKey(dirPath)}`;
        this.context.globalState.update(metadataKey, metadata);

        console.log(`Analyzed directory: ${dirPath}, found ${fileList.length} files`);
    }

    public refreshContextMetadata(): void {
        for (const itemPath of this.selectedContextItems) {
            if (fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory()) {
                this.analyzeAndStoreDirectoryMetadata(itemPath);
            }
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
        fileList: { path: string, size: number, type: string, relevanceScore?: number }[],
        maxDepth: number = 3,
        currentDepth: number = 0,
        rootDir: string = dirPath
    ): void {
        if (currentDepth > maxDepth) {
            return;
        }

        try {
            const entries = fs.readdirSync(dirPath);
            const ig = this.getGitignoreRules(rootDir);

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
                // Skip hidden files and directories (except .gitignore)
                if (entry.startsWith('.') && entry !== '.gitignore') {
                    continue;
                }

                const fullPath = path.join(dirPath, entry);

                // Check if the file should be ignored based on .gitignore
                const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
                if (entry !== '.gitignore' && ig.ignores(relativePath)) {
                    continue;
                }

                try {
                    const stats = fs.statSync(fullPath);

                    if (stats.isDirectory()) {
                        // Recursively analyze subdirectories
                        this.analyzeDirectory(fullPath, fileList, maxDepth, currentDepth + 1, rootDir);
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
                    console.error(`Error processing entry ${fullPath}:`, error);
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
    ): { path: string, size: number, type: string, relevanceScore: number }[] {
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
        this.context.globalState.update('brain-reducer.selectedContext', this.selectedContextItems);
    }

    /**
     * Clear all selected context items
     */
    clearSelectedContext(): void {
        this.selectedContextItems = [];
        // Persist selected context
        this.context.globalState.update('brain-reducer.selectedContext', this.selectedContextItems);
    }

    /**
     * Get the list of selected context items
     */
    async getSelectedContextItems(): Promise<string[]> {
        const contextItems: string[] = [];

        // Add existing file/folder context items
        for (const item of this.selectedContextItems) {
            if (fs.existsSync(item)) {
                contextItems.push(item);
            }
        }

        // Add in-memory image IDs
        for (const imageId of this.inMemoryImages.keys()) {
            contextItems.push(imageId);
        }

        return contextItems;
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
            const ig = this.getGitignoreRules(dirPath);

            // Filter entries based on gitignore
            const filteredEntries = entries.filter(entry => {
                if (entry === '.gitignore') return true; // Always include .gitignore

                const fullPath = path.join(dirPath, entry);
                const relativePath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
                return !ig.ignores(relativePath);
            });

            // Add subdirectory list to the summary
            let dirs = filteredEntries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
            });

            if (dirs.length > 0) {
                dirSummary += `Subdirectories: ${dirs.join(', ')}\n`;
            }

            // Add file list to the summary
            let files = filteredEntries.filter(entry => {
                const fullPath = path.join(dirPath, entry);
                return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
            });

            if (files.length > 0) {
                dirSummary += `Files: ${files.join(', ')}\n`;
            }

            // Add the directory summary to the result
            result.push(dirSummary);

            // Process files first, then directories
            // Process files
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                await this.processFile(filePath, result, processedPaths);
            }

            // Process directories
            for (const dir of dirs) {
                const subDirPath = path.join(dirPath, dir);
                if (!processedPaths.has(subDirPath)) {
                    await this.processDirectory(subDirPath, result, processedPaths, depth + 1);
                }
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
