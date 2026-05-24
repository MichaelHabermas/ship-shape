export function renderFindingsTable(view, helpers) {
  const { escapeHtml, linkedPath } = helpers;
  if (!view.findings.length) {
    return '<tr><td colspan="8">No known findings are recorded in security-findings.json.</td></tr>';
  }
  return view.findings
    .map((finding) => {
      const verification = finding.lastVerification;
      const narrativePath = finding.narrativePath
        ? `my-docs/evidence/security-audit/${finding.narrativePath}`
        : '';
      const location = (finding.primaryLocations || []).join(', ');
      const searchText = [finding.id, finding.title, finding.status, finding.severity, location, finding.category]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return `
        <tr
          class="security-finding-row"
          tabindex="0"
          role="button"
          data-finding-id="${escapeHtml(finding.id)}"
          data-status="${escapeHtml(finding.status)}"
          data-severity="${escapeHtml(finding.severity)}"
          data-active="${escapeHtml(finding.activeLabel)}"
          data-search="${escapeHtml(searchText)}"
        >
          <td><strong>${escapeHtml(finding.id)}</strong></td>
          <td><span class="impact-pill impact-${finding.severity === 'critical' || finding.severity === 'high' ? '5' : '3'}">${escapeHtml(finding.severity || 'n/a')}</span></td>
          <td><span class="test-chip ${escapeHtml(helpers.securityStatusClass(finding.status))}">${escapeHtml(finding.status)}</span></td>
          <td>${escapeHtml(finding.activeLabel)}</td>
          <td>${escapeHtml([finding.owasp, finding.category].filter(Boolean).join(' / '))}</td>
          <td><span class="path" title="${escapeHtml(location)}">${escapeHtml(location)}</span></td>
          <td>${narrativePath ? linkedPath(narrativePath, finding.title || finding.id) : escapeHtml(finding.title || finding.id)}</td>
          <td>${escapeHtml(verification ? `${verification.result} · ${verification.runId || verification.method || verification.at}` : 'not recorded')}</td>
        </tr>`;
    })
    .join('');
}

export function renderFindingsExplorerShell(view, helpers) {
  return `
    <div class="security-findings-toolbar">
      <label class="security-filter-label">
        <span>Search</span>
        <input type="search" id="security-finding-search" class="security-filter-input" placeholder="Filter findings (press /)" autocomplete="off" />
      </label>
      <label class="security-filter-label">
        <span>Status</span>
        <select id="security-finding-status-filter" class="security-filter-input">
          <option value="">All statuses</option>
          <option value="open">open</option>
          <option value="in-progress">in-progress</option>
          <option value="deferred">deferred</option>
          <option value="fixed">fixed</option>
          <option value="accepted_risk">accepted_risk</option>
        </select>
      </label>
      <label class="security-filter-label">
        <span>Active</span>
        <select id="security-finding-active-filter" class="security-filter-input">
          <option value="">All</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
          <option value="—">—</option>
        </select>
      </label>
      <span id="security-finding-count" class="subtle"></span>
    </div>
    <div class="table-wrap">
      <table class="security-findings-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Severity</th>
            <th>Status</th>
            <th>Active</th>
            <th>OWASP / Category</th>
            <th>Primary location</th>
            <th>Narrative</th>
            <th>Last verification</th>
          </tr>
        </thead>
        <tbody id="security-findings-tbody">${renderFindingsTable(view, helpers)}</tbody>
      </table>
    </div>
    <aside id="security-finding-drawer" class="security-drawer" hidden role="dialog" aria-modal="true" aria-labelledby="security-drawer-title">
      <div class="security-drawer-inner">
        <header class="security-drawer-header">
          <h3 id="security-drawer-title">Finding</h3>
          <button type="button" id="security-drawer-close" class="security-drawer-close" aria-label="Close detail">×</button>
        </header>
        <div id="security-drawer-body" class="security-drawer-body"></div>
        <footer class="security-drawer-footer">
          <label class="security-filter-label">
            <span>Set status (console server)</span>
            <select id="security-drawer-status" class="security-filter-input" disabled>
              <option value="open">open</option>
              <option value="in-progress">in-progress</option>
              <option value="deferred">deferred</option>
              <option value="fixed">fixed</option>
              <option value="accepted_risk">accepted_risk</option>
            </select>
          </label>
          <button type="button" id="security-drawer-save" class="security-action-btn" disabled>Save status</button>
        </footer>
      </div>
    </aside>`;
}
