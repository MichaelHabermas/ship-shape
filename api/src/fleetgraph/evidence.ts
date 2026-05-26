// FleetGraph evidence assembly keeps graph context bounded and actor-filtered.
import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/client.js';
import { authorize } from '../security/capabilities.js';
import type { Principal } from '../security/principal.js';
import type { BlockedImportantIssueCandidate } from './detector.js';
import { getFleetGraphFindingById, type FleetGraphFinding } from './persistence.js';
import type { FleetGraphEvidenceItem, FleetGraphVisibleOutput } from './types.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type FleetGraphEvidenceBundle = {
  sourceIssueVisible: boolean;
  sourceSprintVisible: boolean;
  noSafeOutput: boolean;
  evidence: FleetGraphEvidenceItem[];
};

export function evidenceFromDetectorCandidate(
  candidate: BlockedImportantIssueCandidate
): FleetGraphEvidenceItem[] {
  return [
    {
      kind: 'source_issue',
      sourceDocumentId: candidate.issue_id,
      sourceType: 'issue',
      claim: `Source issue ${candidate.issue_ticket_number ? `#${candidate.issue_ticket_number}` : ''} is urgent/high active-week work.`,
      visibility: 'internal',
      visibleFields: ['title', 'ticket_number', 'priority', 'state'],
    },
    {
      kind: 'source_sprint',
      sourceDocumentId: candidate.sprint_id,
      sourceType: 'sprint',
      claim: `The issue belongs to active sprint ${candidate.sprint_number}.`,
      visibility: 'internal',
      visibleFields: ['title', 'sprint_number'],
    },
    {
      kind: 'blocker',
      sourceDocumentId: candidate.issue_id,
      sourceType: 'issue',
      claim: 'The latest issue iteration has non-empty blocker text.',
      excerpt: candidate.blocker_text,
      visibility: 'internal',
      visibleFields: ['blockers_encountered'],
    },
    {
      kind: 'dedupe',
      claim: 'FleetGraph used the locked blocked-work dedupe key.',
      excerpt: candidate.dedupeKey,
      visibility: 'internal',
      visibleFields: ['dedupe_key'],
    },
  ];
}

export async function filterEvidenceForActor(input: {
  principal?: Principal;
  workspaceId: string;
  sourceIssueId: string;
  sourceSprintId: string;
  evidence: FleetGraphEvidenceItem[];
  db?: QueryRunner;
}): Promise<FleetGraphEvidenceBundle> {
  if (!input.principal) {
    return {
      sourceIssueVisible: false,
      sourceSprintVisible: false,
      noSafeOutput: false,
      evidence: input.evidence,
    };
  }

  const db = input.db ?? pool;
  const issueDecision = await authorize(db, input.principal, {
    resource: 'document',
    action: 'read',
    documentId: input.sourceIssueId,
    expectedType: 'issue',
  });
  const sprintDecision = await authorize(db, input.principal, {
    resource: 'document',
    action: 'read',
    documentId: input.sourceSprintId,
    expectedType: 'sprint',
  });
  const sourceIssueVisible = issueDecision.allowed;
  const sourceSprintVisible = sprintDecision.allowed;

  if (!sourceIssueVisible) {
    return {
      sourceIssueVisible,
      sourceSprintVisible,
      noSafeOutput: true,
      evidence: [{
        kind: 'restricted',
        claim: 'FleetGraph cannot safely explain this finding because the source issue is not visible to the current user.',
        visibility: 'restricted',
        visibleFields: [],
        redactionReason: issueDecision.reason,
      }],
    };
  }

  return {
    sourceIssueVisible,
    sourceSprintVisible,
    noSafeOutput: false,
    evidence: input.evidence.map((item) => {
      if (item.sourceType === 'sprint' && !sourceSprintVisible) {
        return {
          kind: 'restricted',
          claim: 'Some sprint context is restricted for the current user.',
          visibility: 'restricted',
          visibleFields: [],
          redactionReason: sprintDecision.reason,
        } satisfies FleetGraphEvidenceItem;
      }

      return { ...item, visibility: 'actor_visible' };
    }),
  };
}

export async function getFindingForGraph(input: {
  workspaceId: string;
  findingId: string;
  db?: QueryRunner;
}): Promise<FleetGraphFinding | null> {
  return getFleetGraphFindingById({
    workspaceId: input.workspaceId,
    findingId: input.findingId,
  }, input.db ?? pool);
}

export async function visibleOutputForFinding(input: {
  principal?: Principal;
  workspaceId: string;
  finding: FleetGraphFinding;
  db?: QueryRunner;
}): Promise<{ evidence: FleetGraphEvidenceItem[]; output: FleetGraphVisibleOutput }> {
  const storedEvidence = Array.isArray(input.finding.evidence_snapshot)
    ? input.finding.evidence_snapshot as FleetGraphEvidenceItem[]
    : [];
  const evidenceBundle = await filterEvidenceForActor({
    principal: input.principal,
    workspaceId: input.workspaceId,
    sourceIssueId: input.finding.source_issue_id,
    sourceSprintId: input.finding.source_sprint_id,
    evidence: storedEvidence,
    db: input.db,
  });

  if (evidenceBundle.noSafeOutput) {
    return {
      evidence: evidenceBundle.evidence,
      output: {
        title: 'Restricted FleetGraph finding',
        summary: 'FleetGraph cannot safely explain this finding for the current user.',
        evidence: evidenceBundle.evidence,
        humanGate: { required: true, reason: 'source_issue_not_visible' },
        noSafeOutput: true,
      },
    };
  }

  return {
    evidence: evidenceBundle.evidence,
    output: {
      title: input.finding.title,
      summary: input.finding.summary,
      evidence: evidenceBundle.evidence,
      humanGate: input.finding.human_gate,
      draftContent: input.finding.draft_content,
    },
  };
}
