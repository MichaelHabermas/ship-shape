// Generates FleetGraph product-surface eval reports for human review and trend tracking.
import { mkdir, writeFile, copyFile, access } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { pool } from '../db/client.js';
import {
  FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS,
  fleetGraphProductSurfaceCases,
  scoreFleetGraphProductSurfaceCase,
  summarizeFleetGraphProductSurfaceResults,
  type FleetGraphProductSurfaceCase,
  type FleetGraphProductSurfaceResult,
} from '../fleetgraph/eval/product-surface.js';
import { runFleetGraph, type FleetGraphPersistencePort } from '../fleetgraph/core.js';
import { blockedImportantIssueDedupeKey, type FleetGraphFinding, type FleetGraphRun, type RecordFleetGraphRunInput } from '../fleetgraph/persistence.js';
import type { BlockedImportantIssueCandidate } from '../fleetgraph/detector.js';
import type { FleetGraphVisibleOutput } from '../fleetgraph/types.js';

type SurfaceEvalReport = {
  generatedAt: string;
  summary: ReturnType<typeof summarizeFleetGraphProductSurfaceResults>;
  results: Array<FleetGraphProductSurfaceResult & {
    title: string;
    visibleCopy: string[];
    notes: readonly string[];
  }>;
};

const repoRoot = path.resolve(process.cwd(), '..');
const outputRoot = path.join(repoRoot, 'my-docs/evals/fleetgraph-product-surface');
const runsRoot = path.join(outputRoot, 'runs');
const reviewNotesPath = path.join(outputRoot, 'review-notes.md');
const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function reportForNow(now = new Date()): Promise<SurfaceEvalReport> {
  const cases = [
    ...fleetGraphProductSurfaceCases,
    ...await runtimeSurfaceCases(),
    ...await persistedSurfaceCases(),
  ];
  const scoredResults = cases.map((testCase) => ({
    ...scoreFleetGraphProductSurfaceCase(testCase),
    title: testCase.title,
    visibleCopy: [...testCase.input.visibleCopy],
    notes: testCase.notes,
  }));

  return {
    generatedAt: now.toISOString(),
    summary: summarizeFleetGraphProductSurfaceResults(scoredResults),
    results: scoredResults,
  };
}

function markdownReport(report: SurfaceEvalReport): string {
  const lines = [
    '# FleetGraph Product Surface Eval',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Pass: ${report.summary.passCount}`,
    `- Fail: ${report.summary.failCount}`,
    '',
    '| Dimension | Average |',
    '| --- | ---: |',
    ...FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS.map((dimension) =>
      `| ${dimension} | ${report.summary.average[dimension].toFixed(2)} |`
    ),
    '',
    '## Cases',
    '',
  ];

  for (const result of report.results) {
    lines.push(
      `### ${result.caseId}`,
      '',
      result.title,
      '',
      'Visible copy:',
      '',
      '> ' + result.visibleCopy.join(' · '),
      '',
      `Status: ${result.pass ? 'pass' : `fail (${result.failedDimensions.join(', ')})`}`,
      '',
      '| Dimension | Score |',
      '| --- | ---: |',
      ...FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS.map((dimension) =>
        `| ${dimension} | ${result.scores[dimension]} |`
      ),
      '',
      'Notes:',
      ...result.notes.map((note) => `- ${note}`),
      '',
      'Human review:',
      '- TBD',
      '',
    );
  }

  return lines.join('\n');
}

