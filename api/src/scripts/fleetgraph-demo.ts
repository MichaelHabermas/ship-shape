// Idempotent FleetGraph demo setup seeds reviewer-safe attention scenarios.
// Non-local demo seeding requires FLEETGRAPH_DEMO_PASSWORD.
import { pathToFileURL } from 'url';
import { computeCurrentSprintNumber } from '@ship/shared';
import { pool } from '../db/client.js';
import { detectFleetGraphAttentionDecisions, findBlockedImportantIssueQuietExits } from '../fleetgraph/detection/detector.js';
import { runFleetGraph } from '../fleetgraph/core.js';
import { scoreFleetGraphObservabilityResult } from '../fleetgraph/observability-scores.js';
import { postFleetGraphTraceScores, shutdownFleetGraphTracing, withFleetGraphTrace } from '../fleetgraph/observability-trace.js';
import { saveBlockedImportantIssueFinding } from '../fleetgraph/persistence.js';
import type { Principal } from '../security/principal.js';
import { requireFirstRow } from '../utils/query-rows.js';
import {
  assertLocalDemoDatabase,
  associate,
  DEMO_FIXTURE_VERSION,
  demoPassword,
  ensureIssueTicket,
  setDocumentUpdatedAt,
  upsertDocument,
  upsertIssueIteration,
  upsertUser,
  upsertWorkspace,
} from './fleetgraph-demo/demo-db-helpers.js';
import { seedStableAttentionFixtures } from './fleetgraph-demo/demo-fixtures.js';

const BASE_URL = process.env.FLEETGRAPH_DEMO_WEB_URL ?? 'http://localhost:5173';

export type FleetGraphDemoTraceEvidence = Awaited<ReturnType<typeof captureTraceEvidence>>;
export type FleetGraphDemoReport = Awaited<ReturnType<typeof seedFleetGraphDemo>>;

