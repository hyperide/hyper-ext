# Hyper Preview

Visual editor for React components inside VS Code.
Edit styles, inspect props, and preview changes — all without leaving your editor.

## Features

- **Live Preview** — see your React components rendered in real time
- **Component Explorer** — browse and navigate your project's component tree
- **Style Inspector** — view and edit Tailwind classes and CSS properties
- **AI Chat** — ask AI to modify components, generate code, and explain patterns
- **Dev Server** — start and manage your project's dev server from VS Code
- **Code ↔ Canvas** — click an element in preview to jump to source, and vice versa

## Quick Start

1. Install the extension from the VS Code Marketplace
2. Open a React project in VS Code
3. Run `Cmd+Shift+P` → **Hyper: Open Preview**
4. (Optional) Start the dev server: `Cmd+Shift+P` → **Hyper: Start Dev Server**

## AI Configuration

The extension includes an AI assistant for component editing and code generation.

1. Run `Cmd+Shift+P` → **Hyper: Configure AI API Key**
2. Select your preferred provider in settings (see table below)

Recommended: **GLM via Z.ai** — flat-rate starting from $10/mo.

## Settings

| Setting | Default | Description |
|---|---|---|
| `hypercanvas.ai.provider` | `glm` | AI provider: `claude`, `openai`, `glm`, `proxy`, `opencode` |
| `hypercanvas.ai.backend` | — | Backend for proxy/opencode providers (e.g. `gemini`, `deepseek`) |
| `hypercanvas.ai.model` | — | Model identifier (e.g. `claude-sonnet-4-20250514`, `gpt-4o`) |
| `hypercanvas.ai.baseURL` | — | Custom base URL for AI provider API |
| `hypercanvas.devServer.autoStart` | `false` | Auto-start dev server when opening preview |
| `hypercanvas.preview.defaultPort` | `3000` | Default port for dev server |
| `hypercanvas.preview.syncPositions` | `true` | Sync cursor position with canvas selection |

## Commands

| Command | Keybinding | Description |
|---|---|---|
| Hyper: Open Preview | — | Open the visual preview panel |
| Hyper: Refresh Preview | — | Refresh the preview iframe |
| Hyper: Go to Visual | `Cmd+Shift+V` | Jump from code to canvas element |
| Hyper: Start Dev Server | — | Start the project dev server |
| Hyper: Stop Dev Server | — | Stop the running dev server |
| Hyper: Configure AI API Key | — | Set API key for the selected AI provider |
| Hyper: Open Explorer | — | Open the component explorer sidebar |
| Hyper: Open Inspector | — | Open the style inspector sidebar |
| Hyper: Open AI Chat | — | Open the AI chat panel |

## Requirements

- VS Code 1.74 or later
- A React project (JSX/TSX)

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture details, build instructions, and contribution guide.

## License

[Elastic License 2.0](https://www.elastic.co/licensing/elastic-license)

**You can:** use, copy, modify, and redistribute the code for internal or commercial projects.

**You cannot:** provide this software (or a modified version) as a hosted/managed service
competing with HyperIDE, or publish editor extensions (VS Code, JetBrains, etc.)
derived from this code.
