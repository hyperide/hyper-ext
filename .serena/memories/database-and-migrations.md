# Database Migrations

## Two-Step Migration System

Runs automatically on every deployment:

1. **Schema migrations** (`drizzle-kit migrate`) — DDL (tables, columns, indexes)
2. **Data migrations** (`scripts/run-data-migrations.ts`) — DML (backfills, transformations)

Both run as K8s init containers before the main app starts (`k8s/base/hypercanvas.yaml`).

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

## Schema Migrations (Drizzle)

**Files**:

- `server/database/schema/` — schema definitions (split by domain)
- `server/database/migrations/` — SQL files that are **executed**
- `server/database/migrations/meta/` — snapshots and journal
- `drizzle.config.ts` — configuration

**Standard workflow**:

```bash
# 1. Modify schema in server/database/schema/

# 2. Generate migration (CRITICAL: use npx, not bunx!)
DATABASE_URL="postgresql://hypercanvas:hypercanvas_dev@localhost:5432/hypercanvas" \
  npx drizzle-kit generate --name descriptive-name

# 3. Review generated SQL

# 4. Commit schema + migration together
git add server/database/schema/ server/database/migrations/
git commit -m "feat(db): add descriptive-name"
```

**How it works**:

- `generate`: compares schema.ts with snapshots → creates SQL + updates snapshots
- `migrate`: reads `__drizzle_migrations` table → executes only unapplied SQL
- Dev mode: `scripts/dev.ts` runs `drizzle-kit migrate` before starting server
- Production: init container runs before pod starts

**Naming**: `NNNN_descriptive-name.sql` — use `--name` flag with lowercase-hyphens.

## Data Migrations

For changes that `drizzle-kit migrate` can't handle (backfills, data transforms).

**File**: `scripts/run-data-migrations.ts`

**Properties**: idempotent (check→run pattern), self-contained, no tracking table, runs on every deploy.

**Adding new migration**:

```typescript
const migrations: Migration[] = [
  // ... existing ...
  {
    name: '0007_your-migration-name',
    check: async () => {
      const result = await sql`SELECT COUNT(*) as count FROM your_table WHERE condition`;
      return Number(result[0].count) > 0;
    },
    run: async () => {
      console.log('  Running...');
      await sql`UPDATE your_table SET col = 'val' WHERE condition`;
    },
  },
];
```

**Rules**: `check()` must return `false` after successful `run()`.

## K8s Execution Order

```yaml
initContainers:
  - name: migrate-schema   # 1. DDL first
    command: ["npx", "drizzle-kit", "migrate"]
  - name: migrate-data     # 2. DML second (may depend on new schema)
    command: ["bun", "run", "scripts/run-data-migrations.ts"]
```

## Bootstrapping New Environment

When DB already has schema (e.g., from `push`):

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT
);
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
VALUES ('0000_baseline', EXTRACT(EPOCH FROM NOW())::BIGINT * 1000);
```

## Connection

`server/database/db.ts` — Drizzle connection with RLS support

## Critical Rules

- **ALWAYS npx, NEVER bunx** for drizzle-kit (bunx silently fails)
- Generate BEFORE applying: `npx drizzle-kit generate --name descriptive-name`
- Review SQL before committing
- Commit schema + migration files together

## Troubleshooting

```bash
kubectl logs -n hypercanvas deployment/hypercanvas -c migrate-schema
kubectl logs -n hypercanvas deployment/hypercanvas -c migrate-data
```

- **Migration not generated** → are you using `npx` instead of `bunx`?
- **Migration runs twice** → check `__drizzle_migrations` table
- **Data migration stuck** → check `check()` condition
- **Data migration fails** → ensure schema migration ran first
