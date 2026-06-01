export function parseMetricEstimate(estimate: string | number): number {
  if (typeof estimate === 'number') {
    return Number.isFinite(estimate) ? estimate : 0;
  }
  const parsed = parseFloat(estimate);
  return Number.isFinite(parsed) ? parsed : 0;
}
