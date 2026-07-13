import React, { useState } from 'react';
import { useQAStore } from '@/store/qaStore';
import type { AnnotationComment } from '@/types';

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SendIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ReplyIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
  </svg>
);

const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Avatar component
const Avatar: React.FC<{ name?: string; size?: 'sm' | 'md' }> = ({ name, size = 'md' }) => {
  const initials = name ? name.charAt(0).toUpperCase() : '?';
  const sizeClasses = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm';

  return (
    <div className={`${sizeClasses} rounded-full bg-blue-600 flex items-center justify-center font-medium`}>
      {initials}
    </div>
  );
};

// Single comment component
interface CommentItemProps {
  comment: AnnotationComment;
  onReply: (parentId: string) => void;
  onResolve: (commentId: string) => void;
  level?: number;
}

const CommentItem: React.FC<CommentItemProps> = ({ comment, onReply, onResolve, level = 0 }) => {
  return (
    <div className={`${level > 0 ? 'ml-6 border-l border-gray-700 pl-3' : ''}`}>
      <div className="flex gap-2 py-2">
        <Avatar name={comment.user_name} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-sm text-white">
              {comment.user_name || 'Unknown User'}
            </span>
            <span className="text-xs text-gray-500">
              {formatRelativeTime(comment.created_at)}
            </span>
            {comment.is_resolved && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <CheckCircleIcon />
                Resolved
              </span>
            )}
          </div>
          <p className="text-sm text-gray-300 mt-0.5 break-words">
            {comment.content}
          </p>
          <div className="flex items-center gap-3 mt-1">
            {level === 0 && (
              <button
                onClick={() => onReply(comment.id)}
                className="text-xs text-gray-500 hover:text-blue-400 flex items-center gap-1"
              >
                <ReplyIcon />
                Reply
              </button>
            )}
            {level === 0 && !comment.is_resolved && (
              <button
                onClick={() => onResolve(comment.id)}
                className="text-xs text-gray-500 hover:text-green-400 flex items-center gap-1"
              >
                <CheckCircleIcon />
                Resolve
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-1">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              onReply={onReply}
              onResolve={onResolve}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const AnnotationComments: React.FC = () => {
  const {
    activeCommentThread,
    closeCommentThread,
    annotationComments,
    addComment,
    resolveCommentThread,
  } = useQAStore();

  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!activeCommentThread) return null;

  const comments = annotationComments.get(activeCommentThread) || [];

  const handleSubmit = async () => {
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      await addComment(activeCommentThread, newComment.trim(), replyingTo || undefined);
      setNewComment('');
      setReplyingTo(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = (parentId: string) => {
    setReplyingTo(parentId);
  };

  const handleResolve = async (commentId: string) => {
    await resolveCommentThread(commentId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      if (replyingTo) {
        setReplyingTo(null);
      } else {
        closeCommentThread();
      }
    }
  };

  return (
    <div className="fixed right-[340px] bottom-6 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h4 className="font-medium text-white">Comments</h4>
        <button
          onClick={closeCommentThread}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <XIcon />
        </button>
      </div>

      {/* Comments List */}
      <div className="max-h-80 overflow-y-auto px-4 py-2">
        {comments.length === 0 ? (
          <div className="py-6 text-center text-gray-500">
            <p className="text-sm">No comments yet</p>
            <p className="text-xs mt-1">Be the first to add a comment</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onReply={handleReply}
                onResolve={handleResolve}
              />
            ))}
          </div>
        )}
      </div>

      {/* Reply indicator */}
      {replyingTo && (
        <div className="px-4 py-2 bg-blue-600/20 border-t border-blue-500/30 flex items-center justify-between">
          <span className="text-xs text-blue-400">Replying to comment...</span>
          <button
            onClick={() => setReplyingTo(null)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={replyingTo ? "Write a reply..." : "Add a comment..."}
            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm focus:outline-none focus:border-blue-500"
            disabled={isSubmitting}
          />
          <button
            onClick={handleSubmit}
            disabled={!newComment.trim() || isSubmitting}
            className="p-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnnotationComments;
