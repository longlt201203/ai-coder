import { ChatContent } from "./chat-content";

export type ChatHistoryItem = {
    role: 'user' | 'assistant';
    content: ChatContent;
};