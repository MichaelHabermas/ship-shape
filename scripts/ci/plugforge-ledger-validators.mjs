// PlugForge proof-ledger live evidence validators for atom-specific JSON proof files.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRealExternalHttpsUrl } from '../lib/plugforge-live-drill.mjs';

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
  if (!isRealExternalHttpsUrl(json.api_url)) problems.push('Slack live evidence must include a real external HTTPS api_url');
  if (!isRealExternalHttpsUrl(json.integration_target_url)) problems.push('Slack live evidence must include a real external HTTPS integration_target_url');
  if (json.mocked === true || json.mock === true || json.proofClass === 'dev_shortcut' || json.proof_class === 'dev_shortcut') {
    problems.push('Slack live evidence must not be mocked or a dev shortcut');
  }
  const cleanup = json.cleanup ?? {};
  const deactivated = cleanup.ship_webhooks_deactivated ?? cleanup.shipWebhooksDeactivated;
  const hostedCleanup = cleanup.hosted_mode === true && cleanup.kept === true;
  if (hostedCleanup) {
    const subscriptionIds = cleanup.subscription_ids ?? cleanup.subscriptionIds;
    if (!Array.isArray(subscriptionIds) || subscriptionIds.length < 2 || subscriptionIds.some(id => !isUuid(id))) {
      problems.push('Slack hosted evidence requires two persistent subscription_ids when webhooks are kept');
    }
  } else if (!Array.isArray(deactivated) || deactivated.length < 2 || deactivated.some(item => item?.active !== false)) {
    problems.push('Slack evidence requires Ship webhook subscriptions deactivated after the live run');
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
  if (!(isRealExternalHttpsUrl(sdkDemoUrl) && sdkDemoUrl.includes('/sdk-demo'))) {
    problems.push('browser SDK live evidence must include a real external HTTPS deployed /sdk-demo URL');
  }
  if (!isRealExternalHttpsUrl(json.api_url ?? json.apiUrl)) {
    problems.push('browser SDK live evidence must include a real external HTTPS api_url');
  }
  if (json.mocked === true || json.mock === true || json.proofClass === 'dev_shortcut' || json.proof_class === 'dev_shortcut') {
    problems.push('browser SDK live evidence must not be mocked or a dev shortcut');
  }
  if (!(json.environment === 'deployed' || json.deployed === true)) {
    problems.push('browser SDK live evidence must mark environment deployed');
  }
  const oauthApp = json.oauth_app ?? json.oauthApp ?? {};
  if (!hasValue(oauthApp.client_id ?? oauthApp.clientId)) problems.push('browser SDK evidence requires an OAuth app client_id');
  const pkce = json.pkce ?? json.authCodePkce ?? json.authorizationCodePkce ?? {};
  if (!(pkce.ok === true || pkce.completed === true)) {
    problems.push('browser SDK live evidence must prove Authorization Code + PKCE completion');
  }
  const documentList = json.documentList ?? json.document_list ?? {};
  if (!(documentList.ok === true || documentList.listed === true || Array.isArray(json.documents))) {
    problems.push('browser SDK live evidence requires authenticated document-list evidence');
  }
  const documentCreate = json.documentCreate ?? json.document_create ?? {};
  if (!(documentCreate.ok === true && hasValue(documentCreate.title))) {
    problems.push('browser SDK live evidence requires authenticated document-create evidence');
  }
  const screenshotPath = json.screenshot_path ?? json.screenshotPath;
  if (hasValue(screenshotPath) && !existsSync(path.resolve(defaultRootDir, screenshotPath))) {
    problems.push(`browser SDK screenshot path does not exist: ${screenshotPath}`);
  }
  return problems;
}

