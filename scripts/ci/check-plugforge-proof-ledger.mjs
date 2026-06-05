#!/usr/bin/env node
// PlugForge proof ledger checker validates atom classification, proof evidence, and named gaps.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultLedgerPath = path.join(rootDir, 'my-docs', 'project-weeks-sot', 'week-6', 'proof-ledger.yaml');
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const enforce = args.has('--enforce');
const ledgerPathArg = process.argv.find(arg => arg.startsWith('--ledger='));
const ledgerPath = ledgerPathArg
  ? path.resolve(rootDir, ledgerPathArg.slice('--ledger='.length))
  : defaultLedgerPath;

const filters = {
  priorities: parseFilter('priority'),
  areas: parseFilter('area'),
  classes: parseFilter('class'),
  statuses: parseFilter('status'),
};

const validStatuses = new Set([
  'proven',
  'partial',
  'missing',
  'manual_pending',
  'open_decision',
  'non_scope',
  'covered_by',
]);
const validTestability = new Set(['unit', 'api', 'e2e', 'metric', 'manual', 'none']);
const validRequirementClasses = new Set([
  'functional',
  'metric',
  'documentation',
  'submission',
  'manual',
  'open_decision',
  'non_scope',
]);
const validPriorities = new Set(['P0', 'P1', 'P2']);
const validProofTiers = new Set(['live_required', 'unit_ok', 'not_applicable']);
const enforceTestability = new Set(['unit', 'api', 'e2e', 'metric']);
const requiredFields = [
  'id',
  'source',
  'section',
  'requirement',
  'requirement_class',
  'testability',
  'priority',
  'status',
  'proof_command',
  'proof_files',
  'pending_test',
  'manual_evidence',
  'covered_by',
  'gap',
];

const liveEvidenceValidators = new Map([
  ...[
    'W6-METRIC-002',
    'W6-METRIC-003',
    'W6-CLI-002',
    'W6-CLI-003',
    'W6-CLI-006',
    'W6-CLI-007',
    'W6-CLI-010',
    'W6-CLI-011',
    'W6-CLI-012',
    'W6-CLI-013',
    'W6-CLI-014',
    'W6-INT-002',
  ].map(id => [id, validateTtfeTimingEvidence]),
  ...[
    'W6-METRIC-005',
    'W6-METRIC-006',
  ].map(id => [id, validateTtfeFlakeEvidence]),
  ...[
    'W6-INT-003',
    'W6-INT-004',
    'W6-INT-005',
    'W6-INT-006',
  ].map(id => [id, validateSlackLiveEvidence]),
  ...[
    'W6-INT-008',
    'W6-INT-009',
  ].map(id => [id, validateBrowserSdkLiveEvidence]),
  ...[
    'W6-INT-010',
    'W6-INT-011',
  ].map(id => [id, validateGitLabLiveEvidence]),
]);

if (!existsSync(ledgerPath)) {
  console.error(`PlugForge proof ledger not found: ${path.relative(rootDir, ledgerPath)}`);
  process.exit(1);
}

const entries = parseLedger(readFileSync(ledgerPath, 'utf8'));
const problems = [];
const ids = new Set();
const fileContents = new Map();
const coverageReferences = [];

if (entries.length === 0) {
  problems.push('Ledger contains no requirements.');
}

