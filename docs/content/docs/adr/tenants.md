# ADR: Multi-Tenant Authentication & Workspace Architecture

**Status:** Accepted
**Date:** 2025-12-01
**Authors:** Alex Ultra, Claude

## Context

HyperCanvas needs to evolve from a local development tool to a SaaS platform with:

- Multi-user authentication
- Workspace-based multi-tenancy (one user can belong to multiple workspaces)
- Role-based access control within workspaces
- Data isolation between tenants
- Kubernetes (k3s) deployment readiness

## Decision

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Bun | Already in use, excellent performance |
| Framework | Hono | Already in use, lightweight, fast |
| ORM | Drizzle | Type-safe, lightweight, works great with Bun |
| Database | PostgreSQL | Required for k8s (SQLite has single-node limitations) |
| Auth | OAuth (Google + GitHub) | No password management, better UX |
| Email | Resend | Best DX for TypeScript/React, React Email support |
| Rate Limiting | Redis | Required for horizontal scaling |
| Session | JWT (access) + httpOnly cookies (refresh) | Stateless, secure |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Load Balancer / Ingress                   │
└─────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │  Bun Pod │  │  Bun Pod │  │  Bun Pod │
              │  (API)   │  │  (API)   │  │  (API)   │
              └────┬─────┘  └────┬─────┘  └────┬─────┘
                   │             │             │
                   └──────┬──────┴──────┬──────┘
                          │             │
                    ┌─────▼─────┐ ┌─────▼─────┐
                    │  Redis    │ │ PostgreSQL│
                    │ (sessions,│ │ (data,    │
                    │  rate     │ │  RLS)     │
                    │  limits)  │ │           │
                    └───────────┘ └───────────┘
```

## Database Schema (ERD)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AUTHENTICATION                              │
└─────────────────────────────────────────────────────────────────────────┘

┌────────────────────┐       ┌─────────────────────┐
│      users         │       │   oauth_accounts    │
├────────────────────┤       ├─────────────────────┤
│ id: uuid [PK]      │──┐    │ id: uuid [PK]       │
│ email: varchar     │  │    │ user_id: uuid [FK]  │──┐
│ email_verified: ts │  │    │ provider: enum      │  │
│ name: varchar      │  │    │ provider_id: varchar│  │
│ avatar_url: text   │  │    │ access_token: text  │  │
│ deleted_at: ts?    │  │    │ refresh_token: text?│  │
│ created_at: ts     │  │    │ expires_at: ts?     │  │
│ updated_at: ts     │  │    │ created_at: ts      │  │
└────────────────────┘  │    └─────────────────────┘  │
         │              │              │               │
         │              └──────────────┼───────────────┘
         │                             │
         │    ┌────────────────────────┘
         │    │
         ▼    ▼
┌────────────────────┐       ┌─────────────────────┐
│  refresh_tokens    │       │    audit_logs       │
├────────────────────┤       ├─────────────────────┤
│ id: uuid [PK]      │       │ id: uuid [PK]       │
│ user_id: uuid [FK] │       │ user_id: uuid [FK]  │
│ token_hash: varchar│       │ action: varchar     │
│ expires_at: ts     │       │ entity_type: varchar│
│ revoked_at: ts?    │       │ entity_id: uuid?    │
│ user_agent: text?  │       │ ip_address: inet?   │
│ ip_address: inet?  │       │ user_agent: text?   │
│ created_at: ts     │       │ metadata: jsonb?    │
└────────────────────┘       │ created_at: ts      │
                             └─────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                              MULTI-TENANCY                               │
└─────────────────────────────────────────────────────────────────────────┘

┌────────────────────┐       ┌─────────────────────┐
│    workspaces      │       │ workspace_members   │
├────────────────────┤       ├─────────────────────┤
│ id: uuid [PK]      │◄──────│ workspace_id: uuid  │──┐
│ name: varchar      │       │ user_id: uuid [FK]  │──┼──► users
│ slug: varchar [UQ] │       │ role: enum          │  │
│ owner_id: uuid [FK]│───────│ invited_by: uuid?   │  │
│ deleted_at: ts?    │       │ invited_at: ts?     │  │
│ created_at: ts     │       │ joined_at: ts       │  │
│ updated_at: ts     │       │ [PK: workspace_id,  │  │
└────────────────────┘       │      user_id]       │  │
         │                   └─────────────────────┘  │
         │                                            │
         │    ┌───────────────────────────────────────┘
         │    │
         ▼    ▼
┌────────────────────┐       ┌─────────────────────┐
│ workspace_invites  │       │      projects       │
├────────────────────┤       ├─────────────────────┤
│ id: uuid [PK]      │       │ id: uuid [PK]       │
│ workspace_id: uuid │       │ workspace_id: uuid  │──► workspaces
│ email: varchar     │       │ name: varchar       │
│ role: enum         │       │ path: varchar       │
│ token: varchar [UQ]│       │ ... (existing cols) │
│ invited_by: uuid   │       │ created_at: ts      │
│ expires_at: ts     │       │ updated_at: ts      │
│ accepted_at: ts?   │       └─────────────────────┘
│ created_at: ts     │
└────────────────────┘

ROLES ENUM:
  - owner    : Full control, can delete workspace, transfer ownership
  - admin    : Manage members, projects, settings (except delete workspace)
  - member   : Create/edit projects, view all workspace data
  - viewer   : Read-only access to projects
```

