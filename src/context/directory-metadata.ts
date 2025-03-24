export interface DirectoryMetadata {
    lastAnalyzed: string;
    fileCount: number;
    files: Array<{
        path: string;
        size: number;
        type: string;
        relevanceScore?: number;
    }>;
}