// FleetGraph eval types define golden-case contracts before graph behavior exists.
import type { FleetGraphRunDecision, FleetGraphRunMode } from '../persistence.js';

export type FleetGraphEvalMode = FleetGraphRunMode;

export type FleetGraphEvalDecision = Extract<
  FleetGraphRunDecision,
  | 'quiet_exit'
  | 'create_finding'
  | 'update_finding'
  | 'explain'
  | 'refine_draft'
  | 'needs_confirmation'
  | 'dismiss'
  | 'resolve'
  | 'error'
>;

export type FleetGraphEvalInputState = {
  fixture: string;
  trigger: string;
  shipState: readonly string[];
  userContext?: string;
};

export type FleetGraphEvalMutationBoundary = {
  allowedFleetGraphWrites: readonly string[];
  forbiddenShipMutations: readonly string[];
  forbiddenExternalActions: readonly string[];
};

export type FleetGraphEvalRubricExpectation = {
  groundedness: number;
  recipientFit: number;
  uncertaintyHonesty: number;
  draftUsefulness: number;
  actionSafety: number;
  humanGateClarity: number;
};

export type FleetGraphEvalModelBoundary = {
  expectedModelCalls: 0 | 'bounded';
  expectedModelCost: 0 | 'bounded';
};

export type FleetGraphEvalTraceBoundary = {
  requiredNodes: readonly string[];
  forbiddenTraceData: readonly string[];
};

export type FleetGraphScenarioLabel =
  | 'mode:proactive'
  | 'mode:on_demand'
  | 'branch:create'
  | 'branch:update'
  | 'branch:quiet'
  | 'branch:explain'
  | 'branch:refine'
  | 'branch:needs_confirmation'
  | 'branch:dismiss'
  | 'branch:resolve'
  | 'branch:error'
  | 'action:fleetgraph_write'
  | 'action:no_ship_write'
  | 'action:human_gate'
  | 'evidence:full'
  | 'evidence:restricted'
  | 'evidence:missing'
  | 'permission:recipient_visible'
  | 'permission:restricted'
  | 'difficulty:happy_path'
  | 'difficulty:edge'
  | 'difficulty:failure';

export type FleetGraphGoldenCase = {
  id: string;
  title: string;
  mode: FleetGraphEvalMode;
  inputState: FleetGraphEvalInputState;
  expectedDecision: FleetGraphEvalDecision;
  requiredEvidence: readonly string[];
  forbiddenClaims: readonly string[];
  mutationBoundary: FleetGraphEvalMutationBoundary;
  modelBoundary: FleetGraphEvalModelBoundary;
  traceBoundary: FleetGraphEvalTraceBoundary;
  labels: readonly FleetGraphScenarioLabel[];
  rubric: FleetGraphEvalRubricExpectation;
};
