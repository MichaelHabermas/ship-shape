import type {
  FleetGraphProductSurfaceResult,
  FleetGraphProductSurfaceSummary,
} from '../../fleetgraph/eval/product-surface.js';

export type SurfaceEvalReport = {
  generatedAt: string;
  summary: FleetGraphProductSurfaceSummary;
  sections: SurfaceEvalSection[];
  results: SurfaceEvalResult[];
};

export type SurfaceEvalSectionId = 'current' | 'historical';

export type SurfaceEvalResult = FleetGraphProductSurfaceResult & {
  title: string;
  visibleCopy: string[];
  notes: readonly string[];
  section: SurfaceEvalSectionId;
};

export type SurfaceEvalSection = {
  id: SurfaceEvalSectionId;
  title: string;
  description: string;
  summary: FleetGraphProductSurfaceSummary;
  results: SurfaceEvalResult[];
};
