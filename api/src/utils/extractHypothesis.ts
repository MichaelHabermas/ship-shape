/**
 * Extract hypothesis content from TipTap JSON document structure.
 *
 * Looks for H2 headings with text "Hypothesis" (case-insensitive)
 * and extracts the content between that heading and the next H2.
 *
 * Returns the extracted text as a plain string, or null if no hypothesis found.
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

/**
 * Extract plain text from a TipTap node tree
 */
function extractText(nodes: TipTapNode[]): string {
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      text += node.text;
    } else if (node.content) {
      text += extractText(node.content);
    }
    // Add newlines after block elements
    if (['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type)) {
      text += '\n';
    }
  }
  return text;
}

/**
 * Check if a node is an H2 heading with "Hypothesis" text
 */
function isHypothesisHeading(node: TipTapNode): boolean {
  if (node.type !== 'heading') return false;
  if (node.attrs?.level !== 2) return false;

  const text = extractText(node.content || []).trim().toLowerCase();
  return text === 'hypothesis';
}

/**
 * Check if a node is any H2 heading
 */
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

/**
 * Extract hypothesis content from TipTap document JSON.
 *
 * Looks for:
 * 1. hypothesisBlock nodes (preferred - custom block component)
 * 2. H2 "Hypothesis" heading with content until next H2 (legacy format)
 *
 * @param content - TipTap JSON document
 * @returns Extracted hypothesis text, or null if no hypothesis section found
 */
export function extractHypothesisFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;

  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;

  const nodes = doc.content;

  // First, look for hypothesisBlock nodes (preferred)
  for (const node of nodes) {
    if (node.type === 'hypothesisBlock' && node.content) {
      const text = extractText(node.content).trim();
      if (text) return text;
    }
  }

  // Fallback: look for H2 "Hypothesis" heading (legacy format)
  let hypothesisStartIndex = -1;

  // Find the Hypothesis H2 heading
  for (const [i, node] of nodes.entries()) {
    if (isHypothesisHeading(node)) {
      hypothesisStartIndex = i;
      break;
    }
  }

  if (hypothesisStartIndex === -1) return null;

  // Find the end (next H2 or end of document)
  const hypothesisEndIndex = findSectionEndIndex(nodes, hypothesisStartIndex);

  // Extract content between heading and end
  const contentNodes = nodes.slice(hypothesisStartIndex + 1, hypothesisEndIndex);
  if (contentNodes.length === 0) return null;

  const text = extractText(contentNodes).trim();
  return text || null;
}

/**
 * Extract success criteria content from TipTap document JSON.
 *
 * Finds the first H2 "Success Criteria" heading and extracts all content
 * until the next H2 heading (or end of document).
 *
 * @param content - TipTap JSON document
 * @returns Extracted success criteria text, or null if no section found
 */
export function extractSuccessCriteriaFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;

  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;

  const nodes = doc.content;
  let startIndex = -1;

  // Find the Success Criteria H2 heading (case-insensitive)
  for (const [i, node] of nodes.entries()) {
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = extractText(node.content || []).trim().toLowerCase();
      if (text === 'success criteria') {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex === -1) return null;

  // Find the end (next H2 or end of document)
  const endIndex = findSectionEndIndex(nodes, startIndex);

  // Extract content between heading and end
  const contentNodes = nodes.slice(startIndex + 1, endIndex);
  if (contentNodes.length === 0) return null;

  const text = extractText(contentNodes).trim();
  return text || null;
}

/**
 * Extract vision content from TipTap document JSON.
 *
 * Finds the first H2 "Vision" heading and extracts all content
 * until the next H2 heading (or end of document).
 * This is used for Program documents.
 *
 * @param content - TipTap JSON document
 * @returns Extracted vision text, or null if no section found
 */
export function extractVisionFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;

  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;

  const nodes = doc.content;
  let startIndex = -1;

  // Find the Vision H2 heading (case-insensitive)
  for (const [i, node] of nodes.entries()) {
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = extractText(node.content || []).trim().toLowerCase();
      if (text === 'vision') {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex === -1) return null;

  // Find the end (next H2 or end of document)
  const endIndex = findSectionEndIndex(nodes, startIndex);

  // Extract content between heading and end
  const contentNodes = nodes.slice(startIndex + 1, endIndex);
  if (contentNodes.length === 0) return null;

  const text = extractText(contentNodes).trim();
  return text || null;
}

/**
 * Extract goals content from TipTap document JSON.
 *
 * Finds the first H2 "Goals" heading and extracts all content
 * until the next H2 heading (or end of document).
 * This is used for Program documents.
 *
 * @param content - TipTap JSON document
 * @returns Extracted goals text, or null if no section found
 */
export function extractGoalsFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;

  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;

  const nodes = doc.content;
  let startIndex = -1;

  // Find the Goals H2 heading (case-insensitive)
  for (const [i, node] of nodes.entries()) {
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = extractText(node.content || []).trim().toLowerCase();
      if (text === 'goals') {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex === -1) return null;

  // Find the end (next H2 or end of document)
  const endIndex = findSectionEndIndex(nodes, startIndex);

  // Extract content between heading and end
  const contentNodes = nodes.slice(startIndex + 1, endIndex);
  if (contentNodes.length === 0) return null;

  const text = extractText(contentNodes).trim();
  return text || null;
}

/**
 * Check if a document is complete based on document type requirements.
 *
 * Requirements:
 * - Projects: need plan AND success_criteria
 * - Sprints: need plan AND at least 1 linked issue
 *   (dates are computed from sprint_number + workspace.sprint_start_date)
 *
 * @param documentType - The document type (project, sprint, etc.)
 * @param properties - The document's properties object
 * @param linkedIssuesCount - Number of issues linked to this sprint (for sprint docs)
 * @returns Object with is_complete boolean and array of missing fields
 */
export function checkDocumentCompleteness(
  documentType: string,
  properties: Record<string, unknown> | null,
  linkedIssuesCount: number = 0
): { isComplete: boolean; missingFields: string[] } {
  const props = properties || {};
  const missingFields: string[] = [];

  if (documentType === 'project') {
    // Projects need plan + success_criteria
    if (!props.plan || (typeof props.plan === 'string' && !props.plan.trim())) {
      missingFields.push('Plan');
    }
    if (!props.success_criteria || (typeof props.success_criteria === 'string' && !props.success_criteria.trim())) {
      missingFields.push('Success Criteria');
    }
  } else if (documentType === 'sprint') {
    // Sprints need at least 1 linked issue
    // Plans are now per-person weekly_plan documents, not sprint properties
    if (linkedIssuesCount === 0) {
      missingFields.push('Linked Issues');
    }
  }
  // Other document types don't have completeness requirements

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}
