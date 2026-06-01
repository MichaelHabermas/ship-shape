// Context chat loads authorized page/finding/document context for model-backed PM conversation.
import { pool } from '../../db/client.js';
import { resolveInitialContent } from '../../db/document-content-codec.js';
import { authorize } from '../../security/capabilities.js';
import type { Principal } from '../../security/principal.js';
import { visibleOutputForFinding } from '../evidence.js';
import type { FleetGraphFinding } from '../persistence.js';
import type { FleetGraphInput, FleetGraphVisibleOutput } from '../types.js';
import type { FleetGraphEvidenceItem, FleetGraphPageContext } from '@ship/shared';
import type { FleetGraphChatAnswerPayload } from './chat.js';

type QueryRunner = Pick<typeof pool, 'query'>;

export type ContextChatContext = Extract<FleetGraphInput['trigger'], { type: 'context_chat' }>['context'];

export type ContextChatDocument = {
  id: string;
  document_type: string;
  title: string;
  properties: Record<string, unknown>;
  content: unknown;
  belongsTo: Array<{ type: string; title: string }>;
};

export type ContextChatSignal = {
  finding: FleetGraphFinding;
  output: FleetGraphVisibleOutput;
  evidence: FleetGraphEvidenceItem[];
};

export type ContextChatBundle = {
  documents: ContextChatDocument[];
  signals: ContextChatSignal[];
  pages: FleetGraphPageContext[];
  visibleOutput?: FleetGraphVisibleOutput;
  evidence: FleetGraphEvidenceItem[];
};

export type ContextChatPersistencePort = {
  getFinding(workspaceId: string, findingId: string): Promise<FleetGraphFinding | null>;
  listFindingsForSource(input: {
    workspaceId: string;
    sourceIssueId?: string;
    sourceSprintId?: string;
  }): Promise<FleetGraphFinding[]>;
};

export type ContextChatResolveOptions = {
  db?: QueryRunner;
  principal?: Principal;
};

export async function resolveContextChatBundle(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'context_chat' }> },
  persistence: ContextChatPersistencePort,
  options: ContextChatResolveOptions
): Promise<ContextChatBundle> {
  const contexts = uniqueChatContexts([input.trigger.context, ...(input.trigger.context.attachedContexts ?? [])]);
  const documents: ContextChatDocument[] = [];
  const signals: ContextChatSignal[] = [];
  const pages: FleetGraphPageContext[] = [];
  const evidence: FleetGraphEvidenceItem[] = [];

  const documentIds = new Set<string>();
  const documentLoads: Array<Promise<ContextChatDocument | null>> = [];
  const findingLookups = contexts.map((context) => resolveFindingForChatContext(input, persistence, context));
  const findings = await Promise.all(findingLookups);
  const visibleLookups = findings.map((finding) => finding
    ? visibleOutputForFinding({
      principal: input.principal,
      workspaceId: input.workspaceId,
      finding,
      db: options.db,
    })
    : Promise.resolve(null));
  const visibles = await Promise.all(visibleLookups);

  const queueDocumentLoad = (documentId: string | null | undefined) => {
    if (!documentId || documentIds.has(documentId)) return;
    documentIds.add(documentId);
    documentLoads.push(loadContextChatDocument({
      db: options.db,
      principal: input.principal,
      workspaceId: input.workspaceId,
      documentId,
    }));
  };

  for (let index = 0; index < contexts.length; index += 1) {
    const context = contexts[index];
    if (!context) continue;

    if (context.pageContext) {
      pages.push(context.pageContext);
      for (const documentId of documentIdsFromPageContext(context.pageContext)) {
        queueDocumentLoad(documentId);
      }
    }

    const finding = findings[index];
    const visible = visibles[index];
    if (finding && visible) {
      if (!visible.output.noSafeOutput) {
        signals.push({ finding, output: visible.output, evidence: visible.evidence });
        evidence.push(...visible.evidence);
      }
      queueDocumentLoad(finding.source_issue_id);
      queueDocumentLoad(finding.source_sprint_id);
      continue;
    }

    queueDocumentLoad(context.documentId ?? documentIdFromSourcePath(context.sourcePath));
  }

  const loadedDocuments = await Promise.all(documentLoads);
  for (const document of loadedDocuments) {
    if (document) documents.push(document);
  }

  return {
    documents: uniqueDocuments(documents),
    signals,
    pages: uniquePages(pages),
    visibleOutput: signals[0]?.output,
    evidence,
  };
}

