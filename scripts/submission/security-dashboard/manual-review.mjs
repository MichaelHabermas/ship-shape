const MANUAL_KEYS = [
  { key: 'corsCsp', label: 'CORS / CSP' },
  { key: 'secrets', label: 'Secrets exposure' },
  { key: 'rateLimits', label: 'Rate limiting' },
  { key: 'verboseErrors', label: 'Verbose errors' },
];

export function renderManualReview(view, helpers) {
  const { escapeHtml } = helpers;
  const manual = view.report?.manualReview || {};
  return `
    <div class="security-manual-grid">
      ${MANUAL_KEYS.map(({ key, label }) => {
        const entry = manual[key] || {};
        const status = entry.status || 'unknown';
        const chip = status === 'passed' || status === 'pass' ? 'pass' : status === 'failed' ? 'fail' : 'warn';
        const detail =
          entry.details ||
          entry.detail ||
          entry.summary ||
          (entry.observed ? JSON.stringify(entry.observed) : '') ||
          '';
        return `
          <article class="security-manual-card">
            <header>
              <h4>${escapeHtml(label)}</h4>
              <span class="test-chip ${chip}">${escapeHtml(status)}</span>
            </header>
            <p>${escapeHtml(String(detail).slice(0, 400) || 'See latest.json manualReview block.')}</p>
          </article>`;
      }).join('')}
    </div>`;
}

export function renderSurfaceCards(view, helpers) {
  const { escapeHtml } = helpers;
  const summary = view.report?.summary || {};
  const surfaces = view.report?.surfaces || {};
  const surfaceEntries = [
    { id: 'authSession', label: 'Auth / session' },
    { id: 'authorization', label: 'Authorization (v2)' },
    { id: 'websocketValidation', label: 'WebSocket validation' },
    { id: 'inputSanitization', label: 'Input sanitization' },
    { id: 'dependencyCves', label: 'Dependency CVEs' },
  ];
  const measured = summary.attackSurfacesMeasured ?? 0;
  const total = summary.attackSurfacesTotal ?? 0;
  const perimeterNote =
    total > 4
      ? `${measured}/${total} measured (Cat 8 perimeter = 4; v2 adds authorization)`
      : `${measured}/${total} measured`;

  return `
    <div class="security-surface-grid">
      ${surfaceEntries
        .map(({ id, label }) => {
          const block = surfaces[id];
          const measured = block?.measured ?? block?.status ?? (id === 'authorization' ? 'extension' : '—');
          return `
            <article class="security-surface-card">
              <h4>${escapeHtml(label)}</h4>
              <p class="security-surface-status">${escapeHtml(String(measured))}</p>
              ${
                block?.findings?.length
                  ? `<p class="subtle">${block.findings.length} finding(s) in report</p>`
                  : '<p class="subtle">No confirmed findings in latest probe</p>'
              }
            </article>`;
        })
        .join('')}
      <article class="security-surface-card security-surface-summary">
        <h4>Probe summary</h4>
        <p><strong>${escapeHtml(perimeterNote)}</strong></p>
        <p class="subtle">${escapeHtml(String(summary.probesByStatus?.passed ?? 0))} probes passed · ${escapeHtml(String(summary.findings ?? 0))} latest findings</p>
      </article>
    </div>`;
}

export function renderTriageChips(view, helpers) {
  const { escapeHtml } = helpers;
  const t = view.triageCounts;
  const chips = [
    ['new', t.new ?? 0, 'fail'],
    ['known-open', t.knownOpen ?? 0, 'warn'],
    ['resolved', t.resolved ?? 0, 'pass'],
    ['regression', t.regression ?? 0, 'fail'],
  ];
  return chips
    .map(
      ([label, count, cls]) =>
        `<span class="test-chip ${cls} security-triage-chip" data-triage="${escapeHtml(label)}">${escapeHtml(label)}: ${count}</span>`
    )
    .join('');
}
