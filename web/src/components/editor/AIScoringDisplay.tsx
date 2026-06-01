import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * AIScoringDisplay — Renders inline AI quality feedback as widget decorations
 * after each plan/retro list item, following the CommentDisplay pattern.
 *
 * Reads analysis data from extension storage (set by the parent component
 * when AI analysis completes). Matches analysis items to document list items
 * by text similarity, then renders score indicators and feedback inline.
 */

interface PlanItemAnalysis {
  text: string;
  score: number;
  feedback: string;
  issues: string[];
  conciseness_score?: number;
  is_verbose?: boolean;
  conciseness_feedback?: string;
}

interface PlanAnalysisData {
  overall_score: number;
  items: PlanItemAnalysis[];
  workload_assessment: string;
  workload_feedback: string;
}

interface RetroItemAnalysis {
  plan_item: string;
  addressed: boolean;
  has_evidence: boolean;
  feedback: string;
}

interface RetroAnalysisData {
  overall_score: number;
  plan_coverage: RetroItemAnalysis[];
  suggestions: string[];
}

export interface AIScoringStorage {
  planAnalysis: PlanAnalysisData | null;
  retroAnalysis: RetroAnalysisData | null;
}

export const aiScoringPluginKey = new PluginKey('aiScoringDisplay');

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Extract plain text from a ProseMirror node */
function extractNodeText(node: ProseMirrorNode): string {
  let text = '';
  node.descendants((child: ProseMirrorNode) => {
    if (child.isText) text += child.text;
  });
  return text.trim();
}

/** Normalize text for matching */
function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Find list items in the document and return their positions and text.
 * Returns array of { pos: end position of list item block, text: extracted text }
 */
function findListItems(doc: ProseMirrorNode): Array<{ endPos: number; text: string }> {
  const items: Array<{ endPos: number; text: string }> = [];

  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      const text = extractNodeText(node);
      if (text) {
        const endPos = pos + node.nodeSize;
        items.push({ endPos, text });
      }
      return false;
    }
  });

  return items;
}

/**
 * Find planReference nodes in the document (for retro documents).
 * Returns array of { endPos, text } using the planItemText attribute.
 */
function findPlanReferenceNodes(doc: ProseMirrorNode): Array<{ endPos: number; text: string }> {
  const items: Array<{ endPos: number; text: string }> = [];

  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type.name === 'planReference') {
      const attrs = node.attrs as { planItemText?: unknown };
      const text = typeof attrs.planItemText === 'string' ? attrs.planItemText : '';
      if (text) {
        const endPos = pos + node.nodeSize;
        items.push({ endPos, text });
      }
      return false;
    }
  });

  return items;
}

/**
 * Match analysis items to document list items by text similarity.
 * Returns a map of listItemIndex -> analysisItemIndex.
 */
function matchAnalysisToListItems(
  listItems: Array<{ endPos: number; text: string }>,
  analysisItems: Array<{ text: string }>
): Map<number, number> {
  const matches = new Map<number, number>();
  const usedAnalysis = new Set<number>();

  // First pass: exact normalized matches
  for (let li = 0; li < listItems.length; li++) {
    const listItem = listItems[li];
    if (!listItem) continue;
    const normalizedLi = normalizeText(listItem.text);
    for (let ai = 0; ai < analysisItems.length; ai++) {
      if (usedAnalysis.has(ai)) continue;
      const analysisItem = analysisItems[ai];
      if (!analysisItem) continue;
      const normalizedAi = normalizeText(analysisItem.text);
      if (normalizedLi === normalizedAi) {
        matches.set(li, ai);
        usedAnalysis.add(ai);
        break;
      }
    }
  }

  // Second pass: prefix/substring matching for unmatched items
  for (let li = 0; li < listItems.length; li++) {
    if (matches.has(li)) continue;
    const listItem = listItems[li];
    if (!listItem) continue;
    const normalizedLi = normalizeText(listItem.text);

    for (let ai = 0; ai < analysisItems.length; ai++) {
      if (usedAnalysis.has(ai)) continue;
      const analysisItem = analysisItems[ai];
      if (!analysisItem) continue;
      const normalizedAi = normalizeText(analysisItem.text);

      if (normalizedLi.startsWith(normalizedAi) || normalizedAi.startsWith(normalizedLi)) {
        matches.set(li, ai);
        usedAnalysis.add(ai);
        break;
      }
    }
  }

  // Third pass: positional fallback for remaining items
  for (let li = 0; li < listItems.length; li++) {
    if (matches.has(li)) continue;
    if (li < analysisItems.length && !usedAnalysis.has(li)) {
      matches.set(li, li);
      usedAnalysis.add(li);
    }
  }

  return matches;
}