## Drizzle Schema

```typescript
// server/database/schema/auth.ts

import { pgTable, uuid, varchar, text, timestamp, inet, pgEnum } from 'drizzle-orm/pg-core';

export const oauthProviderEnum = pgEnum('oauth_provider', ['google', 'github']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  name: varchar('name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const oauthAccounts = pgTable('oauth_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: oauthProviderEnum('provider').notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(), // SHA-256
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ipAddress: inet('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// server/database/schema/workspaces.ts

export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'admin', 'member', 'viewer']);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: workspaceRoleEnum('role').notNull().default('member'),
  invitedBy: uuid('invited_by').references(() => users.id),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
}));

export const workspaceInvites = pgTable('workspace_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  role: workspaceRoleEnum('role').notNull().default('member'),
  token: varchar('token', { length: 64 }).notNull().unique(), // nanoid
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// server/database/schema/audit.ts

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  action: varchar('action', { length: 100 }).notNull(), // e.g., 'user.login', 'workspace.member.added'
  entityType: varchar('entity_type', { length: 50 }), // e.g., 'workspace', 'project'
  entityId: uuid('entity_id'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata'), // Additional context
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

## Row Level Security (RLS)

PostgreSQL RLS ensures data isolation at database level:

```sql
-- Enable RLS on projects table
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see projects in their workspaces
CREATE POLICY projects_workspace_isolation ON projects
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = current_setting('app.current_user_id')::uuid
    )
  );

-- Set user context in each request (middleware sets this)
SET LOCAL app.current_user_id = 'user-uuid-here';
```

## Module Structure

```
server/
├── database/
│   ├── schema/
│   │   ├── auth.ts           # users, oauth_accounts, refresh_tokens
│   │   ├── workspaces.ts     # workspaces, members, invites
│   │   ├── projects.ts       # projects (migrated from current)
│   │   ├── audit.ts          # audit_logs
│   │   └── index.ts          # Re-exports all schemas
│   ├── migrations/           # Drizzle migrations
│   ├── db.ts                 # Drizzle client + connection pool
│   └── seed.ts               # Development seed data
│
├── modules/
│   ├── auth/
│   │   ├── routes.ts         # /api/auth/*
│   │   ├── service.ts        # Business logic
│   │   ├── oauth/
│   │   │   ├── google.ts     # Google OAuth flow
│   │   │   └── github.ts     # GitHub OAuth flow (integrate existing)
│   │   ├── tokens.ts         # JWT generation, validation
│   │   └── types.ts          # Auth-related types
│   │
│   ├── users/
│   │   ├── routes.ts         # /api/users/*
│   │   ├── service.ts        # User CRUD, profile
│   │   └── types.ts
│   │
│   ├── workspaces/
│   │   ├── routes.ts         # /api/workspaces/*
│   │   ├── service.ts        # Workspace CRUD
│   │   ├── members.ts        # Member management
│   │   ├── invites.ts        # Invite flow
│   │   └── types.ts
│   │
│   └── email/
│       ├── client.ts         # Resend client
│       ├── templates/        # React Email templates
│       │   ├── invite.tsx
│       │   └── welcome.tsx
│       └── service.ts
│
├── middleware/
│   ├── auth.ts               # JWT validation, user context
│   ├── workspace.ts          # Workspace context, RLS setup
│   ├── rate-limit.ts         # Redis-based rate limiting
│   └── error-handler.ts      # Unified error handling
│
├── lib/
│   ├── redis.ts              # Redis client
│   ├── crypto.ts             # Password hashing, token generation
│   └── validation.ts         # Zod schemas
│
└── index.ts                  # Hono app with all routes
```

## API Endpoints

### Authentication

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/auth/google` | Initiate Google OAuth | No |
| GET | `/api/auth/google/callback` | Google OAuth callback | No |
| GET | `/api/auth/github` | Initiate GitHub OAuth | No |
| GET | `/api/auth/github/callback` | GitHub OAuth callback | No |
| POST | `/api/auth/refresh` | Refresh access token | Cookie |
| POST | `/api/auth/logout` | Revoke refresh token | Cookie |
| GET | `/api/auth/me` | Get current user | JWT |

