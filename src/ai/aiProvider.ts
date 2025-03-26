import * as vscode from "vscode";
import { ContextManager } from "../context/contextManager";
import { ContextItem } from "./context-item";
import { AnthropicProvider } from "./anthropic-aiProvider";
import { GeminiProvider } from "./gemini-aiProvider";

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

// Global provider instance that can be accessed throughout the extension
let globalProvider: AIProvider;

export function initializeAIProvider(
  context: vscode.ExtensionContext,
  contextManager: ContextManager
): AIProvider {
  // Get the selected model from context manager or default to 'anthropic'
  const selectedModel = context.globalState.get<string>('brain-reducer.selectedModel', 'anthropic');
  
  // Create the appropriate provider based on the selected model
  globalProvider = createProviderForModel(selectedModel, context, contextManager);

  // No need to register a command here anymore
  // The ChatView will call switchAIProvider directly

  return globalProvider;
}

/**
 * Creates an AI provider instance for the specified model type
 */
function createProviderForModel(
  modelType: string,
  context: vscode.ExtensionContext,
  contextManager: ContextManager
): AIProvider {
  if (modelType === 'gemini') {
    const provider = new GeminiProvider(context, contextManager);
    // Update VS Code context for UI elements
    vscode.commands.executeCommand(
      "setContext",
      "brain-reducer.geminiApiKeyConfigured",
      provider.isConfigured()
    );
    return provider;
  } else {
    // Default to Anthropic
    const provider = new AnthropicProvider(context, contextManager);
    // Update VS Code context for UI elements
    vscode.commands.executeCommand(
      "setContext",
      "brain-reducer.apiKeyConfigured",
      provider.isConfigured()
    );
    return provider;
  }
}

/**
 * Switches the global AI provider to the specified model type
 */
export async function switchAIProvider(
  modelType: string,
  context: vscode.ExtensionContext,
  contextManager: ContextManager
): Promise<AIProvider> {
  console.log(`Switching AI provider to ${modelType}`);
  
  // Store the selected model in global state
  await context.globalState.update('brain-reducer.selectedModel', modelType);
  
  // Create the new provider
  globalProvider = createProviderForModel(modelType, context, contextManager);
  
  // Log the switch
  console.log(`AI provider switched to ${modelType}`);

  return globalProvider;
}

/**
 * Gets the current global AI provider instance
 */
export function getGlobalAIProvider(): AIProvider {
  return globalProvider;
}
