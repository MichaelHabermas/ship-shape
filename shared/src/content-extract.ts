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
