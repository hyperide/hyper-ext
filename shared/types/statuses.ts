/**
 * Shared status/role union types.
 *
 * These mirror the DB enums but are plain TS types — no runtime dependency
 * on drizzle or the server schema.  Keep in sync manually.
 *
 * SYNC: When adding/removing values here, update the corresponding pgEnum in:
 *   - server/database/schema/projects.ts   (ProjectStatus, ProjectRole)
 *   - server/database/schema/workspaces.ts (WorkspaceRole)
 *   - server/database/schema/comments.ts   (CommentStatus)
 * DB enum changes require a migration; these TS types do not.
 */

/** Project lifecycle status (matches `project_status` pgEnum) */
export type ProjectStatus = 'stopped' | 'building' | 'running' | 'error';

/** Workspace-level sharing role (matches `workspace_role` pgEnum) */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

/** Project-level sharing role (matches `project_role` pgEnum) */
export type ProjectRole = 'editor' | 'viewer';

/** Comment thread status (matches `comment_status` pgEnum) */
export type CommentStatus = 'open' | 'resolved' | 'archived';

/**
 * Container/pod phase reported by K8s or Docker.
 *
 * Known values are enumerated; the `(string & {})` tail allows
 * forward-compatible handling of new K8s reasons without a type bump.
 */
export type ContainerPhase =
  | 'Pending'
  | 'Running'
  | 'Succeeded'
  | 'Failed'
  | 'Unknown'
  | 'ContainerCreating'
  | 'CrashLoopBackOff'
  | 'Terminated'
  | 'ErrImagePull'
  | 'ImagePullBackOff'
  | (string & {});

/** Fix session status (matches `fixSessions.status` varchar values) */
export type FixSessionStatus = 'running' | 'success' | 'failed' | 'cancelled';

/** Fix attempt result (matches `fixAttempts.result` varchar values) */
export type FixAttemptResult = 'success' | 'failed' | 'error';

/** AI agent message role (matches `aiAgentMessages.role` varchar values) */
export type AIMessageRole = 'user' | 'assistant';
