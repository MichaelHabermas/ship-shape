// Builds and validates FleetGraph reviewer proof packets from deterministic repo evidence.
export const REQUIRED_SCENARIOS = [
  {
    id: 'proactive-blocked-create',
    title: 'Proactive blocked finding creates notification',
    goldenCaseId: 'fg-create-blocked-visible-issue',
    path: 'proactive create',
    expected: 'create_finding',
    matrix: { proactive: 'executed', onDemand: 'not applicable', update: 'not applicable', quiet: 'not applicable', humanGate: 'executed' },
  },
  {
    id: 'proactive-duplicate-update',
    title: 'Duplicate source updates existing finding',
    goldenCaseId: 'fg-update-duplicate-open-finding',
    path: 'proactive update',
    expected: 'update_finding',
    matrix: { proactive: 'executed', onDemand: 'not applicable', update: 'executed', quiet: 'not applicable', humanGate: 'not applicable' },
  },
  {
    id: 'proactive-stale-create',
    title: 'Proactive stale finding creates notification',
    goldenCaseId: 'fg-create-stale-visible-issue',
    path: 'proactive stale create',
    expected: 'create_finding',
    matrix: { proactive: 'executed', onDemand: 'not applicable', update: 'not applicable', quiet: 'not applicable', humanGate: 'executed' },
  },
  {
    id: 'proactive-at-risk-create',
    title: 'Proactive at-risk finding creates notification',
    goldenCaseId: 'fg-create-at-risk-visible-issue',
    path: 'proactive at-risk create',
    expected: 'create_finding',
    matrix: { proactive: 'executed', onDemand: 'not applicable', update: 'not applicable', quiet: 'not applicable', humanGate: 'executed' },
  },
  {
    id: 'proactive-quiet-exit',
    title: 'Done or cancelled work exits quietly',
    goldenCaseId: 'fg-quiet-done-cancelled',
    path: 'proactive quiet',
    expected: 'quiet_exit',
    matrix: { proactive: 'defined', onDemand: 'not applicable', update: 'not applicable', quiet: 'defined', humanGate: 'not applicable' },
  },
  {
    id: 'restricted-no-safe-output',
    title: 'Restricted evidence does not leak',
    goldenCaseId: 'fg-restricted-source-hidden',
    path: 'privacy guard',
    expected: 'quiet_exit',
    matrix: { proactive: 'executed', onDemand: 'not applicable', update: 'not applicable', quiet: 'executed', humanGate: 'not applicable' },
  },
  {
    id: 'on-demand-explain',
    title: 'On-demand source explanation stays grounded',
    goldenCaseId: 'fg-explain-existing-finding',
    path: 'on-demand explain',
    expected: 'explain',
    matrix: { proactive: 'not applicable', onDemand: 'executed', update: 'not applicable', quiet: 'not applicable', humanGate: 'not applicable' },
  },
  {
    id: 'context-chat-human-gate',
    title: 'Next-action chat preserves human gate',
    goldenCaseId: 'fg-human-gated-action-prep',
    path: 'context chat',
    expected: 'needs_confirmation',
    matrix: { proactive: 'not applicable', onDemand: 'defined', update: 'not applicable', quiet: 'not applicable', humanGate: 'defined' },
  },
  {
    id: 'source-condition-resolved',
    title: 'Finding resolves when source condition disappears',
    goldenCaseId: 'fg-resolve-condition-gone',
    path: 'proactive resolve',
    expected: 'resolve',
    matrix: { proactive: 'defined', onDemand: 'not applicable', update: 'not applicable', quiet: 'not applicable', humanGate: 'not applicable' },
  },
];

export const LOOP_STEPS = [
  { name: 'Ship signal', evidence: 'api/src/fleetgraph/eval/golden-cases.ts' },
  { name: 'Detector policy', evidence: 'api/src/fleetgraph/eval/executable-golden-cases.test.ts' },
  { name: 'Finding lifecycle', evidence: 'my-docs/evals/fleetgraph-product-surface/latest.json' },
  { name: 'Notification state', evidence: 'e2e/fleetgraph-attention-loop.spec.ts' },
  { name: 'Source and chat', evidence: 'my-docs/evidence/fleetgraph-proof/latest.html' },
  { name: 'Human gate', evidence: 'my-docs/evidence/fleetgraph-proof/latest.md' },
];