for (const entry of entries) {
  const label = entry.id || '(missing id)';
  for (const field of requiredFields) {
    if (!hasValue(entry[field])) {
      problems.push(`${label}: missing required field ${field}`);
    }
  }

  if (!/^W6-[A-Z]+-\d{3}$/.test(entry.id ?? '')) {
    problems.push(`${label}: id must match W6-AREA-001`);
  }
  if (ids.has(entry.id)) {
    problems.push(`${label}: duplicate id`);
  }
  ids.add(entry.id);

  if (!validStatuses.has(entry.status ?? '')) {
    problems.push(`${label}: invalid status ${entry.status}`);
  }
  if (!validTestability.has(entry.testability ?? '')) {
    problems.push(`${label}: invalid testability ${entry.testability}`);
  }
  if (!validRequirementClasses.has(entry.requirement_class ?? '')) {
    problems.push(`${label}: invalid requirement_class ${entry.requirement_class}`);
  }
  if (!validPriorities.has(entry.priority ?? '')) {
    problems.push(`${label}: invalid priority ${entry.priority}`);
  }
  if (hasValue(entry.proof_tier) && !validProofTiers.has(entry.proof_tier ?? '')) {
    problems.push(`${label}: invalid proof_tier ${entry.proof_tier}`);
  }
  if (filters.priorities.length > 0 && !filters.priorities.includes(entry.priority)) {
    continue;
  }
  if (filters.areas.length > 0 && !filters.areas.includes(areaFor(entry.id))) {
    continue;
  }
  if (filters.classes.length > 0 && !filters.classes.includes(entry.requirement_class)) {
    continue;
  }
  if (filters.statuses.length > 0 && !filters.statuses.includes(entry.status)) {
    continue;
  }

  if (entry.status === 'proven') {
    if (isNone(entry.proof_command)) problems.push(`${label}: proven item must name proof_command`);
    if (isNone(entry.proof_files)) problems.push(`${label}: proven item must name proof_files`);
    if (!isNone(entry.gap)) problems.push(`${label}: proven item should use gap: "none"`);
    if (entry.proof_tier === 'live_required') {
      const liveEvidence = validateLiveProofEvidence(entry);
      if (!liveEvidence.ok) {
        problems.push(`${label}: ${liveEvidence.message}`);
      }
    }
    const mockEvidenceMarkers = [
      'my-docs/evidence/plugforge-integrations/slack.json',
      'my-docs/evidence/plugforge-integrations/gitlab.json',
      'my-docs/evidence/plugforge-integrations/matrix.json',
      'my-docs/evidence/plugforge-integrations/all-runner.json',
    ];
    if (!isNone(entry.proof_files)) {
      for (const marker of mockEvidenceMarkers) {
        if (entry.proof_files.includes(marker)) {
          problems.push(`${label}: proven item must not cite invalidated mock integration evidence (${marker})`);
        }
      }
    }
    if (!isNone(entry.proof_command) && /\bplugforge:integrations(?!:check)\b/.test(entry.proof_command)) {
      if (entry.proof_tier === 'live_required' || (entry.id ?? '').startsWith('W6-INT-0')) {
        problems.push(`${label}: proven integration proof must not use mocked plugforge:integrations runner`);
      }
    }
  }

  if ((entry.status === 'partial' || entry.status === 'missing' || entry.status === 'manual_pending') && isNone(entry.gap)) {
    problems.push(`${label}: ${entry.status} item must name a concrete gap`);
  }

  if (
    enforce &&
    (entry.priority === 'P0' || entry.priority === 'P1') &&
    enforceTestability.has(entry.testability) &&
    entry.status !== 'proven'
  ) {
    problems.push(`${label}: enforce mode requires P0/P1 ${entry.testability} requirements to be proven`);
  }

  if (
    (entry.priority === 'P0' || entry.priority === 'P1') &&
    enforceTestability.has(entry.testability) &&
    (entry.status === 'partial' || entry.status === 'missing') &&
    isNone(entry.pending_test)
  ) {
    problems.push(`${label}: missing or partial testable item must name a pending_test`);
  }

  if (isDocumentationLike(entry) && !['covered_by', 'open_decision', 'non_scope'].includes(entry.status) && isNone(entry.manual_evidence)) {
    problems.push(`${label}: manual/documentation/submission item must name manual_evidence`);
  }

  if (entry.status === 'covered_by') {
    if (isNone(entry.covered_by)) {
      problems.push(`${label}: covered_by item must point to an existing id`);
    } else {
      coverageReferences.push({ id: entry.id, coveredBy: entry.covered_by });
    }
    if (!isNone(entry.proof_command) || !isNone(entry.proof_files) || !isNone(entry.pending_test) || !isNone(entry.manual_evidence)) {
      problems.push(`${label}: covered_by item should not duplicate proof, pending tests, or manual evidence`);
    }
  } else if (!isNone(entry.covered_by)) {
    problems.push(`${label}: covered_by must be none unless status is covered_by`);
  }

  if (entry.status === 'open_decision' || entry.status === 'non_scope') {
    if (entry.requirement_class !== entry.status) {
      problems.push(`${label}: ${entry.status} item must use requirement_class ${entry.status}`);
    }
    if (!isNone(entry.proof_command) || !isNone(entry.proof_files) || !isNone(entry.pending_test) || !isNone(entry.manual_evidence) || !isNone(entry.covered_by)) {
      problems.push(`${label}: ${entry.status} item must not pretend to have proof, pending tests, manual evidence, or coverage`);
    }
  }

  if (entry.requirement_class === 'open_decision' && entry.status !== 'open_decision') {
    problems.push(`${label}: open_decision class must use open_decision status`);
  }
  if (entry.requirement_class === 'non_scope' && entry.status !== 'non_scope') {
    problems.push(`${label}: non_scope class must use non_scope status`);
  }

  for (const field of ['proof_files', 'pending_test']) {
    if (isNone(entry[field])) continue;
    for (const item of splitPaths(entry[field])) {
      if (!existsSync(path.resolve(rootDir, item))) {
        problems.push(`${label}: ${field} path does not exist: ${item}`);
      }
    }
  }

  if (
    (entry.priority === 'P0' || entry.priority === 'P1') &&
    enforceTestability.has(entry.testability) &&
    (entry.status === 'partial' || entry.status === 'missing') &&
    !isNone(entry.pending_test)
  ) {
    const pendingFiles = splitPaths(entry.pending_test);
    const hasMatchingPendingId = pendingFiles.some(item => {
      const absolutePath = path.resolve(rootDir, item);
      if (!existsSync(absolutePath)) return false;
      if (!fileContents.has(absolutePath)) {
        fileContents.set(absolutePath, readFileSync(absolutePath, 'utf8'));
      }
      return fileContents.get(absolutePath).includes(entry.id);
    });
    if (!hasMatchingPendingId) {
      problems.push(`${label}: pending_test file must mention the requirement id`);
    }
  }
}

