#!/usr/bin/env node
// One-shot PlugForge live proof refresh: hosted health → live drills → screenshot gate → render → tunnel check.
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assertHttpReachable,
  defaultGitlabWebhookUrl,
  defaultSlackIntegrationUrl,
  isTunnelUrl,
  parseArgs,
  rootDir,
  runCommand,
} from '../lib/plugforge-live-drill.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const liveEvidenceDir = path.join(rootDir, 'my-docs/evidence/plugforge-integrations/live');
const slackScreenshotPath = path.join(liveEvidenceDir, 'slack-proof.png');
const slackScreenshotMetaPath = path.join(liveEvidenceDir, 'slack-proof.meta.json');

const args = parseArgs();
const allowTunnels = args.has('allow-tunnels');
const skipDrills = args.has('skip-drills');
const skipScreenshot = args.has('skip-screenshot');
const allowSyntheticScreenshot = args.has('allow-synthetic-screenshot');
const screenshotArg = args.get('screenshot');

const slackOrigin = normalizeOrigin(
  process.env.SLACK_INTEGRATION_PUBLIC_URL ?? defaultSlackIntegrationUrl
);
const gitlabWebhookUrl = process.env.GITLAB_WEBHOOK_PUBLIC_URL ?? defaultGitlabWebhookUrl;
const gitlabOrigin = normalizeOrigin(gitlabWebhookUrl);

try {
  console.error('══════════════════════════════════════════════════════════════════');
  console.error('  PlugForge live proof refresh');
  console.error('══════════════════════════════════════════════════════════════════');

  await healthCheckHostedIntegrations();
  await assertCurrentEvidenceNotUsingTunnels();

  if (!skipDrills) {
    await runLiveDrills();
    await runMatrixRefresh();
  }

  if (screenshotArg) {
    await installScreenshot(path.resolve(rootDir, screenshotArg));
  }

  if (!skipScreenshot) {
    await assertSlackScreenshotReady();
  }

  await runCommand('pnpm', ['plugforge:render-reviewer'], { timeoutMs: 120_000 });
  await runCommand('pnpm', ['plugforge:render-reviewer:check', '--require-screenshot'], { timeoutMs: 60_000 });
  await assertFreshEvidenceNotUsingTunnels();

  console.error('');
  console.error('PlugForge live proof refresh complete.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function healthCheckHostedIntegrations() {
  console.error('\n[1/6] Hosted integration health checks');
  await assertHttpReachable(`${slackOrigin}/health`, 'Slack integration health', { timeoutMs: 15_000 });
  await assertHttpReachable(`${gitlabOrigin}/health`, 'GitLab integration health', { timeoutMs: 15_000 });
  console.error('  Slack + GitLab Render services are reachable.');
}

async function runLiveDrills() {
  console.error('\n[2/6] Live provider drills (GitLab hosted → Slack hosted)');
  await runCommand('pnpm', ['plugforge:live:gitlab'], { timeoutMs: 600_000 });
  await runCommand('pnpm', ['plugforge:live:slack'], { timeoutMs: 600_000 });
}

async function runMatrixRefresh() {
  console.error('\n[3/6] Refresh integration matrix evidence');
  await runCommand('pnpm', ['plugforge:live:matrix'], { timeoutMs: 60_000 });
}

async function installScreenshot(sourcePath) {
  console.error(`\n[screenshot] Copying ${sourcePath} → slack-proof.png`);
  await copyFile(sourcePath, slackScreenshotPath);
  await writeScreenshotMeta('live_capture', `Copied from ${sourcePath}`);
}

async function assertSlackScreenshotReady() {
  console.error('\n[4/6] Slack screenshot gate');
  try {
    await readFile(slackScreenshotPath);
  } catch {
    throw new Error(`Missing ${path.relative(rootDir, slackScreenshotPath)}.
Capture a real Slack channel screenshot after the hosted drill, then rerun with:
  pnpm plugforge:refresh-proof --screenshot=/path/to/slack-proof.png`);
  }

  let meta = { source: 'unknown' };
  try {
    meta = JSON.parse(await readFile(slackScreenshotMetaPath, 'utf8'));
  } catch {
    throw new Error(`Missing ${path.relative(rootDir, slackScreenshotMetaPath)}.
Create it with { "source": "live_capture" } after capturing a real screenshot.`);
  }

  if (meta.source === 'synthetic' && !allowSyntheticScreenshot) {
    throw new Error(`slack-proof.meta.json still marks source "synthetic".
Replace slack-proof.png with a real Slack screenshot and set source to "live_capture", or pass --screenshot=…`);
  }
  console.error(`  Screenshot ready (source=${meta.source}).`);
}

async function assertCurrentEvidenceNotUsingTunnels() {
  if (allowTunnels) return;
  const problems = await collectTunnelProblems();
  if (problems.length === 0) return;
  console.error('\nCurrent evidence still references tunnel URLs (continuing refresh to replace them):');
  for (const problem of problems) console.error(`  - ${problem}`);
}

async function assertFreshEvidenceNotUsingTunnels() {
  if (allowTunnels) {
    console.error('\n[5/6] Tunnel check skipped (--allow-tunnels)');
    return;
  }
  console.error('\n[5/6] Tunnel URL gate');
  const problems = await collectTunnelProblems();
  if (problems.length > 0) {
    throw new Error(`Live evidence still references ephemeral tunnel URLs:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  console.error('  No tunnel URLs in slack.json or gitlab.json.');
  console.error('\n[6/6] Reviewer packet rendered and checked');
}

async function collectTunnelProblems() {
  const problems = [];
  const slack = await readJsonIfExists(path.join(liveEvidenceDir, 'slack.json'));
  const gitlab = await readJsonIfExists(path.join(liveEvidenceDir, 'gitlab.json'));
  if (slack?.integration_target_url && isTunnelUrl(slack.integration_target_url)) {
    problems.push(`slack.json integration_target_url=${slack.integration_target_url}`);
  }
  if (gitlab?.webhook?.target_url && isTunnelUrl(gitlab.webhook.target_url)) {
    problems.push(`gitlab.json webhook.target_url=${gitlab.webhook.target_url}`);
  }
  return problems;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeScreenshotMeta(source, note) {
  const payload = {
    source,
    note,
    updated_at: new Date().toISOString(),
  };
  await writeFile(slackScreenshotMetaPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeOrigin(value) {
  return new URL(value.endsWith('/') ? value : `${value}/`).origin;
}
