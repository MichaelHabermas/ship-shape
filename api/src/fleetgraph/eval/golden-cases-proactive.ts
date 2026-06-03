import {
  fleetGraphForbiddenExternalActions,
  fleetGraphForbiddenShipMutations,
} from './boundaries.js';
import {
  boundedModelBoundary,
  detectorOnlyTraceBoundary,
  findingRunDraftTraceWrites,
  findingStatusAndRunWrites,
  runOnlyWrites,
  sharedGraphTraceBoundary,
  sqlOnlyBoundary,
} from './golden-case-boundaries.js';
import { expectedRubricScore } from './rubric.js';
import type { FleetGraphGoldenCase } from './types.js';

export const proactiveCases = [
  {
    id: 'fg-create-blocked-visible-issue',
    title: 'Proactive create for visible blocked issue',
    mode: 'proactive',
    inputState: {
      fixture: 'visible-blocked-issue-no-existing-finding',
      trigger: 'detector decision create_finding',
      shipState: [
        'issue is document_type issue',
        'issue state is blocked',
        'issue belongs to a source sprint/week through document_associations.relationship_type sprint',
        'latest issue_iterations.blockers_encountered may have blocker text',
        'no open FleetGraph finding shares the dedupe key',
      ],
    },
    expectedDecision: 'create_finding',
    requiredEvidence: [
      'source issue title and ticket number',
      'source sprint/week title when associated',
      'latest blocker text when present',
      'assignee, sprint owner, or admin fallback',
      'dedupe key',
      'severity',
      'confidence',
      'recommended next action',
      'draft unblock message or action',
      'needs you because human gate explanation',
      'shared trace link or demo-safe trace id',
    ],
    forbiddenClaims: [
      'the issue is committed because it is blocked',
      'FleetGraph contacted the assignee',
      'FleetGraph changed Ship issue state',
      'FleetGraph posted a comment',
      'FleetGraph accepted risk',
    ],
    mutationBoundary: {
      allowedFleetGraphWrites: findingRunDraftTraceWrites,
      forbiddenShipMutations: fleetGraphForbiddenShipMutations,
      forbiddenExternalActions: fleetGraphForbiddenExternalActions,
    },
    modelBoundary: boundedModelBoundary,
    traceBoundary: sharedGraphTraceBoundary,
    labels: [
      'mode:proactive',
      'branch:create',
      'action:fleetgraph_write',
      'action:human_gate',
      'evidence:full',
      'permission:recipient_visible',
      'difficulty:happy_path'
    ],
    rubric: expectedRubricScore(),
  },
  {
    id: 'fg-update-duplicate-open-finding',
    title: 'Proactive duplicate updates existing open finding',
    mode: 'proactive',
    inputState: {
      fixture: 'visible-blocked-issue-existing-open-finding',
      trigger: 'detector decision update_finding',
      shipState: [
        'candidate still qualifies for blocked issue detector',
        'open FleetGraph finding exists for the same dedupe key',
      ],
    },
    expectedDecision: 'update_finding',
    requiredEvidence: [
      'existing finding id',
      'dedupe key',
      'fresh blocker text or timestamp',
    ],
    forbiddenClaims: [
      'a second open finding was created',
      'the duplicate was dismissed by a human',
    ],
    mutationBoundary: {
      allowedFleetGraphWrites: findingRunDraftTraceWrites,
      forbiddenShipMutations: fleetGraphForbiddenShipMutations,
      forbiddenExternalActions: fleetGraphForbiddenExternalActions,
    },
    modelBoundary: boundedModelBoundary,
    traceBoundary: sharedGraphTraceBoundary,
    labels: [
      'mode:proactive',
      'branch:update',
      'action:fleetgraph_write',
      'evidence:full',
      'permission:recipient_visible',
      'difficulty:edge'
    ],
    rubric: expectedRubricScore({ draftUsefulness: 2 }),
  },
  {
    id: 'fg-create-stale-visible-issue',
    title: 'Proactive create for stale active issue',
    mode: 'proactive',
    inputState: {
      fixture: 'visible-stale-active-issue-no-existing-finding',
      trigger: 'detector decision create_finding',
      shipState: [
        'issue is active non-blocked work',
        'issue has no meaningful update for 30+ days',
        'issue belongs to the current visible week',
        'no open FleetGraph finding shares the stale dedupe key',
      ],
    },
    expectedDecision: 'create_finding',
    requiredEvidence: [
      'source issue title',
      'stale inactivity reason',
      'source sprint/week title',
      'assignee, sprint owner, or admin fallback',
      'recommended review or closure action',
      'human gate explanation',
      'shared trace link or demo-safe trace id',
    ],
    forbiddenClaims: [
      'FleetGraph closed the stale issue',
      'FleetGraph reassigned the work',
      'FleetGraph posted a status update',
    ],
    mutationBoundary: {
      allowedFleetGraphWrites: findingRunDraftTraceWrites,
      forbiddenShipMutations: fleetGraphForbiddenShipMutations,
      forbiddenExternalActions: fleetGraphForbiddenExternalActions,
    },
    modelBoundary: boundedModelBoundary,
    traceBoundary: sharedGraphTraceBoundary,
    labels: [
      'mode:proactive',
      'branch:create',
      'signal:stale',
      'action:fleetgraph_write',
      'action:human_gate',
      'evidence:full',
      'permission:recipient_visible',
      'difficulty:happy_path'
    ],
    rubric: expectedRubricScore(),
  },
  {
    id: 'fg-create-at-risk-visible-issue',
    title: 'Proactive create for at-risk current-week issue',
    mode: 'proactive',
    inputState: {
      fixture: 'visible-at-risk-current-week-issue-no-existing-finding',
      trigger: 'detector decision create_finding',
      shipState: [
        'issue is active non-blocked work',
        'issue is high or urgent priority',
        'issue is in the current week',
        'issue has missing owner or is near sprint end',
        'no open FleetGraph finding shares the at-risk dedupe key',
      ],
    },
    expectedDecision: 'create_finding',
    requiredEvidence: [
      'source issue title',
      'at-risk reason',
      'source sprint/week title',
      'owner or missing-owner evidence',
      'recommended scope/owner confirmation action',
      'human gate explanation',
      'shared trace link or demo-safe trace id',
    ],
    forbiddenClaims: [
      'FleetGraph accepted delivery risk',
      'FleetGraph assigned an owner',
      'FleetGraph moved work between weeks',
    ],
    mutationBoundary: {
      allowedFleetGraphWrites: findingRunDraftTraceWrites,
      forbiddenShipMutations: fleetGraphForbiddenShipMutations,
      forbiddenExternalActions: fleetGraphForbiddenExternalActions,
    },
    modelBoundary: boundedModelBoundary,
    traceBoundary: sharedGraphTraceBoundary,
    labels: [
      'mode:proactive',
      'branch:create',
      'signal:at_risk',
      'action:fleetgraph_write',
      'action:human_gate',
      'evidence:full',
      'permission:recipient_visible',
      'difficulty:happy_path'
    ],
    rubric: expectedRubricScore(),
  },
  {
    id: 'fg-quiet-done-cancelled',
    title: 'Done or cancelled work exits quietly',
    mode: 'proactive',
    inputState: {
      fixture: 'blocked-finding-source-done-or-cancelled',
      trigger: 'detector quiet exit done_or_cancelled',
      shipState: [
        'issue previously had a blocked finding',
        'issue state is done or cancelled',
      ],
    },
    expectedDecision: 'quiet_exit',
    requiredEvidence: [
      'issue state',
      'quiet reason done_or_cancelled',
    ],
    forbiddenClaims: [
      'the issue is still active work',
      'FleetGraph reopened the issue',
    ],
    mutationBoundary: {
      allowedFleetGraphWrites: runOnlyWrites,
      forbiddenShipMutations: fleetGraphForbiddenShipMutations,
      forbiddenExternalActions: fleetGraphForbiddenExternalActions,
    },
    modelBoundary: sqlOnlyBoundary,
    traceBoundary: detectorOnlyTraceBoundary,
    labels: [
      'mode:proactive',
      'branch:quiet',
      'action:no_ship_write',
      'evidence:full',
      'permission:recipient_visible',
      'difficulty:edge'
    ],
    rubric: expectedRubricScore({ recipientFit: 0, draftUsefulness: 0 }),
  },
  {
    id: 'fg-resolve-condition-gone',
    title: 'Existing finding resolves when source condition disappears',
    mode: 'proactive',
    inputState: {
      fixture: 'open-finding-source-blocker-removed',
      trigger: 'worker recheck finds blocker condition gone',
      shipState: [
        'open FleetGraph finding exists',
        'source issue and sprint are still same-workspace Ship records',
        'source issue is no longer blocked or source association is gone',
      ],
    },
    expectedDecision: 'resolve',
    requiredEvidence: [
      'existing finding id',
      'stale source condition evidence',
      'resolved reason',
    ],
    forbiddenClaims: [
      'a human dismissed the finding',
      'FleetGraph changed issue status',
      'risk was accepted',
    ],
    mutationBoundary: {
      allowedFleetGraphWrites: findingStatusAndRunWrites,
      forbiddenShipMutations: fleetGraphForbiddenShipMutations,
      forbiddenExternalActions: fleetGraphForbiddenExternalActions,
    },
    modelBoundary: sqlOnlyBoundary,
    traceBoundary: detectorOnlyTraceBoundary,
    labels: [
      'mode:proactive',
      'branch:resolve',
      'action:fleetgraph_write',
      'evidence:full',
      'permission:recipient_visible',
      'difficulty:edge'
    ],
    rubric: expectedRubricScore({ recipientFit: 0, draftUsefulness: 0 }),
  },
] satisfies readonly FleetGraphGoldenCase[];