export const NON_CLAIMS = [
  'This dashboard is not product UI and does not add FleetGraph branding to the app.',
  'This proof packet does not claim autonomous Ship mutation or external contact.',
  'A blocked deployed target means required deployed evidence was missing, not that production passed.',
];

export function buildProofPacket(input) {
  const executedCaseIds = input.executedCaseIds ?? new Set();
  const executedScenarioIds = input.executedScenarioIds ?? new Set();
  const scenarios = REQUIRED_SCENARIOS.map((scenario) =>
    scenarioFromGoldenCase(scenario, input.goldenCaseIndex, executedCaseIds, executedScenarioIds)
  );
  const productSurface = input.productSurface ?? null;
  const currentSurface = productSurface?.sections?.find((section) => section.id === 'current') ?? null;
  const commandResults = input.commandResults ?? [];
  const environments = input.environments ?? [];
  const loopTimeline = LOOP_STEPS.map((step, index) => ({
    name: step.name,
    status: stepStatus(index, scenarios, commandResults),
    evidence: step.evidence,
  }));

  const packet = {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    runId: input.runId,
    target: input.target,
    git: input.git,
    verdict: 'blocked',
    summary: {
      requiredScenarioCount: REQUIRED_SCENARIOS.length,
      provenScenarioCount: scenarios.filter((scenario) => scenario.status === 'executed').length,
      currentSurfacePass: currentSurface?.summary?.passCount ?? null,
      currentSurfaceFail: currentSurface?.summary?.failCount ?? null,
      deployedConfigured: environments.some((environment) => environment.id === 'deployed' && environment.status !== 'blocked'),
      deployedSignals: input.deployedEvidence?.signalTypes ?? [],
      deployedCompletedWorkerTicks: input.deployedEvidence?.completedWorkerTickCount ?? 0,
      deployedScheduledWorkerSignals: input.deployedEvidence?.scheduledWorkerSignalTypes ?? [],
      graphInvocationCount: input.deployedEvidence?.usageSummary?.graphInvocationCount ?? 0,
      modelCallCount: input.deployedEvidence?.usageSummary?.modelCallCount ?? 0,
      realModelRunCount: input.deployedEvidence?.usageSummary?.realModelRunCount ?? 0,
    },
    environments,
    deployedEvidence: input.deployedEvidence ?? null,
    loopTimeline,
    scenarios,
    graphPathMatrix: matrixFromScenarios(scenarios),
    currentFindings: currentFindingsFromSurface(currentSurface),
    safety: safetyChecks(scenarios, productSurface),
    costs: costSummary(input),
    traceEvidence: input.deployedEvidence?.traceEvidence ?? null,
    commandResults,
    artifacts: artifactIndex(input.artifacts ?? []),
    risks: riskList(scenarios, environments, commandResults, input.target),
    nonClaims: NON_CLAIMS,
  };

  packet.verdict = deriveVerdict(packet);
  return packet;
}

export function validateProofPacket(packet) {
  const issues = [];
  if (!packet.generatedAt) issues.push('missing generatedAt');
  if (!packet.runId) issues.push('missing runId');
  for (const scenario of REQUIRED_SCENARIOS) {
    const item = packet.scenarios.find((candidate) => candidate.id === scenario.id);
    if (!item) {
      issues.push(`missing required scenario ${scenario.id}`);
    } else if (item.decision !== scenario.expected) {
      issues.push(`scenario ${scenario.id} expected ${scenario.expected} but found ${item.decision}`);
    }
  }
  for (const artifact of ['latest.html', 'latest.json', 'latest.md']) {
    if (!packet.artifacts.some((item) => item.path.endsWith(artifact))) {
      issues.push(`missing artifact ${artifact}`);
    }
  }
  if (packet.target !== 'local') {
    for (const artifact of [
      'web/public/fleetgraph-observability/proof/latest.html',
      'web/public/fleetgraph-observability/proof/latest.json',
      'web/public/fleetgraph-observability/proof/latest.md',
    ]) {
      if (!packet.artifacts.some((item) => item.path === artifact)) {
        issues.push(`missing public artifact ${artifact}`);
      }
    }
  }
  if (packet.safety.some((check) => check.status === 'fail')) {
    issues.push('one or more safety checks failed');
  }
  return issues;
}

