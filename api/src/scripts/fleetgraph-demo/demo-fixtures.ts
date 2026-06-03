import { type FleetGraphSignalType } from '@ship/shared';
import { STALE_ISSUE_DAYS } from '../../fleetgraph/detection/attention-policy.js';
import {
  associate,
  ensureIssueTicket,
  isoDate,
  setDocumentUpdatedAt,
  STALE_DEMO_ISSUE_DAYS,
  upsertDocument,
  upsertIssueIteration,
  upsertStableDemoFinding,
  type UserRow,
} from './demo-db-helpers.js';

type StableSignalScenario = {
  signals: FleetGraphSignalType[];
  title: string;
  reasons: string[];
};

export async function seedStableAttentionFixtures(input: {
  workspaceId: string;
  programId: string;
  projectId: string;
  sprintId: string;
  assignee: UserRow;
  adminId: string;
}): Promise<{ issueCount: number; findingCount: number }> {
  const singleSignalGroups: Array<{
    signalType: FleetGraphSignalType;
    state: string;
    prefix: string;
    summaries: Array<[string, string]>;
  }> = [
    {
      signalType: 'blocked',
      state: 'blocked',
      prefix: 'FG-BLOCKED',
      summaries: [
        ['SSO callback contract blocked by identity provider review', 'Waiting on the identity team to confirm the callback payload and signing key rotation window.'],
        ['Payment reconciliation blocked by missing treasury sample file', 'The importer cannot be validated until Finance provides the May close sample.'],
        ['Notification digest blocked on email domain approval', 'SES domain verification is still pending with platform operations.'],
        ['Role migration blocked by production permission export', 'The migration plan needs the current role export before cutover.'],
        ['Mobile upload flow blocked by antivirus vendor response', 'The attachment scanner is rejecting signed iOS uploads.'],
        ['Data retention job blocked by legal hold matrix', 'Legal has not marked which document classes are exempt from retention.'],
        ['Bulk move blocked by week ownership ambiguity', 'The team has not decided whether owner reassignment follows moved issues.'],
        ['Reviewer console blocked by CSP exception approval', 'The evidence viewer needs one approved frame-src exception.'],
        ['Audit export blocked by column classification', 'Security has not classified two export columns for masking.'],
        ['Workspace invite flow blocked by SMTP bounce analysis', 'Agency-domain invites are bouncing pending DMARC analysis.'],
      ],
    },
    {
      signalType: 'stale',
      state: 'in_progress',
      prefix: 'FG-STALE',
      summaries: [
        ['Search relevance tuning has not moved since kickoff', `No implementation update has landed for more than ${STALE_ISSUE_DAYS} days.`],
        ['Project health rollup stalled after initial schema notes', 'The issue has old design notes but no recent code, comment, or status movement.'],
        ['Attachment preview accessibility follow-up is idle', 'The accessibility finding remains open and predates the current review cycle.'],
        ['API pagination cleanup stopped after route inventory', 'The route inventory was captured but endpoints were not converted.'],
        ['Week dashboard empty-state copy is aging out', `The copy decision has been unchanged for more than ${STALE_ISSUE_DAYS} days.`],
        ['Document conversion audit has no recent evidence', 'The checklist has not been updated since the first test pass.'],
        ['Resource allocation export has gone quiet', 'The issue has an owner and estimate but no recent movement.'],
        ['Keyboard navigation polish is still open after review', 'The keyboard review notes are still unresolved.'],
        ['Program breadcrumb cleanup has stale design assumptions', 'The issue references an old navigation model.'],
        ['Bulk selection affordance has no current owner signal', 'The issue remains assigned with no current next action.'],
      ],
    },
    {
      signalType: 'at_risk',
      state: 'todo',
      prefix: 'FG-RISK',
      summaries: [
        ['Security evidence bundle at risk for reviewer deadline', 'The issue is due soon and lacks automated evidence links.'],
        ['Week close reconciliation at risk due to unresolved children', 'Several child issues remain incomplete before close.'],
        ['Invite acceptance flow at risk from cross-browser gap', 'Safari coverage is missing for the collaborator redirect path.'],
        ['Audit log viewer at risk from large workspace load', 'The query is still unpaged for large workspaces.'],
        ['Program status badge at risk from mixed source states', 'The rollup combines stale, blocked, and cancelled issues without clear precedence.'],
        ['Export redaction at risk before compliance demo', 'Masking rules are still represented as notes only.'],
        ['FleetGraph explain action at risk from missing draft path', 'The recommended draft path is not validated end to end.'],
        ['My Week accountability at risk from skipped plan coverage', 'Some assignees have active week work and no plan document.'],
        ['Project retro summary at risk from incomplete impact data', 'Actual impact and next-step data are missing.'],
        ['Realtime document handoff at risk from reconnect edge case', 'Collaboration recovers after refresh but not after network drop.'],
      ],
    },
  ];
  const multiSignalIssues: StableSignalScenario[] = [
    { signals: ['blocked', 'stale'], title: 'Agency SSO redirect has stalled behind certificate approval', reasons: ['Certificate approval is blocking redirect validation.', `The redirect issue has had no meaningful update for ${STALE_DEMO_ISSUE_DAYS} days.`] },
    { signals: ['blocked', 'stale'], title: 'Reviewer evidence import waits on sample archive', reasons: ['The reviewer sample archive has not been delivered.', 'The import plan has not changed since the first spike.'] },
    { signals: ['blocked', 'at_risk'], title: 'Compliance export masking is blocked near demo', reasons: ['Data classification is missing for two export fields.', 'The compliance demo is inside the current delivery window.'] },
    { signals: ['blocked', 'at_risk'], title: 'Workspace invite recovery is blocked before pilot', reasons: ['SMTP alignment remains unresolved for pilot domains.', 'Pilot onboarding depends on this path this week.'] },
    { signals: ['stale', 'at_risk'], title: 'Program health rollup has old precedence assumptions', reasons: ['The rollup logic has not been refreshed after FleetGraph labels shipped.', 'Mixed-status programs may show the wrong executive summary.'] },
    { signals: ['stale', 'at_risk'], title: 'My Week plan gaps are aging into accountability noise', reasons: ['The missing-plan cases have not been revisited since last week.', 'Managers will see noisy action items during planning.'] },
    { signals: ['blocked', 'stale', 'at_risk'], title: 'Security console deploy readiness is blocked and aging', reasons: ['AWS environment approval is still pending.', `The deployment checklist has not moved in ${STALE_DEMO_ISSUE_DAYS} days.`, 'Reviewer access depends on this before the next evidence package.'] },
    { signals: ['blocked', 'stale', 'at_risk'], title: 'External feedback triage migration needs owner decision', reasons: ['Product has not approved the migration mapping.', 'The migration issue has stale acceptance criteria.', 'Untriaged feedback will leak into the pilot dashboard.'] },
  ];
  let issueCount = 0;
  let findingCount = 0;
  const now = new Date();

  for (const group of singleSignalGroups) {
    for (let index = 0; index < group.summaries.length; index++) {
      const summaryEntry = group.summaries[index];
      if (!summaryEntry) {
        throw new Error(`Missing FleetGraph demo summary at index ${index}`);
      }
      const [title, summary] = summaryEntry;
      const issueTitle = `${group.prefix}-${String(index + 1).padStart(2, '0')} ${title}`;
      const issueId = await upsertDocument({
        workspaceId: input.workspaceId,
        type: 'issue',
        title: issueTitle,
        properties: {
          state: group.state,
          priority: group.signalType === 'at_risk' || index % 3 === 0 ? 'urgent' : 'high',
          source: 'internal',
          assignee_id: input.assignee.id,
          estimate: 3 + (index % 6),
          due_date: isoDate(new Date(now.getTime() + (index + 1) * 86_400_000)),
          blocker_text: group.signalType === 'blocked' ? summary : null,
          blocked_reason: group.signalType === 'blocked' ? summary : null,
          attention_seed: group.signalType,
          demo_fixture: true,
        },
        createdBy: input.adminId,
      });
      await ensureIssueTicket(issueId, input.workspaceId);
      await associate(issueId, input.programId, 'program');
      await associate(issueId, input.projectId, 'project');
      await associate(issueId, input.sprintId, 'sprint');
      await upsertIssueIteration({
        issueId,
        workspaceId: input.workspaceId,
        authorId: input.assignee.id,
        whatAttempted: `Stable FleetGraph demo ${group.signalType}: ${title}`,
        blockerText: group.signalType === 'blocked' ? summary : null,
        createdAt: new Date(now.getTime() - (group.signalType === 'stale' ? STALE_DEMO_ISSUE_DAYS : 5 + index) * 86_400_000),
      });
      if (group.signalType === 'stale') {
        await setDocumentUpdatedAt(issueId, new Date(now.getTime() - STALE_DEMO_ISSUE_DAYS * 86_400_000));
      }
      await upsertStableDemoFinding({
        workspaceId: input.workspaceId,
        issueId,
        sprintId: input.sprintId,
        signalType: group.signalType,
        title,
        summary,
        assignee: input.assignee,
      });
      issueCount++;
      findingCount++;
    }
  }

  for (let index = 0; index < multiSignalIssues.length; index++) {
    const scenario = multiSignalIssues[index];
    if (!scenario) {
      throw new Error(`Missing FleetGraph multi-signal scenario at index ${index}`);
    }
    const issueTitle = `FG-MULTI-${String(index + 1).padStart(2, '0')} ${scenario.title}`;
    const issueId = await upsertDocument({
      workspaceId: input.workspaceId,
      type: 'issue',
      title: issueTitle,
      properties: {
        state: scenario.signals.includes('blocked') ? 'blocked' : 'in_progress',
        priority: scenario.signals.includes('at_risk') ? 'urgent' : 'high',
        source: 'internal',
        assignee_id: input.assignee.id,
        estimate: 5 + (index % 8),
        due_date: isoDate(new Date(now.getTime() + ((index % 5) + 1) * 86_400_000)),
        blocker_text: scenario.signals.includes('blocked') ? scenario.reasons[0] : null,
        blocked_reason: scenario.signals.includes('blocked') ? scenario.reasons[0] : null,
        attention_seed: 'multi_signal',
        attention_signals: scenario.signals,
        demo_fixture: true,
      },
      createdBy: input.adminId,
    });
    await ensureIssueTicket(issueId, input.workspaceId);
    await associate(issueId, input.programId, 'program');
    await associate(issueId, input.projectId, 'project');
    await associate(issueId, input.sprintId, 'sprint');
    await upsertIssueIteration({
      issueId,
      workspaceId: input.workspaceId,
      authorId: input.assignee.id,
      whatAttempted: `Stable FleetGraph multi-signal demo: ${scenario.title}`,
      blockerText: scenario.signals.includes('blocked') ? (scenario.reasons[0] ?? null) : null,
      createdAt: new Date(now.getTime() - STALE_DEMO_ISSUE_DAYS * 86_400_000),
    });
    if (scenario.signals.includes('stale')) {
      await setDocumentUpdatedAt(issueId, new Date(now.getTime() - STALE_DEMO_ISSUE_DAYS * 86_400_000));
    }
    for (let signalIndex = 0; signalIndex < scenario.signals.length; signalIndex++) {
      const signalType = scenario.signals[signalIndex];
      if (!signalType) {
        throw new Error(`Missing FleetGraph signal at index ${signalIndex}`);
      }
      await upsertStableDemoFinding({
        workspaceId: input.workspaceId,
        issueId,
        sprintId: input.sprintId,
        signalType,
        title: `${scenario.title} (${signalType})`,
        summary: scenario.reasons[signalIndex] ?? scenario.reasons[0] ?? scenario.title,
        assignee: input.assignee,
        signalIndex,
        multiSignal: true,
      });
      findingCount++;
    }
    issueCount++;
  }

  return { issueCount, findingCount };
}
