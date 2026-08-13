# Public MCP server with OAuth authentication

Date: 2026-06-03
Author: Alex Ultra + Claude
Status: Draft
Linear: HYP-262

## Context

HyperIDE runs **two** independent MCP servers that share `shared/ai-agent-tools.ts`
(`ALL_TOOLS`) but nothing else:

- **In-process extension server** — `vscode-extension/hypercanvas-preview/src/mcp/HyperMcpServer.ts`.
  A `node:http` server bound to `127.0.0.1:0` (`HyperMcpServer.ts:97`), stateless
  `StreamableHTTPServerTransport` per request (`:70`), endpoint `/mcp`, **no auth at all**
  (loopback only). Out of scope for this ticket.
- **SaaS server** — `server/routes/mcp.ts` mounted at `app.route('/api/mcp', …)`
  (`server/index.ts:355`), delegating to `server/services/mcp-server.ts`. This is the
  endpoint HYP-262 targets.

Today's SaaS auth (`server/routes/mcp.ts:13-30`):

1. Read `Authorization: Bearer <token>`.
2. `validateMcpToken(token)` → context, or 401.
3. `handleMcpRequest(workspaceId, projectPath, req)`.

The token (`server/services/mcp-token.ts`) is a `crypto.randomUUID()` stored in an
**in-memory `Map`** (`:18`), TTL 1h with a sliding window (`:44-53`), carrying only
`{ workspaceId, projectPath }`. The only producer is the internal AI agent:
`server/services/ai-agent.ts:322` calls `createMcpToken(...)` and registers it with
OpenCode (`:316-345`) so OpenCode can call our tools over `http://127.0.0.1:PORT/api/mcp`.

So "internal MCP works" means: our own process mints a UUID and hands it to a child
process on loopback. There is **no user identity in the token, no per-user permission
check, and no way for an external client to obtain a token**. That is exactly the gap.

The SaaS already has real human-auth infrastructure, which is the relevant pattern source
(not reusable as-is — see Reality check):

- JWT access/refresh tokens via `jose` — `server/modules/auth/tokens.ts`
  (`generateAccessToken`/`verifyAccessToken`, HS256, `JWT_SECRET`).
- `authMiddleware` (`server/middleware/auth.ts:24`) resolving user from Bearer/cookie/query.
- OAuth **client** flows (HyperIDE logs users in via GitHub/Google) —
  `server/modules/auth/oauth/{github,google}.ts`, routed under `/api/auth`
  (`server/modules/auth/routes.ts:17-18`).
- Project-level access control: `checkProjectAccess(userId, projectId)`
  (`server/middleware/workspace.ts:119`) returning `{ hasAccess, project, workspaceId, role }`,
  and `requireProjectAccess` / `requireEditor` / `setProjectRole` middleware
  (`server/middleware/projectRole.ts`). Roles are `editor | viewer`
  (`server/database/schema/projects.ts:39-41`).
- DB tables (Postgres/Drizzle): `users`, `oauthAccounts`, `refreshTokens`
  (`server/database/schema/auth.ts`) — all **human-login** tables.

## Reality check

The cited files are real and accurate. The danger is not a phantom architecture — it is
**imagined simplicity**. Three conflations must be stated plainly before anyone codes:

### 1. Two different "OAuth" roles — existing oauth/ code is a reference, not reusable infra

`server/modules/auth/oauth/{github,google}.ts` makes HyperIDE an OAuth **client**: a human
logs in, we redirect _out_ to GitHub/Google, get back a code, mint our own JWT session.

HYP-262 needs HyperIDE to be an OAuth **authorization server**: an external MCP client
(Cursor, Windsurf, Claude Desktop) authenticates _against us_, and _we_ issue the token.
Per the MCP authorization spec (2025-03-26, OAuth 2.1) the third-party-delegation flow is
explicitly blessed: the MCP server acts as **both** an OAuth client to an upstream IdP and
an authorization server to the MCP client. That maps cleanly onto reusing our existing
Google/GitHub login for the human-consent step — but the AS half (`/authorize`, `/token`,
`/register`, AS metadata, code/PKCE handling, client registry) **does not exist** and is
net-new. Do **not** "just reuse github.ts."

