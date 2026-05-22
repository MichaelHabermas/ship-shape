/**
 * TipTap JSON content extraction (hypothesis, sections, completeness).
 * Shared between API persistence and web editor preview paths.
 */

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
}

interface TipTapDoc {
  type: 'doc';
  content?: TipTapNode[];
}

function extractText(nodes: TipTapNode[]): string {
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      text += node.text;
    } else if (node.content) {
      text += extractText(node.content);
    }
    if (['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type)) {
      text += '\n';
    }
  }
  return text;
}

function isHypothesisHeading(node: TipTapNode): boolean {
  if (node.type !== 'heading') return false;
  if (node.attrs?.level !== 2) return false;
  const text = extractText(node.content || []).trim().toLowerCase();
  return text === 'hypothesis';
}

function isH2Heading(node: TipTapNode): boolean {
  return node.type === 'heading' && node.attrs?.level === 2;
}

function findSectionEndIndex(nodes: TipTapNode[], startIndex: number): number {
  for (const [offset, node] of nodes.slice(startIndex + 1).entries()) {
    if (isH2Heading(node)) {
      return startIndex + 1 + offset;
    }
  }
  return nodes.length;
}

function extractSectionByHeading(nodes: TipTapNode[], headingText: string): string | null {
  let startIndex = -1;
  const target = headingText.toLowerCase();
  for (const [i, node] of nodes.entries()) {
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = extractText(node.content || []).trim().toLowerCase();
      if (text === target) {
        startIndex = i;
        break;
      }
    }
  }
  if (startIndex === -1) return null;
  const endIndex = findSectionEndIndex(nodes, startIndex);
  const contentNodes = nodes.slice(startIndex + 1, endIndex);
  if (contentNodes.length === 0) return null;
  const text = extractText(contentNodes).trim();
  return text || null;
}

export function extractHypothesisFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;
  const nodes = doc.content;

  for (const node of nodes) {
    if (node.type === 'hypothesisBlock' && node.content) {
      const text = extractText(node.content).trim();
      if (text) return text;
    }
  }

  let hypothesisStartIndex = -1;
  for (const [i, node] of nodes.entries()) {
    if (isHypothesisHeading(node)) {
      hypothesisStartIndex = i;
      break;
    }
  }
  if (hypothesisStartIndex === -1) return null;
  const hypothesisEndIndex = findSectionEndIndex(nodes, hypothesisStartIndex);
  const contentNodes = nodes.slice(hypothesisStartIndex + 1, hypothesisEndIndex);
  if (contentNodes.length === 0) return null;
  const text = extractText(contentNodes).trim();
  return text || null;
}

export function extractSuccessCriteriaFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;
  return extractSectionByHeading(doc.content, 'success criteria');
}

export function extractVisionFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;
  return extractSectionByHeading(doc.content, 'vision');
}

export function extractGoalsFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;
  return extractSectionByHeading(doc.content, 'goals');
}

/** Plain text from a TipTap subtree (no block separators). Matches API document-content extractText. */
function extractPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text' && n.text) return n.text;
  if (Array.isArray(n.content)) return n.content.map(extractPlainText).join('');
  return '';
}

export interface ExtractPlanItemsOptions {
  /** Include standalone paragraphs with text length > 10. Default true. */
  includeParagraphs?: boolean;
  /** Return taskItem checked state (dashboard PlanItem shape). Default false. */
  withChecked?: boolean;
}

type PlanItemEntry = { text: string; checked?: boolean };

function collectPlanItemEntries(content: unknown, includeParagraphs: boolean): PlanItemEntry[] {
  if (!content || typeof content !== 'object') return [];
  const doc = content as { content?: unknown[] };
  if (!Array.isArray(doc.content)) return [];

  const items: PlanItemEntry[] = [];

  function walkNodes(nodes: unknown[]) {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as {
        type?: string;
        attrs?: { checked?: boolean };
        content?: unknown[];
      };

      if (n.type === 'listItem' || n.type === 'taskItem') {
        const text = extractPlainText(n).trim();
        if (text) {
          items.push({
            text,
            checked: n.type === 'taskItem' ? (n.attrs?.checked ?? false) : undefined,
          });
        }
      } else if (includeParagraphs && n.type === 'paragraph') {
        const text = extractPlainText(n).trim();
        if (text.length > 10) items.push({ text });
      }

      if (n.content && n.type !== 'listItem' && n.type !== 'taskItem') {
        walkNodes(n.content);
      }
    }
  }

  walkNodes(doc.content);
  return items;
}

/**
 * Extract plan bullet texts from weekly plan / retro TipTap JSON.
 * Used by API routes (weekly plans, dashboard, AI analysis).
 */
export function extractPlanItemsFromContent(
  content: unknown,
  options?: ExtractPlanItemsOptions & { withChecked?: false }
): string[];
export function extractPlanItemsFromContent(
  content: unknown,
  options: ExtractPlanItemsOptions & { withChecked: true }
): Array<{ text: string; checked: boolean }>;
export function extractPlanItemsFromContent(
  content: unknown,
  options?: ExtractPlanItemsOptions
): string[] | Array<{ text: string; checked: boolean }> {
  const includeParagraphs = options?.includeParagraphs ?? true;
  const entries = collectPlanItemEntries(content, includeParagraphs);
  if (options?.withChecked) {
    return entries.map((entry) => ({
      text: entry.text,
      checked: entry.checked ?? false,
    }));
  }
  return entries.map((entry) => entry.text);
}

export function checkDocumentCompleteness(
  documentType: string,
  properties: Record<string, unknown> | null,
  linkedIssuesCount: number = 0
): { isComplete: boolean; missingFields: string[] } {
  const props = properties || {};
  const missingFields: string[] = [];

  if (documentType === 'project') {
    if (!props.plan || (typeof props.plan === 'string' && !props.plan.trim())) {
      missingFields.push('Plan');
    }
    if (!props.success_criteria || (typeof props.success_criteria === 'string' && !props.success_criteria.trim())) {
      missingFields.push('Success Criteria');
    }
  } else if (documentType === 'sprint') {
    if (linkedIssuesCount === 0) {
      missingFields.push('Linked Issues');
    }
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}
