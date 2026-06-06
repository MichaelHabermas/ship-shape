// View-model projections for submission ledger tabs and grading packet.
import { repoPathExists, statusLabel } from './ledger-utils.mjs';
import { week4 } from './week4-paths.mjs';

const dashboardDirPrefix = `${week4.root}/`;

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
  if (repoPath.startsWith(dashboardDirPrefix)) {
    return repoPath.slice(dashboardDirPrefix.length);
  }
  if (repoPath.startsWith('my-docs/')) {
    return `../../../${repoPath.slice('my-docs/'.length)}`;
  }
  if (repoPath.startsWith('test-results/') || repoPath.startsWith('packages/')) {
    return `../../../../${repoPath}`;
  }
  return `../../../../${repoPath}`;
}

export function projectSecurityTab(ledger) {
  return {
    category: (ledger.categories || []).find((item) => item.id === 'cat-8-security-audit') ?? null,
  };
}

export function buildLedgerModel(ledger) {
  const categories = [...ledger.categories].sort((a, b) => a.number - b.number);
  const categoryViews = categories.map((category) => buildCategoryView(category));
  const model = {
    ledger,
    categories: categoryViews,
    gateSnapshot: getGateSnapshot(categories),
    failuresAndWarnings: getAcceptanceWarningsAndFailures(categories),
    securityTab: projectSecurityTab(ledger),
  };
  return {
    ...model,
    gradingPacket: buildGradingPacket(model),
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

export function buildGradingPacket(model) {
  const categories = model.categories || [];
  const blockedCount = categories.filter((category) => category.status !== 'proven').length;
  return {
    title: `${model.gateSnapshot.proven}/${categories.length} categories source-gate ready`,
    lede:
      blockedCount === 0
        ? `${categories.length}/${categories.length} categories proven in the ledger.`
        : `${blockedCount} categor${blockedCount === 1 ? 'y is' : 'ies are'} not proven.`,
    reproduceCommands: [
      {
        label: 'Validate and regenerate',
        command: 'pnpm submission:validate && pnpm submission:render && pnpm submission:check',
      },
      {
        label: 'Security probe',
        command: 'pnpm security:probe:ci',
      },
    ],
    rows: categories.map((category) => buildGradingRow(category)),
  };
}

function buildGradingRow(category) {
  const baseline = findSummaryCard(category, 'audit baseline');
  const closeout = findSummaryCard(category, 'closeout proof');
  const commandEvidence = firstCommandEvidence(category);
  const artifactEvidence = firstArtifactEvidence(category);
  const caveat = category.non_claims?.[0] || category.caveats?.[0] || '';
  const passedCount = category.passedTests?.length || 0;
  const gateCount = category.acceptance_tests?.length || 0;
  const failingOrWarning = [...(category.failedTests || []), ...(category.warningTests || [])];
  const primaryTarget = category.primaryTarget;
  const targetOutcome = primaryTarget ? renderTargetOutcome(category, primaryTarget) : '';
  const improvement =
    summaryCardSentence(closeout) ||
    [primaryTarget?.description, targetOutcome].filter(Boolean).join(' ') ||
    category.proofSummary ||
    '';

  return {
    categoryId: category.id,
    number: category.number,
    title: category.title,
    status: category.status,
    sourceGate: category.source_requirement?.statement || '',
    sourcePath: category.source_requirement?.source || '',
    baseline: summaryCardSentence(baseline) || 'Audit baseline fields are recorded in the ledger.',
    improvement,
    proof: artifactEvidence
      ? {
          label: artifactEvidence.description || artifactEvidence.id,
          path: artifactEvidence.path,
          type: artifactEvidence.type,
        }
      : null,
    reproduce: commandEvidence
      ? {
          label: commandEvidence.description || commandEvidence.id,
          command: commandEvidence.command,
          result: commandEvidence.result || '',
        }
      : null,
    caveat,
    verdict:
      failingOrWarning.length === 0
        ? `${passedCount}/${gateCount} gates pass`
        : `${failingOrWarning.length} gate warning/failure${failingOrWarning.length === 1 ? '' : 's'}`,
  };
}

export function findSummaryCard(category, title) {
  return (category.summary_cards || []).find((card) => String(card.title || '').toLowerCase() === title);
}

export function summaryCardSentence(card) {
  if (!card?.items?.length) return '';
  return card.items.map((item) => `${item.label}: ${item.value}`).join(' ');
}

export function firstEvidence(category, predicate) {
  return (category.evidence || []).find(predicate) || null;
}

export function firstCommandEvidence(category) {
  return firstEvidence(category, (item) => item.command);
}

export function firstArtifactEvidence(category) {
  return firstEvidence(category, (item) => item.path);
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
  return `${statusLabel(category.status)}; ${category.caveats?.[0] || '—'}`;
}

function renderProofSummary(category, target) {
  if (!target) return category.source_requirement.statement;
  const outcome = renderTargetOutcome(category, target);
  const result = target.result === 'pass' ? 'passes' : target.result === 'fail' ? 'does not pass' : target.result;
  return `${target.description} ${result}.${outcome ? ` ${outcome}.` : ''}`;
}