export function contextTextForModel(bundle: ContextChatBundle): string {
  const documentById = new Map(bundle.documents.map((document) => [document.id, document]));
  const documentText = bundle.documents.map((document) => [
    `Title: ${document.title}`,
    `Type: ${document.document_type}`,
    compactDocumentProperties(document.properties).join(' '),
    document.belongsTo.length > 0 ? `Connected to: ${document.belongsTo.map((item) => `${item.type} ${item.title}`).join(', ')}` : '',
    textFromTipTap(document.content),
  ].filter(Boolean).join('\n')).join('\n\n');
  const signalText = bundle.signals.map((signal) => [
    `Signal: ${signal.output.title}`,
    `Summary: ${signal.output.summary}`,
    `Reason: ${signalReason(signal.output) ?? ''}`,
    `Recommended action: ${recommendedActionFromOutput(signal.output) ?? ''}`,
  ].filter(Boolean).join('\n')).join('\n\n');
  const pageText = bundle.pages.map((page) => [
    `Surface: ${page.surface}`,
    `Route: ${page.route}`,
    `Visible item count hint: ${page.visibleItems.length}`,
    page.selectedItemIds?.length ? `Selected item count hint: ${page.selectedItemIds.length}` : '',
    authorizedDocumentsForPage(page, documentById).length
      ? `Authorized items: ${authorizedDocumentsForPage(page, documentById).map(pageDocumentLabel).join('; ')}`
      : 'Authorized items: none loaded',
  ].filter(Boolean).join('\n')).join('\n\n');

  return [pageText, documentText, signalText].filter(Boolean).join('\n\n---\n\n');
}

export function sourcesFromContextBundle(bundle: ContextChatBundle): Array<{ label: string; kind: string }> {
  return [
    ...bundle.pages.map((page) => ({ label: pageSourceLabel(page.surface), kind: page.surface })),
    ...bundle.documents.map((document) => ({ label: document.title, kind: document.document_type })),
    ...bundle.signals.map((signal) => ({ label: signal.output.title, kind: 'finding' })),
  ].filter((source, index, items) => items.findIndex((item) => item.label === source.label) === index);
}

export function chatModelAnswerFromContext(body: string, bundle: ContextChatBundle): FleetGraphChatAnswerPayload {
  return {
    title: bundle.documents[0]?.title ?? bundle.signals[0]?.output.title ?? 'Chat',
    body: body || 'I do not have an answer for that yet.',
    sources: sourcesFromContextBundle(bundle),
    humanGate: { required: false },
  };
}

