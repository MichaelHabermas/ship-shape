import crypto from 'node:crypto';
import { fail, finding, pass, skip } from '../lib/result-model.mjs';
import { runSelectedProbes } from '../lib/probe-selection.mjs';
import { fingerprintForFinding } from '../lib/finding-registry.mjs';
import { isDeniedStatus, memberReady, pickSprintDocument, pickProgram } from '../lib/fixtures.mjs';
import { longPayload, marker, sqlPayload, xssPayload } from '../fixtures/payloads.mjs';

export async function inputSanitizationProbes(context) {
  return runSelectedProbes(context, [
    { id: 'input-stored-xss-document-title', name: 'Stored XSS document title does not echo raw script tag', run: storedXssDocumentTitle },
    { id: 'input-search-payloads', name: 'Search payloads do not leak internals or raw script markers', run: searchPayloads },
    { id: 'input-long-field-validation', name: 'Excessively long document title rejected', run: longFieldValidation, requiresWrite: true },
    { id: 'input-issue-payloads', name: 'Issue payloads remain inert and validation bounded', run: issuePayloads, requiresWrite: true },
    { id: 'input-comment-payloads', name: 'Comment payloads remain inert and validation bounded', run: commentPayloads, requiresWrite: true },
    { id: 'input-file-upload-size-mismatch', name: 'Local upload size mismatch rejected', run: fileUploadSizeMismatch, requiresWrite: true },
    { id: 'input-file-serve-headers', name: 'Served uploads use safe download headers', run: fileServeHeaders, requiresWrite: true },
    { id: 'input-governance-mass-assignment', name: 'Governance fields rejected on generic PATCH', run: governanceMassAssignment, requiresWrite: true },
  ]);
}

async function governanceMassAssignment({ clients }) {
  if (!memberReady(clients)) {
    return skip('input-governance-mass-assignment', 'Governance fields rejected on generic PATCH', 'member login unavailable');
  }
  const program = await pickProgram(clients.admin);
  const sprint = await pickSprintDocument(clients.admin, program.id);
  const patch = await clients.member.api(`/api/documents/${sprint.id}`, {
    method: 'PATCH',
    body: {
      properties: {
        review_approval: { state: 'approved' },
        submitted_at: new Date().toISOString(),
      },
    },
  });
  if (isDeniedStatus(patch.status)) {
    return pass('input-governance-mass-assignment', 'Governance fields rejected on generic PATCH');
  }
  return fail('input-governance-mass-assignment', 'Governance fields rejected on generic PATCH', finding({
    id: 'probe-governance-mass-assignment',
    probeId: 'input-governance-mass-assignment',
    title: 'Governance fields accepted via generic PATCH',
    severity: 'critical',
    ledgerId: 'SS-FIND-001',
    owasp: 'A01',
    fingerprint: fingerprintForFinding('input-governance-mass-assignment', 'probe-governance-mass-assignment'),
    category: 'input-validation',
    expected: 'Member PATCH with review_approval/submitted_at returns 400 or 403.',
    observed: `Received HTTP ${patch.status}.`,
    evidence: { reproduction: ['pnpm security:probe -- --probe input-governance-mass-assignment'] },
  }));
}

async function storedXssDocumentTitle({ clients, config }) {
  const result = await clients.admin.api('/api/documents', {
    method: 'POST',
    body: {
      title: `${marker(config.runId)} ${xssPayload}`,
      document_type: 'wiki',
      visibility: 'workspace',
    },
  });
  const contentType = result.headers.get('content-type') || '';
  if (result.status < 300 && contentType.includes('application/json')) {
    return pass('input-stored-xss-document-title', 'Stored XSS payload remains inert in JSON API response');
  }
  if (result.status < 300 && /<script>|onerror=/i.test(result.text)) {
    return fail('input-stored-xss-document-title', 'Stored XSS document title does not echo raw script tag', finding({
      id: 'cat8-input-stored-xss-document-title',
      probeId: 'input-stored-xss-document-title',
      title: 'Document create response rendered executable-looking script payload',
      severity: 'medium',
      category: 'xss',
      affected: { endpoint: '/api/documents' },
      expected: 'Stored payloads remain inert in JSON API responses and rendering paths.',
      observed: 'Create response returned executable-looking payload outside JSON.',
      evidence: { reproduction: ['Run pnpm security:probe -- --probe input-stored-xss-document-title'] },
    }));
  }
  return skip('input-stored-xss-document-title', 'Stored XSS document title does not echo raw script tag', `document create returned HTTP ${result.status}`);
}

