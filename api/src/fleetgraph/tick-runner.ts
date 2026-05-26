// FleetGraph tick runner unifies read-only detector previews and bounded graph execution.
import { utcToday } from '@ship/shared';
import { pool } from '../db/client.js';
import type { Principal } from '../security/principal.js';
import { detectBlockedImportantIssueDecisions, findBlockedImportantIssueQuietExits, type BlockedImportantIssueDedupeDecision, type FleetGraphDetectorQuietExit } from './detector.js';
import { runFleetGraph, type FleetGraphCoreOptions } from './core.js';
import type { FleetGraphResult } from './types.js';

type QueryRunner = Pick<typeof pool, 'query'>;

export type FleetGraphDryRunTickSummary = {
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

export type FleetGraphExecuteTickSummary = {
  mode: 'proactive';
  detectorDecisions: number;
  results: FleetGraphResult[];
};

export type FleetGraphTickInput =
  | {
      mode: 'dryRun';
      workspaceId: string;
      today?: Date;
      limit?: number;
      db?: QueryRunner;
    }
  | {
      mode: 'execute';
      workspaceId: string;
      principal: Principal;
      today?: Date;
      limit?: number;
      triggerReason?: string;
      db?: QueryRunner;
      graphOptions?: Omit<FleetGraphCoreOptions, 'db'>;
    };

function mapDedupeDecision(
  decision: BlockedImportantIssueDedupeDecision
): FleetGraphDryRunTickSummary['dedupeDecisions'][number] {
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

async function runWithOwnedTransaction<T>(fn: (db: QueryRunner) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runGraphExecute(
  input: Extract<FleetGraphTickInput, { mode: 'execute' }>,
  db: QueryRunner,
  trigger: Parameters<typeof runFleetGraph>[0]['trigger']
): Promise<FleetGraphResult> {
  const execute = (graphDb: QueryRunner) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: input.principal,
    mode: 'proactive',
    trigger,
    triggerReason: input.triggerReason ?? 'manual-run',
  }, { ...input.graphOptions, db: graphDb });

  return input.db ? execute(db) : runWithOwnedTransaction(execute);
}

export async function runFleetGraphTick(input: Extract<FleetGraphTickInput, { mode: 'dryRun' }>): Promise<FleetGraphDryRunTickSummary>;
export async function runFleetGraphTick(input: Extract<FleetGraphTickInput, { mode: 'execute' }>): Promise<FleetGraphExecuteTickSummary>;
export async function runFleetGraphTick(input: FleetGraphTickInput): Promise<FleetGraphDryRunTickSummary | FleetGraphExecuteTickSummary> {
  const db = input.db ?? pool;
  const today = input.today ?? utcToday();
  const decisions = await detectBlockedImportantIssueDecisions({
    workspaceId: input.workspaceId,
    today,
    limit: input.limit,
    db,
  });

  if (input.mode === 'dryRun') {
    const quietExits = await findBlockedImportantIssueQuietExits({
      workspaceId: input.workspaceId,
      today,
      db,
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

  if (decisions.length === 0) {
    const quietExits = await findBlockedImportantIssueQuietExits({
      workspaceId: input.workspaceId,
      today,
      db,
    });
    const quietResult = await runGraphExecute(input, db, { type: 'quiet_exit', quietExits });

    return {
      mode: 'proactive',
      detectorDecisions: 0,
      results: [quietResult],
    };
  }

  const results: FleetGraphResult[] = [];
  for (const detectorDecision of decisions) {
    results.push(await runGraphExecute(input, db, { type: 'detector_decision', detectorDecision }));
  }

  return {
    mode: 'proactive',
    detectorDecisions: decisions.length,
    results,
  };
}
