// Normalizes PlugForge reviewer evidence into a render-friendly view model.
import { isTunnelUrl } from '../../lib/plugforge-live-drill.mjs';
import { deployedApiBase, deployedWebBase } from './paths.mjs';

const FLOW_LABELS = {
  cli_ttfe: 'CLI + TTFE drill',
  slack: 'Slack reference integration',
  browser: 'Browser SDK demo (PKCE)',
  gitlab: 'GitLab MR ↔ issue links',
  refresh_token_theft: 'Refresh-token theft drill',
  idempotency_replay: 'Idempotency-Key replay drill',
};

export function buildReviewerModel(evidence) {
  const { matrix, slack, gitlab, browser, ttfe, hasSlackScreenshot } = evidence;
  const proofIssueId = gitlab.issue.id;
  const gitlabMrUrl = gitlab.merge_request.url ?? gitlab.external_link?.url;
  const gitlabHost = gitlabMrUrl ? new URL(gitlabMrUrl).host : 'labs.gauntletai.com';

  return {
    generatedAt: matrix.generated_at ?? new Date().toISOString(),
    matrixRunId: matrix.run_id,
    matrixStatus: matrix.status,
    flows: matrix.flows.map((flow) => ({
      id: flow.id,
      label: FLOW_LABELS[flow.id] ?? flow.id,
      status: flow.status,
      proofClass: flow.proof_class ?? 'n/a',
    })),
    ttfe: {
      totalMs: ttfe.result?.totalMs ?? ttfe.durationMs,
      command: ttfe.command ?? 'pnpm drill ttfe',
      withinGate: (ttfe.result?.totalMs ?? ttfe.durationMs) < (ttfe.targets?.maxTotalMs ?? 60000),
    },
    slack: {
      runId: slack.run_id,
      targetUrl: slack.integration_target_url,
      documentDeliveryId: slack.signed_webhooks?.find((row) => row.event === 'document.created')?.delivery_id,
      issueDeliveryId: slack.signed_webhooks?.find((row) => row.event === 'issue.assigned')?.delivery_id,
      messages: (slack.messages ?? []).map((message) => ({
        event: message.event,
        messageTs: message.message_ts,
        permalink: message.permalink,
        textPreview: message.text_preview,
      })),
      hasScreenshot: hasSlackScreenshot,
      screenshotPublicPath: '/plugforge-evidence/slack-proof.png',
    },
    gitlab: {
      runId: gitlab.run_id,
      projectUrl: gitlab.project_url,
      mergeRequestUrl: gitlabMrUrl,
      mergeRequestIid: gitlab.merge_request?.iid ?? gitlab.observed_webhook?.merge_request_iid,
      proofIssueId,
      proofIssueUrl: `${deployedWebBase}/documents/${proofIssueId}`,
      externalLinkId: gitlab.external_link?.external_id,
      host: gitlabHost,
      webhookTargetUrl: gitlab.webhook?.target_url,
    },
    browser: {
      runId: browser.run_id ?? null,
      sdkDemoUrl: browser.sdk_demo_url ?? `${deployedWebBase}/sdk-demo`,
      pkceCompleted: Boolean(browser.pkce?.completed),
    },
    graderCurl: `curl -s -H "Authorization: Bearer $GRADER_TOKEN" ${deployedApiBase}/api/v1/issues/${proofIssueId}`,
    proofIssuePath: `/documents/${proofIssueId}`,
  };
}

export function normalizeHtml(text) {
  return text.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

/** Ensure external anchors open in a new tab; leave in-page hash links unchanged. */
export function openExternalLinksInNewTab(html) {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
    if (/\btarget\s*=/.test(attrs)) return match;
    const hrefMatch = attrs.match(/\bhref\s*=\s*"([^"]*)"/i);
    if (!hrefMatch || hrefMatch[1].startsWith('#')) return match;
    return `<a${attrs} target="_blank" rel="noopener noreferrer">`;
  });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** CSS class for matrix flow status (passed vs measured vs other). */
export function flowStatusClass(status) {
  if (status === 'passed' || status === 'passed_in_proof_pack') return 'status-pass';
  if (status === 'measured') return 'status-measured';
  return 'status-muted';
}

/** True when integration webhook targets still use ephemeral tunnels. */
export function usesEphemeralTunnel(model) {
  const urls = [model.slack?.targetUrl, model.gitlab?.webhookTargetUrl].filter(Boolean);
  return urls.some((url) => isTunnelUrl(String(url)));
}

export function repoRelative(filePath, repoRoot) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}