export function documentIdFromSourcePath(sourcePath: string | undefined): string | null {
  const match = sourcePath?.match(/^\/(?:documents|issues|projects|programs|sprints)\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export async function loadContextChatDocument(input: {
  db?: QueryRunner;
  principal?: Principal;
  workspaceId: string;
  documentId: string;
}): Promise<ContextChatDocument | null> {
  if (!input.principal) return null;
  const db = input.db ?? pool;
  const decision = await authorize(db, input.principal, {
    resource: 'document',
    action: 'read',
    documentId: input.documentId,
  });
  if (!decision.allowed) return null;

  const result = await db.query<{
    id: string;
    document_type: string;
    title: string;
    properties: Record<string, unknown> | null;
    content: unknown;
    yjs_state: Buffer | null;
  }>(
    `SELECT id, document_type, title, properties, content, yjs_state
       FROM documents
      WHERE id = $1
        AND workspace_id = $2
        AND archived_at IS NULL
        AND deleted_at IS NULL`,
    [input.documentId, input.workspaceId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const resolvedContent = resolveInitialContent({
    content: row.content,
    yjs_state: row.yjs_state,
  }).docJson ?? row.content;

  const associations = await db.query<{ type: string; title: string }>(
    `SELECT da.relationship_type AS type, d.title
       FROM document_associations da
       JOIN documents d ON d.id = da.related_id
      WHERE da.document_id = $1
        AND d.workspace_id = $2
        AND d.archived_at IS NULL
        AND d.deleted_at IS NULL
      ORDER BY da.relationship_type, d.title
      LIMIT 8`,
    [input.documentId, input.workspaceId]
  );

  return {
    id: row.id,
    document_type: row.document_type,
    title: row.title,
    properties: row.properties ?? {},
    content: resolvedContent,
    belongsTo: associations.rows,
  };
}

async function resolveFindingForChatContext(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'context_chat' }> },
  persistence: ContextChatPersistencePort,
  context: ContextChatContext
): Promise<FleetGraphFinding | null> {
  if (context.findingId) return persistence.getFinding(input.workspaceId, context.findingId);

  const documentId = context.documentId ?? documentIdFromSourcePath(context.sourcePath);
  if (!documentId) return null;
  if (context.kind === 'sprint') {
    const findings = await persistence.listFindingsForSource({ workspaceId: input.workspaceId, sourceSprintId: documentId });
    return findings[0] ?? null;
  }
  if (context.kind === 'issue' || context.kind === 'document') {
    const findings = await persistence.listFindingsForSource({ workspaceId: input.workspaceId, sourceIssueId: documentId });
    return findings[0] ?? null;
  }

  return null;
}

function compactDocumentProperties(properties: Record<string, unknown>): string[] {
  const labels: Array<[string, string]> = [
    ['state', 'State'],
    ['status', 'Status'],
    ['priority', 'Priority'],
    ['source', 'Source'],
    ['plan_approval', 'Plan approval'],
    ['review_approval', 'Review approval'],
  ];
  return labels
    .map(([key, label]) => {
      const value = properties[key];
      return typeof value === 'string' && value.trim() ? `${label}: ${value.trim()}.` : null;
    })
    .filter((line): line is string => Boolean(line));
}

function textFromTipTap(value: unknown): string {
  const text = collectTipTapText(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 900 ? `${text.slice(0, 900).trim()}...` : text;
}

function collectTipTapText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const node = value as { text?: unknown; content?: unknown };
  const ownText = typeof node.text === 'string' ? node.text : '';
  const childText = Array.isArray(node.content) ? node.content.map(collectTipTapText).join(' ') : '';
  return [ownText, childText].filter(Boolean).join(' ');
}

function signalReason(output: FleetGraphVisibleOutput): string | null {
  return output.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt?.trim()
    || output.evidence.find((item) => ['stale', 'at_risk'].includes(item.kind) && item.claim?.trim())?.claim?.trim()
    || output.summary
    || null;
}

function recommendedActionFromOutput(output: FleetGraphVisibleOutput): string | undefined {
  return stringFromUnknown(output.recommendedAction?.text)
    || stringFromUnknown(output.recommendedAction?.summary)
    || stringFromUnknown(output.recommendedAction?.label)
    || undefined;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueChatContexts(contexts: ContextChatContext[]): ContextChatContext[] {
  const seen = new Set<string>();
  return contexts.filter((context) => {
    const key = context.findingId
      ? `finding:${context.findingId}`
      : `document:${context.documentId ?? documentIdFromSourcePath(context.sourcePath) ?? context.pageContext?.route ?? context.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueDocuments(documents: ContextChatDocument[]): ContextChatDocument[] {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

function uniquePages(pages: FleetGraphPageContext[]): FleetGraphPageContext[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = `${page.surface}:${page.route}:${page.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function documentIdsFromPageContext(page: FleetGraphPageContext): string[] {
  const ids = new Set<string>();
  for (const id of page.selectedItemIds ?? []) ids.add(id);
  for (const item of page.visibleItems.slice(0, 8)) {
    if (item.id) ids.add(item.id);
  }
  return [...ids].slice(0, 12);
}

function authorizedDocumentsForPage(
  page: FleetGraphPageContext,
  documentById: Map<string, ContextChatDocument>
): ContextChatDocument[] {
  const ids = documentIdsFromPageContext(page);
  return ids.map((id) => documentById.get(id)).filter((document): document is ContextChatDocument => Boolean(document));
}

function pageDocumentLabel(document: ContextChatDocument): string {
  return [
    document.title,
    stringFromUnknown(document.properties.state) ? `state ${stringFromUnknown(document.properties.state)}` : null,
    stringFromUnknown(document.properties.priority) ? `priority ${stringFromUnknown(document.properties.priority)}` : null,
  ].filter(Boolean).join(' · ');
}

function pageSourceLabel(surface: FleetGraphPageContext['surface']): string {
  return `Current ${surface.replace(/_/g, ' ')} page`;
}
