import Anthropic from "@anthropic-ai/sdk";
import { ContextManager } from "../context/context-manager";
import { aiProvidersInfo } from "./ai-providers-info";
import { AiProvider } from "./ai-provider";
import { MessageParam } from "@anthropic-ai/sdk/resources/index.mjs";

export class AnthropicProvider implements AiProvider {
    static PROVIDER_KEY = 'anthropic'

    private static instance: AnthropicProvider;
    static getInstance() {
        if (!this.instance) {
            const ctx = ContextManager.getInstance();
            const apiKey = ctx.getAPIKey(aiProvidersInfo[AnthropicProvider.PROVIDER_KEY].key);
            this.instance = new AnthropicProvider(apiKey)
        }
        return this.instance;
    }

    private client: Anthropic;
    private constructor(apiKey: string) {
        this.client = new Anthropic({
            apiKey: apiKey
        })
    }

    async generateResponse(message: string, onChunkResponse?: (chunkText: string) => void) {
        const ctx = ContextManager.getInstance();
        const currentModel = ctx.getCurrentModel();
        const stream = await this.client.messages.create({
            model: currentModel.key,
            max_tokens: 4000,
            messages: this.prepareMessages(message),
            temperature: 0.7,
            stream: true
        });

        let fullResponseText = '';
        for await (const chunk of stream) {
            console.log('Receive new chunk:', chunk);

            switch (chunk.type) {
                case "message_start":
                    break;
                case "message_stop":
                    break;
                case "message_delta":
                    break;
                case "content_block_start":
                    break;
                case "content_block_stop":
                    break;
                case "content_block_delta":
                    break;
            }
        }

        return fullResponseText;
    }

    private prepareMessages(newMessage: string) {
        const ctx = ContextManager.getInstance()

        const messages: MessageParam[] = [
            {
                role: 'assistant',
                content: 'I am an AI coding assistant. I can help you with programming tasks, explain code, and provide suggestions.'
            },
            // ...
            {
                role: 'user',
                content: newMessage
            }
        ]

        return messages;
    }
}