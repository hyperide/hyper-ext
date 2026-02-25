import { useState, useCallback, useEffect } from 'react';
import { authFetch } from '@/utils/authFetch';
import type { Comment, CreateCommentParams, CreateReplyParams } from './types';

interface UseCommentsOptions {
  projectId: string | undefined;
  componentPath: string | undefined;
}

interface UseCommentsReturn {
  comments: Comment[];
  isLoading: boolean;
  error: string | null;
  selectedCommentId: string | null;
  selectedComment: Comment | null;
  selectComment: (id: string | null) => void;
  createComment: (params: CreateCommentParams) => Promise<Comment | null>;
  createReply: (parentId: string, params: CreateReplyParams) => Promise<Comment | null>;
  updateComment: (commentId: string, content: string) => Promise<boolean>;
  resolveComment: (commentId: string) => Promise<boolean>;
  reopenComment: (commentId: string) => Promise<boolean>;
  deleteComment: (commentId: string) => Promise<boolean>;
  markOrphaned: (commentId: string, lastKnownX: number, lastKnownY: number) => Promise<boolean>;
  refetch: () => Promise<void>;
}

export function useComments({ projectId, componentPath }: UseCommentsOptions): UseCommentsReturn {
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!projectId || !componentPath) {
      setComments([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `/api/projects/${projectId}/comments?componentPath=${encodeURIComponent(componentPath)}`;
      const response = await authFetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch comments');
      }

      const data = await response.json();
      setComments(data.comments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setComments([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, componentPath]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Listen for comment updates from other instances
  useEffect(() => {
    const handleCommentsUpdated = (e: CustomEvent<{ projectId: string; componentPath: string }>) => {
      if (e.detail.projectId === projectId && e.detail.componentPath === componentPath) {
        fetchComments();
      }
    };

    window.addEventListener('comments-updated', handleCommentsUpdated as EventListener);
    return () => {
      window.removeEventListener('comments-updated', handleCommentsUpdated as EventListener);
    };
  }, [projectId, componentPath, fetchComments]);

  const selectedComment = comments.find((c) => c.id === selectedCommentId) || null;

  const selectComment = useCallback((id: string | null) => {
    setSelectedCommentId(id);
  }, []);

  const createComment = useCallback(
    async (params: CreateCommentParams): Promise<Comment | null> => {
      if (!projectId) return null;

      try {
        const response = await authFetch(`/api/projects/${projectId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create comment');
        }

        const data = await response.json();
        setComments((prev) => [data.comment, ...prev]);
        return data.comment;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return null;
      }
    },
    [projectId]
  );

  const createReply = useCallback(
    async (parentId: string, params: CreateReplyParams): Promise<Comment | null> => {
      if (!projectId) return null;

      try {
        const response = await authFetch(`/api/projects/${projectId}/comments/${parentId}/replies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create reply');
        }

        const data = await response.json();

        // Add reply to parent comment
        setComments((prev) =>
          prev.map((c) =>
            c.id === parentId ? { ...c, replies: [...(c.replies || []), data.comment] } : c
          )
        );

        return data.comment;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return null;
      }
    },
    [projectId]
  );

  const updateComment = useCallback(
    async (commentId: string, content: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const response = await authFetch(`/api/projects/${projectId}/comments/${commentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to update comment');
        }

        const data = await response.json();

        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, ...data.comment } : c))
        );

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [projectId]
  );

  const resolveComment = useCallback(
    async (commentId: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const response = await authFetch(`/api/projects/${projectId}/comments/${commentId}/resolve`, {
          method: 'PATCH',
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to resolve comment');
        }

        const data = await response.json();

        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, ...data.comment } : c))
        );

        // Notify other instances to refetch
        window.dispatchEvent(new CustomEvent('comments-updated', {
          detail: { projectId, componentPath }
        }));

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [projectId, componentPath]
  );

  const reopenComment = useCallback(
    async (commentId: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const response = await authFetch(`/api/projects/${projectId}/comments/${commentId}/reopen`, {
          method: 'PATCH',
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to reopen comment');
        }

        const data = await response.json();

        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, ...data.comment } : c))
        );

        // Notify other instances to refetch
        window.dispatchEvent(new CustomEvent('comments-updated', {
          detail: { projectId, componentPath }
        }));

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [projectId, componentPath]
  );

  const deleteComment = useCallback(
    async (commentId: string): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const response = await authFetch(`/api/projects/${projectId}/comments/${commentId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete comment');
        }

        setComments((prev) => prev.filter((c) => c.id !== commentId));

        if (selectedCommentId === commentId) {
          setSelectedCommentId(null);
        }

        // Notify other instances to refetch
        window.dispatchEvent(new CustomEvent('comments-updated', {
          detail: { projectId, componentPath }
        }));

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [projectId, componentPath, selectedCommentId]
  );

  const markOrphaned = useCallback(
    async (commentId: string, lastKnownX: number, lastKnownY: number): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const response = await authFetch(`/api/projects/${projectId}/comments/${commentId}/orphan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastKnownX, lastKnownY }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to mark comment as orphaned');
        }

        const data = await response.json();

        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, ...data.comment } : c))
        );

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return false;
      }
    },
    [projectId]
  );

  return {
    comments,
    isLoading,
    error,
    selectedCommentId,
    selectedComment,
    selectComment,
    createComment,
    createReply,
    updateComment,
    resolveComment,
    reopenComment,
    deleteComment,
    markOrphaned,
    refetch: fetchComments,
  };
}