function htmlReport(report: SurfaceEvalReport): string {
  const reportJson = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FleetGraph Product Surface Eval</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f0f; color: #f4f4f5; }
    body { margin: 0; padding: 24px; background: #0f0f0f; }
    main { max-width: 1120px; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    .muted { color: #a1a1aa; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 18px; }
    .tab { border: 1px solid #343434; background: #171717; color: #d4d4d8; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
    .tab[aria-selected="true"] { border-color: #0ea5e9; color: white; background: #0b2b3d; }
    .panel { display: none; }
    .panel.active { display: block; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .card { border: 1px solid #292929; background: #151515; border-radius: 8px; padding: 14px; }
    .copy { margin: 10px 0; color: #f4f4f5; line-height: 1.45; }
    .score { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid #262626; padding: 7px 0; font-size: 13px; }
    .bar { height: 6px; width: 86px; border-radius: 999px; background: #262626; overflow: hidden; }
    .fill { height: 100%; background: #10b981; }
    .fail .fill { background: #ef4444; }
    table { width: 100%; border-collapse: collapse; background: #151515; border: 1px solid #292929; border-radius: 8px; overflow: hidden; }
    th, td { border-bottom: 1px solid #292929; padding: 9px 10px; text-align: left; font-size: 13px; vertical-align: top; }
    th { color: #d4d4d8; background: #1c1c1c; }
    tr:last-child td { border-bottom: 0; }
    .pill { display: inline-flex; border: 1px solid #343434; border-radius: 999px; padding: 2px 7px; font-size: 12px; color: #d4d4d8; }
    .pass { border-color: #047857; color: #6ee7b7; }
    .failText { border-color: #991b1b; color: #fca5a5; }
    .note { color: #a1a1aa; font-size: 13px; line-height: 1.45; }
  </style>
</head>
<body>
<main>
  <h1>FleetGraph Product Surface Eval</h1>
  <div class="muted">Generated ${escapeHtml(report.generatedAt)} · ${report.summary.passCount} pass · ${report.summary.failCount} fail</div>
  <nav class="tabs" aria-label="Review views">
    <button class="tab" data-tab="cards" aria-selected="true">Cards</button>
    <button class="tab" data-tab="matrix" aria-selected="false">Score Matrix</button>
    <button class="tab" data-tab="failures" aria-selected="false">Failures</button>
    <button class="tab" data-tab="notes" aria-selected="false">Review Notes</button>
  </nav>
  <section id="cards" class="panel active"></section>
  <section id="matrix" class="panel"></section>
  <section id="failures" class="panel"></section>
  <section id="notes" class="panel"></section>
</main>
<script>
const report = ${reportJson};
const dimensions = ${JSON.stringify(FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS)};
function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function scoreRow(result, dimension) {
  const score = result.scores[dimension];
  const failing = result.failedDimensions.includes(dimension);
  return '<div class="score ' + (failing ? 'fail' : '') + '"><span>' + esc(dimension) + '</span><span class="bar"><span class="fill" style="width:' + (score * 25) + '%"></span></span><strong>' + score + '</strong></div>';
}
document.querySelector('#cards').innerHTML = '<div class="grid">' + report.results.map((result) => (
  '<article class="card"><div><span class="pill ' + (result.pass ? 'pass' : 'failText') + '">' + (result.pass ? 'pass' : 'fail') + '</span></div>' +
  '<h2>' + esc(result.caseId) + '</h2><p class="muted">' + esc(result.title) + '</p>' +
  '<p class="copy">' + esc(result.visibleCopy.join(' · ')) + '</p>' +
  dimensions.map((dimension) => scoreRow(result, dimension)).join('') +
  '<p class="note">' + result.notes.map(esc).join('<br>') + '</p></article>'
)).join('') + '</div>';
document.querySelector('#matrix').innerHTML = '<table><thead><tr><th>Case</th>' + dimensions.map((dimension) => '<th>' + esc(dimension) + '</th>').join('') + '</tr></thead><tbody>' +
  report.results.map((result) => '<tr><td>' + esc(result.caseId) + '</td>' + dimensions.map((dimension) => '<td>' + result.scores[dimension] + '</td>').join('') + '</tr>').join('') +
  '<tr><td><strong>Average</strong></td>' + dimensions.map((dimension) => '<td><strong>' + report.summary.average[dimension].toFixed(2) + '</strong></td>').join('') + '</tr></tbody></table>';
const failures = report.results.filter((result) => !result.pass);
document.querySelector('#failures').innerHTML = failures.length === 0
  ? '<div class="card"><h2>No failing cases</h2><p class="muted">All current product-surface cases met their thresholds.</p></div>'
  : '<div class="grid">' + failures.map((result) => '<article class="card"><h2>' + esc(result.caseId) + '</h2><p class="copy">' + esc(result.visibleCopy.join(' · ')) + '</p><p class="muted">Failed: ' + esc(result.failedDimensions.join(', ')) + '</p></article>').join('') + '</div>';
document.querySelector('#notes').innerHTML = '<div class="card"><h2>Human review</h2><p class="note">Use <code>review-notes.md</code> beside this report to record judgment calls: accepted exceptions, copy that should be tighter, or places where the score is wrong and the rubric needs to evolve.</p></div>';
document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tab));
}));
</script>
</body>
</html>`;
}

async function ensureReviewNotes(): Promise<void> {
  try {
    await access(reviewNotesPath);
  } catch {
    await writeFile(reviewNotesPath, [
      '# FleetGraph Product Surface Review Notes',
      '',
      'Use this file for human judgment calls that the scores cannot know.',
      '',
      '## Template',
      '',
      '### <case id>',
      '',
      '- Decision: accept / tighten / change rubric',
      '- Reason:',
      '- Follow-up:',
      '',
    ].join('\n'), 'utf8');
  }
}

async function runtimeSurfaceCases(): Promise<FleetGraphProductSurfaceCase[]> {
  const clearBlocker = candidate({
    issueTitle: 'Runtime issue clear blocker',
    blockerText: 'Waiting on API credentials.',
    assigneeId: userId,
  });
  const missingBlocker = candidate({
    issueTitle: 'Runtime issue needs reason',
    blockerText: '',
    assigneeId: userId,
  });
  const existingFinding = finding({
    title: 'Runtime existing finding',
    summary: 'Waiting on review · Week 11',
    recommended_action: {
      label: 'Ask Audit Load User 029 to confirm owner and next step for Week 11.',
      text: 'Ask Audit Load User 029 to confirm owner and next step for Week 11.',
    },
    evidence_snapshot: [{
      kind: 'source_issue',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Issue #110',
      visibility: 'internal',
      visibleFields: ['title', 'state'],
    }, {
      kind: 'source_sprint',
      sourceDocumentId: sprintId,
      sourceType: 'sprint',
      claim: 'Week 11',
      visibility: 'internal',
      visibleFields: ['title', 'sprint_number'],
    }, {
      kind: 'blocker',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Latest blocker text',
      excerpt: 'Waiting on review.',
      visibility: 'internal',
      visibleFields: ['blockers_encountered'],
    }],
  });

  const clearResult = await runFleetGraph({
    workspaceId,
    mode: 'proactive',
    trigger: {
      type: 'detector_decision',
      detectorDecision: { decision: 'create_finding', candidate: clearBlocker, existingFindingId: null },
    },
  }, { persistence: persistencePort(findingFromCandidate(clearBlocker)) });
  const missingResult = await runFleetGraph({
    workspaceId,
    mode: 'proactive',
    trigger: {
      type: 'detector_decision',
      detectorDecision: { decision: 'create_finding', candidate: missingBlocker, existingFindingId: null },
    },
  }, { persistence: persistencePort(findingFromCandidate(missingBlocker)) });
  const explainResult = await runFleetGraph({
    workspaceId,
    mode: 'on_demand',
    trigger: { type: 'explain_finding', findingId },
  }, { persistence: persistencePort(existingFinding) });

  return [
    caseFromVisibleOutput('fg-surface-runtime-proactive-clear-blocker', 'Runtime proactive clear-blocker output from runFleetGraph', clearResult.visibleOutput),
    caseFromVisibleOutput('fg-surface-runtime-proactive-missing-blocker', 'Runtime proactive missing-blocker output from runFleetGraph', missingResult.visibleOutput),
    caseFromVisibleOutput('fg-surface-runtime-explain-existing-finding', 'Runtime explain output from runFleetGraph', explainResult.visibleOutput),
  ].filter((testCase): testCase is FleetGraphProductSurfaceCase => Boolean(testCase));
}

async function persistedSurfaceCases(): Promise<FleetGraphProductSurfaceCase[]> {
  try {
    const result = await pool.query<{
      id: string;
      mode: string;
      decision: string;
      output_snapshot: unknown;
      created_at: Date;
    }>(
      `SELECT id, mode, decision, output_snapshot, created_at
         FROM fleetgraph_runs
        WHERE output_snapshot ? 'title'
          AND output_snapshot ? 'summary'
          AND (
            mode = 'on_demand'
            OR decision IN ('create_finding', 'update_finding')
          )
        ORDER BY created_at DESC
        LIMIT 20`
    );

    return result.rows.flatMap((row) => {
      const output = visibleOutputFromUnknown(row.output_snapshot);
      if (!output) return [];
      const testCase = caseFromVisibleOutput(
        `fg-surface-persisted-${row.decision}-${row.id.slice(0, 8)}`,
        `Persisted ${row.mode}/${row.decision} output from ${row.created_at.toISOString()}`,
        output
      );
      if (!testCase) return [];
      return [{
        ...testCase,
        notes: [
          'Loaded from fleetgraph_runs.output_snapshot.',
          'This is the report path that tracks real persisted FleetGraph outputs over time.',
        ],
      }];
    });
  } catch (error) {
    console.warn(`Skipping persisted FleetGraph outputs: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function visibleOutputFromUnknown(value: unknown): FleetGraphVisibleOutput | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== 'string' || typeof value.summary !== 'string') return null;
  return {
    title: value.title,
    summary: value.summary,
    recommendedAction: isRecord(value.recommendedAction) ? value.recommendedAction : undefined,
    proposedRecipient: isRecord(value.proposedRecipient) ? value.proposedRecipient : undefined,
    uncertaintyNotes: Array.isArray(value.uncertaintyNotes)
      ? value.uncertaintyNotes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
      : undefined,
    evidence: Array.isArray(value.evidence)
      ? value.evidence.filter((item): item is FleetGraphVisibleOutput['evidence'][number] => isRecord(item) && typeof item.kind === 'string' && typeof item.claim === 'string')
      : [],
    humanGate: isRecord(value.humanGate) ? value.humanGate : {},
    noSafeOutput: value.noSafeOutput === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function caseFromVisibleOutput(
  id: string,
  title: string,
  output: FleetGraphVisibleOutput | undefined
): FleetGraphProductSurfaceCase | null {
  if (!output) return null;
  const recommendedAction = visibleAction(output);
  const blockerText = output.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt;
  return {
    id,
    title,
    input: {
      cardTitle: output.title,
      cardSummary: output.summary,
      blockerText: blockerText ?? '',
      owner: visibleOwner(output),
      context: output.evidence.find((item) => item.kind === 'source_sprint')?.claim ?? null,
      nextAction: recommendedAction,
      visibleCopy: [
        output.title,
        output.summary,
        ...(recommendedAction ? [recommendedAction] : []),
        ...(output.uncertaintyNotes ?? []),
      ],
    },
    expectedMinimum: {
      actionability: 3,
      groundedness: 3,
      specificity: 3,
      brevity: 3,
      repetitionBudget: 3,
      informationDensity: 3,
      cavemanCopy: 3,
      duplicateFactControl: 3,
      uncertaintyHonesty: 3,
      missingDataUsefulness: 3,
      uiProofSeparation: 4,
    },
    notes: [
      'Generated through runFleetGraph, not a hand-authored product-surface example.',
      'Failures here identify current runtime copy that needs product wording work.',
    ],
  };
}

function visibleAction(output: FleetGraphVisibleOutput): string | undefined {
  const action = output.recommendedAction;
  if (!action) return undefined;
  for (const key of ['text', 'summary', 'label']) {
    const value = action[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function visibleOwner(output: FleetGraphVisibleOutput): string | null {
  const recipient = output.proposedRecipient;
  const displayName = recipient?.displayName;
  const role = recipient?.role;
  if (typeof displayName === 'string' && displayName.trim()) return displayName;
  return typeof role === 'string' && role.trim() ? role : null;
}

function candidate(input: { issueTitle: string; blockerText: string; assigneeId: string | null }): BlockedImportantIssueCandidate {
  return {
    workspace_id: workspaceId,
    issue_id: issueId,
    issue_title: input.issueTitle,
    issue_ticket_number: 110,
    issue_state: 'blocked',
    issue_priority: 'medium',
    issue_assignee_id: input.assigneeId,
    issue_assignee_name: input.assigneeId ? 'Audit Load User 029' : null,
    sprint_id: sprintId,
    sprint_title: 'Week 11',
    sprint_number: 11,
    sprint_owner_id: null,
    sprint_owner_name: null,
    project_id: null,
    project_title: null,
    project_owner_id: null,
    project_owner_name: null,
    program_id: null,
    program_title: null,
    program_owner_id: null,
    program_owner_name: null,
    blocker_text: input.blockerText,
    blocker_iteration_id: input.blockerText ? '66666666-6666-4666-8666-666666666666' : null,
    blocker_iteration_created_at: input.blockerText ? new Date('2026-05-28T00:00:00Z') : null,
    dedupeKey,
  };
}

function findingFromCandidate(input: BlockedImportantIssueCandidate): FleetGraphFinding {
  return finding({
    title: input.issue_title,
    summary: input.blocker_text
      ? `${input.blocker_text.replace(/\.$/, '')} · Week ${input.sprint_number ?? input.sprint_title}`
      : `Reason missing · Week ${input.sprint_number ?? input.sprint_title}`,
    recommended_action: {
      label: input.blocker_text
        ? `Ask Audit Load User 029 to confirm owner and next step for Week ${input.sprint_number ?? input.sprint_title}.`
        : 'Ask Audit Load User 029 to add the blocker reason.',
      text: input.blocker_text
        ? `Ask Audit Load User 029 to confirm owner and next step for Week ${input.sprint_number ?? input.sprint_title}.`
        : 'Ask Audit Load User 029 to add the blocker reason.',
    },
    evidence_snapshot: [{
      kind: 'source_issue',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Issue #110',
      visibility: 'internal',
      visibleFields: ['title', 'state'],
    }, {
      kind: 'source_sprint',
      sourceDocumentId: sprintId,
      sourceType: 'sprint',
      claim: 'Week 11',
      visibility: 'internal',
      visibleFields: ['title', 'sprint_number'],
    }, {
      kind: 'blocker',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: input.blocker_text ? 'Latest blocker text' : 'Blocker missing',
      excerpt: input.blocker_text || undefined,
      visibility: 'internal',
      visibleFields: ['blockers_encountered'],
    }],
  });
}

function finding(overrides: Partial<FleetGraphFinding> = {}): FleetGraphFinding {
  return {
    id: findingId,
    workspace_id: workspaceId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    dedupe_key: dedupeKey,
    status: 'needs_confirmation',
    severity: 'medium',
    confidence: 0.84,
    title: 'Runtime finding',
    summary: 'Runtime finding is blocked.',
    evidence_snapshot: [],
    recommended_action: { label: 'Confirm the unblock path' },
    draft_content: {},
    proposed_recipient: { role: 'issue_assignee', userId, displayName: 'Audit Load User 029' },
    human_gate: { required: true },
    trace_metadata: {},
    run_metadata: {},
    first_detected_at: new Date(),
    last_detected_at: new Date(),
    resolved_at: null,
    dismissed_at: null,
    dismissed_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function run(decision: FleetGraphRun['decision']): FleetGraphRun {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    workspace_id: workspaceId,
    finding_id: findingId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    mode: 'proactive',
    trigger_reason: 'surface-eval',
    decision,
    dedupe_key: dedupeKey,
    input_snapshot: {},
    evidence_snapshot: [],
    output_snapshot: {},
    trace_metadata: {},
    token_metadata: {},
    cost_metadata: {},
    error_metadata: {},
    started_at: new Date(),
    completed_at: new Date(),
    created_at: new Date(),
  };
}

function persistencePort(existingFinding: FleetGraphFinding): FleetGraphPersistencePort {
  return {
    saveFinding: async () => existingFinding,
    recordRun: async (input: RecordFleetGraphRunInput) => run(input.decision),
    getFinding: async () => existingFinding,
    listAnchorRuns: async () => [],
    refineDraft: async () => existingFinding,
    dismissFinding: async () => ({ ...existingFinding, status: 'dismissed' }),
    resolveFinding: async () => ({ ...existingFinding, status: 'resolved' }),
    suppressFinding: async () => ({ ...existingFinding, status: 'suppressed' }),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char));
}

export async function main(): Promise<void> {
  const now = new Date();
  const report = await reportForNow(now);
  const runDir = path.join(runsRoot, timestampForPath(now));

  await mkdir(runDir, { recursive: true });
  await ensureReviewNotes();

  const json = JSON.stringify(report, null, 2) + '\n';
  const markdown = markdownReport(report);
  const html = htmlReport(report);

  const runJsonPath = path.join(runDir, 'results.json');
  const runMarkdownPath = path.join(runDir, 'report.md');
  const runHtmlPath = path.join(runDir, 'review-board.html');

  await writeFile(runJsonPath, json, 'utf8');
  await writeFile(runMarkdownPath, markdown, 'utf8');
  await writeFile(runHtmlPath, html, 'utf8');
  await copyFile(runJsonPath, path.join(outputRoot, 'latest.json'));
  await copyFile(runMarkdownPath, path.join(outputRoot, 'latest.md'));
  await copyFile(runHtmlPath, path.join(outputRoot, 'latest.html'));

  console.log(`FleetGraph product-surface eval: ${report.summary.passCount} pass, ${report.summary.failCount} fail`);
  console.log(`Markdown: ${path.relative(repoRoot, path.join(outputRoot, 'latest.md'))}`);
  console.log(`JSON: ${path.relative(repoRoot, path.join(outputRoot, 'latest.json'))}`);
  console.log(`Review board: ${path.relative(repoRoot, path.join(outputRoot, 'latest.html'))}`);
  console.log(`Run: ${path.relative(repoRoot, runDir)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
