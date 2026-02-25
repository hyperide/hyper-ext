# Hyper Preview

Visual editor for React components inside VS Code. Edit styles, inspect elements, and use AI assistance — all without leaving your editor.

## Features

- **Live Preview** — see your React components rendered in real-time as you edit code
- **Visual Inspector** — click on any element in the preview to see and edit its styles
- **Element Tree** — navigate your component hierarchy visually
- **Code ↔ Preview Sync** — click in code to highlight in preview, click in preview to jump to code (`Cmd+Shift+V`)
- **AI Assistant** — generate and modify components using Claude, OpenAI, GLM, or compatible providers
- **Dev Server Management** — start/stop your project's dev server directly from VS Code
- **Tailwind CSS Support** — edit Tailwind classes visually through the inspector
- **Design Mode** — keyboard shortcuts for element manipulation (delete, duplicate, copy/paste)

## Getting Started

### Prerequisites

- VS Code 1.74+
- A React project (Vite, Next.js, or Create React App)
- Node.js 18+

### Install from Source

```bash
git clone https://github.com/hyperide/hyper-ext.git
cd hyper-ext

# Install root dependencies
bun install

# Build and package the extension
cd vscode-extension/hypercanvas-preview
npm install
npm run package

# Install the generated .vsix file
code --install-extension hypercanvas-preview-0.1.0.vsix
```

### Usage

1. Open a React project in VS Code
2. Run `Hyper: Open Preview` from the command palette (`Cmd+Shift+P`)
3. The extension detects your framework and starts the dev server
4. Click elements in the preview to inspect and edit them

## Commands

| Command | Description |
|---------|-------------|
| `Hyper: Open Preview` | Open the visual preview panel |
| `Hyper: Start Dev Server` | Start the project's dev server |
| `Hyper: Stop Dev Server` | Stop the running dev server |
| `Hyper: Go to Visual` | Jump from code cursor to element in preview (`Cmd+Shift+V`) |
| `Hyper: Configure AI API Key` | Set up AI provider credentials |
| `Hyper: Open Explorer` | Open the component tree sidebar |
| `Hyper: Open Inspector` | Open the style inspector sidebar |
| `Hyper: Open Logs & AI Chat` | Open the AI chat and dev server logs panel |

## AI Configuration

The extension supports multiple AI providers for component generation and modification:

| Provider | Setting | Models |
|----------|---------|--------|
| **Claude** (default) | `claude` | claude-sonnet-4-20250514, etc. |
| **OpenAI** | `openai` | gpt-4o, etc. |
| **GLM** | `glm` | glm-4 |
| **Proxy** | `proxy` | Gemini, DeepSeek, Mistral, Groq |
| **OpenCode** | `opencode` | Gemini, DeepSeek, Qwen |

Configure via VS Code settings (`hypercanvas.ai.*`) or the `Hyper: Configure AI API Key` command.

## Project Structure

```
hyper-ext/
├── vscode-extension/          # VS Code extension
│   └── hypercanvas-preview/
│       ├── src/
│       │   ├── extension.ts           # Extension entry point
│       │   ├── services/              # Dev server, AST, file structure
│       │   ├── bridges/               # AI and editor communication
│       │   ├── webview/               # AI chat & logs panel
│       │   ├── webview-left/          # Explorer sidebar
│       │   ├── webview-right/         # Inspector sidebar
│       │   └── webview-preview-panel/ # Preview canvas
│       ├── esbuild.js                 # Build configuration
│       └── package.json
├── client/                    # Shared React components and engine
│   ├── lib/canvas-engine/     # Canvas manipulation engine
│   ├── components/            # UI components (shadcn/ui)
│   └── stores/                # State management (Zustand)
├── shared/                    # Shared types and AI agent logic
│   ├── canvas-interaction/    # Click, keyboard, overlay handlers
│   └── types/                 # TypeScript type definitions
├── lib/                       # Core libraries
│   ├── ast/                   # AST parsing and manipulation (Babel)
│   ├── tailwind/              # Tailwind class parsing and generation
│   └── component-scanner/     # Component discovery
└── templates/                 # Project templates (Vite, Next.js, Remix)
```

## Development

```bash
# Watch mode (rebuild on changes)
cd vscode-extension/hypercanvas-preview
npm run watch

# Then press F5 in VS Code to launch Extension Development Host
```

### Building

```bash
# Production build
npm run build

# Package as .vsix
npm run package
```

### Running Tests

```bash
# From repo root
bun test
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run tests (`bun test`)
5. Commit using conventional commits (`feat: add your feature`)
6. Open a Pull Request

### Code Style

- TypeScript for all code
- Biome for linting and formatting
- Follow existing patterns in the codebase

## License

[Elastic License 2.0](LICENSE) (ELv2)
