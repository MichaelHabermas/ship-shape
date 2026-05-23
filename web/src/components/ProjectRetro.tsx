import { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/Toast';
import { apiPost, apiPatch, apiGet, readJson } from '@/lib/api';
import type { LegacyErrorResponse } from '@/api/schemas';

interface ProjectRetroProps {
  projectId: string;
}

interface RetroData {
  is_draft: boolean;
  plan_validated: boolean | null;
  monetary_impact_expected: string | null;
  monetary_impact_actual: string | null;
  success_criteria: string[];
  next_steps: string | null;
  content: JSONContent;
  weeks: { id: string; title: string; sprint_number: string }[];
  issues_summary: {
    total: number;
    completed: number;
    cancelled: number;
    active: number;
  };
}

export function ProjectRetro({ projectId }: ProjectRetroProps) {
  const [retroData, setRetroData] = useState<RetroData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [planValidated, setPlanValidated] = useState<boolean | null>(null);
  const [monetaryImpactActual, setMonetaryImpactActual] = useState('');
  const [successCriteria, setSuccessCriteria] = useState<string[]>([]);
  const [newCriterion, setNewCriterion] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const { showToast } = useToast();

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Write your project retrospective...',
      }),
    ],
    content: '',
    onUpdate: () => {
      setIsDirty(true);
    },
  });

  const fetchRetro = useCallback(async () => {
    try {
      const res = await apiGet(`/api/projects/${projectId}/retro`);
      if (res.ok) {
        const data = await readJson<RetroData>(res);
        setRetroData(data);
        setPlanValidated(data.plan_validated ?? null);
        setMonetaryImpactActual(data.monetary_impact_actual || '');
        setSuccessCriteria(data.success_criteria || []);
        if (editor && data.content) {
          editor.commands.setContent(data.content);
        }
      } else {
        showToast('Failed to load project retrospective', 'error');
      }
    } catch (err) {
      console.error('Failed to fetch project retro:', err);
      showToast('Failed to load project retrospective. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, editor, showToast]);

  useEffect(() => {
    if (editor) {
      fetchRetro();
    }
  }, [fetchRetro, editor]);

  const handleSave = async () => {
    if (!editor) return;

    setSaving(true);
    try {
      const content = editor.getJSON();

      if (retroData?.is_draft) {
        // POST to create new retro
        const res = await apiPost(`/api/projects/${projectId}/retro`, {
          content,
          plan_validated: planValidated,
          monetary_impact_actual: monetaryImpactActual || null,
          success_criteria: successCriteria,
        });
        if (res.ok) {
          const data = await readJson<Partial<RetroData>>(res);
          setRetroData({ ...retroData, ...data, is_draft: false });
          setIsDirty(false);
          showToast('Project retrospective saved', 'success');
        } else {
          const data = await readJson<LegacyErrorResponse>(res).catch(() => ({}));
          showToast(data.error || 'Failed to save project retrospective', 'error');
        }
      } else {
        // PATCH to update existing retro
        const res = await apiPatch(`/api/projects/${projectId}/retro`, {
          content,
          plan_validated: planValidated,
          monetary_impact_actual: monetaryImpactActual || null,
          success_criteria: successCriteria,
        });
        if (res.ok) {
          setIsDirty(false);
          showToast('Project retrospective updated', 'success');
        } else {
          const data = await readJson<LegacyErrorResponse>(res).catch(() => ({}));
          showToast(data.error || 'Failed to update project retrospective', 'error');
        }
      }
    } catch (err) {
      console.error('Failed to save project retro:', err);
      showToast('Failed to save project retrospective. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCriterion = () => {
    if (!newCriterion.trim()) return;
    setSuccessCriteria([...successCriteria, newCriterion.trim()]);
    setNewCriterion('');
    setIsDirty(true);
  };

  const handleRemoveCriterion = (index: number) => {
    setSuccessCriteria(successCriteria.filter((_, i) => i !== index));
    setIsDirty(true);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted">Loading retrospective...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Retro content */}
      <div className="flex-1 overflow-auto">
        <div className="flex h-full">
          {/* Editor area */}
          <div className="flex-1 px-6 py-4">
            {retroData?.is_draft && (
              <div className="mb-4 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-600">
                This is a pre-filled draft. Edit and save to finalize your project retrospective.
              </div>
            )}

            {/* Issues Summary */}
            {retroData?.issues_summary && (
              <div className="mb-4 grid grid-cols-4 gap-3">
                <div className="rounded-md border border-border bg-background p-3 text-center">
                  <div className="text-2xl font-bold text-foreground">{retroData.issues_summary.total}</div>
                  <div className="text-xs text-muted">Total Issues</div>
                </div>
                <div className="rounded-md border border-border bg-background p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{retroData.issues_summary.completed}</div>
                  <div className="text-xs text-muted">Completed</div>
                </div>
                <div className="rounded-md border border-border bg-background p-3 text-center">
                  <div className="text-2xl font-bold text-yellow-600">{retroData.issues_summary.active}</div>
                  <div className="text-xs text-muted">Active</div>
                </div>
                <div className="rounded-md border border-border bg-background p-3 text-center">
                  <div className="text-2xl font-bold text-red-600">{retroData.issues_summary.cancelled}</div>
                  <div className="text-xs text-muted">Cancelled</div>
                </div>
              </div>
            )}

            <div className="prose prose-sm max-w-none">
              <EditorContent
                editor={editor}
                className="min-h-[400px] rounded-lg border border-border bg-background p-4 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[350px]"
              />
            </div>
          </div>

          {/* Properties sidebar */}
          <div className="w-72 border-l border-border p-4 overflow-y-auto">
            <h3 className="text-sm font-medium text-foreground mb-4">Retrospective Properties</h3>

            {/* Plan Validation */}
            <div className="space-y-2 mb-6">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">
                Plan Validation
              </label>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setPlanValidated(true);
                    setIsDirty(true);
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    planValidated === true
                      ? 'bg-green-500/20 text-green-600 border border-green-500'
                      : 'bg-border/50 text-muted hover:bg-border'
                  )}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Validated
                </button>
                <button
                  onClick={() => {
                    setPlanValidated(false);
                    setIsDirty(true);
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    planValidated === false
                      ? 'bg-red-500/20 text-red-600 border border-red-500'
                      : 'bg-border/50 text-muted hover:bg-border'
                  )}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Invalidated
                </button>
                {planValidated !== null && (
                  <button
                    onClick={() => {
                      setPlanValidated(null);
                      setIsDirty(true);
                    }}
                    className="text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>

            {/* Monetary Impact Expected */}
            {retroData?.monetary_impact_expected && (
              <div className="space-y-2 mb-6">
                <label className="text-xs font-medium text-muted uppercase tracking-wide">
                  Expected Impact
                </label>
                <div className="text-sm text-foreground bg-border/30 rounded-md px-3 py-2">
                  {retroData.monetary_impact_expected}
                </div>
              </div>
            )}

            {/* Monetary Impact Actual */}
            <div className="space-y-2 mb-6">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">
                Actual Monetary Impact
              </label>
              <input
                type="text"
                value={monetaryImpactActual}
                onChange={(e) => {
                  setMonetaryImpactActual(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="e.g., Saved $50,000/year"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {/* Success Criteria */}
            <div className="space-y-2 mb-6">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">
                Success Criteria
              </label>
              <div className="space-y-2">
                {successCriteria.map((criterion, index) => (
                  <div key={index} className="flex items-center gap-2 group">
                    <svg className="h-4 w-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-foreground flex-1">{criterion}</span>
                    <button
                      onClick={() => handleRemoveCriterion(index)}
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 transition-all"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCriterion}
                    onChange={(e) => setNewCriterion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCriterion();
                      }
                    }}
                    placeholder="Add criterion..."
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={handleAddCriterion}
                    disabled={!newCriterion.trim()}
                    className="rounded-md bg-accent px-2 py-1.5 text-sm text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Sprints */}
            {retroData?.weeks && retroData.weeks.length > 0 && (
              <div className="space-y-2 mb-6">
                <label className="text-xs font-medium text-muted uppercase tracking-wide">
                  Sprints ({retroData.weeks.length})
                </label>
                <div className="space-y-1">
                  {retroData.weeks.map((sprint) => (
                    <div key={sprint.id} className="text-sm text-foreground">
                      Sprint {sprint.sprint_number}: {sprint.title}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status indicator */}
            <div className="pt-4 border-t border-border">
              <div className="text-xs text-muted">
                {retroData?.is_draft ? (
                  <span className="text-yellow-600">Draft - not yet saved</span>
                ) : (
                  <span className="text-green-600">Saved</span>
                )}
                {isDirty && !retroData?.is_draft && (
                  <span className="text-yellow-600"> (unsaved changes)</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save button footer */}
      <div className="border-t border-border px-6 py-4 flex justify-end gap-2">
        <button
          onClick={handleSave}
          disabled={saving || (!isDirty && !retroData?.is_draft)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : retroData?.is_draft ? 'Save Retrospective' : 'Update Retrospective'}
        </button>
      </div>
    </div>
  );
}
