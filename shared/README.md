# Shared Types and Utilities

Types and utilities shared across all parts of the monorepo
(client, server, VS Code extensions).

## Modules

- `escapeRegExp.ts` — regex escaping utility
- `runtime-error.ts` — RuntimeError interface (iframe error overlays)
- `fix-session.ts` — AI auto-fix session types, error/success pattern detection
- `api.ts` — shared API types
- `types/canvas.ts` — canvas instance types, type guards, converters
- `types/props.ts` — component prop types
- `types/annotations.ts` — annotation types, type guards, ID generation
- `canvas-interaction/` — DOM handlers for canvas interaction
  (click, keyboard, overlay, styles)
- `ai-agent.ts`, `ai-agent-core.ts`, `ai-agent-tools.ts` — AI agent types and tools

## Testing

```bash
bun test shared
```
