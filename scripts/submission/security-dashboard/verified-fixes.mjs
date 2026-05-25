export function renderVerifiedFixes(view, helpers) {
  const { escapeHtml, linkedPath, humanizeId } = helpers;
  const fixes = view.category?.audit_deliverable?.verified_vulnerability_fixes || [];
  if (!fixes.length) {
    return '<p class="subtle">No verified vulnerability fixes recorded in the submission ledger.</p>';
  }
  return `
    <div class="security-verified-grid">
      ${fixes
        .map((fix, index) => {
          const proofText = typeof fix.proof === 'string' ? fix.proof : '';
          const proofPaths = [
            ...(fix.proof?.before ? [{ label: 'Before', path: fix.proof.before }] : []),
            ...(fix.proof?.after ? [{ label: 'After', path: fix.proof.after }] : []),
            ...(fix.evidence || []).map((item) => ({ label: humanizeId(item.id), path: item.path })),
          ].filter((item) => item.path);
          return `
            <article class="security-verified-card" data-fix-index="${index}">
              <header>
                <h4>${escapeHtml(fix.vulnerability_class || fix.title || `Fix ${index + 1}`)}</h4>
                ${fix.status ? `<span class="test-chip pass">${escapeHtml(fix.status)}</span>` : ''}
              </header>
              <dl class="security-verified-dl">
                <dt>Reproduction</dt>
                <dd>${escapeHtml(fix.reproduction_steps || fix.reproduction || '—')}</dd>
                <dt>Fix applied</dt>
                <dd>${escapeHtml(fix.fix_applied || fix.fix || '—')}</dd>
                <dt>Proof</dt>
                <dd>
                  ${proofText ? `<p>${escapeHtml(proofText)}</p>` : ''}
                  ${
                    proofPaths.length
                      ? `<ul class="check-list">${proofPaths
                          .map(
                            (item) =>
                              `<li><strong>${escapeHtml(item.label)}</strong><div class="artifact-link">${linkedPath(item.path, item.path)}</div></li>`
                          )
                          .join('')}</ul>`
                      : ''
                  }
                </dd>
              </dl>
            </article>`;
        })
        .join('')}
    </div>`;
}
