# Brain Reducer

Brain Reducer is a VS Code extension that provides AI-powered coding assistance using Claude (Anthropic) and Gemini (Google) models.

## Features

- Chat with AI about your code
- Get code suggestions and explanations
- Analyze your codebase with AI
- Support for both Claude and Gemini models
- Image upload and analysis
- Context-aware responses based on your current files

## Installation

1. Install the extension from the VS Code Marketplace
2. Configure your API key(s):
   - For Claude: Get an API key from [Anthropic](https://console.anthropic.com/)
   - For Gemini: Get an API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

## Usage

### Starting a Chat

1. Open the Command Palette (Ctrl+Shift+P)
2. Run "Brain Reducer: Open Chat"
3. Type your question in the chat input

### Switching Models

Use the model selector dropdown in the chat interface to switch between Claude and Gemini.

### Adding Context

Click the "Add Files/Folders" button to include specific files or folders as context for the AI.

### Uploading Images

Click the image upload button to include images in your conversation.

## Requirements

- VS Code 1.80.0 or higher
- An API key from Anthropic (Claude) or Google (Gemini)

## Privacy

Brain Reducer sends your code and queries to the selected AI provider (Anthropic or Google). Please review their privacy policies:
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google AI Privacy Policy](https://ai.google.dev/privacy)

## License

This project is licensed under the MIT License.
