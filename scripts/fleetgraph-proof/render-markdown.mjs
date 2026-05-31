// Renders FleetGraph reviewer proof packets as compact Markdown evidence.
export function renderMarkdown(packet) {
  return [
    '# FleetGraph Reviewer Proof',
    '',
    `Generated: ${packet.generatedAt}`,
    `Run: ${packet.runId}`,
    `Target: ${packet.target}`,
    `Verdict: ${packet.verdict}`,
    `Git: ${packet.git.branch} @ ${packet.git.sha}`,
    '',
    '## Verdict',
    '',
    `Required scenarios: ${packet.summary.provenScenarioCount}/${packet.summary.requiredScenarioCount}`,
    `Current product surface: ${packet.summary.currentSurfacePass ?? '-'} pass / ${packet.summary.currentSurfaceFail ?? '-'} fail`,
    `Deployed signals: ${(packet.summary.deployedSignals ?? []).join(', ') || '-'}`,
    '',
    '## Attention Loop',
    '',
    '| Step | Status | Evidence |',
    '| --- | --- | --- |',
    ...packet.loopTimeline.map((step) => `| ${step.name} | ${step.status} | ${step.evidence} |`),
    '',
    '## Reviewer Test Cases',
    '',
    '| # | Ship state | Expected output | Required decision | Public LangSmith trace |',
    '| ---: | --- | --- | --- | --- |',
    ...(packet.reviewerTestCases ?? []).map((item) =>
      `| ${item.id} | ${markdownCell(item.shipState)} | ${markdownCell(item.expectedOutput)} | ${markdownCell(item.requiredDecision)} | ${item.traceUrl || 'missing public LangSmith trace'} |`
    ),
    '',
    '## Graph Path Matrix',
    '',
    '| Scenario | Proactive | On-demand | Update | Quiet | Human gate |',
    '| --- | --- | --- | --- | --- | --- |',
    ...packet.graphPathMatrix.map((row) =>
      `| ${row.title} | ${row.cells.proactive} | ${row.cells.onDemand} | ${row.cells.update} | ${row.cells.quiet} | ${row.cells.humanGate} |`
    ),
    '',
    '## Current Findings',
    '',
    '| Signal | Source | Visible copy | Next action | Status |',
    '| --- | --- | --- | --- | --- |',
    ...packet.currentFindings.map((finding) =>
      `| ${finding.signal} | ${finding.source} | ${finding.visibleCopy} | ${finding.nextAction} | ${finding.status} |`
    ),
    '',
    '## Deployed Runtime Evidence',
    '',
    packet.deployedEvidence
      ? `Worker ticks: ${packet.deployedEvidence.workerTickCount}; completed output ticks: ${packet.deployedEvidence.completedWorkerTickCount}; stuck running ticks: ${packet.deployedEvidence.stuckRunningTickCount}; signals: ${packet.deployedEvidence.signalTypes.join(', ') || '-'}; scheduled-worker signals: ${(packet.deployedEvidence.scheduledWorkerSignalTypes ?? []).join(', ') || '-'}`
      : 'No deployed database evidence was configured.',
    '',
    '## Cost And Usage',
    '',
    `Graph invocations: ${packet.costs.graphInvocationCount}`,
    `Model calls: ${packet.costs.modelCallCount}`,
    `Tokens: ${packet.costs.inputTokens} input / ${packet.costs.outputTokens} output / ${packet.costs.totalTokens} total`,
    `Deterministic runs: ${packet.costs.deterministicRunCount}; real-model runs: ${packet.costs.realModelRunCount}`,
    `Estimated FleetGraph model cost: ${packet.costs.modelCost}`,
    `Projection, 100 users: ${packet.costs.projected100Projects}`,
    `Projection, 1,000 users: ${packet.costs.projected1000Projects}`,
    `Projection, 10,000 users: ${packet.costs.projected10000Projects}`,
    `Excluded: ${packet.costs.excludes}`,
    '',
    '## Deployed Runtime Trace Evidence',
    '',
    ...(packet.traceEvidence
      ? [
          `Missing required trace links: ${packet.traceEvidence.missingRequired.join(', ') || 'none'}`,
          ...Object.values(packet.traceEvidence.bySignal ?? {}).map((item) => `- ${item.signal}: ${item.traceUrl || item.traceId || 'missing link'} (${item.decision}, deployed ${runtimeLabel(item.triggerReason)})`),
        ]
      : ['No trace evidence was configured.']),
    '',
    '## Safety',
    '',
    ...packet.safety.map((check) => `- ${check.status}: ${check.name} (${check.evidence})`),
    '',
    '## Risks',
    '',
    ...(packet.risks.length ? packet.risks.map((risk) => `- ${risk}`) : ['- None recorded.']),
    '',
    '## Non-Claims',
    '',
    ...packet.nonClaims.map((claim) => `- ${claim}`),
    '',
    '## Artifacts',
    '',
    ...packet.artifacts.map((artifact) => `- ${artifact.label}: ${artifact.path}`),
    '',
  ].join('\n');
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function runtimeLabel(triggerReason) {
  return triggerReason === 'scheduled-worker'
    ? 'scheduled-worker runtime'
    : `${triggerReason} runtime`;
}
