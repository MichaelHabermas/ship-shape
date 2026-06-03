import {
  fleetGraphForbiddenExternalActions,
  fleetGraphForbiddenShipMutations,
} from './boundaries.js';
import {
  boundedModelBoundary,
  runOnlyWrites,
  sharedGraphTraceBoundary,
} from './golden-case-boundaries.js';
import { expectedRubricScore } from './rubric.js';
import type { FleetGraphGoldenCase } from './types.js';

export const proactiveErrorCases = [
  {
    id: 'fg-error-context-fetch-failure',
    title: 'Context fetch failure records error without stale claims',
    mode: 'proactive',
    inputState: {
      fixture: 'candidate-source-read-fails-after-detector',
      trigger: 'graph context fetch cannot read required source object',
      shipState: [
        'detector produced a candidate',
        'source context fetch fails or source disappears before graph output',
      ],
    },
    expectedDecision: 'error',
    requiredEvidence: [
      'error category context_fetch',
      'source issue id',
      'no output claim marker',
    ],
    forbiddenClaims: [
      'stale blocker summary from missing context',
      'finding was action-ready',
    ],
    mutationBoundary: {
      allowedFleetGraphWrites: runOnlyWrites,
      forbiddenShipMutations: fleetGraphForbiddenShipMutations,
      forbiddenExternalActions: fleetGraphForbiddenExternalActions,
    },
    modelBoundary: boundedModelBoundary,
    traceBoundary: sharedGraphTraceBoundary,
    labels: [
      'mode:proactive',
      'branch:error',
      'action:no_ship_write',
      'evidence:missing',
      'permission:recipient_visible',
      'difficulty:failure'
    ],
    rubric: expectedRubricScore({ recipientFit: 0, draftUsefulness: 0 }),
  },
] satisfies readonly FleetGraphGoldenCase[];