export async function seedFleetGraphDemo(options: {
  captureTraces?: boolean;
} = {}) {
  assertLocalDemoDatabase();
  const workspace = await upsertWorkspace();
  const currentSprintNumber = computeCurrentSprintNumber(new Date(workspace.sprint_start_date));

  const admin = await upsertUser('fleetgraph.reviewer@ship.local', 'FleetGraph Reviewer', workspace.id, 'admin');
  const engineer = await upsertUser('fleetgraph.engineer@ship.local', 'Riley Builder', workspace.id, 'member');
  const pm = await upsertUser('fleetgraph.pm@ship.local', 'Morgan Project Owner', workspace.id, 'member');
  const lead = await upsertUser('fleetgraph.lead@ship.local', 'Dana Program Lead', workspace.id, 'member');
  const dependency = await upsertUser('fleetgraph.dependency@ship.local', 'Casey Dependency Owner', workspace.id, 'member');

  await upsertDocument({
    workspaceId: workspace.id,
    type: 'person',
    title: engineer.name,
    properties: { user_id: engineer.id, role: 'Engineer' },
    createdBy: admin.id,
  });
  const pmPersonId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'person',
    title: pm.name,
    properties: { user_id: pm.id, role: 'PM' },
    createdBy: admin.id,
  });
  const leadPersonId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'person',
    title: lead.name,
    properties: { user_id: lead.id, role: 'Director' },
    createdBy: admin.id,
  });
  const dependencyPersonId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'person',
    title: dependency.name,
    properties: { user_id: dependency.id, role: 'Dependency Owner' },
    createdBy: admin.id,
  });

  const programId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'program',
    title: 'Reviewer Readiness Program',
    properties: { color: '#2563eb', owner_id: leadPersonId, accountable_id: lead.id },
    createdBy: admin.id,
  });
  const projectId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'project',
    title: 'FleetGraph Reviewer Demo Project',
    properties: { color: '#16a34a', impact: 5, confidence: 4, ease: 3, owner_id: pmPersonId, accountable_id: pm.id },
    createdBy: admin.id,
  });
  const activeSprintId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'sprint',
    title: `FleetGraph Demo Week ${currentSprintNumber}`,
    properties: { sprint_number: currentSprintNumber, status: 'active', owner_id: pm.id },
    createdBy: admin.id,
  });
  const inactiveSprintId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'sprint',
    title: `FleetGraph Demo Week ${currentSprintNumber - 1}`,
    properties: { sprint_number: currentSprintNumber - 1, status: 'completed', owner_id: pm.id },
    createdBy: admin.id,
  });
  const dependencyDocId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'wiki',
    title: 'FleetGraph Demo Dependency Notes',
    properties: { owner_id: dependencyPersonId },
    createdBy: admin.id,
  });

  await associate(projectId, programId, 'program');
  await associate(activeSprintId, programId, 'program');
  await associate(inactiveSprintId, programId, 'program');

  const now = new Date();
  const issues = [
    {
      key: 'auth',
      title: 'FG Demo - SSO cert rotation blocked',
      properties: { state: 'blocked', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Blocked on Casey Dependency Owner approving the SSO cert rotation window.',
      whatAttempted: 'FleetGraph demo blocker: SSO cert rotation',
    },
    {
      key: 'data',
      title: 'FG Demo - Data export contract blocked',
      properties: { state: 'blocked', priority: 'high', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Blocked on Morgan Project Owner deciding whether the export includes archived issues.',
      whatAttempted: 'FleetGraph demo blocker: data export contract',
    },
    {
      key: 'at-risk',
      title: 'FG Demo - At-risk rollout checklist',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo at risk: urgent current-week work',
      ageDays: 4,
    },
    {
      key: 'missing-owner',
      title: 'FG Demo - At-risk unowned launch task',
      properties: { state: 'todo', priority: 'high', source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo at risk: missing owner',
      ageDays: 1,
    },
    {
      key: 'stale',
      title: 'FG Demo - Stale integration cleanup',
      properties: { state: 'in_progress', priority: 'medium', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo stale: integration cleanup',
      ageDays: 210,
    },
    {
      key: 'missing',
      title: 'FG Demo - Blocked without blocker explanation',
      properties: { state: 'blocked', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo negative: missing blocker evidence',
    },
    {
      key: 'medium',
      title: 'FG Demo - Medium priority blocked control',
      properties: { state: 'blocked', priority: 'medium', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Blocked even though medium priority; blocked state alone should surface it.',
      whatAttempted: 'FleetGraph demo blocker: medium priority blocker',
    },
    {
      key: 'done',
      title: 'FG Demo - Done blocker history control',
      properties: { state: 'done', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Historical blocker is stale because this issue is done.',
      whatAttempted: 'FleetGraph demo negative: done with blocker history',
    },
    {
      key: 'inactive',
      title: 'FG Demo - Inactive week blocked control',
      properties: { state: 'blocked', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: inactiveSprintId,
      blockerText: 'Blocked in a prior week, outside the active-week detector scope.',
      whatAttempted: 'FleetGraph demo negative: inactive week blocker',
    },
    {
      key: 'duplicate',
      title: 'FG Demo - Duplicate open finding control',
      properties: { state: 'blocked', priority: 'high', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Blocked on a dependency already represented by an open FleetGraph finding.',
      whatAttempted: 'FleetGraph demo negative: duplicate open finding',
    },
    {
      key: 'private',
      title: 'FG Demo - Private blocked source control',
      properties: { state: 'blocked', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Private blocker text should not leak to unauthorized reviewer surfaces.',
      whatAttempted: 'FleetGraph demo negative: private blocked source',
      visibility: 'private' as const,
    },
  ];

  const issueIds = new Map<string, string>();
  for (const issue of issues) {
    const issueId = await upsertDocument({
      workspaceId: workspace.id,
      type: 'issue',
      title: issue.title,
      properties: issue.properties,
      createdBy: issue.key === 'private' ? dependency.id : admin.id,
      visibility: issue.visibility ?? 'workspace',
    });
    await ensureIssueTicket(issueId, workspace.id);
    await associate(issueId, programId, 'program');
    await associate(issueId, projectId, 'project');
    await associate(issueId, issue.sprintId, 'sprint');
    await upsertIssueIteration({
      issueId,
      workspaceId: workspace.id,
      authorId: issue.key === 'private' ? dependency.id : engineer.id,
      whatAttempted: issue.whatAttempted,
      blockerText: issue.blockerText,
      createdAt: new Date(now.getTime() - ((issue.ageDays ?? 0) * 86_400_000) - issueIds.size * 60_000),
    });
    if (issue.ageDays) {
      await setDocumentUpdatedAt(issueId, new Date(now.getTime() - issue.ageDays * 86_400_000));
    }
    issueIds.set(issue.key, issueId);
  }

  const duplicateIssueId = issueIds.get('duplicate');
  if (!duplicateIssueId) throw new Error('Missing duplicate issue');
  const demoIssueIds = Array.from(issueIds.values());
  await pool.query(
    `DELETE FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND source_issue_id = ANY($2::uuid[])
        AND source_issue_id <> $3`,
    [workspace.id, demoIssueIds, duplicateIssueId]
  );
  await saveBlockedImportantIssueFinding({
    workspaceId: workspace.id,
    sourceIssueId: duplicateIssueId,
    sourceSprintId: activeSprintId,
    severity: 'high',
    confidence: 0.85,
    title: 'FG Demo - Duplicate open finding control',
    summary: 'Seeded duplicate control finding for FleetGraph reviewer readiness.',
    runMetadata: {
      signalType: 'blocked',
      reason: 'Seeded duplicate open finding.',
      demo_fixture: true,
      demo_fixture_version: DEMO_FIXTURE_VERSION,
    },
  });
  const stableFixtures = await seedStableAttentionFixtures({
    workspaceId: workspace.id,
    programId,
    projectId,
    sprintId: activeSprintId,
    assignee: engineer,
    adminId: admin.id,
  });

  const decisions = await detectFleetGraphAttentionDecisions({ workspaceId: workspace.id });
  const quietExits = await findBlockedImportantIssueQuietExits({ workspaceId: workspace.id });
  const traceEvidence = options.captureTraces
    ? await captureTraceEvidence({
      workspaceId: workspace.id,
      adminUserId: admin.id,
      positiveIssueId: issueIds.get('auth') ?? '',
    })
    : null;

  return {
    workspaceId: workspace.id,
    currentSprintNumber,
    reviewerLogin: admin.email,
    reviewerPassword: demoPassword(),
    decisionCount: decisions.length,
    stableFixtures,
    decisions: decisions.map((decision) => ({
      decision: decision.decision,
      title: decision.candidate.issue_title,
      issueId: decision.candidate.issue_id,
      sprintId: decision.candidate.sprint_id,
    })),
    quietExits,
    reviewerUrls: {
      activeWeek: `${BASE_URL}/documents/${activeSprintId}`,
      project: `${BASE_URL}/documents/${projectId}`,
      dependencyNotes: `${BASE_URL}/documents/${dependencyDocId}`,
      positiveIssueA: `${BASE_URL}/documents/${issueIds.get('auth')}`,
      positiveIssueB: `${BASE_URL}/documents/${issueIds.get('data')}`,
      missingEvidenceIssue: `${BASE_URL}/documents/${issueIds.get('missing')}`,
      duplicateControlIssue: `${BASE_URL}/documents/${duplicateIssueId}`,
    },
    traceCapturePrompts: [
      'Run gated manual FleetGraph execute for proactive create/update proof.',
      'Use the FleetGraph explain API for legacy on-demand trace continuity proof.',
      'Use the FleetGraph refine API for legacy draft trace continuity proof.',
      'Rerun detector after duplicate finding exists for update/quiet proof.',
    ],
    traceEvidence,
  };
}

export async function captureTraceEvidence(input: {
  workspaceId: string;
  adminUserId: string;
  positiveIssueId: string;
}) {
  const proactivePrincipal: Principal = {
    kind: 'fleetgraph_system',
    workspaceId: input.workspaceId,
    isSuperAdmin: false,
  };
  const onDemandPrincipal: Principal = {
    kind: 'session',
    sessionId: 'fleetgraph-demo-trace-session',
    userId: input.adminUserId,
    workspaceId: input.workspaceId,
    isSuperAdmin: false,
  };

  const decisions = await detectFleetGraphAttentionDecisions({ workspaceId: input.workspaceId, db: pool });
  const positiveDecision = decisions.find((decision) => decision.candidate.issue_id === input.positiveIssueId);
  if (!positiveDecision) throw new Error('Missing positive FleetGraph demo decision for trace capture');
  const staleDecision = decisions.find((decision) => decision.candidate.signalType === 'stale');
  if (!staleDecision) throw new Error('Missing stale FleetGraph demo decision for trace capture');
  const atRiskDecision = decisions.find((decision) => decision.candidate.signalType === 'at_risk');
  if (!atRiskDecision) throw new Error('Missing at-risk FleetGraph demo decision for trace capture');

  const proactive = await withFleetGraphTrace({
    name: 'fleetgraph.proactive_create',
    inputs: {
      mode: 'proactive',
      trigger: 'detector_decision',
      decision: positiveDecision.decision,
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: proactivePrincipal,
    mode: 'proactive',
    trigger: { type: 'detector_decision', detectorDecision: positiveDecision },
    triggerReason: 'demo-proactive-create',
  }, { db: pool, externalTrace, traceRecorder }));

  const stale = await withFleetGraphTrace({
    name: 'fleetgraph.proactive_stale',
    inputs: {
      mode: 'proactive',
      trigger: 'detector_decision',
      signalType: 'stale',
      decision: staleDecision.decision,
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: proactivePrincipal,
    mode: 'proactive',
    trigger: { type: 'detector_decision', detectorDecision: staleDecision },
    triggerReason: 'demo-proactive-stale',
  }, { db: pool, externalTrace, traceRecorder }));

  const atRisk = await withFleetGraphTrace({
    name: 'fleetgraph.proactive_at_risk',
    inputs: {
      mode: 'proactive',
      trigger: 'detector_decision',
      signalType: 'at_risk',
      decision: atRiskDecision.decision,
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: proactivePrincipal,
    mode: 'proactive',
    trigger: { type: 'detector_decision', detectorDecision: atRiskDecision },
    triggerReason: 'demo-proactive-at-risk',
  }, { db: pool, externalTrace, traceRecorder }));

  const findingResult = await pool.query<{ id: string }>(
    `SELECT id
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND source_issue_id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.workspaceId, input.positiveIssueId]
  );
  const findingId = requireFirstRow(findingResult.rows).id;

  const explain = await withFleetGraphTrace({
    name: 'fleetgraph.on_demand_explain',
    inputs: {
      mode: 'on_demand',
      trigger: 'explain_finding',
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: onDemandPrincipal,
    mode: 'on_demand',
    trigger: { type: 'explain_finding', findingId },
    triggerReason: 'demo-why-flagged',
  }, { db: pool, externalTrace, traceRecorder }));

  const refine = await withFleetGraphTrace({
    name: 'fleetgraph.on_demand_refine',
    inputs: {
      mode: 'on_demand',
      trigger: 'refine_draft',
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: onDemandPrincipal,
    mode: 'on_demand',
    trigger: {
      type: 'refine_draft',
      findingId,
      instruction: 'Make the unblock ask concise and mention the approval dependency.',
    },
    triggerReason: 'demo-refine-draft',
  }, { db: pool, externalTrace, traceRecorder }));

  return {
    proactive: await traceEvidenceFor(proactive),
    stale: await traceEvidenceFor(stale),
    atRisk: await traceEvidenceFor(atRisk),
    explain: await traceEvidenceFor(explain),
    refine: await traceEvidenceFor(refine),
  };
}

async function traceEvidenceFor(capture: Awaited<ReturnType<typeof withFleetGraphTrace>>) {
  const observabilityScores = scoreFleetGraphObservabilityResult(capture.result);
  const scorePostFailures = await postFleetGraphTraceScores({
    providers: capture.providers,
    scores: observabilityScores,
  });
  return {
    decision: capture.result.decision,
    findingId: capture.result.finding?.id ?? null,
    traceId: capture.traceId,
    traceUrl: capture.traceUrl,
    sharedTraceUrl: capture.sharedTraceUrl,
    providers: capture.providers,
    providerFailures: capture.providerFailures,
    observabilityScores,
    scorePostFailures,
    tokenMetadata: capture.result.tokenMetadata,
    costMetadata: capture.result.costMetadata,
    traceMetadata: capture.result.traceMetadata,
  };
}

export async function main(): Promise<void> {
  const report = await seedFleetGraphDemo({
    captureTraces: process.argv.includes('--capture-traces'),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await shutdownFleetGraphTracing().catch(() => undefined);
      await pool.end();
    });
}
