// Loads and validates PlugForge live integration evidence JSON for reviewer rendering.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  evidenceRoot,
  integrationEvidenceDir,
  metricsEvidenceDir,
  slackScreenshotSource,
} from './paths.mjs';

const MATRIX_FLOW_IDS = [
  'cli_ttfe',
  'slack',
  'browser',
  'gitlab',
  'refresh_token_theft',
  'idempotency_replay',
];

export async function loadReviewerEvidence(options = {}) {
  const requireScreenshot = options.requireScreenshot ?? false;
  const matrix = await readJson(path.join(integrationEvidenceDir, 'matrix.json'));
  const slack = await readJson(path.join(integrationEvidenceDir, 'slack.json'));
  const gitlab = await readJson(path.join(integrationEvidenceDir, 'gitlab.json'));
  const browser = await readJson(path.join(integrationEvidenceDir, 'browser-sdk.json'));
  const ttfe = await readJson(path.join(metricsEvidenceDir, 'ttfe-timing.json'));

  const problems = [];
  validateMatrix(matrix, problems);
  validateSlack(slack, problems);
  validateGitlab(gitlab, problems);
  validateBrowser(browser, problems);
  validateTtfe(ttfe, problems);

  if (requireScreenshot && slack.status === 'passed' && !existsSync(slackScreenshotSource)) {
    problems.push(`missing Slack screenshot at ${path.relative(evidenceRoot, slackScreenshotSource)}`);
  }

  if (problems.length > 0) {
    throw new Error(`Reviewer evidence invalid:\n- ${problems.join('\n- ')}`);
  }

  return { matrix, slack, gitlab, browser, ttfe, hasSlackScreenshot: existsSync(slackScreenshotSource) };
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function validateMatrix(matrix, problems) {
  if (matrix.flow !== 'matrix') problems.push('matrix.json flow must be "matrix"');
  if (matrix.status !== 'passed') problems.push('matrix.json status must be "passed"');
  if (!Array.isArray(matrix.flows)) {
    problems.push('matrix.json flows must be an array');
    return;
  }
  const ids = new Set(matrix.flows.map((flow) => flow.id));
  for (const id of MATRIX_FLOW_IDS) {
    if (!ids.has(id)) problems.push(`matrix.json missing flow id ${id}`);
  }
}

function validateSlack(slack, problems) {
  if (slack.flow !== 'slack') problems.push('slack.json flow must be "slack"');
  if (slack.status !== 'passed') problems.push('slack.json status must be "passed"');
  if (!slack.run_id) problems.push('slack.json missing run_id');
  if (!Array.isArray(slack.messages) || slack.messages.length < 2) {
    problems.push('slack.json requires two live messages');
  }
}

function validateGitlab(gitlab, problems) {
  if (gitlab.flow !== 'gitlab') problems.push('gitlab.json flow must be "gitlab"');
  if (gitlab.status !== 'passed') problems.push('gitlab.json status must be "passed"');
  if (!gitlab.issue?.id) problems.push('gitlab.json missing issue.id');
  if (!gitlab.merge_request?.url) problems.push('gitlab.json missing merge_request.url');
}

function validateBrowser(browser, problems) {
  if (browser.flow !== 'browser') problems.push('browser-sdk.json flow must be "browser"');
  if (browser.status !== 'passed') problems.push('browser-sdk.json status must be "passed"');
  if (!browser.pkce?.completed) problems.push('browser-sdk.json pkce.completed must be true');
}

function validateTtfe(ttfe, problems) {
  if (ttfe.metric !== 'ttfe-timing') problems.push('ttfe-timing.json metric must be "ttfe-timing"');
  if (!ttfe.result?.totalMs) problems.push('ttfe-timing.json missing result.totalMs');
}
