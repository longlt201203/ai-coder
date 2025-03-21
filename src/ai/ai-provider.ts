export interface AiProvider {
    generateResponse(prompt: string, onChunkResponse?: (chunkText: string) => void): Promise<string>;
}
