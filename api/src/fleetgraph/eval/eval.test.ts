// Verifies the FleetGraph eval pack is complete enough to guide graph implementation.
import { describe, expect, it } from 'vitest';
import {
  fleetGraphAllowedFleetGraphWrites,
  fleetGraphForbiddenExternalActions,
  fleetGraphForbiddenShipMutations,
  fleetGraphForbiddenTraceData,
  fleetGraphSharedGraphRequiredNodes,
} from './boundaries.js';
import {
  FLEETGRAPH_RUBRIC_DIMENSIONS,
  fleetGraphCoverageMatrix,
  fleetGraphCoverageRequirements,
  fleetGraphDecisionPacketRubric,
  fleetGraphGoldenCases,
  fleetGraphTraceReviewTaxonomy,
} from './index.js';
import type { FleetGraphGoldenCase } from './types.js';

const allowedFleetGraphWrites = new Set(fleetGraphAllowedFleetGraphWrites);

const labelPrefixes = ['mode:', 'branch:', 'evidence:', 'permission:', 'difficulty:'] as const;

function requireCase(id: string): FleetGraphGoldenCase {
  const testCase = fleetGraphGoldenCases.find((candidate) => candidate.id === id);
  if (!testCase) {
    throw new Error(`missing golden case: ${id}`);
  }
  return testCase;
}

function expectNonEmptyUniqueStrings(values: readonly string[]) {
  expect(values.length).toBeGreaterThan(0);
  expect(new Set(values).size).toBe(values.length);
  for (const value of values) {
    expect(value).toBe(value.trim());
    expect(value).not.toEqual('');
  }
}

function hasLabel(labels: readonly string[], label: string): boolean {
  return labels.some((candidate) => candidate === label);
}

