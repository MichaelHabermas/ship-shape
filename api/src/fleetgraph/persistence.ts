// FleetGraph persistence helpers own finding/run writes without mutating Ship source records.
export {
  BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX,
  STALE_ISSUE_DEDUPE_PREFIX,
  AT_RISK_ISSUE_DEDUPE_PREFIX,
  blockedImportantIssueDedupeKey,
  fleetGraphAttentionDedupeKey,
  signalTypeFromDedupeKey,
  fleetGraphSignalType,
  signalLabelForType,
  dedupePrefixForSignalType,
  sqlBlockedImportantIssueDedupeKey,
} from './persistence/dedupe.js';
export {
  getOpenFleetGraphFindingByDedupeKey,
  getFleetGraphFindingById,
  listFleetGraphFindingsForSource,
  listFleetGraphFindingsByIds,
  listFleetGraphNotificationFindings,
  markFleetGraphNotificationRead,
  markVisibleFleetGraphNotificationsRead,
} from './persistence/findings-read.js';
export {
  saveBlockedImportantIssueFinding,
  refineFleetGraphDraft,
  dismissFleetGraphFinding,
  resolveFleetGraphFinding,
  suppressFleetGraphFinding,
} from './persistence/findings-write.js';
export {
  enqueueFleetGraphAttentionEvent,
  claimFleetGraphAttentionEvents,
  completeFleetGraphAttentionEvent,
  retryFleetGraphAttentionEvent,
  failFleetGraphAttentionEvent,
} from './persistence/attention-events.js';
export {
  recordFleetGraphRun,
  listFleetGraphAnchorRuns,
  startFleetGraphWorkerTick,
  heartbeatFleetGraphWorkerTick,
  completeFleetGraphWorkerTick,
} from './persistence/runs.js';
export type {
  FleetGraphFindingStatus,
  FleetGraphRunDecision,
  JsonRecord,
  FleetGraphAttentionEventType,
  FleetGraphAttentionEventStatus,
  FleetGraphFinding,
  FleetGraphNotificationFinding,
  FleetGraphRunRow,
  FleetGraphAttentionEventRow,
  FleetGraphWorkerTickStatus,
  FleetGraphWorkerTickRow,
  SaveBlockedImportantIssueFindingInput,
  RecordFleetGraphRunInput,
  CompleteFleetGraphWorkerTickInput,
  EnqueueFleetGraphAttentionEventInput,
  ClaimFleetGraphAttentionEventsInput,
  CompleteFleetGraphAttentionEventInput,
  RetryFleetGraphAttentionEventInput,
  FailFleetGraphAttentionEventInput,
} from './persistence/types.js';
