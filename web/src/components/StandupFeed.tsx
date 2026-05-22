import { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { useInvalidateStandupStatus } from '@/hooks/useStandupStatusQuery';
import { readJson } from '@/api/read-json';
import type { LegacyErrorResponse, UpdatedStandup } from '@/api/schemas';
import { apiPost, apiPatch, apiDelete, apiGetJson } from '@/lib/api';

interface Standup extends UpdatedStandup {
  content: JSONContent;
}

interface StandupFeedProps {
  sprintId: string;
}

export function StandupFeed({ sprintId }: StandupFeedProps) {
  const [standups, setStandups] = useState<Standup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { showToast } = useToast();
  const { user } = useAuth();
  const invalidateStandupStatus = useInvalidateStandupStatus();

  // TipTap editor for creating new standups
  const createEditor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'What did you work on? Any blockers? What\'s next?',
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-accent hover:underline cursor-pointer',
        },
      }),
    ],
    content: '',
  });

  // TipTap editor for editing existing standups
  const editEditor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Edit your standup update...',
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-accent hover:underline cursor-pointer',
        },
      }),
    ],
    content: '',
  });

  const fetchStandups = useCallback(async () => {
    try {
      const data = await apiGetJson<Standup[]>(
        `/api/weeks/${sprintId}/standups`,
        'Failed to load standups'
      );
      setStandups(data);
    } catch (err) {
      console.error('Failed to fetch standups:', err);
      showToast('Failed to load standups. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [sprintId, showToast]);

  useEffect(() => {
    fetchStandups();
  }, [fetchStandups]);

  const handleSubmit = async () => {
    if (!createEditor || createEditor.isEmpty) return;

    setSaving(true);
    try {
      const content = createEditor.getJSON();

      const res = await apiPost(`/api/weeks/${sprintId}/standups`, {
        content,
        title: `Standup - ${new Date().toLocaleDateString()}`,
      });

      if (res.ok) {
        createEditor.commands.clearContent();
        setShowEditor(false);
        fetchStandups();
        invalidateStandupStatus(); // Clear the "standup due" indicator
        showToast('Standup posted', 'success');
      } else {
        let message = 'Failed to post standup';
        try {
          const data = await readJson<LegacyErrorResponse>(res);
          if (data.error) message = data.error;
        } catch {
          // ignore parse errors
        }
        showToast(message, 'error');
      }
    } catch (err) {
      console.error('Failed to create standup:', err);
      showToast('Failed to post standup. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (standup: Standup) => {
    setEditingId(standup.id);
    if (editEditor) {
      editEditor.commands.setContent(standup.content);
    }
  };

  const handleSaveEdit = async (standupId: string) => {
    if (!editEditor || editEditor.isEmpty) return;

    try {
      const content = editEditor.getJSON();

      const res = await apiPatch(`/api/standups/${standupId}`, { content });

      if (res.ok) {
        setEditingId(null);
        editEditor.commands.clearContent();
        fetchStandups();
        showToast('Standup updated', 'success');
      } else if (res.status === 403) {
        showToast('You can only edit your own standups', 'error');
      } else {
        let message = 'Failed to update standup';
        try {
          const data = await readJson<LegacyErrorResponse>(res);
          if (data.error) message = data.error;
        } catch {
          // ignore parse errors
        }
        showToast(message, 'error');
      }
    } catch (err) {
      console.error('Failed to update standup:', err);
      showToast('Failed to update standup. Please try again.', 'error');
    }
  };

  const handleDelete = async (standupId: string) => {
    if (!confirm('Delete this standup update?')) return;

    try {
      const res = await apiDelete(`/api/standups/${standupId}`);

      if (res.ok || res.status === 204) {
        fetchStandups();
        showToast('Standup deleted', 'success');
      } else if (res.status === 403) {
        showToast('You can only delete your own standups', 'error');
      } else {
        let message = 'Failed to delete standup';
        try {
          const data = await readJson<LegacyErrorResponse>(res);
          if (data.error) message = data.error;
        } catch {
          // ignore parse errors
        }
        showToast(message, 'error');
      }
    } catch (err) {
      console.error('Failed to delete standup:', err);
      showToast('Failed to delete standup. Please try again.', 'error');
    }
  };

  // Group standups by date
  const groupedStandups = groupByDate(standups);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted">Loading standups...</div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Floating Add button */}
      {!showEditor && (
        <button
          onClick={() => setShowEditor(true)}
          className="absolute top-3 right-3 z-10 rounded-md bg-accent p-2 text-white hover:bg-accent/90 transition-colors shadow-sm"
          title="Add standup update"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {/* Editor overlay when active */}
      {showEditor && (
        <div className="absolute inset-x-0 top-0 z-10 bg-background border-b border-border p-3">
          <div className="space-y-2">
            <div className="min-h-[5rem] rounded-lg border border-border bg-background px-3 py-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
              <EditorContent
                editor={createEditor}
                className="prose prose-sm max-w-none text-foreground [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[3rem] [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowEditor(false);
                  createEditor?.commands.clearContent();
                }}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!createEditor || createEditor.isEmpty || saving}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standup feed - Scrollable */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {standups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted">
            <svg className="h-10 w-10 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p className="text-sm">No standup updates yet</p>
            <p className="text-xs mt-1">Click + to share an update</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedStandups.map(({ label, standups: dateStandups }) => (
              <div key={label}>
                <div className="sticky top-0 bg-background py-1.5">
                  <span className="text-xs font-medium text-muted uppercase tracking-wide">
                    {label}
                  </span>
                </div>
                <div className="space-y-3">
                  {dateStandups.map((standup) => (
                    <StandupCard
                      key={standup.id}
                      standup={standup}
                      isOwner={user?.id === standup.author_id}
                      isEditing={editingId === standup.id}
                      editEditor={editEditor}
                      onEdit={() => handleEdit(standup)}
                      onSaveEdit={() => handleSaveEdit(standup.id)}
                      onCancelEdit={() => { setEditingId(null); editEditor?.commands.clearContent(); }}
                      onDelete={() => handleDelete(standup.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface StandupCardProps {
  standup: Standup;
  isOwner: boolean;
  isEditing: boolean;
  editEditor: ReturnType<typeof useEditor>;
  onEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

function StandupCard({
  standup,
  isOwner,
  isEditing,
  editEditor,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: StandupCardProps) {
  // Create a read-only editor for displaying content
  const displayEditor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-accent hover:underline cursor-pointer',
        },
      }),
    ],
    content: standup.content,
    editable: false,
  }, [standup.content]);

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-3 mb-3">
        {/* Author avatar */}
        <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center">
          <span className="text-sm font-medium text-accent">
            {standup.author_name?.[0]?.toUpperCase() || standup.author_email?.[0]?.toUpperCase() || '?'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {standup.author_name || standup.author_email || 'Unknown'}
          </p>
          <p className="text-xs text-muted">
            {formatTime(standup.created_at)}
          </p>
        </div>
        {/* Edit/Delete buttons for owner */}
        {isOwner && !isEditing && (
          <div className="flex gap-1">
            <button
              onClick={onEdit}
              className="p-1.5 rounded text-muted hover:text-foreground hover:bg-border transition-colors"
              title="Edit"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              title="Delete"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {isEditing ? (
        <div className="space-y-2">
          <div className="min-h-[6rem] rounded-lg border border-border bg-background px-3 py-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
            <EditorContent
              editor={editEditor}
              className="prose prose-sm max-w-none text-foreground [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[4rem] [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancelEdit}
              className="rounded-md px-3 py-1.5 text-xs text-muted hover:bg-border transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSaveEdit}
              disabled={!editEditor || editEditor.isEmpty}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="prose prose-sm max-w-none text-foreground [&_.ProseMirror]:outline-none [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-medium [&_.ProseMirror_h4]:text-sm [&_.ProseMirror_h4]:font-medium [&_.ProseMirror_h1]:mt-3 [&_.ProseMirror_h1]:mb-1 [&_.ProseMirror_h2]:mt-2 [&_.ProseMirror_h2]:mb-1 [&_.ProseMirror_h3]:mt-2 [&_.ProseMirror_h3]:mb-1">
          <EditorContent editor={displayEditor} />
        </div>
      )}
    </div>
  );
}

// Group standups by date with friendly labels
function groupByDate(standups: Standup[]): { label: string; standups: Standup[] }[] {
  const groups: Record<string, Standup[]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const standup of standups) {
    const date = new Date(standup.created_at);
    date.setHours(0, 0, 0, 0);

    let label: string;
    if (date.getTime() === today.getTime()) {
      label = 'Today';
    } else if (date.getTime() === yesterday.getTime()) {
      label = 'Yesterday';
    } else {
      label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(standup);
  }

  // Convert to array and maintain order (most recent first)
  return Object.entries(groups).map(([label, standups]) => ({
    label,
    standups,
  }));
}

// Format time for display
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
