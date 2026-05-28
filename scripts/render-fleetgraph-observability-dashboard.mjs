// Renders the FleetGraph observability control-plane dashboard from local trial reports.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportRoot = path.join(repoRoot, 'my-docs/evals/fleetgraph-observability');
const datasetPath = path.join(reportRoot, 'datasets/edge-cases.json');
const outputPath = path.join(reportRoot, 'dashboard.html');

async function main() {
  const reports = await loadReports();
  const dataset = await loadDataset();
  const model = buildDashboardModel(reports, dataset);
  await writeFile(outputPath, html(model));
  console.log(outputPath);
}

async function loadReports() {
  const entries = await readdir(reportRoot);
  const files = entries
    .filter((entry) => /^run-.*\.json$/.test(entry))
    .sort();
  const reports = [];
  for (const file of files) {
    const raw = await readFile(path.join(reportRoot, file), 'utf8');
    reports.push({ file, ...JSON.parse(raw) });
  }
  return reports;
}

async function loadDataset() {
  try {
    return JSON.parse(await readFile(datasetPath, 'utf8'));
  } catch {
    return [];
  }
}

function buildDashboardModel(reports, dataset) {
  const latest = reports.at(-1);
  const traces = reports.flatMap((report) =>
    (report.traces ?? []).map((trace) => ({
      ...trace,
      reportFile: report.file,
      generatedAt: report.generatedAt,
      datasetReasons: dataset
        .filter((item) => item.sourceRunGeneratedAt === report.generatedAt && item.label === trace.label)
        .map((item) => item.reason),
    }))
  );
  const providers = ['langfuse', 'langsmith'];
  const providerStats = Object.fromEntries(providers.map((provider) => {
    const appearances = traces.filter((trace) => trace.providers?.some((entry) => entry.provider === provider));
    const failures = traces.filter((trace) =>
      trace.providers?.some((entry) => entry.provider === provider && entry.error) ||
      (trace.providerFailures ?? []).some((failure) => failure.toLowerCase().includes(provider))
    );
    const shared = traces.filter((trace) =>
      trace.providers?.some((entry) => entry.provider === provider && entry.sharedTraceUrl)
    );
    return [provider, {
      traces: appearances.length,
      failures: failures.length,
      sharedLinks: shared.length,
      coverage: traces.length > 0 ? appearances.length / traces.length : 0,
    }];
  }));

  const allScores = traces.flatMap((trace) => trace.scores ?? []);
  const scoreGroups = groupBy(allScores, (score) => score.name);
  const scoreSummary = Object.fromEntries(Object.entries(scoreGroups).map(([name, scores]) => [
    name,
    {
      passed: scores.filter((score) => score.passed).length,
      total: scores.length,
      average: avg(scores.map((score) => score.value)),
    },
  ]));

  return {
    generatedAt: new Date().toISOString(),
    latest,
    reports,
    traces,
    dataset,
    providerStats,
    scoreSummary,
    trends: reports.map((report) => ({
      generatedAt: report.generatedAt,
      traceCount: report.summary?.traceCount ?? 0,
      modelCalls: report.summary?.modelCalls ?? 0,
      totalTokens: report.summary?.totalTokens ?? 0,
      estimatedCostUsd: report.summary?.estimatedCostUsd ?? 0,
      scorePassed: report.summary?.scoreSummary?.passed ?? 0,
      scoreFailed: report.summary?.scoreSummary?.failed ?? 0,
      datasetItems: report.datasetItems?.length ?? 0,
    })),
  };
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] ??= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function avg(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function html(model) {
  const data = JSON.stringify(model).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FleetGraph Observability Control Plane</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #f4f1e8;
      --muted: #a7a99d;
      --line: #2c302b;
      --paper: #11140f;
      --panel: #171b15;
      --panel-2: #20251c;
      --green: #8fd16a;
      --amber: #e7b95f;
      --blue: #78a6ff;
      --red: #f06f66;
      --cyan: #7ed7d1;
      --violet: #b59cff;
      --shadow: 0 18px 60px rgba(0,0,0,.35);
      font-family: ui-sans-serif, Avenir Next, Avenir, Segoe UI, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px) 0 0/44px 44px,
        linear-gradient(0deg, rgba(255,255,255,.025) 1px, transparent 1px) 0 0/44px 44px,
        radial-gradient(circle at 20% 0%, rgba(126,215,209,.16), transparent 34rem),
        radial-gradient(circle at 80% 4%, rgba(231,185,95,.12), transparent 28rem),
        var(--paper);
    }
    a { color: inherit; }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: minmax(0,1fr) auto;
      gap: 18px;
      align-items: center;
      padding: 18px 24px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(17,20,15,.86);
      backdrop-filter: blur(18px);
    }
    h1 {
      margin: 0;
      font-size: clamp(24px, 3vw, 42px);
      letter-spacing: 0;
      line-height: 1;
      font-family: Georgia, Iowan Old Style, serif;
      font-weight: 700;
    }
    .subtitle { color: var(--muted); margin-top: 6px; font-size: 14px; }
    .top-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .chip, button, select {
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.055);
      color: var(--ink);
      border-radius: 6px;
      min-height: 34px;
      padding: 7px 10px;
      font: inherit;
      font-size: 13px;
    }
    button { cursor: pointer; }
    button[aria-pressed="true"] { border-color: var(--green); background: rgba(143,209,106,.18); }
    main { padding: 20px 24px 42px; display: grid; gap: 18px; max-width: 1680px; margin: 0 auto; }
    .grid { display: grid; gap: 14px; }
    .kpis { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .cols-2 { grid-template-columns: minmax(0, 1.15fr) minmax(360px, .85fr); }
    .cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .panel {
      border: 1px solid rgba(255,255,255,.10);
      background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.025));
      box-shadow: var(--shadow);
      border-radius: 8px;
      overflow: hidden;
    }
    .panel > .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 13px 14px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.035);
    }
    .head h2 { margin: 0; font-size: 14px; text-transform: uppercase; color: #d9ddce; letter-spacing: .08em; }
    .body { padding: 14px; }
    .kpi { min-height: 108px; padding: 14px; position: relative; }
    .kpi small { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .kpi strong { display: block; font-size: 30px; line-height: 1.05; margin-top: 10px; font-family: Georgia, Iowan Old Style, serif; }
    .kpi span { display: block; color: var(--muted); margin-top: 7px; font-size: 13px; }
    .good { color: var(--green); }
    .warn { color: var(--amber); }
    .bad { color: var(--red); }
    .info { color: var(--blue); }
    .table-wrap { overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,.08); text-align: left; vertical-align: top; font-size: 13px; }
    th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; background: rgba(255,255,255,.025); }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.055);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
      white-space: nowrap;
    }
    .pill.green { border-color: rgba(143,209,106,.35); color: var(--green); }
    .pill.amber { border-color: rgba(231,185,95,.38); color: var(--amber); }
    .pill.blue { border-color: rgba(120,166,255,.35); color: var(--blue); }
    .pill.red { border-color: rgba(240,111,102,.38); color: var(--red); }
    .trace-links { display: flex; flex-wrap: wrap; gap: 6px; }
    .trace-links a { text-decoration: none; }
    .path {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(132px, 1fr);
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .node {
      min-height: 96px;
      padding: 11px;
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 8px;
      background: rgba(255,255,255,.045);
      position: relative;
    }
    .node::after {
      content: "";
      position: absolute;
      right: -10px;
      top: 50%;
      width: 10px;
      border-top: 1px solid rgba(255,255,255,.22);
    }
    .node:last-child::after { display: none; }
    .node b { display: block; font-size: 13px; line-height: 1.25; overflow-wrap: anywhere; }
    .node small { color: var(--muted); display: block; margin-top: 8px; }
    .spark { width: 100%; height: 130px; display: block; }
    .bar-row { display: grid; grid-template-columns: 148px minmax(0,1fr) 58px; gap: 10px; align-items: center; margin: 9px 0; }
    .bar-track { height: 8px; background: rgba(255,255,255,.09); border-radius: 99px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, var(--green), var(--cyan)); }
    .score-list { display: grid; gap: 8px; }
    .dataset-list { display: grid; gap: 10px; max-height: 510px; overflow: auto; }
    .dataset-card { padding: 11px; border: 1px solid rgba(255,255,255,.09); border-radius: 8px; background: rgba(255,255,255,.035); }
    .dataset-card strong { display: block; margin-bottom: 7px; }
    .muted { color: var(--muted); }
    .view { display: none; }
    .view.active { display: grid; }
    .footer-note { color: var(--muted); font-size: 12px; text-align: right; }
    @media (max-width: 1180px) {
      .kpis, .cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cols-2 { grid-template-columns: 1fr; }
      header { grid-template-columns: 1fr; }
      .top-actions { justify-content: flex-start; }
    }
    @media (max-width: 680px) {
      main, header { padding-left: 14px; padding-right: 14px; }
      .kpis, .cols-3 { grid-template-columns: 1fr; }
      .kpi strong { font-size: 25px; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>FleetGraph Observability Control Plane</h1>
      <div class="subtitle">Neutral cockpit for LangGraph behavior, Langfuse traces, LangSmith runs, scores, costs, and edge-case learning.</div>
    </div>
    <div class="top-actions">
      <button type="button" class="tab" data-view="reviewer" aria-pressed="true">Reviewer</button>
      <button type="button" class="tab" data-view="engineer" aria-pressed="false">Engineer</button>
      <button type="button" class="tab" data-view="bakeoff" aria-pressed="false">Provider Bake-Off</button>
      <button type="button" class="tab" data-view="learning" aria-pressed="false">Learning Loop</button>
      <select id="runSelect" title="Select run"></select>
    </div>
  </header>
  <main>
    <section id="reviewer" class="view active"></section>
    <section id="engineer" class="view"></section>
    <section id="bakeoff" class="view"></section>
    <section id="learning" class="view"></section>
    <div class="footer-note">Generated ${escapeHtml(model.generatedAt)} from ${model.reports.length} reports and ${model.dataset.length} dataset items.</div>
  </main>
  <script id="dashboard-data" type="application/json">${data}</script>
  <script>
    const model = JSON.parse(document.getElementById('dashboard-data').textContent);
    let selectedReport = model.reports.at(-1);

    const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
    const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
    const runSelect = document.getElementById('runSelect');
    model.reports.slice().reverse().forEach((report) => {
      const option = document.createElement('option');
      option.value = report.generatedAt;
      option.textContent = new Date(report.generatedAt).toLocaleString() + ' · ' + report.summary.traceCount + ' traces';
      runSelect.appendChild(option);
    });
    runSelect.addEventListener('change', () => {
      selectedReport = model.reports.find((report) => report.generatedAt === runSelect.value) || model.reports.at(-1);
      renderAll();
    });
    document.querySelectorAll('.tab').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
        document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === button.dataset.view));
      });
    });

    function renderAll() {
      renderReviewer();
      renderEngineer();
      renderBakeoff();
      renderLearning();
    }

    function tracesForSelected() {
      return model.traces.filter((trace) => trace.generatedAt === selectedReport.generatedAt);
    }

    function providerLink(trace, providerName) {
      const provider = trace.providers.find((item) => item.provider === providerName);
      if (!provider) return '<span class="pill">missing</span>';
      const href = provider.sharedTraceUrl || provider.traceUrl;
      return '<a class="pill ' + (provider.sharedTraceUrl ? 'green' : 'amber') + '" href="' + escAttr(href) + '">' + providerName + '</a>';
    }

    function renderReviewer() {
      const traces = tracesForSelected();
      const failedScores = traces.flatMap((trace) => trace.scores.filter((score) => !score.passed));
      const providerFailures = traces.flatMap((trace) => [...(trace.providerFailures || []), ...(trace.scorePostFailures || [])]);
      document.getElementById('reviewer').innerHTML = [
        kpis([
          ['Traces', selectedReport.summary.traceCount, 'latest run'],
          ['Score Pass', selectedReport.summary.scoreSummary.passed + '/' + (selectedReport.summary.scoreSummary.passed + selectedReport.summary.scoreSummary.failed), failedScores.length ? 'attention needed' : 'all green', failedScores.length ? 'warn' : 'good'],
          ['Model Calls', selectedReport.summary.modelCalls, 'explicit spend only', selectedReport.summary.modelCalls ? 'info' : 'good'],
          ['Tokens', fmt.format(selectedReport.summary.totalTokens), 'latest run'],
          ['Cost', money.format(selectedReport.summary.estimatedCostUsd), 'estimated USD', selectedReport.summary.estimatedCostUsd ? 'info' : 'good'],
          ['Dataset Adds', selectedReport.datasetItems?.length || 0, 'learning loop'],
        ]),
        panel('Reviewer Flight Deck', '<div class="table-wrap">' + traceTable(traces) + '</div>'),
        '<div class="grid cols-2">' +
          panel('Trendline', sparkPanel()) +
          panel('Reviewer Signals', signalList(providerFailures, failedScores)) +
        '</div>',
      ].join('');
    }

    function renderEngineer() {
      const traces = tracesForSelected();
      const selectedTrace = traces.find((trace) => trace.decision === 'create_finding') || traces[0];
      document.getElementById('engineer').innerHTML = [
        '<div class="grid cols-2">' +
          panel('LangGraph Execution Map', graphPath(selectedTrace)) +
          panel('Score Matrix', scoreMatrix(traces)) +
        '</div>',
        panel('Trace Inventory', '<div class="table-wrap">' + traceTable(traces, true) + '</div>'),
      ].join('');
    }

    function renderBakeoff() {
      document.getElementById('bakeoff').innerHTML = [
        '<div class="grid cols-3">' +
          providerCard('Langfuse', model.providerStats.langfuse, 'Native trace scores, generation observations, dataset/experiment APIs.') +
          providerCard('LangSmith', model.providerStats.langsmith, 'Run feedback, shared runs, annotation queues, evaluation workflows.') +
          panel('Neutral Referee', '<p class="muted">Local reports are the source of truth when provider UIs disagree. Compare links per row, then use dataset items as regression seeds.</p>') +
        '</div>',
        panel('Side-by-Side Runs', '<div class="table-wrap">' + bakeoffTable(model.traces.slice().reverse()) + '</div>'),
      ].join('');
    }

    function renderLearning() {
      document.getElementById('learning').innerHTML = [
        kpis([
          ['Dataset Items', model.dataset.length, 'durable review/replay cases'],
          ['Provider Friction', model.dataset.filter((item) => item.reason === 'provider_failure').length, 'share/API rough edges', 'warn'],
          ['Model Cost Cases', model.dataset.filter((item) => item.reason === 'model_cost').length, 'spend examples', 'info'],
          ['Failed Score Cases', model.dataset.filter((item) => item.reason === 'failed_score').length, 'regression seeds', model.dataset.some((item) => item.reason === 'failed_score') ? 'bad' : 'good'],
          ['Reports', model.reports.length, 'history loaded'],
          ['Avg Score', fmt.format(model.latest.summary.scoreSummary.average), 'latest run', 'good'],
        ]),
        '<div class="grid cols-2">' +
          panel('Edge-Case Dataset', datasetList()) +
          panel('Score Health Across Runs', scoreHealth()) +
        '</div>',
      ].join('');
    }

    function kpis(items) {
      return '<div class="grid kpis">' + items.map(([label, value, note, tone]) =>
        '<article class="panel kpi"><small>' + esc(label) + '</small><strong class="' + (tone || '') + '">' + esc(String(value)) + '</strong><span>' + esc(note) + '</span></article>'
      ).join('') + '</div>';
    }

    function panel(title, body) {
      return '<section class="panel"><div class="head"><h2>' + esc(title) + '</h2></div><div class="body">' + body + '</div></section>';
    }

    function traceTable(traces, includePath = false) {
      return '<table><thead><tr><th>Run</th><th>Decision</th><th>Scores</th><th>Tokens</th><th>Cost</th><th>Dataset</th><th>Providers</th>' + (includePath ? '<th>Path</th>' : '') + '</tr></thead><tbody>' +
        traces.map((trace) => {
          const failed = trace.scores.filter((score) => !score.passed);
          const path = trace.traceMetadata?.nodePath || [];
          return '<tr><td><strong>' + esc(trace.label) + '</strong><br><span class="muted">' + esc(new Date(trace.generatedAt).toLocaleTimeString()) + '</span></td>' +
            '<td><span class="pill blue">' + esc(trace.decision) + '</span></td>' +
            '<td>' + (failed.length ? failed.map((score) => '<span class="pill red">' + esc(score.name) + '</span>').join(' ') : '<span class="pill green">all pass</span>') + '</td>' +
            '<td>' + esc(String(trace.tokenMetadata.totalTokens || 0)) + '</td>' +
            '<td>' + esc(String(trace.costMetadata.estimatedCostUsd || 0)) + '</td>' +
            '<td>' + (trace.datasetReasons.length ? trace.datasetReasons.map((reason) => '<span class="pill amber">' + esc(reason) + '</span>').join(' ') : '<span class="pill">none</span>') + '</td>' +
            '<td><div class="trace-links">' + providerLink(trace, 'langfuse') + providerLink(trace, 'langsmith') + '</div></td>' +
            (includePath ? '<td>' + esc(path.join(' -> ')) + '</td>' : '') +
            '</tr>';
        }).join('') + '</tbody></table>';
    }

    function graphPath(trace) {
      if (!trace) return '<p class="muted">No trace selected.</p>';
      const path = trace.traceMetadata?.nodePath || [];
      return '<p><span class="pill blue">' + esc(trace.label) + '</span> <span class="pill">' + esc(trace.decision) + '</span> <span class="pill ' + (trace.tokenMetadata.modelCalls ? 'blue' : 'green') + '">' + (trace.tokenMetadata.modelCalls ? 'model call' : 'no model') + '</span></p>' +
        '<div class="path">' + path.map((node, index) =>
          '<div class="node"><b>' + esc(node) + '</b><small>Step ' + (index + 1) + '</small>' + nodeBadge(node, trace) + '</div>'
        ).join('') + '</div>';
    }

    function nodeBadge(node, trace) {
      if (/reason/i.test(node) && trace.tokenMetadata.modelCalls) return '<small class="info">model + tokens</small>';
      if (/persist/i.test(node)) return '<small class="warn">state boundary</small>';
      if (/filter/i.test(node)) return '<small class="good">visibility gate</small>';
      return '';
    }

    function scoreMatrix(traces) {
      const scoreNames = [...new Set(traces.flatMap((trace) => trace.scores.map((score) => score.name)))];
      return '<div class="score-list">' + scoreNames.map((name) => {
        const scores = traces.flatMap((trace) => trace.scores.filter((score) => score.name === name));
        const value = scores.length ? scores.filter((score) => score.passed).length / scores.length : 0;
        return '<div class="bar-row"><span>' + esc(name) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + (value * 100) + '%"></span></span><span>' + Math.round(value * 100) + '%</span></div>';
      }).join('') + '</div>';
    }

    function bakeoffTable(traces) {
      return '<table><thead><tr><th>Run</th><th>Langfuse</th><th>LangSmith</th><th>Tokens/Cost</th><th>Scores</th><th>Dataset</th></tr></thead><tbody>' +
        traces.map((trace) => '<tr><td><strong>' + esc(trace.label) + '</strong><br><span class="muted">' + esc(trace.reportFile) + '</span></td>' +
          '<td>' + providerLink(trace, 'langfuse') + '</td>' +
          '<td>' + providerLink(trace, 'langsmith') + '</td>' +
          '<td>' + esc(String(trace.tokenMetadata.totalTokens || 0)) + ' / ' + esc(String(trace.costMetadata.estimatedCostUsd || 0)) + '</td>' +
          '<td>' + (trace.scores.every((score) => score.passed) ? '<span class="pill green">pass</span>' : '<span class="pill red">fail</span>') + '</td>' +
          '<td>' + (trace.datasetReasons.join(', ') || 'none') + '</td></tr>').join('') +
        '</tbody></table>';
    }

    function providerCard(name, stats, note) {
      return panel(name, '<div class="grid">' +
        '<div class="bar-row"><span>Coverage</span><span class="bar-track"><span class="bar-fill" style="width:' + Math.round(stats.coverage * 100) + '%"></span></span><span>' + Math.round(stats.coverage * 100) + '%</span></div>' +
        '<p><span class="pill green">' + stats.traces + ' traces</span> <span class="pill ' + (stats.failures ? 'amber' : 'green') + '">' + stats.failures + ' failures</span> <span class="pill blue">' + stats.sharedLinks + ' shared links</span></p>' +
        '<p class="muted">' + esc(note) + '</p></div>');
    }

    function sparkPanel() {
      const values = model.trends.map((trend) => trend.estimatedCostUsd);
      return '<svg class="spark" viewBox="0 0 620 130" role="img" aria-label="Cost over time">' + sparkPath(values) + '</svg>' +
        '<p class="muted">Cost trend across local observability runs. Hover provider trace links for deep inspection in the tables.</p>';
    }

    function sparkPath(values) {
      if (!values.length) return '';
      const max = Math.max(...values, .000001);
      const points = values.map((value, index) => {
        const x = values.length === 1 ? 20 : 20 + index * (580 / (values.length - 1));
        const y = 110 - (value / max) * 90;
        return [x, y];
      });
      const d = points.map(([x, y], index) => (index ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
      return '<path d="' + d + '" fill="none" stroke="#e7b95f" stroke-width="3"/>' +
        points.map(([x,y]) => '<circle cx="' + x + '" cy="' + y + '" r="4" fill="#8fd16a"/>').join('');
    }

    function signalList(providerFailures, failedScores) {
      return '<div class="score-list">' +
        '<p><span class="pill ' + (failedScores.length ? 'red' : 'green') + '">' + failedScores.length + ' failed scores</span></p>' +
        '<p><span class="pill ' + (providerFailures.length ? 'amber' : 'green') + '">' + providerFailures.length + ' provider failures</span></p>' +
        '<p class="muted">' + (providerFailures[0] ? esc(providerFailures[0]) : 'No provider friction on selected run.') + '</p>' +
      '</div>';
    }

    function datasetList() {
      if (!model.dataset.length) return '<p class="muted">No dataset items yet.</p>';
      return '<div class="dataset-list">' + model.dataset.slice().reverse().map((item) =>
        '<article class="dataset-card"><strong>' + esc(item.label) + '</strong>' +
        '<p><span class="pill amber">' + esc(item.reason) + '</span> <span class="pill blue">' + esc(item.decision) + '</span></p>' +
        '<p class="muted">' + esc((item.providerFailures || []).join('; ') || 'No provider failure. Captured for model cost / score history.') + '</p>' +
        '</article>'
      ).join('') + '</div>';
    }

    function scoreHealth() {
      return '<div class="score-list">' + Object.entries(model.scoreSummary).map(([name, summary]) => {
        const value = summary.total ? summary.passed / summary.total : 0;
        return '<div class="bar-row"><span>' + esc(name) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + (value * 100) + '%"></span></span><span>' + summary.passed + '/' + summary.total + '</span></div>';
      }).join('') + '</div>';
    }

    function esc(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function escAttr(value) { return esc(value); }
    renderAll();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