describe('FleetGraph eval pack', () => {
  it('defines complete golden cases with unique ids and clean semantic arrays', () => {
    const ids = new Set<string>();

    for (const testCase of fleetGraphGoldenCases) {
      expect(testCase.id).toMatch(/^fg-/);
      expect(ids.has(testCase.id)).toBe(false);
      ids.add(testCase.id);

      expect(testCase.title).toBe(testCase.title.trim());
      expect(testCase.title).not.toEqual('');
      expect(['proactive', 'on_demand']).toContain(testCase.mode);
      expect(testCase.inputState.fixture).not.toEqual('');
      expect(testCase.inputState.trigger).not.toEqual('');

      expectNonEmptyUniqueStrings(testCase.inputState.shipState);
      expectNonEmptyUniqueStrings(testCase.requiredEvidence);
      expectNonEmptyUniqueStrings(testCase.forbiddenClaims);
      expectNonEmptyUniqueStrings(testCase.labels);
      expectNonEmptyUniqueStrings(testCase.mutationBoundary.allowedFleetGraphWrites);
      expectNonEmptyUniqueStrings(testCase.mutationBoundary.forbiddenShipMutations);
      expectNonEmptyUniqueStrings(testCase.mutationBoundary.forbiddenExternalActions);

      for (const prefix of labelPrefixes) {
        expect(testCase.labels.filter((label) => label.startsWith(prefix))).toHaveLength(1);
      }
      expect(testCase.labels.filter((label) =>
        label === 'action:fleetgraph_write' || label === 'action:no_ship_write'
      )).toHaveLength(1);
    }

    expect(fleetGraphGoldenCases).toHaveLength(17);
  });

  it('keeps FleetGraph-only writes explicit and blocks Ship mutation or contact', () => {
    for (const testCase of fleetGraphGoldenCases) {
      expect(testCase.mutationBoundary.forbiddenShipMutations).toEqual(fleetGraphForbiddenShipMutations);
      expect(testCase.mutationBoundary.forbiddenExternalActions).toEqual(
        fleetGraphForbiddenExternalActions
      );

      for (const writeTarget of testCase.mutationBoundary.allowedFleetGraphWrites) {
        expect(allowedFleetGraphWrites.has(writeTarget)).toBe(true);
        expect(testCase.mutationBoundary.forbiddenShipMutations).not.toContain(writeTarget);
        expect(testCase.mutationBoundary.forbiddenExternalActions).not.toContain(writeTarget);
      }

      if (hasLabel(testCase.labels, 'action:no_ship_write')) {
        expect(testCase.mutationBoundary.allowedFleetGraphWrites).toEqual(['fleetgraph_runs']);
      }
    }

    expect(requireCase('fg-refine-draft').mutationBoundary.allowedFleetGraphWrites).toEqual([
      'fleetgraph_findings.draft_content',
      'fleetgraph_runs',
    ]);
  });

  it('keeps mode and branch labels aligned to each case decision', () => {
    const expectedBranchByDecision = {
      create_finding: 'branch:create',
      update_finding: 'branch:update',
      quiet_exit: 'branch:quiet',
      explain: 'branch:explain',
      refine_draft: 'branch:refine',
      summarize_changes: 'branch:summarize_changes',
      needs_confirmation: 'branch:needs_confirmation',
      dismiss: 'branch:dismiss',
      resolve: 'branch:resolve',
      error: 'branch:error',
    } as const;

    for (const testCase of fleetGraphGoldenCases) {
      expect(testCase.labels).toContain(`mode:${testCase.mode}`);
      expect(testCase.labels).toContain(expectedBranchByDecision[testCase.expectedDecision]);
    }
  });

  it('covers required MVP graph branches in the coverage matrix', () => {
    expect(fleetGraphCoverageMatrix).toHaveLength(fleetGraphCoverageRequirements.length);

    for (const requirement of fleetGraphCoverageMatrix) {
      expect(requirement.caseIds.length).toBeGreaterThanOrEqual(requirement.minimumCases);
      for (const caseId of requirement.caseIds) {
        const testCase = requireCase(caseId);
        for (const label of requirement.requiredLabels) {
          expect(testCase.labels).toContain(label);
        }
      }
    }
  });

  it('defines rubric dimensions and keeps golden-case scores at required thresholds', () => {
    expect(Object.keys(fleetGraphDecisionPacketRubric).sort()).toEqual(
      [...FLEETGRAPH_RUBRIC_DIMENSIONS].sort()
    );

    for (const dimension of FLEETGRAPH_RUBRIC_DIMENSIONS) {
      expect(fleetGraphDecisionPacketRubric[dimension].description).not.toEqual('');
      expect(fleetGraphDecisionPacketRubric[dimension].threshold).toBeGreaterThan(0);
    }

    for (const testCase of fleetGraphGoldenCases) {
      expect(testCase.rubric.groundedness).toBeGreaterThanOrEqual(
        fleetGraphDecisionPacketRubric.groundedness.threshold
      );
      expect(testCase.rubric.actionSafety).toBeGreaterThanOrEqual(
        fleetGraphDecisionPacketRubric.actionSafety.threshold
      );
      expect(testCase.rubric.humanGateClarity).toBeGreaterThanOrEqual(
        fleetGraphDecisionPacketRubric.humanGateClarity.threshold
      );
    }
  });

  it('pins restricted-evidence and human-gate contracts by canonical case id', () => {
    const restrictedNeighbor = requireCase('fg-restricted-neighbor-evidence');
    expect(restrictedNeighbor.expectedDecision).toBe('quiet_exit');
    expect(restrictedNeighbor.labels).toEqual(expect.arrayContaining([
      'evidence:restricted',
      'permission:restricted',
      'action:no_ship_write',
    ]));
    expect(restrictedNeighbor.forbiddenClaims).toEqual(expect.arrayContaining([
      'hidden document title',
      'hidden document id',
      'hidden project or program breadcrumb',
      'private text excerpt',
    ]));

    const hiddenSource = requireCase('fg-restricted-source-hidden');
    expect(hiddenSource.forbiddenClaims).toEqual(expect.arrayContaining([
      'source issue title',
      'source issue ticket number',
      'source issue UUID',
      'hidden owner or assignee identity',
    ]));

    const hiddenRecipient = requireCase('fg-restricted-recipient-hidden');
    expect(hiddenRecipient.forbiddenClaims).toEqual(expect.arrayContaining([
      'recipient name',
      'recipient email',
      'recipient UUID',
    ]));

    const humanGate = requireCase('fg-human-gated-action-prep');
    expect(humanGate.expectedDecision).toBe('needs_confirmation');
    expect(humanGate.labels).toEqual(expect.arrayContaining([
      'branch:needs_confirmation',
      'action:human_gate',
    ]));
    expect(humanGate.requiredEvidence).toEqual(expect.arrayContaining([
      'proposed recipient or role',
      'recipient rationale',
      'exact draft text',
      'why approval is required',
      'blocked consequence if not approved',
    ]));
    expect(humanGate.forbiddenClaims).toEqual(expect.arrayContaining([
      'draft was posted',
      'recipient was notified',
      'issue status was changed',
    ]));
  });

  it('pins model boundaries, shared graph nodes, and trace redaction requirements', () => {
    for (const testCase of fleetGraphGoldenCases) {
      if (
        testCase.expectedDecision === 'quiet_exit' &&
        testCase.mode === 'proactive' &&
        !hasLabel(testCase.labels, 'evidence:restricted')
      ) {
        expect(testCase.modelBoundary).toEqual({
          expectedModelCalls: 0,
          expectedModelCost: 0,
        });
      }

      if (testCase.modelBoundary.expectedModelCalls === 'bounded') {
        expect(testCase.traceBoundary.requiredNodes).toEqual(
          expect.arrayContaining([...fleetGraphSharedGraphRequiredNodes])
        );
      }

      expect(testCase.traceBoundary.forbiddenTraceData).toEqual(fleetGraphForbiddenTraceData);
    }
  });

  it('defines non-empty trace failure taxonomy entries', () => {
    expect(fleetGraphTraceReviewTaxonomy.length).toBeGreaterThan(0);

    for (const entry of fleetGraphTraceReviewTaxonomy) {
      expect(entry.firstQuestion).not.toEqual('');
      expect(entry.reviewerSignal).not.toEqual('');
    }
  });
});