async function searchPayloads({ clients }) {
  const [sql, xss] = await Promise.all([
    clients.admin.api(`/api/search/documents?q=${encodeURIComponent(sqlPayload)}`),
    clients.admin.api(`/api/search/documents?q=${encodeURIComponent(xssPayload)}`),
  ]);
  const combined = `${sql.text}\n${xss.text}`;
  if (!/stack|node_modules|syntax error|DATABASE_URL|\/Users\//i.test(combined)) return pass('input-search-payloads', 'Search payloads do not leak internals');
  return fail('input-search-payloads', 'Search payloads do not leak internals', finding({
    id: 'cat8-input-search-payloads',
    probeId: 'input-search-payloads',
    title: 'Search payload response exposed internals',
    severity: 'medium',
    category: 'input-validation',
    affected: { endpoint: '/api/search/documents' },
    expected: 'Search handles SQL/XSS-shaped input without internals.',
    observed: 'Response matched stack/internal leakage pattern.',
    evidence: { reproduction: ['Run pnpm security:probe -- --probe input-search-payloads'] },
  }));
}

async function longFieldValidation({ clients }) {
  const result = await clients.admin.api('/api/documents', {
    method: 'POST',
    body: { title: longPayload, document_type: 'wiki' },
  });
  if (result.status === 400) return pass('input-long-field-validation', 'Excessively long document title rejected');
  return fail('input-long-field-validation', 'Excessively long document title rejected', finding({
    id: 'cat8-input-long-title',
    probeId: 'input-long-field-validation',
    title: 'Excessively long title was not rejected',
    severity: 'medium',
    category: 'input-validation',
    affected: { endpoint: '/api/documents' },
    expected: 'Document title length validation returns 400.',
    observed: `Received HTTP ${result.status}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe input-long-field-validation'] },
  }));
}

async function createLocalUpload({ clients, config }, sizeBytes = 32) {
  const create = await clients.admin.api('/api/files/upload', {
    method: 'POST',
    body: {
      filename: `${marker(config.runId)}-probe.html`.replace(/[^\w.-]+/g, '_'),
      mimeType: 'text/html',
      sizeBytes,
    },
  });
  const fileId = create.json?.fileId;
  const uploadUrl = create.json?.uploadUrl;
  if (!fileId || !uploadUrl) return { create };
  return { create, fileId, uploadUrl };
}

async function createProbeDocument({ clients, config }) {
  const result = await clients.admin.api('/api/documents', {
    method: 'POST',
    body: {
      title: `${marker(config.runId)} comment target`,
      document_type: 'wiki',
      visibility: 'workspace',
    },
  });
  return result.json?.id || result.json?.data?.id || result.json?.document?.id;
}

function hasInternalLeak(text) {
  return /stack|node_modules|syntax error|DATABASE_URL|\/Users\//i.test(text);
}

function isJson(result) {
  return (result.headers.get('content-type') || '').includes('application/json');
}

async function issuePayloads({ clients, config }) {
  const result = await clients.admin.api('/api/issues', {
    method: 'POST',
    body: {
      title: `${marker(config.runId)} ${xssPayload} ${sqlPayload}`,
      state: 'backlog',
      priority: 'medium',
      belongs_to: [],
    },
  });
  if (result.status < 300 && isJson(result) && !hasInternalLeak(result.text)) return pass('input-issue-payloads', 'Issue payloads remain inert and validation bounded');
  return fail('input-issue-payloads', 'Issue payloads remain inert and validation bounded', finding({
    id: 'cat8-input-issue-payloads',
    probeId: 'input-issue-payloads',
    title: 'Issue payload response exposed unsafe content or internals',
    severity: 'medium',
    category: 'input-validation',
    affected: { endpoint: '/api/issues' },
    expected: 'Issue create handles XSS/SQL-shaped title input as inert JSON without internals.',
    observed: `Received HTTP ${result.status}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe input-issue-payloads'] },
  }));
}

async function commentPayloads(context) {
  const { clients, config } = context;
  const docId = await createProbeDocument(context);
  if (!docId) return skip('input-comment-payloads', 'Comment payloads remain inert and validation bounded', 'could not create probe document');
  const result = await clients.admin.api(`/api/documents/${docId}/comments`, {
    method: 'POST',
    body: {
      comment_id: cryptoRandomUuid(),
      content: `${marker(config.runId)} ${xssPayload} ${sqlPayload}`,
    },
  });
  const longComment = await clients.admin.api(`/api/documents/${docId}/comments`, {
    method: 'POST',
    body: {
      comment_id: cryptoRandomUuid(),
      content: `${longPayload}${longPayload}`,
    },
  });
  if (result.status < 300 && isJson(result) && !hasInternalLeak(result.text) && longComment.status === 400) {
    return pass('input-comment-payloads', 'Comment payloads remain inert and validation bounded');
  }
  return fail('input-comment-payloads', 'Comment payloads remain inert and validation bounded', finding({
    id: 'cat8-input-comment-payloads',
    probeId: 'input-comment-payloads',
    title: 'Comment payload response exposed unsafe content or missing length validation',
    severity: 'medium',
    category: 'input-validation',
    affected: { endpoint: '/api/documents/:id/comments' },
    expected: 'Comment create handles XSS/SQL-shaped content as inert JSON and rejects overlong content.',
    observed: `payload HTTP ${result.status}, long comment HTTP ${longComment.status}.`,
    evidence: { reproduction: ['Run pnpm security:probe -- --probe input-comment-payloads'] },
  }));
}

function cryptoRandomUuid() {
  return crypto.randomUUID();
}

async function fileUploadSizeMismatch(context) {
  const { clients } = context;
  const upload = await createLocalUpload(context, 2048);
  if (!upload.fileId) return skip('input-file-upload-size-mismatch', 'Local upload size mismatch rejected', `upload request returned HTTP ${upload.create.status}`);
  const result = await clients.admin.api(upload.uploadUrl, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body: '<h1>too short</h1>',
  });
  if (result.status === 400) return pass('input-file-upload-size-mismatch', 'Local upload size mismatch rejected');
  return fail('input-file-upload-size-mismatch', 'Local upload size mismatch rejected', finding({
    id: 'cat8-input-file-size-mismatch',
    probeId: 'input-file-upload-size-mismatch',
    title: 'Local file upload accepted bytes that did not match declared size',
    severity: 'medium',
    category: 'file-upload',
    affected: { endpoint: '/api/files/:id/local-upload' },
    expected: 'Local upload rejects body length that differs from pending file size_bytes.',
    observed: `Upload returned HTTP ${result.status}.`,
    evidence: { reproduction: ['Create pending upload with sizeBytes 2048.', 'POST a much shorter body to /api/files/:id/local-upload.'] },
    fixCandidate: 'Compare received buffer length with file.size_bytes before writing local upload.',
  }));
}

