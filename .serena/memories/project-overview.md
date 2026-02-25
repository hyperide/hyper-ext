# HyperIDE / HyperCanvas — Project Overview

## What It Is

Visual React component builder and editor (SaaS + VS Code extension).
User projects run in Docker containers (locally) or K8s pods (production).

## Tech Stack

- **Runtime**: Bun 1.3+
- **Frontend**: React 18.3, TypeScript 5.9, Zustand 5.0, Tailwind CSS 3.4, shadcn/ui
- **Backend**: Hono 4.x on Bun native server (main.ts)
- **Database**: PostgreSQL + Drizzle ORM (schema in server/database/schema/)
- **AI**: Anthropic Claude SDK (primary), OpenAI (secondary)
- **Build**: esbuild (VS Code ext), Vite-like custom build (client)
- **Testing**: Vitest, memfs, Playwright
- **Linting**: Biome 2.x
- **Deployment**: K8s + ArgoCD, Docker for user projects

## Key Architectural Decisions

1. Iframe-based preview with same-origin proxy for DOM access
2. Two-layer path rewriting (server + injected client script)
3. Canvas Engine with Command pattern for undo/redo
4. Platform abstraction for SaaS / VS Code code sharing
5. Bun native WebSocket for HMR proxy (replaced Express Nov 2025)

## Active Branches

- `develop` — main development branch
- `main` — production (deployed via ArgoCD)
- `vscode-ext` — VS Code extension feature work
- `fixes` — hotfix branch

## Package Manager Rules

- **bun** for everything EXCEPT VS Code extension and drizzle-kit
- **npm** for vscode-extension (vsce requires npm list)
- **npx** for drizzle-kit (bunx silently fails)