/** Create DOM element for plan item feedback widget */
function createPlanFeedbackWidget(item: PlanItemAnalysis): HTMLElement {
  const container = document.createElement('div');
  container.className = 'ai-scoring-inline';
  container.contentEditable = 'false';

  const scorePercent = Math.round(item.score * 10);
  const colorClass = item.score >= 0.7 ? 'green' : item.score >= 0.4 ? 'yellow' : 'red';

  let conciseness = '';
  if (item.is_verbose && item.conciseness_feedback) {
    conciseness = `<span class="ai-scoring-conciseness">${escapeHtml(item.conciseness_feedback)}</span>`;
  }

  container.innerHTML = `
    <div class="ai-scoring-feedback ai-scoring-${colorClass}">
      <span class="ai-scoring-badge">${scorePercent}</span>
      <span class="ai-scoring-text">${escapeHtml(item.feedback)}</span>
      ${conciseness}
    </div>
  `;

  return container;
}

/** Create DOM element for retro item coverage widget */
function createRetroCoverageWidget(item: RetroItemAnalysis): HTMLElement {
  const container = document.createElement('div');
  container.className = 'ai-scoring-inline';
  container.contentEditable = 'false';

  const statusClass = item.addressed && item.has_evidence ? 'green'
    : item.addressed ? 'yellow'
    : 'red';

  const statusIcon = item.addressed && item.has_evidence ? '&#10003;'
    : item.addressed ? '&#9888;'
    : '&#10007;';

  container.innerHTML = `
    <div class="ai-scoring-feedback ai-scoring-${statusClass}">
      <span class="ai-scoring-status-icon">${statusIcon}</span>
      <span class="ai-scoring-text">${escapeHtml(item.feedback)}</span>
    </div>
  `;

  return container;
}

export const AIScoringDisplayExtension = Extension.create<Record<string, never>, AIScoringStorage>({
  name: 'aiScoringDisplay',

  addStorage() {
    return {
      planAnalysis: null,
      retroAnalysis: null,
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;

    return [
      new Plugin({
        key: aiScoringPluginKey,
        props: {
          decorations: (state) => {
            const { doc } = state;
            const decorations: Decoration[] = [];

            const { planAnalysis, retroAnalysis } = storage;

            if (planAnalysis && planAnalysis.items.length > 0) {
              const listItems = findListItems(doc);
              const matches = matchAnalysisToListItems(listItems, planAnalysis.items);

              for (const [listIdx, analysisIdx] of matches) {
                const listItem = listItems[listIdx];
                const analysisItem = planAnalysis.items[analysisIdx];
                if (!listItem || !analysisItem) continue;

                const widget = Decoration.widget(listItem.endPos, () => {
                  return createPlanFeedbackWidget(analysisItem);
                }, {
                  side: 1,
                  key: `ai-plan-${listIdx}-${analysisItem.score}`,
                });

                decorations.push(widget);
              }
            }

            if (retroAnalysis && retroAnalysis.plan_coverage.length > 0) {
              // For retros, prefer planReference nodes (auto-populated retros),
              // fall back to regular list items (free-form retros)
              const planRefNodes = findPlanReferenceNodes(doc);
              const listItems = planRefNodes.length > 0 ? planRefNodes : findListItems(doc);
              const coverageItems = retroAnalysis.plan_coverage.map(c => ({ text: c.plan_item }));
              const matches = matchAnalysisToListItems(listItems, coverageItems);

              for (const [listIdx, coverageIdx] of matches) {
                const listItem = listItems[listIdx];
                const coverageItem = retroAnalysis.plan_coverage[coverageIdx];
                if (!listItem || !coverageItem) continue;

                const widget = Decoration.widget(listItem.endPos, () => {
                  return createRetroCoverageWidget(coverageItem);
                }, {
                  side: 1,
                  key: `ai-retro-${listIdx}-${coverageItem.addressed}`,
                });

                decorations.push(widget);
              }
            }

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
