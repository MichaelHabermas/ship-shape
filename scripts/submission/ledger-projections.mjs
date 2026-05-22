import { repoPathExists, statusLabel } from './ledger-utils.mjs';

export function formatValue(value) {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatPercent(value) {
  if (typeof value !== 'number') return 'N/A';
  return `${formatValue(Math.abs(value))}%`;
}

export function dashboardHref(repoPath) {
  if (!repoPath || !repoPathExists(repoPath)) return null;
  return repoPath.startsWith('my-docs/') ? repoPath.slice('my-docs/'.length) : `../${repoPath}`;
}

export function buildLedgerModel(ledger) {
  const categories = [...ledger.categories].sort((a, b) => a.number - b.number);
  return {
    ledger,
    categories: categories.map((category) => buildCategoryView(category)),
    gateSnapshot: getGateSnapshot(categories),
    failuresAndWarnings: getAcceptanceWarningsAndFailures(categories),
  };
}

export function buildCategoryView(category) {
  const itemById = new Map();
  for (const collectionName of [
    'rubric_items',
    'measurements',
    'derived_metrics',
    'targets',
    'acceptance_tests',
    'claims',
    'evidence',
    'comparability',
    'summary_cards',
  ]) {
    for (const item of category[collectionName] || []) {
      if (item?.id) itemById.set(item.id, { ...item, collectionName });
    }
  }

  const failedTests = (category.acceptance_tests || []).filter((test) => test.result === 'fail');
  const warningTests = (category.acceptance_tests || []).filter((test) => test.result === 'warn');
  const passedTests = (category.acceptance_tests || []).filter((test) => test.result === 'pass');
  const primaryTarget = (category.targets || []).find((target) => target.result === 'pass') || category.targets?.[0];
  const primaryClaim = category.claims?.[0];

  return {
    ...category,
    itemById,
    failedTests,
    warningTests,
    passedTests,
    primaryTarget,
    primaryClaim,
    proofSummary: renderProofSummary(category, primaryTarget),
    currentTruth: renderCurrentTruth(category),
  };
}

export function getGateSnapshot(categories) {
  const statusCounts = categories.reduce((counts, category) => {
    counts[category.status] = (counts[category.status] || 0) + 1;
    return counts;
  }, {});
  return {
    proven: statusCounts.proven || 0,
    partial: statusCounts.partial || 0,
    openFill: (statusCounts.open || 0) + (statusCounts.needs_fill_in || 0) + (statusCounts.not_measured || 0),
  };
}

export function getAcceptanceWarningsAndFailures(categories) {
  return categories.flatMap((category) =>
    (category.acceptance_tests || [])
      .filter((test) => test.result === 'fail' || test.result === 'warn')
      .map((test) => ({
        categoryNumber: category.number,
        categoryTitle: category.title,
        id: test.id,
        result: test.result,
        reason: test.reason || test.notes || '',
        target: (category.targets || []).find((target) => target.id === test.target_id),
      }))
  );
}

export function getCurrentLedgerTruth(model) {
  return model.categories.map((category) => ({
    categoryNumber: category.number,
    title: category.title,
    status: category.status,
    text: category.currentTruth,
    failedTests: category.failedTests.map((test) => test.id),
    warningTests: category.warningTests.map((test) => test.id),
  }));
}

export function renderMetricSentence(metric) {
  if (!metric) return '';
  if (metric.kind === 'percent_change' && typeof metric.baseline_value === 'number' && typeof metric.latest_value === 'number') {
    const direction = metric.change_percent <= 0 ? 'decreased' : 'increased';
    return `${formatValue(metric.baseline_value)} -> ${formatValue(metric.latest_value)} (${direction} ${formatPercent(metric.change_percent)})`;
  }
  if (metric.kind === 'count' && 'value' in metric) {
    return `${formatValue(metric.value)}${typeof metric.threshold === 'number' ? ` / ${formatValue(metric.threshold)} required` : ''}`;
  }
  if (metric.kind === 'boolean_gate' && 'value' in metric) {
    return metric.value ? 'true' : 'false';
  }
  return '';
}

export function renderTargetOutcome(category, target) {
  const metric = target?.metric_id ? (category.derived_metrics || []).find((item) => item.id === target.metric_id) : null;
  const metricText = renderMetricSentence(metric);
  const thresholdText = target?.threshold !== undefined ? `threshold ${formatValue(target.threshold)}` : '';
  const actualText = target?.actual !== undefined ? `actual ${formatValue(target.actual)}` : '';
  return [metricText, thresholdText, actualText, target?.reason].filter(Boolean).join('; ');
}

function renderCurrentTruth(category) {
  const failed = (category.acceptance_tests || []).filter((test) => test.result === 'fail').map((test) => test.id);
  const warnings = (category.acceptance_tests || []).filter((test) => test.result === 'warn').map((test) => test.id);
  if (category.status === 'proven' && warnings.length === 0) {
    return `${statusLabel(category.status)}; required acceptance gates pass.`;
  }
  if (category.status === 'proven' && warnings.length > 0) {
    return `${statusLabel(category.status)} with warning ${warnings.join(', ')}.`;
  }
  if (failed.length > 0) {
    return `${statusLabel(category.status)}; failing acceptance ${failed.join(', ')}.`;
  }
  return `${statusLabel(category.status)}; ${category.caveats?.[0] || 'no failing acceptance test recorded.'}`;
}

function renderProofSummary(category, target) {
  if (!target) return category.source_requirement.statement;
  const outcome = renderTargetOutcome(category, target);
  const result = target.result === 'pass' ? 'passes' : target.result === 'fail' ? 'does not pass' : target.result;
  return `${target.description} ${result}.${outcome ? ` ${outcome}.` : ''}`;
}