function validateGitLabLiveEvidence(json, entry) {
  const problems = [];
  if (json.flow !== 'gitlab') problems.push('GitLab atoms require flow "gitlab"');
  if (liveProofClass(json) !== 'live') problems.push('GitLab live evidence must set proof_class live');
  if (json.status !== 'passed') problems.push('GitLab live evidence must have status passed');
  if (!isRealExternalHttpsUrl(json.api_url)) problems.push('GitLab live evidence must include a real external HTTPS api_url');
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

function validateIntegrationMatrixLiveEvidence(json) {
  const problems = [];
  if (json.flow !== 'matrix') problems.push('integration matrix atom requires flow "matrix"');
  if (liveProofClass(json) !== 'live') problems.push('integration matrix evidence must set proof_class live');
  if (json.status !== 'passed') problems.push('integration matrix evidence must have status passed');

  const flows = matrixFlows(json);
  for (const id of ['cli_ttfe', 'slack', 'browser', 'gitlab', 'refresh_token_theft', 'idempotency_replay']) {
    if (!flows.has(id)) problems.push(`integration matrix missing ${id}`);
  }

  const referencedJsonValidators = [
    ['cli_ttfe', validateTtfeTimingEvidence, { id: 'W6-INT-002' }],
    ['slack', validateSlackLiveEvidence, { id: 'W6-INT-003' }],
    ['browser', validateBrowserSdkLiveEvidence, { id: 'W6-INT-008' }],
    ['gitlab', validateGitLabLiveEvidence, { id: 'W6-INT-010' }],
  ];

  for (const [id, validator, entry] of referencedJsonValidators) {
    const flow = flows.get(id);
    if (!flow) continue;
    const evidencePath = flow.evidence ?? flow.path;
    if (!hasValue(evidencePath)) {
      problems.push(`integration matrix ${id} must cite JSON evidence`);
      continue;
    }
    const referenced = readReferencedJsonEvidence(evidencePath);
    if (!referenced.ok) {
      problems.push(`integration matrix ${id} evidence invalid: ${referenced.message}`);
      continue;
    }
    const validationProblems = [
      ...validateBaseLiveEvidence(referenced.json),
      ...validator(referenced.json, entry),
      ...validateEvidenceIsSanitized(referenced.json),
    ];
    if (validationProblems.length > 0) {
      problems.push(`integration matrix ${id} evidence failed validation: ${validationProblems.join('; ')}`);
    }
  }

  for (const id of ['refresh_token_theft', 'idempotency_replay']) {
    const flow = flows.get(id);
    if (!flow) continue;
    const requirement = matrixProofRequirement(id);
    const proofPath = flow.proof ?? flow.evidence;
    if (!hasValue(proofPath)) {
      problems.push(`integration matrix ${id} must cite a proof file`);
      continue;
    }
    if (proofPath !== requirement.proof) {
      problems.push(`integration matrix ${id} must cite ${requirement.proof}`);
      continue;
    }
    const resolved = resolveRepoRelativePath(proofPath);
    if (!resolved.ok) {
      problems.push(`integration matrix ${id} proof file invalid: ${resolved.message}`);
      continue;
    }
    if (!existsSync(resolved.path)) {
      problems.push(`integration matrix ${id} proof file does not exist: ${proofPath}`);
    }
    if (flow.command !== requirement.command) {
      problems.push(`integration matrix ${id} must cite proof command ${requirement.command}`);
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
  const sensitiveKeys = new Set([
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'password',
    'authorization',
    'sessionid',
    'cookie',
    'setcookie',
    'csrftoken',
    'xcsrftoken',
    'privatetoken',
    'gitlabtoken',
    'slackclientsecret',
    'webhooksecret',
    'signingsecret',
    'shipaccesstoken',
    'sessioncookie',
  ]);
  visitJson(json, (key, value) => {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (sensitiveKeys.has(normalizedKey)) {
      problems.push(`evidence must not include sensitive key ${key}`);
    }
    if (typeof value === 'string' && /^Bearer\s+/i.test(value)) {
      problems.push(`evidence must not include bearer token value at ${key}`);
    }
    if (typeof value === 'string' && /(xox[baprs]-|glpat-|ship_(?:pat|sk|whsec)_)/i.test(value)) {
      problems.push(`evidence must not include token-shaped value at ${key}`);
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

function matrixFlows(json) {
  if (Array.isArray(json.flows)) {
    return new Map(json.flows
      .filter(item => item && typeof item === 'object' && hasValue(item.id))
      .map(item => [item.id, item]));
  }
  return new Map();
}

function readReferencedJsonEvidence(item) {
  const resolved = resolveRepoRelativePath(item);
  if (!resolved.ok) return resolved;
  if (!existsSync(resolved.path)) {
    return { ok: false, message: `path does not exist: ${item}` };
  }
  try {
    return { ok: true, json: JSON.parse(readFileSync(resolved.path, 'utf8')) };
  } catch (error) {
    return { ok: false, message: `invalid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
}

function resolveRepoRelativePath(item) {
  if (!hasValue(item)) return { ok: false, message: 'path is empty' };
  if (path.isAbsolute(item)) return { ok: false, message: `path must be repo-relative: ${item}` };
  const absolutePath = path.resolve(defaultRootDir, item);
  const relative = path.relative(defaultRootDir, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, message: `path escapes repository: ${item}` };
  }
  return { ok: true, path: absolutePath };
}

function matrixProofRequirement(id) {
  if (id === 'refresh_token_theft') {
    return {
      proof: 'api/src/platform/oauth/refresh-theft-drill.test.ts',
      command: './scripts/run-api-tests.sh -- src/platform/oauth/refresh-theft-drill.test.ts',
    };
  }
  return {
    proof: 'api/src/platform/webhooks/service.test.ts',
    command: './scripts/run-api-tests.sh -- src/platform/webhooks/service.test.ts',
  };
}

function findSlackMessage(json, event) {
  return findArrayItem(json.messages ?? json.posts, item =>
    item?.event === event &&
    item?.live === true &&
    hasValue(item.channel) &&
    (isSlackMessageTs(item.message_ts ?? item.messageTs) || isRealExternalHttpsUrl(item.permalink))
  );
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

function isSlackMessageTs(value) {
  return typeof value === 'string' && /^\d{10}\.\d{6}$/.test(value);
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSuccessStatus(value) {
  return Number.isInteger(value) && value >= 200 && value < 300;
}
const liveEvidenceValidators = new Map([
  ['W6-INT-001', validateIntegrationMatrixLiveEvidence],
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
export function validateLiveProofEvidence(entry) {
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
    const absolutePath = path.resolve(defaultRootDir, item);
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
