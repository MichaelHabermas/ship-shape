// FleetGraph product-surface eval tests keep user-facing copy quality measurable over time.
import { describe, expect, it } from 'vitest';
import {
  FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS,
  fleetGraphProductSurfaceCases,
  scoreFleetGraphProductSurfaceCase,
  summarizeFleetGraphProductSurfaceResults,
  type FleetGraphProductSurfaceCase,
} from './product-surface.js';
import { buildSurfaceEvalReport } from '../../scripts/fleetgraph-product-surface-eval.js';

describe('FleetGraph product surface evals', () => {
  it('defines unique product-surface cases with trendable thresholds', () => {
    const ids = new Set<string>();

    for (const testCase of fleetGraphProductSurfaceCases) {
      expect(testCase.id).toMatch(/^fg-surface-/);
      expect(ids.has(testCase.id)).toBe(false);
      ids.add(testCase.id);
      expect(testCase.title.trim()).toBe(testCase.title);
      expect(testCase.input.visibleCopy.length).toBeGreaterThan(0);
      expect(testCase.notes.length).toBeGreaterThan(0);

      for (const dimension of FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS) {
        expect(testCase.expectedMinimum[dimension]).toBeGreaterThanOrEqual(0);
        expect(testCase.expectedMinimum[dimension]).toBeLessThanOrEqual(4);
      }
    }
  });

  it('scores the starter cases above their minimum product-quality thresholds', () => {
    const results = fleetGraphProductSurfaceCases.map(scoreFleetGraphProductSurfaceCase);

    for (const result of results) {
      expect(result.pass, `${result.caseId} failed ${result.failedDimensions.join(', ')}`).toBe(true);
      for (const dimension of FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS) {
        expect(result.scores[dimension]).toBeGreaterThanOrEqual(0);
        expect(result.scores[dimension]).toBeLessThanOrEqual(4);
      }
    }
  });

  it('produces stable summary scores for branch-to-branch comparison', () => {
    const summary = summarizeFleetGraphProductSurfaceResults(
      fleetGraphProductSurfaceCases.map(scoreFleetGraphProductSurfaceCase)
    );

    expect(summary.passCount).toBe(fleetGraphProductSurfaceCases.length);
    expect(summary.failCount).toBe(0);
    expect(Object.keys(summary.average).sort()).toEqual([...FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS].sort());
    expect(summary.average.uiProofSeparation).toBe(4);
  });

  it('keeps historical persisted failures out of the current headline', () => {
    const [currentCase] = fleetGraphProductSurfaceCases;
    if (!currentCase) throw new Error('Missing starter product-surface case');
    const historicalFailure: FleetGraphProductSurfaceCase = {
      ...currentCase,
      id: 'fg-surface-persisted-old-failure',
      title: 'Old persisted row should not affect current headline',
      input: {
        ...currentCase.input,
        visibleCopy: [
          'Blocked issue: Old row',
          'Old row is blocked. Latest blocker: blocked blocked blocked blocked blocked.',
          'Confirm the unblock path',
          'FleetGraph sees a blocker signal, but a human must confirm the current unblock path.',
        ],
      },
    };

    const report = buildSurfaceEvalReport({
      generatedAt: '2026-05-28T00:00:00.000Z',
      currentCases: [currentCase],
      historicalCases: [historicalFailure],
    });

    expect(report.summary.passCount).toBe(1);
    expect(report.summary.failCount).toBe(0);
    expect(report.sections.find((section) => section.id === 'historical')?.summary.failCount).toBe(1);
  });
});