### Users

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/users/me` | Get current user profile | JWT |
| PATCH | `/api/users/me` | Update profile | JWT |
| DELETE | `/api/users/me` | Soft delete account | JWT |

### Workspaces

| Method | Path | Description | Auth | Roles |
|--------|------|-------------|------|-------|
| GET | `/api/workspaces` | List user's workspaces | JWT | any |
| POST | `/api/workspaces` | Create workspace | JWT | - |
| GET | `/api/workspaces/:id` | Get workspace | JWT | any |
| PATCH | `/api/workspaces/:id` | Update workspace | JWT | owner, admin |
| DELETE | `/api/workspaces/:id` | Delete workspace | JWT | owner |
| GET | `/api/workspaces/:id/members` | List members | JWT | any |
| POST | `/api/workspaces/:id/members` | Add member (direct) | JWT | owner, admin |
| PATCH | `/api/workspaces/:id/members/:userId` | Update role | JWT | owner, admin |
| DELETE | `/api/workspaces/:id/members/:userId` | Remove member | JWT | owner, admin |
| POST | `/api/workspaces/:id/invites` | Send invite | JWT | owner, admin |
| GET | `/api/workspaces/:id/invites` | List pending invites | JWT | owner, admin |
| DELETE | `/api/workspaces/:id/invites/:inviteId` | Cancel invite | JWT | owner, admin |
| POST | `/api/invites/:token/accept` | Accept invite | JWT | - |

## Authentication Flow

### OAuth Login (Google/GitHub)

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client  │     │   API    │     │  OAuth   │     │ Database │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │
     │ GET /auth/google               │                │
     │───────────────►│                │                │
     │                │                │                │
     │ 302 Redirect to Google         │                │
     │◄───────────────│                │                │
     │                │                │                │
     │ User authorizes│                │                │
     │───────────────────────────────►│                │
     │                │                │                │
     │ Callback with code             │                │
     │◄───────────────────────────────│                │
     │                │                │                │
     │ GET /auth/google/callback?code=...             │
     │───────────────►│                │                │
     │                │                │                │
     │                │ Exchange code for tokens       │
     │                │───────────────►│                │
     │                │◄───────────────│                │
     │                │                │                │
     │                │ Find/create user               │
     │                │───────────────────────────────►│
     │                │◄───────────────────────────────│
     │                │                │                │
     │                │ Create refresh token           │
     │                │───────────────────────────────►│
     │                │◄───────────────────────────────│
     │                │                │                │
     │ 302 Redirect + Set-Cookie (refresh)            │
     │ + access_token in URL fragment                  │
     │◄───────────────│                │                │
     │                │                │                │
```