for (const reference of coverageReferences) {
  if (!ids.has(reference.coveredBy)) {
    problems.push(`${reference.id}: covered_by target does not exist: ${reference.coveredBy}`);
  }
}

const counts = countBy(entries, entry => entry.status);
const byArea = countBy(entries, entry => areaFor(entry.id));
const byRequirementClass = countBy(entries, entry => entry.requirement_class);
const byTestability = countBy(entries, entry => entry.testability);

console.log(JSON.stringify({
  ledger: path.relative(rootDir, ledgerPath),
  atoms: entries.length,
  by_status: counts,
  by_area: byArea,
  by_requirement_class: byRequirementClass,
  by_testability: byTestability,
  enforce,
  filters,
}, null, 2));

if (problems.length > 0) {
  console.error('\nPlugForge proof ledger problems:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

function parseLedger(text) {
  const entries = [];
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const idMatch = rawLine.match(/^  - id:\s*(.+)$/);
    if (idMatch) {
      current = { id: parseScalar(idMatch[1]) };
      entries.push(current);
      continue;
    }

    if (!current) continue;
    const fieldMatch = rawLine.match(/^    ([A-Za-z0-9_]+):\s*(.*)$/);
    if (fieldMatch) {
      current[fieldMatch[1]] = parseScalar(fieldMatch[2]);
    }
  }

  return entries;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasJsonValue(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return hasValue(value);
}

function isNone(value) {
  return !hasValue(value) || value.trim().toLowerCase() === 'none';
}

function splitPaths(value) {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function areaFor(id) {
  return id?.split('-')[1] ?? 'UNKNOWN';
}

function countBy(entries, mapper) {
  return entries.reduce((acc, entry) => {
    const key = mapper(entry) || 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function parseFilter(name) {
  const inline = rawArgs.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return splitFilterValues(inline.slice(name.length + 3));

  const index = rawArgs.indexOf(`--${name}`);
  if (index === -1 || index === rawArgs.length - 1) return [];
  return splitFilterValues(rawArgs[index + 1]);
}

function splitFilterValues(value) {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function isDocumentationLike(entry) {
  return entry.requirement_class === 'documentation' || entry.requirement_class === 'submission' || entry.requirement_class === 'manual';
}

function validateLiveProofEvidence(entry) {
  const validator = liveEvidenceValidators.get(entry.id);
  if (!validator) {
    return {
      ok: false,
      message: 'live_required proven item has no atom-specific live evidence validator',
    };
  }
  const candidates = [
    ...splitPaths(isNone(entry.proof_files) ? '' : entry.proof_files),
    ...splitPaths(isNone(entry.manual_evidence) ? '' : entry.manual_evidence),
  ].filter(item => item.endsWith('.json'));

  const failures = [];
  for (const item of candidates) {
    const absolutePath = path.resolve(rootDir, item);
    if (!existsSync(absolutePath)) continue;
    try {
      const json = JSON.parse(readFileSync(absolutePath, 'utf8'));
      const validationProblems = [
        ...validateBaseLiveEvidence(json),
        ...validator(json, entry),
        ...validateEvidenceIsSanitized(json),
      ];
      if (validationProblems.length === 0) return { ok: true, path: item };
      failures.push(`${item}: ${validationProblems.join('; ')}`);
    } catch (error) {
      failures.push(`${item}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (failures.length === 0) {
    return { ok: false, message: 'live_required proven item must cite atom-specific live JSON evidence' };
  }
  return { ok: false, message: `live_required proof evidence failed validation: ${failures.join(' | ')}` };
}

function validateBaseLiveEvidence(json) {
  const problems = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ['evidence must be a JSON object'];
  const proofClass = json.proofClass ?? json.proof_class;
  if (proofClass !== 'live') problems.push('proofClass/proof_class must be "live"');
  if (json.ok === false) problems.push('ok must not be false');
  if (json.status === 'failed') problems.push('status must not be failed');
  if (!(json.ok === true || json.status === 'measured' || json.status === 'passed')) {
    problems.push('evidence must be passing (ok true, measured, or passed)');
  }
  return problems;
}

function validateTtfeTimingEvidence(json) {
  const problems = [];
  const requiredStages = ['install', 'login', 'subscription', 'create', 'receipt', 'verification', 'total'];
  const tailEvent = json.evidence?.tailEvent ?? json.tailEvent ?? json.drill?.tailEvent;
  const timings = Array.isArray(json.drill?.timings) ? json.drill.timings : Array.isArray(json.timings) ? json.timings : [];
  const stageNames = timings.map(timing => timing.stage ?? timing.name);
  const totalMs = typeof json.result?.totalMs === 'number'
    ? json.result.totalMs
    : timings.find(timing => timing.stage === 'total' || timing.name === 'total')?.ms;
  const maxTotalMs = typeof json.targets?.maxTotalMs === 'number' ? json.targets.maxTotalMs : 60_000;

  if (json.metric !== 'ttfe-timing') problems.push('metric must be ttfe-timing');
  if (json.approvalMethod !== 'oauth_device_ui') problems.push('approvalMethod must be oauth_device_ui');
  if (json.result?.liveApprovalOk !== true) problems.push('result.liveApprovalOk must be true');
  if (json.evidence?.approval?.method !== 'oauth_device_ui' && json.drill?.approval?.method !== 'oauth_device_ui') {
    problems.push('approval evidence must use oauth_device_ui');
  }
  for (const stage of requiredStages) {
    if (!stageNames.includes(stage)) problems.push(`missing TTFE stage ${stage}`);
  }
  if (typeof totalMs !== 'number') problems.push('total TTFE timing must be numeric');
  else if (totalMs >= maxTotalMs) problems.push(`total TTFE timing must be < ${maxTotalMs}ms`);
  if (json.result?.tailOk !== true) problems.push('result.tailOk must be true');
  problems.push(...validateDocumentCreatedTailEvent(tailEvent));
  return problems;
}

function validateTtfeFlakeEvidence(json) {
  const problems = [];
  const runs = Array.isArray(json.runs) ? json.runs : [];
  const requestedRuns = json.requestedRuns;
  const p95 = json.totalTimingMs?.p95;
  const maxP95Ms = typeof json.targets?.maxP95Ms === 'number' ? json.targets.maxP95Ms : 60_000;

  if (json.metric !== 'ttfe-flake-loop') problems.push('metric must be ttfe-flake-loop');
  if (typeof requestedRuns !== 'number' || requestedRuns < 20) problems.push('requestedRuns must be at least 20');
  if (json.passedRuns !== requestedRuns) problems.push('passedRuns must equal requestedRuns');
  if (json.failedRuns !== 0) problems.push('failedRuns must be 0');
  if (typeof p95 !== 'number') problems.push('totalTimingMs.p95 must be numeric');
  else if (p95 >= maxP95Ms) problems.push(`totalTimingMs.p95 must be < ${maxP95Ms}ms`);
  if (runs.length !== requestedRuns) problems.push('runs length must equal requestedRuns');
  for (const run of runs) {
    if (run.ok !== true) problems.push(`run ${run.run ?? '?'} must be ok`);
    if (run.proofClass !== 'live') problems.push(`run ${run.run ?? '?'} proofClass must be live`);
    problems.push(...validateDocumentCreatedTailEvent(run.evidence?.tailEvent).map(problem => `run ${run.run ?? '?'} ${problem}`));
  }
  return problems;
}

function validateSlackLiveEvidence(json, entry) {
  const problems = [];
  if (json.flow !== 'slack') problems.push('Slack atoms require flow "slack"');
  if (liveProofClass(json) !== 'live') problems.push('Slack live evidence must set proof_class live');
  if (json.status !== 'passed') problems.push('Slack live evidence must have status passed');
  if (!isHttpUrl(json.api_url)) problems.push('Slack live evidence must include api_url');
  if (!isHttpUrl(json.integration_target_url)) problems.push('Slack live evidence must include integration_target_url');
  if (json.mocked === true || json.mock === true || json.proofClass === 'dev_shortcut' || json.proof_class === 'dev_shortcut') {
    problems.push('Slack live evidence must not be mocked or a dev shortcut');
  }
  const oauth = json.oauth ?? json.slack_oauth ?? {};
  if (!(oauth.provider === 'slack' && oauth.completed === true && oauth.live === true && hasValue(oauth.team_id ?? oauth.teamId))) {
    problems.push('Slack evidence requires live OAuth with provider slack, completed true, live true, and team id');
  }
  const documentWebhook = findSignedWebhook(json, 'document.created');
  const issueWebhook = findSignedWebhook(json, 'issue.assigned');
  if (!documentWebhook) problems.push('Slack evidence requires signed document.created delivery with ids and 2xx response');
  if (!issueWebhook) problems.push('Slack evidence requires signed issue.assigned delivery with ids and 2xx response');
  const documentMessage = findSlackMessage(json, 'document.created');
  const issueMessage = findSlackMessage(json, 'issue.assigned');
  if (!documentMessage) problems.push('Slack evidence requires real document.created Slack message with live marker and message_ts or permalink');
  if (!issueMessage) problems.push('Slack evidence requires real issue.assigned Slack message with live marker and message_ts or permalink');
  if (entry.id === 'W6-INT-003') {
    if (!documentWebhook) problems.push('W6-INT-003 requires a live signed document.created webhook with signatureVerified true');
  }
  if (entry.id === 'W6-INT-004') {
    if (!documentMessage) problems.push('W6-INT-004 requires a real Slack document.created message with message_ts or permalink');
  }
  if (entry.id === 'W6-INT-005') {
    if (!issueMessage) problems.push('W6-INT-005 requires a real Slack issue.assigned message with message_ts or permalink');
  }
  return problems;
}

function validateBrowserSdkLiveEvidence(json, entry) {
  const problems = [];
  const sdkDemoUrl = json.sdkDemoUrl ?? json.sdk_demo_url ?? json.deployedUrl ?? json.deployed_url ?? '';
  if (json.flow !== 'browser') problems.push('browser SDK atoms require flow "browser"');
  if (!(sdkDemoUrl.startsWith('https://') && sdkDemoUrl.includes('/sdk-demo'))) {
    problems.push('browser SDK live evidence must include an https deployed /sdk-demo URL');
  }
  if (!(json.environment === 'deployed' || json.deployed === true)) {
    problems.push('browser SDK live evidence must mark environment deployed');
  }
  const pkce = json.pkce ?? json.authCodePkce ?? json.authorizationCodePkce ?? {};
  if (!(pkce.ok === true || pkce.completed === true)) {
    problems.push('browser SDK live evidence must prove Authorization Code + PKCE completion');
  }
  if (entry.id === 'W6-INT-009') {
    const documentList = json.documentList ?? json.document_list ?? {};
    if (!(documentList.ok === true || documentList.listed === true || Array.isArray(json.documents))) {
      problems.push('W6-INT-009 requires authenticated document-list evidence');
    }
  }
  return problems;
}

function validateGitLabLiveEvidence(json, entry) {
  const problems = [];
  if (json.flow !== 'gitlab') problems.push('GitLab atoms require flow "gitlab"');
  if (liveProofClass(json) !== 'live') problems.push('GitLab live evidence must set proof_class live');
  if (json.status !== 'passed') problems.push('GitLab live evidence must have status passed');
  if (!isHttpUrl(json.api_url)) problems.push('GitLab live evidence must include api_url');
  if (json.mocked === true || json.mock === true || json.proofClass === 'dev_shortcut' || json.proof_class === 'dev_shortcut') {
    problems.push('GitLab live evidence must not be mocked or a dev shortcut');
  }
  const link = json.external_link ?? json.externalLink ?? {};
  const mergeRequest = json.merge_request ?? json.mergeRequest ?? {};
  const webhook = json.webhook ?? json.gitlabWebhook ?? {};
  const observedWebhook = json.observed_webhook ?? json.observedWebhook ?? {};
  const projectUrl = webhook.projectUrl ?? webhook.project_url ?? json.project_url;
  if (!isRealExternalHttpsUrl(projectUrl)) problems.push('GitLab evidence requires a real HTTPS project URL');
  if (!(webhook.live === true && isRealExternalHttpsUrl(webhook.target_url ?? webhook.targetUrl) && String(webhook.target_url ?? webhook.targetUrl).endsWith('/gitlab/webhook'))) {
    problems.push('GitLab evidence requires a live HTTPS /gitlab/webhook target URL');
  }
  if (!hasJsonValue(webhook.hook_id ?? webhook.hookId)) problems.push('GitLab evidence requires hook id');
  if (!(Number(observedWebhook.linked) >= 1)) problems.push('GitLab evidence requires observed webhook linked >= 1');
  if (hasJsonValue(observedWebhook.merge_request_iid ?? observedWebhook.mergeRequestIid) && hasJsonValue(mergeRequest.iid) &&
    String(observedWebhook.merge_request_iid ?? observedWebhook.mergeRequestIid) !== String(mergeRequest.iid)) {
    problems.push('GitLab observed webhook iid must match merge request iid');
  }
  if (!isRealExternalHttpsUrl(mergeRequest.url)) problems.push('GitLab evidence requires a real HTTPS merge request URL');
  if (link.url !== mergeRequest.url) problems.push('GitLab external link URL must match merge request URL');
  if (hasJsonValue(mergeRequest.iid) && !String(link.external_id ?? link.externalId ?? '').endsWith(`!${mergeRequest.iid}`)) {
    problems.push('GitLab external link external_id must end with merge request iid');
  }
  if (entry.id === 'W6-INT-010') {
    if (!(link.provider === 'gitlab' && link.kind === 'merge_request' && isRealExternalHttpsUrl(link.url))) {
      problems.push('W6-INT-010 requires a live GitLab merge-request external link URL');
    }
    if (!(mergeRequest.iid || mergeRequest.id || json.webhook_response?.merge_request_iid)) {
      problems.push('W6-INT-010 requires a GitLab merge-request id or iid');
    }
  }
  if (entry.id === 'W6-INT-011') {
    if (!(webhook.live === true && isRealExternalHttpsUrl(webhook.projectUrl ?? webhook.project_url ?? json.project_url))) {
      problems.push('W6-INT-011 requires a live GitLab project webhook URL');
    }
  }
  return problems;
}

function validateDocumentCreatedTailEvent(event) {
  const problems = [];
  if (!event || typeof event !== 'object') return ['tailEvent must be present'];
  if (event.verified !== true) problems.push('tailEvent.verified must be true');
  if (event.event !== 'document.created') problems.push('tailEvent.event must be document.created');
  if (event.payload?.type !== 'document.created') problems.push('tailEvent.payload.type must be document.created');
  return problems;
}

function validateEvidenceIsSanitized(json) {
  const problems = [];
  const sensitiveKeys = new Set(['accesstoken', 'refresh_token', 'refreshtoken', 'client_secret', 'clientsecret', 'password', 'authorization', 'session_id']);
  visitJson(json, (key, value) => {
    const normalizedKey = key.replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
    if (sensitiveKeys.has(normalizedKey)) {
      problems.push(`evidence must not include sensitive key ${key}`);
    }
    if (typeof value === 'string' && /^Bearer\s+/i.test(value)) {
      problems.push(`evidence must not include bearer token value at ${key}`);
    }
  });
  return problems;
}

function visitJson(value, fn, key = '') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitJson(item, fn, `${key}[${index}]`));
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    fn(childKey, childValue);
    visitJson(childValue, fn, childKey);
  }
}

function findArrayItem(value, predicate) {
  return Array.isArray(value) ? value.find(predicate) : null;
}

function findSlackMessage(json, event) {
  return findArrayItem(json.messages ?? json.posts, item =>
    item?.event === event &&
    item?.live === true &&
    hasValue(item.channel) &&
    (isSlackMessageTs(item.message_ts ?? item.messageTs) || isRealExternalHttpsUrl(item.permalink))
  );
}

function isHttpsUrl(value) {
  return typeof value === 'string' && value.startsWith('https://');
}

function findSignedWebhook(json, event) {
  return findArrayItem(json.signed_webhooks ?? json.signedWebhooks ?? json.webhooks, item =>
    item?.event === event &&
    item?.signatureVerified === true &&
    isUuid(item.subscription_id ?? item.subscriptionId) &&
    isUuid(item.delivery_id ?? item.deliveryId) &&
    hasValue(item.idempotency_key ?? item.idempotencyKey) &&
    isSuccessStatus(item.response_status ?? item.responseStatus)
  );
}

function liveProofClass(json) {
  return json.proof_class ?? json.proofClass;
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function isRealExternalHttpsUrl(value) {
  if (!isHttpsUrl(value)) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '::1', 'example.com'].includes(hostname) &&
      !hostname.endsWith('.example.com') &&
      !hostname.endsWith('.test') &&
      !hostname.endsWith('.example') &&
      !hostname.endsWith('.invalid');
  } catch {
    return false;
  }
}

function isSlackMessageTs(value) {
  return typeof value === 'string' && /^\d{10}\.\d{6}$/.test(value);
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSuccessStatus(value) {
  return Number.isInteger(value) && value >= 200 && value < 300;
}
