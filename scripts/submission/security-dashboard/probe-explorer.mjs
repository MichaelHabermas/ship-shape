import { securitySurfaceLabel } from './utils.mjs';

export function renderLatestFindings(view, helpers) {
  const { escapeHtml } = helpers;
  if (!view.latestFindings.length) {
    return '<p class="subtle">Latest probe reported zero confirmed findings.</p>';
  }
  return `
    <div class="table-wrap">
      <table class="security-latest-findings-table">
        <thead>
          <tr><th>Severity</th><th>Title</th><th>Probe</th><th>Reproduction</th></tr>
        </thead>
        <tbody>
          ${view.latestFindings
            .map((finding) => {
              const repro = finding.evidence?.reproduction || [];
              const reproHtml = repro.length
                ? `<ul class="security-repro-list">${repro.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul>`
                : escapeHtml(finding.observed || '—');
              return `
            <tr data-latest-finding-id="${escapeHtml(finding.id)}">
              <td><span class="impact-pill impact-${finding.severity === 'critical' || finding.severity === 'high' ? '5' : '3'}">${escapeHtml(finding.severity)}</span></td>
              <td>${escapeHtml(finding.title)}</td>
              <td><code>${escapeHtml(finding.probeId)}</code></td>
              <td>${reproHtml}</td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

export function renderProbeExplorer(view, helpers) {
  const { escapeHtml, linkedPath } = helpers;
  if (!view.probes.length) {
    return '<tr><td colspan="6">No probe rows were available from the latest security report.</td></tr>';
  }
  const bySurface = new Map();
  for (const probe of view.probes) {
    const surface = securitySurfaceLabel(probe.id);
    if (!bySurface.has(surface)) bySurface.set(surface, []);
    bySurface.get(surface).push(probe);
  }

  return [...bySurface.entries()]
    .map(([surface, probes]) => {
      const rows = probes
        .map((probe) => {
          const findingText = probe.findingIds?.length
            ? probe.findingIds.join(', ')
            : 'Passed — no confirmed finding';
          const details = probe.details ? JSON.stringify(probe.details, null, 2) : '';
          return `
            <tr data-probe-id="${escapeHtml(probe.id)}" class="security-probe-row">
              <td>${escapeHtml(probe.id)}</td>
              <td><span class="test-chip ${probe.status === 'passed' ? 'pass' : 'fail'}">${escapeHtml(probe.status || 'unknown')}</span></td>
              <td>${escapeHtml(String(probe.durationMs ?? '—'))} ms</td>
              <td>${escapeHtml(findingText)}</td>
              <td>${linkedPath('my-docs/evidence/security-audit/latest.json', 'latest.json')}</td>
              <td>
                <button type="button" class="security-expand-btn" data-probe-expand="${escapeHtml(probe.id)}" aria-expanded="false">Details</button>
              </td>
            </tr>
            ${
              details
                ? `<tr class="security-probe-detail-row" data-probe-detail="${escapeHtml(probe.id)}" hidden>
              <td colspan="6"><pre class="security-probe-pre">${escapeHtml(details)}</pre></td>
            </tr>`
                : ''
            }`;
        })
        .join('');
      return `
        <tbody data-surface-group="${escapeHtml(surface)}">
          <tr class="security-surface-header-row"><td colspan="6"><strong>${escapeHtml(surface)}</strong> (${probes.length} probes)</td></tr>
          ${rows}
        </tbody>`;
    })
    .join('');
}

export function renderProbeTableShell(view, helpers) {
  const body = renderProbeExplorer(view, helpers);
  return `
    <div class="table-wrap">
      <table class="security-probe-table">
        <thead>
          <tr>
            <th>Probe ID</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Findings</th>
            <th>Report</th>
            <th></th>
          </tr>
        </thead>
        ${body}
      </table>
    </div>`;
}
