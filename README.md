# AI Coder

AI Coder is a VS Code extension that provides AI-powered coding assistance using the Claude API from Anthropic. It helps you write, understand, and refactor code with natural language interactions.

## Features

- **AI Chat Interface**: Interact with Claude AI directly within VS Code
- **Context-Aware Responses**: The AI understands your current file and project context
- **Code Generation**: Generate code snippets based on your requirements
- **File Context Management**: Easily add files to provide context for your questions
- **Syntax Highlighting**: Code snippets in responses match your VS Code theme

## Requirements

- VS Code 1.98.0 or higher
- An Anthropic API key (Claude)

## Installation

1. Install the extension from the VS Code Marketplace
2. Open the Command Palette (Ctrl+Shift+P)
3. Run the command "AI Coder: Configure API Key"
4. Enter your Anthropic API key when prompted

## Usage

### Starting a Chat

1. Open the Command Palette (Ctrl+Shift+P)
2. Run "AI Coder: Open Chat"
3. Type your question or request in the chat panel

### Adding Context

1. Click the "Add Context" button in the chat panel
2. Select files from your project to provide as context
3. The AI will use these files to provide more relevant answers

### Example Prompts

- "Explain how this function works"
- "Refactor this code to be more efficient"
- "Create a unit test for this class"
- "Add error handling to this function"
- "Convert this JavaScript code to TypeScript"

## Privacy

This extension sends code snippets and your prompts to Anthropic's Claude API. Please review Anthropic's privacy policy for details on how your data is handled.

## License

This project is licensed under the MIT License.