export function deriveVerdict(packet) {
  if (packet.commandResults.some((result) => result.status === 'fail')) return 'fail';
  if (packet.scenarios.some((scenario) => scenario.status === 'missing' || scenario.status === 'mismatch')) return 'fail';
  if (packet.environments.some((environment) => environment.required && environment.status === 'blocked')) return 'blocked';
  if (packet.scenarios.some((scenario) => scenario.status === 'blocked')) return 'blocked';
  if (packet.target !== 'local' && packet.commandResults.some((result) => result.status === 'skipped')) return 'blocked';
  if (packet.target !== 'local' && !hasAllDeployedSignals(packet.deployedEvidence)) return 'blocked';
  if (packet.target !== 'local' && !packet.deployedEvidence?.hasRecentCompletedWorkerOutput) return 'blocked';
  if (packet.target !== 'local' && Number(packet.deployedEvidence?.stuckRunningTickCount ?? 0) > 0) return 'blocked';
  if (packet.target !== 'local' && packet.traceEvidence?.missingRequired?.length > 0) return 'blocked';
  if (packet.risks.length > 0) return 'risk';
  return 'pass';
}

function hasAllDeployedSignals(deployedEvidence) {
  if (!deployedEvidence) return false;
  const signals = new Set(deployedEvidence.signalTypes ?? []);
  return ['blocked', 'stale', 'at_risk'].every((signal) => signals.has(signal));
}

function scenarioFromGoldenCase(scenario, goldenCaseIndex, executedCaseIds, executedScenarioIds) {
  const goldenCase = goldenCaseIndex.get(scenario.goldenCaseId);
  if (!goldenCase) {
    return {
      ...scenario,
      status: 'missing',
      evidence: [],
      notes: ['Golden case was not found in api/src/fleetgraph/eval/golden-cases.ts.'],
    };
  }
  const status = goldenCase.expectedDecision !== scenario.expected
    ? 'mismatch'
    : executedCaseIds.has(scenario.goldenCaseId) || executedScenarioIds.has(scenario.id)
      ? 'executed'
      : 'defined';
  return {
    ...scenario,
    status,
    decision: goldenCase.expectedDecision,
    mode: goldenCase.mode,
    evidence: [
      `${status === 'executed' ? 'Executable proof covers' : 'Golden case defines'} ${scenario.goldenCaseId}`,
      `Expected ${goldenCase.expectedDecision}`,
      ...goldenCase.labels.slice(0, 4),
    ],
    notes: goldenCase.title ? [goldenCase.title] : [],
  };
}

function matrixFromScenarios(scenarios) {
  return scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    title: scenario.title,
    cells: Object.fromEntries(Object.entries(scenario.matrix).map(([key, value]) => [
      key,
      scenario.status === 'missing' || scenario.status === 'mismatch' ? scenario.status : downgradeMatrixCell(value, scenario.status),
    ])),
  }));
}

function downgradeMatrixCell(cell, scenarioStatus) {
  if (cell === 'not applicable') return cell;
  return scenarioStatus === 'executed' ? 'executed' : 'defined';
}

function currentFindingsFromSurface(section) {
  if (!section?.results) return [];
  return section.results.slice(0, 6).map((result) => ({
    signal: result.visibleCopy?.[0] ?? 'Attention',
    source: result.visibleCopy?.[1] ?? result.caseId,
    visibleCopy: (result.visibleCopy ?? []).slice(0, 4).join(' · '),
    nextAction: result.visibleCopy?.at(-1) ?? 'See source.',
    status: result.pass ? 'pass' : 'fail',
    evidence: result.caseId,
  }));
}

