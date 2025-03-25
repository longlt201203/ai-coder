import { AIProvider } from "./aiProvider";
import { ContextItem } from "./context-item";

export class GoogleAIProvider implements AIProvider {
    generateResponse(prompt: string, contextItems?: (string | ContextItem)[], onPartialResponse?: (text: string) => void): Promise<string> {
        throw new Error("Method not implemented.");
    }

    isConfigured(): boolean {
        throw new Error("Method not implemented.");
    }

    configureApiKey(): Promise<boolean> {
        throw new Error("Method not implemented.");
    }

    addImageToHistory(name: string, dataUrl: string): void {
        throw new Error("Method not implemented.");
    }
    
    analyzeContextWithAI(prompt: string, contextPaths: string[]): Promise<string[]> {
        throw new Error("Method not implemented.");
    }

}