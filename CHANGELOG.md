# Change Log

All notable changes to the "Brain Reducer" extension will be documented in this file.

## [0.0.7] - 2025-03-27

### Fixed
- Change the title of the command "Brain Reducer: Configure Anthropic API Key" to "Brain Reducer: Configure API Key"

## [0.0.6] - 2025-03-27

### Fixed
- Fixed image handling in Gemini provider
- Improved error handling for image processing
- Added better type safety for Gemini API requests

## [0.0.5] - 2025-03-26
### Fixed
- Fixed dependency bundling issues by including node_modules
- Separated view files from src directory
- Updated all "AI Coder" references to "Brain Reducer"
- Improved extension packaging for better compatibility

## [0.0.4] - 2025-03-26
### Fixed
- Updated packaging scripts to fix dependency issues
- Fixed command registration

## [0.0.3] - 2025-03-26
### Fixed
- Fixed dependency bundling issues
- Updated API key context references
- Improved extension packaging

## [0.0.2] - 2025-03-26
### Changed
- Renamed extension from "AI Coder" to "Brain Reducer"
- Fixed API key configuration for Gemini model
- Improved error handling for API requests

## [0.0.1] - 2025-03-26
### Added
- Initial beta release
- Support for Claude (Anthropic) and Gemini (Google) models
- Chat interface with markdown support
- Context-aware responses based on your current files
- Image upload and analysis
- File browser for adding context
- Model switching between Claude and Gemini

### Known Issues
- Large files may cause token limit issues
- Some language-specific features may not work as expected