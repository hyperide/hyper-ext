# Database & Migrations

## Schema Location

`server/database/schema/` — split by domain:

- `index.ts` — re-exports all
- `projects.ts` — projects, members, invites
- `auth.ts` — users, auth tokens
- `workspaces.ts` — workspaces
- `comments.ts` — canvas comments
- `github-app.ts` — GitHub app integration
- `file-snapshots.ts` — file snapshots for undo/redo
- `audit.ts` — audit logs
- `relations.ts` — table relationships

## Two-Step Migration System

1. **Schema** (`npx drizzle-kit migrate`) — DDL
2. **Data** (`bun scripts/run-data-migrations.ts`) — DML

Both run as K8s init containers before app starts.

## Critical Rules

- **ALWAYS npx, NEVER bunx** for drizzle-kit (bunx silently fails)
- Generate BEFORE applying: `npx drizzle-kit generate --name descriptive-name`
- Review SQL before committing
- Commit schema + migration files together

## Data Migrations

In `scripts/run-data-migrations.ts`:

- Idempotent (check() before run())
- Self-contained
- No tracking table
- Runs on every deploy, skips completed ones

## Connection

`server/database/db.ts` — Drizzle connection with RLS support
