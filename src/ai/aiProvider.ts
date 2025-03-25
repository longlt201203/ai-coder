import * as vscode from "vscode";
import { ContextManager } from "../context/contextManager";
import { ContextItem } from "./context-item";
import { AnthropicProvider } from "./anthropic-aiProvider";

export interface AIProvider {
  generateResponse(
    prompt: string,
    contextItems?: (string | ContextItem)[],
    onPartialResponse?: (text: string) => void
  ): Promise<string>;
  isConfigured(): boolean;
  configureApiKey(): Promise<boolean>;
  addImageToHistory(name: string, dataUrl: string): void;
  analyzeContextWithAI(
    prompt: string,
    contextPaths: string[]
  ): Promise<string[]>;
}

export function initializeAIProvider(
  context: vscode.ExtensionContext,
  contextManager: ContextManager
): AIProvider {
  const provider = new AnthropicProvider(context, contextManager);

  // Store the provider in extension context for access from other modules
  context.globalState.update(
    "ai-coder.apiKeyConfigured",
    provider.isConfigured()
  );

  return provider;
}
