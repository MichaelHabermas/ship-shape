// FleetGraph manual detector runner summarizes read-only detector decisions for local validation.
import {
  detectBlockedImportantIssueDecisions,
  findBlockedImportantIssueQuietExits,
  type BlockedImportantIssueDedupeDecision,
  type FleetGraphDetectorQuietExit,
} from './detector.js';
import { utcToday } from '@ship/shared';

export type ManualFleetGraphDetectorSummary = {
  workspaceId: string;
  today: string | null;
  decisionCount: number;
  dedupeDecisions: Array<{
    decision: BlockedImportantIssueDedupeDecision['decision'];
    issueId: string;
    issueTitle: string;
    issuePriority: string;
    sprintId: string;
    sprintTitle: string;
    blockerText: string;
    dedupeKey: string;
    existingFindingId: string | null;
  }>;
  quietExits: FleetGraphDetectorQuietExit[];
  modelCalls: 0;
  mutatesShip: false;
  mutatesFleetGraph: false;
};

function mapDedupeDecision(
  decision: BlockedImportantIssueDedupeDecision
): ManualFleetGraphDetectorSummary['dedupeDecisions'][number] {
  const { candidate } = decision;
  return {
    decision: decision.decision,
    issueId: candidate.issue_id,
    issueTitle: candidate.issue_title,
    issuePriority: candidate.issue_priority,
    sprintId: candidate.sprint_id,
    sprintTitle: candidate.sprint_title,
    blockerText: candidate.blocker_text,
    dedupeKey: candidate.dedupeKey,
    existingFindingId: decision.existingFindingId,
  };
}

export async function runManualFleetGraphDetector(input: {
  workspaceId: string;
  today?: Date;
  limit?: number;
}): Promise<ManualFleetGraphDetectorSummary> {
  const today = input.today ?? utcToday();
  const decisions = await detectBlockedImportantIssueDecisions({
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
    decisionCount: decisions.length,
    dedupeDecisions: decisions.map(mapDedupeDecision),
    quietExits,
    modelCalls: 0,
    mutatesShip: false,
    mutatesFleetGraph: false,
  };
}
