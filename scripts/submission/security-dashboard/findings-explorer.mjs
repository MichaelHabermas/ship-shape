export function renderFindingsTable(view, helpers) {
  const { escapeHtml, linkedPath } = helpers;
  if (!view.findings.length) {
    return '<tr><td colspan="8">No findings in security-findings.json.</td></tr>';
  }
  return view.findings
    .map((finding) => {
      const verification = finding.lastVerification;
      const narrativePath = finding.narrativePath
        ? `my-docs/evidence/security-audit/${finding.narrativePath}`
        : '';
      const location = (finding.primaryLocations || []).join(', ');
      return `
        <tr class="security-finding-row">
          <td><strong>${escapeHtml(finding.id)}</strong></td>
          <td><span class="impact-pill impact-${finding.severity === 'critical' || finding.severity === 'high' ? '5' : '3'}">${escapeHtml(finding.severity || 'n/a')}</span></td>
          <td><span class="test-chip ${escapeHtml(helpers.securityStatusClass(finding.status))}">${escapeHtml(finding.status)}</span></td>
          <td>${escapeHtml(finding.activeLabel)}</td>
          <td>${escapeHtml([finding.owasp, finding.category].filter(Boolean).join(' / '))}</td>
          <td><span class="path" title="${escapeHtml(location)}">${escapeHtml(location)}</span></td>
          <td>${narrativePath ? linkedPath(narrativePath, finding.title || finding.id) : escapeHtml(finding.title || finding.id)}</td>
          <td>${escapeHtml(verification ? `${verification.result} · ${verification.runId || verification.method || verification.at}` : '—')}</td>
        </tr>`;
    })
    .join('');
}
