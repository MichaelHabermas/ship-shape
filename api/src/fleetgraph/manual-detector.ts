// FleetGraph manual detector runner summarizes read-only detector decisions for local validation.
import {
  detectBlockedImportantIssueDecisions,
  findBlockedImportantIssueQuietExits,
  type BlockedImportantIssueCandidate,
  type BlockedImportantIssueDedupeDecision,
  type FleetGraphDetectorQuietExit,
} from './detector.js';
import { utcToday } from '@ship/shared';

export type ManualFleetGraphDetectorSummary = {
  workspaceId: string;
  today: string | null;
  candidateCount: number;
  candidates: Array<{
    issueId: string;
    issueTitle: string;
    issuePriority: string;
    sprintId: string;
    sprintTitle: string;
    blockerText: string;
    dedupeKey: string;
  }>;
  dedupeDecisions: Array<{
    decision: BlockedImportantIssueDedupeDecision['decision'];
    issueId: string;
    sprintId: string;
    dedupeKey: string;
    existingFindingId: string | null;
  }>;
  quietExits: FleetGraphDetectorQuietExit[];
  modelCalls: 0;
  mutatesShip: false;
  mutatesFleetGraph: false;
};

function mapCandidate(candidate: BlockedImportantIssueCandidate): ManualFleetGraphDetectorSummary['candidates'][number] {
  return {
    issueId: candidate.issue_id,
    issueTitle: candidate.issue_title,
    issuePriority: candidate.issue_priority,
    sprintId: candidate.sprint_id,
    sprintTitle: candidate.sprint_title,
    blockerText: candidate.blocker_text,
    dedupeKey: candidate.dedupeKey,
  };
}

function mapDedupeDecision(
  decision: BlockedImportantIssueDedupeDecision
): ManualFleetGraphDetectorSummary['dedupeDecisions'][number] {
  return {
    decision: decision.decision,
    issueId: decision.candidate.issue_id,
    sprintId: decision.candidate.sprint_id,
    dedupeKey: decision.candidate.dedupeKey,
    existingFindingId: decision.existingFindingId,
  };
}

export async function runManualFleetGraphDetector(input: {
  workspaceId: string;
  today?: Date;
  limit?: number;
}): Promise<ManualFleetGraphDetectorSummary> {
  const today = input.today ?? utcToday();
  const decisionBatch = await detectBlockedImportantIssueDecisions({
    ...input,
    today,
  });
  const quietExits = await findBlockedImportantIssueQuietExits({
    workspaceId: input.workspaceId,
    today,
  });

  return {
    workspaceId: input.workspaceId,
    today: today.toISOString(),
    candidateCount: decisionBatch.decisions.length,
    candidates: decisionBatch.decisions.map((decision) => mapCandidate(decision.candidate)),
    dedupeDecisions: decisionBatch.decisions.map(mapDedupeDecision),
    quietExits,
    modelCalls: 0,
    mutatesShip: false,
    mutatesFleetGraph: false,
  };
}
