# KurdBox AI - VSCode Extension

🤖 AI Chat & Inline Completions powered by KURDOST Gateway

## Features

- 💬 **AI Chat Panel** - Interactive chat with multiple AI providers
- 🤖 **Agent Mode** - Autonomous AI agent with tool calling
- ⚡ **Inline Completions** - Smart code completions as you type
- 🔧 **Multi-Provider Support** - Groq, SambaNova, Gemini, Cerebras, Mistral, and more
- 🎯 **Smart Model Selection** - Automatic model selection based on context
- 🔄 **Auto Server Detection** - Automatically detects KurdBox backend server
- 📊 **Streaming Responses** - Real-time streaming for faster responses

## Installation

### From VSIX (Development)
```bash
code --install-extension kurdbox-1.0.0.vsix
```

### From Marketplace (Coming Soon)
Search for "KurdBox AI" in VSCode Extensions

## Setup

1. **Start the KurdBox Backend**
```bash
cd backend
.\start_dev.ps1
```

2. **The extension will auto-detect the server** - no manual configuration needed!

3. **Add AI Providers**
- Open the KurdBox panel in VSCode
- Click on Settings (⚙)
- Add your API keys (Groq, SambaNova, etc.)

## Commands

- `Ctrl+Shift+K` - Open Chat Panel
- `Ctrl+Shift+A` - Open Agent Panel  
- `Ctrl+Shift+D` - Debug Error

## Configuration

The extension automatically detects the KurdBox backend server. You can also manually configure:

```json
{
  "kurdbox.serverUrl": "http://localhost:5001",
  "kurdbox.defaultModel": "best-70b",
  "kurdbox.inlineCompletions": true
}
```

## Development

### Auto-Reload (Recommended for Development)
```bash
cd extension
npm run dev
```

This will watch for file changes and automatically rebuild & reinstall the extension.

### Manual Build
```bash
cd extension
npm run compile
npm run package
code --install-extension ./kurdbox-1.0.0.vsix --force
```

### Quick Reload
```bash
cd extension
npm run quick-reload
```

## Supported Providers

- Groq (Cloud)
- SambaNova
- Google Gemini
- Cerebras
- Mistral
- OpenRouter
- NVIDIA NIM
- GitHub Models
- Perplexity
- Fireworks AI

## License

MIT License - See LICENSE file for details

## Support

For issues and feature requests, please visit our GitHub repository.
