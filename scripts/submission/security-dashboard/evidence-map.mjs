export function renderSecurityEvidenceMap(view, helpers) {
  const { escapeHtml, linkedPath, humanizeId, shortPath } = helpers;
  const categoryEvidence = view.category?.evidence || [];
  const preferred = [
    'cat8-baseline-comparison-json',
    'cat8-security-probe-final-report',
    'cat8-security-probe-final-markdown',
    'cat8-security-findings',
    'cat8-security-findings-ledger-generated',
    'cat8-security-probe-ci-gate',
    'cat8-before-file-size',
    'cat8-after-file-size',
    'cat8-before-file-headers',
    'cat8-after-file-headers',
    'cat8-before-ws-malformed',
    'cat8-after-ws-malformed',
    'cat8-after-ws-oversized',
  ];
  const rows = preferred
    .map((id) => categoryEvidence.find((item) => item.id === id))
    .filter(Boolean)
    .map(
      (item) => `
        <li data-ledger-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(humanizeId(item.id))}</strong>
          <span>${escapeHtml(item.description || '')}</span>
          <div class="artifact-link">${linkedPath(item.path, shortPath(item.path))}</div>
        </li>`
    )
    .join('');
  const extra = [
    linkedPath('my-docs/evidence/security-audit/cat8-audit-deliverable.json', 'cat8-audit-deliverable.json'),
    linkedPath('my-docs/Cat-8-Sec-Audit-and-Tool-plan.md', 'Cat-8 runbook'),
    linkedPath('packages/shipshape-security/README.md', 'shipshape-security README'),
  ].join(' · ');
  return `
    <ul class="check-list security-evidence-list">${rows}</ul>
    <p class="subtle">Also: ${extra}</p>`;
}
