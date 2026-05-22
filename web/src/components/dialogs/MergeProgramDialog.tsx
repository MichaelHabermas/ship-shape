import { useState, useEffect } from 'react';
import { apiGet, apiPost, readJson } from '@/lib/api';
import type { LegacyErrorResponse } from '@/api/schemas';
import { usePrograms } from '@/hooks/useProgramsQuery';
import { useToast } from '@/components/ui/Toast';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

interface MergePreview {
  source: { id: string; name: string };
  target: { id: string; name: string };
  counts: { projects: number; issues: number; sprints: number; wikis: number };
  conflicts: Array<{ type: string; message: string }>;
}

interface MergeProgramDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sourceId: string;
  sourceName: string;
}

export function MergeProgramDialog({ isOpen, onClose, sourceId, sourceName }: MergeProgramDialogProps) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { programs } = usePrograms();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Filter out current program and archived programs
  const availableTargets = programs.filter(
    (p) => p.id !== sourceId && !p.archived_at
  );

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setTargetId(null);
      setPreview(null);
      setConfirmText('');
      setError(null);
      setIsMerging(false);
    }
  }, [isOpen]);

  // Fetch preview when target is selected
  useEffect(() => {
    if (!targetId) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setError(null);

    apiGet(`/api/programs/${sourceId}/merge-preview?target_id=${targetId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const data = await readJson<LegacyErrorResponse>(res);
          setError(data.error || 'Failed to load preview');
          setPreview(null);
        } else {
          const data = await readJson<MergePreview>(res);
          setPreview(data);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load preview');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => { cancelled = true; };
  }, [targetId, sourceId]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen || isMerging) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMerging, onClose]);

  const handleMerge = async () => {
    if (!targetId || confirmText !== sourceName) return;

    setIsMerging(true);
    setError(null);

    try {
      const res = await apiPost(`/api/programs/${sourceId}/merge`, {
        target_id: targetId,
        confirm_name: confirmText,
      });

      if (!res.ok) {
        const data = await readJson<LegacyErrorResponse>(res);
        setError(data.error || 'Merge failed');
        setIsMerging(false);
        return;
      }

      // Invalidate programs cache
      queryClient.invalidateQueries({ queryKey: ['programs'] });

      showToast(`Merged "${sourceName}" into "${preview?.target.name}"`, 'success');
      onClose();
      navigate(`/documents/${targetId}`);
    } catch {
      setError('Merge failed. Please try again.');
      setIsMerging(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isMerging) onClose();
  };

  if (!isOpen) return null;

  const totalEntities = preview
    ? preview.counts.projects + preview.counts.issues + preview.counts.sprints + preview.counts.wikis
    : 0;

  const confirmMatch = confirmText === sourceName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Merge Program</h2>
        <p className="mb-4 text-sm text-muted">
          Move all content from <strong>{sourceName}</strong> into another program.
        </p>

        {/* Target selection */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted uppercase tracking-wider">
            Merge into
          </label>
          <select
            value={targetId || ''}
            onChange={(e) => setTargetId(e.target.value || null)}
            disabled={isMerging}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">Select target program...</option>
            {availableTargets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Preview */}
        {previewLoading && (
          <div className="mb-4 rounded border border-border p-3 text-center text-sm text-muted">
            Loading preview...
          </div>
        )}

        {preview && !previewLoading && (
          <div className="mb-4 rounded border border-border p-3">
            <p className="mb-2 text-sm font-medium text-foreground">
              {totalEntities} {totalEntities === 1 ? 'item' : 'items'} will be moved:
            </p>
            <ul className="space-y-1 text-sm text-muted">
              {preview.counts.projects > 0 && (
                <li>{preview.counts.projects} {preview.counts.projects === 1 ? 'project' : 'projects'}</li>
              )}
              {preview.counts.issues > 0 && (
                <li>{preview.counts.issues} {preview.counts.issues === 1 ? 'issue' : 'issues'}</li>
              )}
              {preview.counts.sprints > 0 && (
                <li>{preview.counts.sprints} {preview.counts.sprints === 1 ? 'week' : 'weeks'}</li>
              )}
              {preview.counts.wikis > 0 && (
                <li>{preview.counts.wikis} {preview.counts.wikis === 1 ? 'wiki page' : 'wiki pages'}</li>
              )}
              {totalEntities === 0 && <li>No child entities to move</li>}
            </ul>

            {preview.conflicts.length > 0 && (
              <div className="mt-2 rounded bg-amber-500/10 border border-amber-500/30 p-2">
                {preview.conflicts.map((c, i) => (
                  <p key={i} className="text-xs text-amber-300">{c.message}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Type-to-confirm */}
        {preview && !previewLoading && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-muted">
              Type <strong className="text-foreground">{sourceName}</strong> to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={isMerging}
              placeholder={sourceName}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
              autoComplete="off"
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 rounded bg-red-500/10 border border-red-500/30 p-2">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isMerging}
            className="rounded px-3 py-1.5 text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={!confirmMatch || isMerging || !preview}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isMerging ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Merging...
              </>
            ) : (
              'Merge Program'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
