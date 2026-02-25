# Development Patterns & Conventions

## Recent Focus Areas (Feb 2026)

Based on last 100 commits:

- **37 fix** — mostly editor, auth, canvas bugs
- **23 refactor** — server route extraction, sidebar hooks, panel layout
- **17 feat** — VS Code extension features, undo/redo, auth tokens
- **11 chore** — Claude settings, config updates

Top scopes: editor (22), ext (11), server (9), ide (7), auth (7)

## Common Refactoring Patterns

1. **Route extraction**: Monolith server/index.ts → individual sub-routers
2. **Hook extraction**: Large components → custom hooks (e.g., useSidebarPanelLayout)
3. **Section extraction**: Large sidebars → section components
4. **DI introduction**: Global singletons → injected services (ComponentScanner)
5. **authFetch migration**: raw fetch → authFetch across client

## Auth Middleware Pattern

```typescript
// Inline middleware on routes, NOT app.use wildcards
app.get('/api/endpoint', authMiddleware, requireEditor, handler)
```

Auth middleware was refactored from wildcard `app.use` to inline per-route.

## File Snapshot Pattern (Undo/Redo)

1. Server middleware intercepts mutating endpoints
2. Saves file content to PostgreSQL fileSnapshots table
3. Returns snapshotId in response
4. Client stores undoSnapshotId / redoSnapshotId
5. Undo → restoreFileSnapshot(undoSnapshotId)

## Partial Staging Technique

When need to stage part of changes:

1. `git add` the whole file
2. Backup current state
3. Edit file to keep only changes for current commit
4. Stage the edited version
5. Restore from backup (don't stage)

## Commit Style

- Conventional commits: `feat|fix|refactor|chore(scope): description`
- English only
- Tests in same commit as functionality
- fixup! for amendments to specific commits