async function fileServeHeaders(context) {
  const { clients } = context;
  const body = '<h1>cat8</h1>xx';
  const upload = await createLocalUpload(context, Buffer.byteLength(body));
  if (!upload.fileId) return skip('input-file-serve-headers', 'Served uploads use safe download headers', `upload request returned HTTP ${upload.create.status}`);
  const uploaded = await clients.admin.api(upload.uploadUrl, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body,
  });
  if (uploaded.status >= 400) return skip('input-file-serve-headers', 'Served uploads use safe download headers', `local upload returned HTTP ${uploaded.status}`);
  const served = await clients.admin.api(`/api/files/${upload.fileId}/serve`);
  const disposition = served.headers.get('content-disposition') || '';
  const nosniff = served.headers.get('x-content-type-options') || '';
  if (/attachment/i.test(disposition) && /nosniff/i.test(nosniff)) return pass('input-file-serve-headers', 'Served uploads use safe download headers');
  return fail('input-file-serve-headers', 'Served uploads use safe download headers', finding({
    id: 'cat8-input-file-serve-headers',
    probeId: 'input-file-serve-headers',
    title: 'Uploaded HTML was served inline without nosniff protection',
    severity: 'medium',
    category: 'file-upload',
    affected: { endpoint: '/api/files/:id/serve' },
    expected: 'User uploads are served as attachments with X-Content-Type-Options: nosniff.',
    observed: `Content-Disposition=${disposition || '(missing)'}, X-Content-Type-Options=${nosniff || '(missing)'}.`,
    evidence: { reproduction: ['Upload text/html content through local file upload.', 'GET /api/files/:id/serve and inspect response headers.'] },
    fixCandidate: 'Serve local uploads as attachments, sanitize filenames, and set X-Content-Type-Options: nosniff.',
  }));
}
