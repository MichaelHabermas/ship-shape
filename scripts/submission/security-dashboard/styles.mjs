export function securityDashboardStyles() {
  return `
      .security-panel h3 { margin-top:18px; }
      .security-lede { max-width:820px; color:#34342f; font-size:14px; }
      .security-reproduce { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:12px 0; padding:10px 12px; border:1px solid var(--line); background:#fbf8f0; font-size:13px; }
      .security-reproduce p { margin:0; color:#2d2d29; }
      .security-reproduce code { font-size:12px; }
      .security-signals { margin:0 0 12px; font-size:13px; color:#34342f; }
      .security-copy-btn { appearance:none; border:1px solid var(--line); background:var(--paper); padding:4px 8px; font:inherit; font-size:11px; font-weight:800; cursor:pointer; }
      .security-copy-btn:hover { border-color:var(--dark); }
      .security-copy-toast { margin:0; font-size:12px; color:var(--proven-ink); font-weight:750; }
      .security-copy-toast[hidden] { display:none; }
      .security-metric-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:7px; margin:0 0 12px; }
      .security-mini { min-height:64px; display:flex; flex-direction:column; padding:10px; border:1px solid var(--line); background:var(--paper); }
      .security-mini span { color:var(--muted); font-size:11px; font-weight:850; text-transform:uppercase; }
      .security-mini strong { margin-top:auto; font-size:17px; line-height:1.1; }
      .security-evidence-list { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .security-deliverable-table { min-width:900px; }
      .security-deliverable-list { margin:6px 0 0; padding-left:18px; color:#2d2d29; font-size:12px; }
      .security-manual-grid,.security-surface-grid,.security-verified-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:10px 0; }
      .security-manual-card,.security-surface-card,.security-verified-card { padding:12px; border:1px solid var(--line); background:#fbf8f0; }
      .security-manual-card header,.security-verified-card header { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; margin-bottom:8px; }
      .security-manual-card h4,.security-surface-card h4,.security-verified-card h4 { margin:0; font-size:14px; }
      .security-manual-card p,.security-surface-card p { margin:0; font-size:12px; color:var(--muted); }
      .security-surface-status { color:var(--dark); font-weight:800; }
      .security-surface-summary { background:var(--proven-bg); border-color:#b6d6b2; }
      .security-verified-dl { margin:0; font-size:12px; }
      .security-verified-dl dt { margin:8px 0 2px; color:var(--muted); font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
      .security-verified-dl dd { margin:0; color:#2d2d29; }
      .security-probe-table { min-width:980px; }
      .security-findings-table { table-layout:fixed; min-width:1540px; }
      .security-latest-findings-table { min-width:820px; }
      .security-probe-table th:nth-child(1),.security-probe-table td:nth-child(1) { width:260px; }
      .security-surface-header-row td { background:#f3efe6; font-size:12px; }
      .security-probe-pre { margin:0; padding:10px; max-height:220px; overflow:auto; background:#eee7da; border:1px solid #ded3c3; font-size:11px; line-height:1.35; white-space:pre-wrap; }
      .security-expand-btn { appearance:none; border:1px solid var(--line); background:var(--paper); padding:3px 8px; font-size:11px; font-weight:750; cursor:pointer; }
      .security-findings-table th:nth-child(1),.security-findings-table td:nth-child(1) { width:122px; white-space:nowrap; }
      .security-findings-table th:nth-child(2),.security-findings-table td:nth-child(2) { width:118px; white-space:nowrap; }
      .security-findings-table .impact-pill,.security-latest-findings-table .impact-pill { width:auto; padding:0 7px; white-space:nowrap; }
      .security-findings-table th:nth-child(3),.security-findings-table td:nth-child(3) { width:92px; white-space:nowrap; }
      .security-findings-table th:nth-child(4),.security-findings-table td:nth-child(4) { width:78px; white-space:nowrap; }
      .security-findings-table th:nth-child(5),.security-findings-table td:nth-child(5) { width:245px; }
      .security-findings-table th:nth-child(6),.security-findings-table td:nth-child(6) { width:220px; }
      .security-findings-table th:nth-child(7),.security-findings-table td:nth-child(7) { width:440px; }
      .security-findings-table th:nth-child(8),.security-findings-table td:nth-child(8) { width:225px; }
      .security-findings-table td:nth-child(6) .path,.security-findings-table td:nth-child(7) .path { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .security-repro-list { margin:0; padding-left:18px; font-size:12px; }
      @media (max-width: 1100px) { .security-metric-grid,.security-manual-grid,.security-surface-grid,.security-verified-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width: 960px) { .security-evidence-list,.security-manual-grid,.security-surface-grid,.security-verified-grid { grid-template-columns:1fr; } }
      @media (max-width: 620px) { .security-metric-grid { grid-template-columns:1fr; } }`;
}
