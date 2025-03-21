export interface AiProviderInfo {
    key: string;
    name: string;
}

export interface ModelInfo {
    key: string
    name: string
    provider: AiProviderInfo
}

export const aiProvidersInfo: { [key: string]: AiProviderInfo } = {
    anthropic: {
        key: 'anthropic',
        name: 'Anthropic',
    }
} as const

export const modelsInfo: { [key: string]: ModelInfo } = {
    'claude-3-5-sonnet-latest': {
        key: 'claude-3-5-sonnet-latest',
        name: 'Claude-3.5',
        provider: aiProvidersInfo.anthropic
    },
    'claude-3-7-sonnet-latest': {
        key: 'claude-3-7-sonnet-latest',
        name: 'Claude-3.7',
        provider: aiProvidersInfo.anthropic
    }
} as const