### Token Refresh

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client  │     │   API    │     │  Redis   │
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │
     │ POST /auth/refresh              │
     │ Cookie: refresh_token=xxx       │
     │───────────────►│                │
     │                │                │
     │                │ Check rate limit
     │                │───────────────►│
     │                │◄───────────────│
     │                │                │
     │                │ Validate refresh token (DB)
     │                │                │
     │                │ Generate new access token
     │                │                │
     │ 200 { accessToken }             │
     │◄───────────────│                │
     │                │                │
```

## Middleware Chain

```typescript
// Request flow through middleware

app.use('*', errorHandler);           // Catch all errors
app.use('*', requestId);              // Add X-Request-ID
app.use('/api/*', rateLimiter);       // Rate limit all API calls

// Auth routes (no auth required)
app.route('/api/auth', authRoutes);

// Protected routes
app.use('/api/*', authMiddleware);    // Validate JWT, set c.user

// Workspace-scoped routes
app.use('/api/workspaces/:id/*', workspaceMiddleware);  // Check membership, set c.workspace, setup RLS
```

## Security Considerations

### JWT Configuration

```typescript
// Access Token (short-lived, stateless)
{
  alg: 'RS256',           // Asymmetric for production
  exp: 15 * 60,           // 15 minutes
  payload: {
    sub: userId,
    email: userEmail,
    type: 'access'
  }
}

// Refresh Token (long-lived, stored in DB)
{
  alg: 'RS256',
  exp: 7 * 24 * 60 * 60,  // 7 days
  payload: {
    sub: userId,
    jti: tokenId,         // For revocation
    type: 'refresh'
  }
}
```

### Cookie Settings

```typescript
const refreshCookieOptions = {
  httpOnly: true,         // No JS access
  secure: true,           // HTTPS only
  sameSite: 'strict',     // CSRF protection
  path: '/api/auth',      // Only sent to auth endpoints
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};
```

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/auth/*` | 10 req | 1 min |
| `/api/auth/refresh` | 5 req | 1 min |
| `/api/workspaces/*/invites` | 20 req | 1 hour |
| General API | 100 req | 1 min |

## Kubernetes Deployment

### Required Resources

```yaml
# PostgreSQL StatefulSet with PersistentVolume
# Redis Deployment (or use managed Redis)
# Bun API Deployment (2+ replicas)
# Ingress with TLS
# Secrets for:
#   - JWT private/public keys
#   - OAuth client secrets
#   - Database credentials
#   - Redis password
#   - Resend API key
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@postgres:5432/hypercanvas

# Redis
REDIS_URL=redis://redis:6379

# JWT (RS256)
JWT_PRIVATE_KEY=<base64-encoded-pem>
JWT_PUBLIC_KEY=<base64-encoded-pem>

# OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# Email
RESEND_API_KEY=re_...

# App
APP_URL=https://app.hypercanvas.io
COOKIE_DOMAIN=.hypercanvas.io
```

## Migration Strategy

### Phase 1: Database Migration (SQLite → PostgreSQL)

1. Setup PostgreSQL locally + Drizzle
2. Create new schema with Drizzle migrations
3. Write migration script for existing data
4. Test migration on staging

### Phase 2: Auth Implementation

1. Implement OAuth flows (Google, GitHub)
2. JWT + refresh token infrastructure
3. Auth middleware
4. Integrate existing GitHub token for repo access

### Phase 3: Multi-Tenancy

1. Workspaces CRUD
2. Member management + invites
3. RLS policies
4. Migrate projects to workspace-scoped

### Phase 4: Email + Polish

1. Resend integration
2. Invite emails
3. Audit logging
4. Rate limiting

## Decisions (Resolved)

1. **Personal workspace**: Auto-create on signup
   - Every new user gets a personal workspace with slug derived from email/name

2. **Workspace switching UX**: URL-based routing
   - Pattern: `/w/:slug/projects`, `/w/:slug/settings`
   - localStorage for last used workspace (redirect on `/`)

3. **GitHub OAuth scope**: Keep existing repo scope
   - Same OAuth app for auth and repo integration
   - Simplifies UX, no need to re-authorize later

4. **Existing projects**: Drop, no migration
   - Clean slate for SaaS launch
   - SQLite data is development-only, not worth migrating

## References

- [Hono Documentation](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [OAuth 2.0 Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
