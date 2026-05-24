function formatDeliverableCell(value, escapeHtml, linkedPath) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return escapeHtml(value);
  if (typeof value === 'number' || typeof value === 'boolean') return escapeHtml(String(value));
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<span class="security-empty-metric">Probe ran; zero confirmed</span>';
    }
    return `<ul class="security-deliverable-list">${value
      .map((item) => {
        if (typeof item === 'string') return `<li>${escapeHtml(item)}</li>`;
        const title = item.title || item.id || item.metric || 'Finding';
        const severity = item.severity ? ` <span class="subtle">(${escapeHtml(item.severity)})</span>` : '';
        const probe = item.probe_id ? ` · ${escapeHtml(item.probe_id)}` : '';
        return `<li><strong>${escapeHtml(title)}</strong>${severity}${probe}</li>`;
      })
      .join('')}</ul>`;
  }
  if (typeof value === 'object') {
    const yesNo = value.yes ?? value.status;
    const details = value.details ?? value.detail ?? value.examples;
    const parts = [];
    if (yesNo !== undefined) parts.push(`<strong>${escapeHtml(String(yesNo))}</strong>`);
    if (details) parts.push(`<span class="subtle">${escapeHtml(String(details))}</span>`);
    if (value.count !== undefined) parts.push(`count: ${escapeHtml(String(value.count))}`);
    if (value.packages?.length) {
      parts.push(
        `<ul class="security-deliverable-list">${value.packages
          .slice(0, 8)
          .map(
            (pkg) =>
              `<li>${escapeHtml(pkg.name || pkg.package || 'package')}${
                pkg.application_features ? ` — ${escapeHtml(pkg.application_features.join(', '))}` : ''
              }</li>`
          )
          .join('')}</ul>`
      );
    }
    if (value.endpoints?.length) {
      parts.push(
        `<ul class="security-deliverable-list">${value.endpoints
          .map((endpoint) => `<li>${escapeHtml(String(endpoint))}</li>`)
          .join('')}</ul>`
      );
    }
    return parts.join(' ') || escapeHtml(JSON.stringify(value));
  }
  return escapeHtml(String(value));
}

function evidenceLinks(row, linkedPath) {
  const evidence = row?.evidence;
  if (!evidence || typeof evidence !== 'object') return '—';
  const links = Object.entries(evidence)
    .map(([label, path]) => (path ? linkedPath(path, label) : ''))
    .filter(Boolean);
  return links.length ? links.join(' · ') : '—';
}

export function renderDeliverableTable(view, helpers) {
  const { escapeHtml, linkedPath } = helpers;
  const table = view.deliverable?.table || [];
  const explanation = view.deliverable?.explanation?.empty_findings_mean;
  if (!table.length) {
    return '<p class="subtle">No cat8-audit-deliverable.json table found. Run shipshape-security baseline deliverable.</p>';
  }
  return `
    ${explanation ? `<div class="callout security-callout">${escapeHtml(explanation)}</div>` : ''}
    <div class="table-wrap">
      <table class="security-deliverable-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Baseline</th>
            <th>Current</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          ${table
            .map(
              (row) => `
            <tr data-metric="${escapeHtml(row.metric)}">
              <td><strong>${escapeHtml(row.metric)}</strong></td>
              <td>${formatDeliverableCell(row.baseline, escapeHtml, linkedPath)}</td>
              <td>${formatDeliverableCell(row.current, escapeHtml, linkedPath)}</td>
              <td>${evidenceLinks(row, linkedPath)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}
