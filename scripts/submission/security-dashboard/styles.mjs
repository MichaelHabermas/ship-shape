export function securityDashboardStyles() {
  return `
      .security-panel h3 { margin-top:18px; }
      .security-callout { margin:10px 0 12px; color:#34342f; font-size:13px; font-weight:750; }
      .security-action-bar { position:sticky; top:47px; z-index:9; display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:10px 12px; margin:0 0 12px; border:1px solid var(--line); background:color-mix(in srgb, var(--paper) 92%, transparent); backdrop-filter:blur(8px); }
      .security-action-bar .security-status-chips { display:flex; flex-wrap:wrap; gap:6px; flex:1 1 240px; }
      .security-action-bar .security-action-group { display:flex; flex-wrap:wrap; gap:6px; }
      .security-action-btn { appearance:none; border:1px solid var(--line); background:var(--paper); color:var(--dark); padding:7px 10px; font:inherit; font-size:12px; font-weight:800; cursor:pointer; }
      .security-action-btn:hover:not(:disabled) { border-color:var(--dark); }
      .security-action-btn:disabled { opacity:.55; cursor:not-allowed; }
      .security-action-btn.primary { background:var(--dark); border-color:var(--dark); color:#fffdf8; }
      .security-action-btn-danger { border-color:#8b2e2e; color:#8b2e2e; }
      .security-action-btn-danger.primary { background:#8b2e2e; border-color:#8b2e2e; color:#fffdf8; }
      .security-copy-btn { padding:2px 6px; font-size:10px; margin-left:6px; }
      .security-cli-list code { font-size:12px; }
      .security-console-toast { margin:6px 0 0; padding:6px 10px; background:var(--proven-bg); border:1px solid #b6d6b2; font-size:12px; font-weight:750; }
      .security-console-toast[hidden] { display:none; }
      .security-run-log-header { display:flex; justify-content:space-between; align-items:center; gap:8px; }
      .security-drawer-actions { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
      .security-narrative-editor { width:100%; min-height:200px; font:inherit; font-size:12px; padding:8px; border:1px solid var(--line); }
      .security-modal { position:fixed; inset:0; z-index:30; display:grid; place-items:center; background:rgba(21,21,21,.35); }
      .security-modal[hidden] { display:none; }
      .security-modal-inner { width:min(480px,92vw); padding:16px; background:var(--paper); border:1px solid var(--line); }
      .security-modal-inner h3 { margin:0 0 8px; }
      .security-modal-inner p { margin:0 0 12px; font-size:13px; color:#2d2d29; }
      .security-modal-actions { display:flex; justify-content:flex-end; gap:8px; }
      .security-action-btn.busy { opacity:.7; pointer-events:none; }
      .security-triage-chip { white-space:nowrap; }
      .security-metric-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); align-items:stretch; gap:7px; margin:12px 0; }
      .security-mini { min-height:76px; display:flex; flex-direction:column; }
      .security-mini span { display:block; color:var(--muted); font-size:11px; font-weight:850; text-transform:uppercase; }
      .security-mini strong { margin:8px 0 2px; font-size:18px; line-height:1.05; }
      .security-mini strong:first-of-type { margin-top:auto; }
      .security-mini small { display:block; color:var(--muted); font-size:11px; line-height:1.2; }
      .security-evidence-list { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .security-deliverable-table { min-width:900px; }
      .security-deliverable-list { margin:6px 0 0; padding-left:18px; color:#2d2d29; font-size:12px; }
      .security-empty-metric { color:var(--proven-ink); font-weight:750; font-size:12px; }
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
      .security-findings-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:end; margin:8px 0 10px; }
      .security-filter-label { display:grid; gap:4px; font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase; }
      .security-filter-input { min-width:160px; padding:7px 8px; border:1px solid var(--line); background:var(--paper); font:inherit; font-size:13px; }
      .security-finding-row { cursor:pointer; }
      .security-finding-row:focus-visible,.security-finding-row.is-selected { outline:2px solid var(--dark); outline-offset:-2px; background:#fff8df; }
      .security-findings-table th:nth-child(1),.security-findings-table td:nth-child(1) { width:122px; white-space:nowrap; }
      .security-findings-table th:nth-child(2),.security-findings-table td:nth-child(2) { width:118px; white-space:nowrap; }
      .security-findings-table th:nth-child(3),.security-findings-table td:nth-child(3) { width:92px; white-space:nowrap; }
      .security-findings-table th:nth-child(4),.security-findings-table td:nth-child(4) { width:78px; white-space:nowrap; }
      .security-findings-table th:nth-child(5),.security-findings-table td:nth-child(5) { width:245px; }
      .security-findings-table th:nth-child(6),.security-findings-table td:nth-child(6) { width:220px; }
      .security-findings-table th:nth-child(7),.security-findings-table td:nth-child(7) { width:440px; }
      .security-findings-table th:nth-child(8),.security-findings-table td:nth-child(8) { width:225px; }
      .security-findings-table td:nth-child(6) .path,.security-findings-table td:nth-child(7) .path,.security-findings-table td:nth-child(8) { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .security-findings-table .impact-pill { width:auto; min-width:66px; padding:3px 7px; }
      .security-repro-list { margin:0; padding-left:18px; font-size:12px; }
      .security-drawer { position:fixed; inset:0; z-index:20; display:grid; justify-content:end; background:rgba(21,21,21,.28); }
      .security-drawer[hidden] { display:none; }
      .security-drawer-inner { width:min(480px,100vw); height:100%; background:var(--paper); border-left:1px solid var(--line); display:grid; grid-template-rows:auto 1fr auto; }
      .security-drawer-header { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:14px; border-bottom:1px solid var(--line); }
      .security-drawer-header h3 { margin:0; font-size:18px; }
      .security-drawer-close { appearance:none; border:0; background:transparent; font-size:24px; line-height:1; cursor:pointer; }
      .security-drawer-body { padding:14px; overflow:auto; font-size:13px; color:#2d2d29; }
      .security-drawer-body .security-narrative { margin-top:12px; padding-top:12px; border-top:1px solid var(--line); }
      .security-drawer-footer { display:grid; gap:8px; padding:14px; border-top:1px solid var(--line); }
      .security-run-log { margin:12px 0 0; padding:12px; border:1px solid var(--line); background:#fbf8f0; }
      .security-run-log pre { margin:8px 0 0; max-height:240px; overflow:auto; padding:10px; background:#151515; color:#f6f4ef; font-size:11px; line-height:1.4; }
      .security-run-log.is-running pre { border:1px solid #e2c77f; }
      .security-console-hint { font-size:12px; color:var(--muted); }
      .security-open-console-link { font-weight:850; }
      @media (max-width: 1100px) { .security-metric-grid,.security-manual-grid,.security-surface-grid,.security-verified-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width: 960px) { .security-evidence-list,.security-manual-grid,.security-surface-grid,.security-verified-grid { grid-template-columns:1fr; } .security-action-bar { top:0; } }
      @media (max-width: 620px) { .security-metric-grid { grid-template-columns:1fr; } }`;
}