function safetyChecks(scenarios, productSurface) {
  const hasPassingProofTests = scenarios.some((scenario) => scenario.status === 'executed');
  return [
    {
      name: 'Permission-filtered evidence',
      status: scenarios.some((scenario) => scenario.id === 'restricted-no-safe-output' && scenario.status === 'executed') ? 'pass' : 'blocked',
      evidence: 'fg-restricted-source-hidden',
    },
    {
      name: 'No autonomous Ship mutation/contact',
      status: hasPassingProofTests && scenarios.every((scenario) => scenario.status !== 'missing') ? 'pass' : 'blocked',
      evidence: 'FleetGraph golden-case mutation boundaries',
    },
    {
      name: 'Human gate before next action',
      status: scenarios.some((scenario) => scenario.id === 'context-chat-human-gate' && scenario.status === 'executed') ? 'pass' : 'blocked',
      evidence: 'fg-human-gated-action-prep',
    },
    {
      name: 'Reviewer proof kept out of product UI',
      status: (productSurface?.summary?.average?.uiProofSeparation ?? 0) >= 3 ? 'pass' : 'blocked',
      evidence: 'fleetgraph-product-surface latest.json',
    },
  ];
}

function costSummary(input) {
  const commandMs = (input.commandResults ?? []).reduce((sum, result) => sum + (result.durationMs ?? 0), 0);
  const usage = input.deployedEvidence?.usageSummary;
  const projections = usage?.projections ?? {};
  return {
    runCount: input.commandResults?.length ?? 0,
    measuredCommandMs: commandMs,
    graphInvocationCount: usage?.graphInvocationCount ?? 0,
    modelCallCount: usage?.modelCallCount ?? 0,
    inputTokens: usage?.inputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    billableInputTokens: usage?.billableInputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    deterministicRunCount: usage?.deterministicRunCount ?? 0,
    realModelRunCount: usage?.realModelRunCount ?? 0,
    estimatedModelCostUsd: usage?.estimatedCostUsd ?? 0,
    modelCost: usage
      ? `$${Number(usage.estimatedCostUsd ?? 0).toFixed(6)} measured FleetGraph graph-runtime estimate`
      : 'not measured; no deployed run metadata was available',
    p95Latency: input.latency?.p95 ?? 'not measured',
    projected100Projects: projectionLabel(projections[100]),
    projected1000Projects: projectionLabel(projections[1000]),
    projected10000Projects: projectionLabel(projections[10000]),
    excludes: 'Out-of-band coding assistant and development-wide Claude/API spend were not instrumented and are excluded.',
  };
}

function projectionLabel(projection) {
  if (!projection) return 'requires deployed telemetry';
  return `$${Number(projection.estimatedMonthlyCostUsd ?? 0).toFixed(6)} / month at ${projection.monthlyInvocations} graph invocations`;
}

function artifactIndex(artifacts) {
  return artifacts.map((artifact) => ({
    label: artifact.label,
    path: artifact.path,
    kind: artifact.kind ?? 'file',
  }));
}

function riskList(scenarios, environments, commandResults, target) {
  const risks = [];
  if (scenarios.some((scenario) => scenario.status === 'defined')) {
    risks.push('One or more required graph paths is defined by golden cases but not executed by the focused proof tests yet.');
  }
  if (environments.some((environment) => environment.id === 'deployed' && environment.status === 'blocked')) {
    risks.push('Deployed proof is blocked until deployed URLs/credentials are configured.');
  }
  if (commandResults.some((result) => result.status === 'blocked')) risks.push('One or more verification commands was blocked.');
  const skippedCommands = commandResults.filter((result) => result.status === 'skipped');
  if (target !== 'local' && skippedCommands.length > 0) risks.push('One or more verification commands was skipped.');
  return risks;
}

function stepStatus(index, scenarios, commandResults) {
  if (commandResults.some((result) => result.status === 'fail')) return 'fail';
  if (scenarios.some((scenario) => scenario.status === 'missing' || scenario.status === 'mismatch')) return 'fail';
  if (index > 2 && commandResults.some((result) => result.status === 'blocked')) return 'blocked';
  if (index > 2 && commandResults.some((result) => result.status === 'skipped')) return 'skipped';
  return 'pass';
}