### 2. SDK OAuth scaffolding is express-based; the codebase is Hono/Bun with zero express

`@modelcontextprotocol/sdk@^1.27.1` (`package.json:29`) ships
`dist/esm/server/auth/{router,provider,handlers/*,providers/proxyProvider}`. The
`proxyProvider` pattern (delegate to an upstream IdP) is conceptually exactly what we want.
**But** `router.d.ts:1` imports `express` and `mcpAuthRouter` returns an express
`RequestHandler`. The repo has **no express dependency** (grep for `from 'express'` →
zero hits) — it's pure Hono on Bun. So `mcpAuthRouter` cannot be dropped in. We either
hand-roll Hono routes against the SDK's `OAuthServerProvider` _interface_, use a
Hono-native AS library, or shim express (worst option).

### 3. OpenAuth.js (the ticket's suggestion) is Hono-native but does NOT do DCR

Verified against openauth.js.org: OpenAuth is itself a Hono app that runs on Bun, acts as
its own authorization server, and issues JWT access tokens. Good — it sidesteps the express
problem. **However** its docs show no support for OAuth 2.0 Dynamic Client Registration
(RFC 7591). The MCP spec says clients **SHOULD** and HyperIDE **SHOULD** support DCR, and
Cursor/Claude Desktop rely on it (they don't know our client_id in advance). Conclusion:
whatever library we pick, **DCR is its own phase** — OpenAuth won't give it for free.

### 4. Today's token has no user identity and no permission enforcement

`mcp-token.ts` stores `{ workspaceId, projectPath }` only, in memory, with no `userId` and
**no `checkProjectAccess` call anywhere in the MCP path**. "User-scoped tokens tied to
workspace/project permissions" is therefore not a small tweak to the OAuth flow — it is a
distinct, independently shippable slice (Phase 1) that is valuable even before any OAuth
ceremony exists, and it's the most obviously TDD-able first move.

### 5. Spec-required surface (target 2025-03-26, the revision the ticket links)

- OAuth 2.1; **PKCE REQUIRED** for all clients.
- AS metadata at `/.well-known/oauth-authorization-server` (RFC 8414); default endpoints
  `/authorize`, `/token`, `/register` derived from the MCP server URL with the path
  discarded (so they live at domain root, **not** under `/api/mcp`).
- DCR via `/register` (RFC 7591) — SHOULD.
- `401` when unauthenticated (with `WWW-Authenticate`), `403` on insufficient scope, `400`
  on malformed request. All endpoints HTTPS; redirect URIs must be localhost or HTTPS and
  must be validated (open-redirect guard).
- Forward-compat note: the later 2025-06-18 revision splits resource-server from
  auth-server via RFC 9728 Protected Resource Metadata. Target 2025-03-26 now; design the
  401 challenge/PRM so the split is a later additive change, not a rewrite.

**Verdict: epic-decompose.** Not blocked, but multi-phase with a mandatory security gate.

## Scope / Decomposition

Each phase is independently shippable and TDD-able. The internal OpenCode callsite
(`ai-agent.ts:322`) **must keep working through every phase** — any token-model change
either preserves it or migrates it in the same phase.

### Phase 0 — Decision: AS library + delegation model (blocks all)

Resolve the central fork; do **not** pre-decide it in this spec. Candidates:

- **OpenAuth.js** — Hono/Bun-native, AS + JWT issuance; no DCR (defer DCR to Phase 4).
- **Hand-rolled Hono endpoints on the SDK `OAuthServerProvider` interface** — reuse SDK
  handler logic (`server/auth/handlers/*`) without its express `router`.
- **express-compat shim** for `mcpAuthRouter` — fastest to wire, foreign to the codebase;
  treat as fallback only.

Recommended model to evaluate first: **third-party delegation** — HyperIDE as AS to the MCP
client, delegating the human-consent step to the existing `/api/auth/{github,google}`
login. Mirrors the SDK `proxyProvider` shape.

- Key files (read): `server/modules/auth/oauth/*`, `server/modules/auth/tokens.ts`,
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/*`.
- Acceptance: a written decision (this spec section + Linear comment) naming the library,
  the delegation model, and the DCR plan; a 1-file spike proving the chosen library serves
  `/authorize` from a Hono route on Bun.

### Phase 1 — User-scope the existing token (ship first, no OAuth ceremony)

- Add `userId` to the token context; resolve and enforce
  `checkProjectAccess(userId, projectId)` in `server/routes/mcp.ts` before
  `handleMcpRequest`. **Resolve the project workspace-scoped, not path-only:**
  `getProjectByPath` (`server/modules/projects/service.ts:66-69`) is path-only and the
  `projects` schema has no unique-path constraint (only a workspace index), so the same path
  in two workspaces can resolve to the wrong project — granting access for project A while
  `handleMcpRequest` runs against the token's workspace B. Bind a concrete `projectId` into
  the token (preferred), or resolve by `{ workspaceId, path }` and assert the resolved project
  matches the token's workspace before `checkProjectAccess`. Never authorize off a path-only
  lookup.
- Replace the in-memory `Map` (`mcp-token.ts:18`) with a persisted table (survives restart,
  supports revocation list). New table, e.g. `mcpTokens` — do **not** overload
  `refreshTokens`/`oauthAccounts` (those are human-login).
- Keep `ai-agent.ts:322` working: the internal mint now also attaches the agent's `userId`.
- Key files: `server/services/mcp-token.ts`, `server/routes/mcp.ts`,
  `server/services/ai-agent.ts`, `server/middleware/workspace.ts`,
  `server/database/schema/` (new table + migration).
- Acceptance (TDD): request with a valid user token but no access to the bound project →
  `403`; valid user with `viewer` role calling a file-mutating tool → `403`/blocked;
  internal OpenCode path still lists/calls tools green.

### Phase 2 — AS metadata discovery + 401 challenge

- Serve `/.well-known/oauth-authorization-server` (RFC 8414) at domain root, plus a
  Protected Resource Metadata document (RFC 9728) for forward-compat.
- `/api/mcp` returns `401` + `WWW-Authenticate` pointing at the metadata when no valid
  OAuth token is presented (keep the internal Bearer path working in parallel).
- Key files: new `server/routes/oauth-as.ts` (or library mount), `server/index.ts`
  (root-level mount, **not** under `/api/mcp`), `server/routes/mcp.ts`.
- Acceptance (TDD): GET metadata returns the spec-required fields and the three endpoint
  URLs; unauthenticated MCP POST returns `401` with a parseable `WWW-Authenticate`.

### Phase 3 — /authorize + /token (OAuth 2.1 + PKCE), delegating login to Google/GitHub

- `/authorize`: validate `client_id`, `redirect_uri` (localhost-or-HTTPS allowlist),
  `code_challenge` (PKCE **required**), delegate human login to existing
  `/api/auth/{github,google}`, then redirect back with an authorization code.
- `/token`: exchange code + `code_verifier` for a HyperIDE-signed MCP access token (reuse
  `jose`/`tokens.ts` signing) bound to `userId` and granted scopes; support refresh.
- **Project/workspace binding (required — a `userId`+scopes token is not routable).**
  `handleMcpRequest` needs a concrete `{ workspaceId, projectPath }` (`mcp.ts:24`) and Phase 1's
  `checkProjectAccess(userId, projectId)` needs a concrete project; neither is derivable from a
  user+scopes token alone. The flow MUST resolve a project context, one of: (a) the `/authorize`
  human-consent step includes a workspace/project picker and the chosen `{ workspaceId, projectId }`
  is bound into the issued token (recommended for v1 — one token = one project); or (b) the token is
  workspace-scoped and `/api/mcp` requires an explicit `projectPath`/`projectId` request param,
  validated against the user's access on every call (later multi-project enhancement). `/api/mcp`
  must never fall back to a global or first-project default when the binding is absent.
- New tables: `oauthAuthorizationCodes` (short-lived, single-use). `/api/mcp` validates the
  issued token, resolves `userId` + bound project, then enters Phase 1's `checkProjectAccess` path.
- Key files: `server/routes/oauth-as.ts`, `server/modules/auth/tokens.ts`,
  `server/modules/auth/oauth/*` (delegation), schema + migration.
- Acceptance (TDD): full code+PKCE exchange yields a working MCP token bound to a concrete
  `{ userId, workspaceId, projectId }`; missing/invalid `code_verifier` → error; an MCP call whose
  bound (or supplied) project the user can't access → `403`; no project binding → request rejected,
  never defaulted.

### Phase 4 — Dynamic Client Registration (/register, RFC 7591)

- `/register` accepting client metadata, applying a registration policy, persisting to a new
  `oauthClients` table; surface registered clients in AS metadata.
- Key files: `server/routes/oauth-as.ts`, schema + migration.
- Acceptance (TDD): POST `/register` returns `client_id`; a freshly registered client
  completes the Phase 3 flow end-to-end (simulating Cursor/Claude Desktop).

### Phase 5 — Security review (HARD GATE) + public exposure

- `/security-review` covering: redirect-URI validation / open-redirect, PKCE enforcement,
  token expiry + rotation, scope→role mapping (`editor`/`viewer`), code single-use,
  rate-limiting `/register` and `/token`, and tightening
  `Access-Control-Allow-Origin: '*'` (`server/services/mcp-server.ts:167`, `:169`) to an
  allowlist.
- Only after a green review: flip `/api/mcp` from internal-only to publicly reachable.
- Acceptance: documented review with findings resolved; the `*` CORS removed; public probe
  from an external MCP client succeeds with scoped, user-bound access.

## Risks & prerequisites

- **Ordering**: Phase 0 blocks everything; Phase 1 is independent and should ship first
  (value without OAuth). Phases 2→3→4 are strictly sequential. Phase 5 is a gate, not a
  feature, and must precede public exposure.
- **express vs Hono (shared-infra constraint)**: the SDK auth router is express-only; the
  repo is express-free. Phase 0 must settle this or every later phase inherits ambiguity.
- **DCR is not free** from OpenAuth.js — Phase 4 is real engineering, not a config flag.
- **Don't overload human-auth tables** (`refreshTokens`, `oauthAccounts`); MCP needs its own
  `mcpTokens`, `oauthClients`, `oauthAuthorizationCodes`. New migrations on Postgres/Drizzle.
- **Don't break OpenCode** (`ai-agent.ts:322`): the internal loopback mint must survive the
  token-model migration in Phase 1.
- **Stateless transport assumption**: both servers create a fresh
  `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request. OAuth state
  (codes, PKCE) must live in the DB, not transport/session memory.
- **Spec-revision drift**: target 2025-03-26 (ticket link); design the 401/PRM surface so the
  2025-06-18 resource-server/auth-server split is additive.

## Out of scope

- The in-process extension MCP server (`HyperMcpServer.ts`) — loopback-only, no public auth.
- Changing the toolset (`shared/ai-agent-tools.ts` / `ALL_TOOLS`); this is auth + transport.
- Replacing or refactoring the existing **human** login (Google/GitHub) — we reuse it for the
  consent step, we do not rebuild it.
- A public MCP catalog / discovery UI for end users (separate product surface).
- Client-side (Cursor/Claude Desktop) configuration tooling beyond what DCR provides.
