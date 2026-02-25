export interface CommentAuthor {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface Comment {
  id: string;
  projectId: string;
  parentId: string | null;
  content: string;
  authorId: string;
  author: CommentAuthor;
  elementId: string | null;
  instanceId: string | null;
  positionX: number | null;
  positionY: number | null;
  componentPath: string;
  lastKnownX: number | null;
  lastKnownY: number | null;
  isOrphaned: boolean;
  status: 'open' | 'resolved' | 'archived';
  resolvedBy: string | null;
  resolvedAt: string | null;
  editedAt: string | null;
  firstViewedAt: string | null;
  firstViewedBy: string | null;
  mentionedUserIds: string[] | null;
  createdAt: string;
  updatedAt: string;
  replies?: Comment[];
}

export interface CreateCommentParams {
  content: string;
  componentPath: string;
  elementId?: string;
  instanceId?: string;
  positionX?: number;
  positionY?: number;
  mentionedUserIds?: string[];
}

export interface CreateReplyParams {
  content: string;
  mentionedUserIds?: string[];
}

export type CommentPosition =
  | { type: 'element'; elementId: string }
  | { type: 'free'; x: number; y: number };
