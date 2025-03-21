import * as vscode from "vscode"
import { aiProvidersInfo, ModelInfo, modelsInfo } from "../ai/ai-providers-info";

export class ContextManager {
    private static instance: ContextManager;
    
    static initialize(context: vscode.ExtensionContext) {
        this.instance = new ContextManager(context);
    }
    
    static getInstance() {
        if (!this.instance) throw new Error('ContextManager not initialized!');
        return this.instance;
    }

    private currentModel: ModelInfo;
    private apiKeys: { [provider: string]: string } = {};
    private constructor(private vscodeContext: vscode.ExtensionContext) {
        this.currentModel = this.vscodeContext.globalState.get("currentModel") || modelsInfo['claude-3-5-sonnet-latest']
        this.apiKeys = this.vscodeContext.globalState.get("apiKeys") || {};
    }

    getVSCodeContext() {
        return this.vscodeContext;
    }

    getCurrentModel() {
        return this.currentModel;
    }

    setCurrentModel(currentModel: ModelInfo) {
        this.currentModel = currentModel;
        this.vscodeContext.globalState.update("currentModel", currentModel);
    }

    getAPIKey(provider: string) {
        return this.apiKeys[provider];
    }

    setAPIKey(provider: string, apiKey: string) {
        this.apiKeys[provider] = apiKey;
        this.vscodeContext.globalState.update("apiKeys", this.apiKeys);
    }

    async configureApiKey(provider: string): Promise<boolean> {
        const apiKey = await vscode.window.showInputBox({
            prompt: `Enter your ${aiProvidersInfo[provider]} API key`,
            password: true,
            placeHolder: 'sk-...',
            ignoreFocusOut: true
        })
        if (apiKey) {
            this.setAPIKey(provider, apiKey);
            return true;
        }
        return false;
    }
}