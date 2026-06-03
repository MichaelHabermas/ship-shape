import {
  FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS,
  scoreFleetGraphProductSurfaceCase,
  summarizeFleetGraphProductSurfaceResults,
  type FleetGraphProductSurfaceCase,
} from '../../fleetgraph/eval/product-surface.js';
import type {
  SurfaceEvalReport,
  SurfaceEvalSection,
  SurfaceEvalSectionId,
  SurfaceEvalResult,
} from './surface-eval-types.js';

export function buildSurfaceEvalReport(input: {
  generatedAt: string;
  currentCases: readonly FleetGraphProductSurfaceCase[];
  historicalCases: readonly FleetGraphProductSurfaceCase[];
}): SurfaceEvalReport {
  const currentResults = scoreCases(input.currentCases, 'current');
  const historicalResults = scoreCases(input.historicalCases, 'historical');
  const sections: SurfaceEvalSection[] = [
    {
      id: 'current',
      title: 'Current Surface',
      description: 'Fresh authored and runFleetGraph cases. This is the present-tense pass/fail signal.',
      summary: summarizeFleetGraphProductSurfaceResults(currentResults),
      results: currentResults,
    },
    {
      id: 'historical',
      title: 'Historical Persisted Samples',
      description: 'Older fleetgraph_runs.output_snapshot rows for trend review only. These do not affect the current headline.',
      summary: summarizeFleetGraphProductSurfaceResults(historicalResults),
      results: historicalResults,
    },
  ];
  const currentSection = sections.find((section) => section.id === 'current');
  if (!currentSection) throw new Error('Current product-surface eval section is missing');

  return {
    generatedAt: input.generatedAt,
    summary: currentSection.summary,
    sections,
    results: [...currentResults, ...historicalResults],
  };
}

function scoreCases(
  cases: readonly FleetGraphProductSurfaceCase[],
  section: SurfaceEvalSectionId
): SurfaceEvalResult[] {
  return cases.map((testCase) => ({
    ...scoreFleetGraphProductSurfaceCase(testCase),
    title: testCase.title,
    visibleCopy: [...testCase.input.visibleCopy],
    notes: testCase.notes,
    section,
  }));
}

export function sectionById(report: SurfaceEvalReport, id: SurfaceEvalSectionId): SurfaceEvalSection | undefined {
  return report.sections.find((section) => section.id === id);
}

export function markdownReport(report: SurfaceEvalReport): string {
  const lines = [
    '# FleetGraph Product Surface Eval',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Current Surface Summary',
    '',
    `- Pass: ${report.summary.passCount}`,
    `- Fail: ${report.summary.failCount}`,
    `- Historical persisted failures: ${sectionById(report, 'historical')?.summary.failCount ?? 0} (trend only)`,
    '',
    '| Dimension | Average |',
    '| --- | ---: |',
    ...FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS.map((dimension) =>
      `| ${dimension} | ${report.summary.average[dimension].toFixed(2)} |`
    ),
    '',
    '',
  ];

  for (const section of report.sections) {
    lines.push(
      `## ${section.title}`,
      '',
      section.description,
      '',
      `- Pass: ${section.summary.passCount}`,
      `- Fail: ${section.summary.failCount}`,
      '',
    );

    for (const result of section.results) {
      lines.push(
        `### ${result.caseId}`,
        '',
        result.title,
        '',
        'Visible copy:',
        '',
        '> ' + result.visibleCopy.join(' · '),
        '',
        `Status: ${result.pass ? 'pass' : `fail (${result.failedDimensions.join(', ')})`}`,
        '',
        '| Dimension | Score |',
        '| --- | ---: |',
        ...FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS.map((dimension) =>
          `| ${dimension} | ${result.scores[dimension]} |`
        ),
        '',
        'Notes:',
        ...result.notes.map((note) => `- ${note}`),
        '',
        'Human review:',
        '- TBD',
        '',
      );
    }
  }

  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char));
}

export function htmlReport(report: SurfaceEvalReport): string {
  const reportJson = JSON.stringify(report).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FleetGraph Product Surface Eval</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f0f; color: #f4f4f5; }
    body { margin: 0; padding: 24px; background: #0f0f0f; }
    main { max-width: 1120px; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    .muted { color: #a1a1aa; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 18px; }
    .tab { border: 1px solid #343434; background: #171717; color: #d4d4d8; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
    .tab[aria-selected="true"] { border-color: #0ea5e9; color: white; background: #0b2b3d; }
    .panel { display: none; }
    .panel.active { display: block; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .card { border: 1px solid #292929; background: #151515; border-radius: 8px; padding: 14px; }
    .copy { margin: 10px 0; color: #f4f4f5; line-height: 1.45; }
    .score { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid #262626; padding: 7px 0; font-size: 13px; }
    .bar { height: 6px; width: 86px; border-radius: 999px; background: #262626; overflow: hidden; }
    .fill { height: 100%; background: #10b981; }
    .fail .fill { background: #ef4444; }
    table { width: 100%; border-collapse: collapse; background: #151515; border: 1px solid #292929; border-radius: 8px; overflow: hidden; }
    th, td { border-bottom: 1px solid #292929; padding: 9px 10px; text-align: left; font-size: 13px; vertical-align: top; }
    th { color: #d4d4d8; background: #1c1c1c; }
    tr:last-child td { border-bottom: 0; }
    .pill { display: inline-flex; border: 1px solid #343434; border-radius: 999px; padding: 2px 7px; font-size: 12px; color: #d4d4d8; }
    .pass { border-color: #047857; color: #6ee7b7; }
    .failText { border-color: #991b1b; color: #fca5a5; }
    .note { color: #a1a1aa; font-size: 13px; line-height: 1.45; }
  </style>
</head>
<body>
<main>
  <h1>FleetGraph Product Surface Eval</h1>
  <div class="muted">Generated ${escapeHtml(report.generatedAt)} · current ${report.summary.passCount} pass · ${report.summary.failCount} fail</div>
  <nav class="tabs" aria-label="Review views">
    <button class="tab" data-tab="current" aria-selected="true">Current</button>
    <button class="tab" data-tab="historical" aria-selected="false">Historical</button>
    <button class="tab" data-tab="matrix" aria-selected="false">Score Matrix</button>
    <button class="tab" data-tab="failures" aria-selected="false">Failures</button>
    <button class="tab" data-tab="notes" aria-selected="false">Review Notes</button>
  </nav>
  <section id="current" class="panel active"></section>
  <section id="historical" class="panel"></section>
  <section id="matrix" class="panel"></section>
  <section id="failures" class="panel"></section>
  <section id="notes" class="panel"></section>
</main>
<script>
const report = ${reportJson};
const dimensions = ${JSON.stringify(FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS)};
function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function scoreRow(result, dimension) {
  const score = result.scores[dimension];
  const failing = result.failedDimensions.includes(dimension);
  return '<div class="score ' + (failing ? 'fail' : '') + '"><span>' + esc(dimension) + '</span><span class="bar"><span class="fill" style="width:' + (score * 25) + '%"></span></span><strong>' + score + '</strong></div>';
}
function sectionById(id) {
  return report.sections.find((section) => section.id === id) || { title: id, description: '', summary: { passCount: 0, failCount: 0 }, results: [] };
}
function cardsForSection(section) {
  return '<div class="card"><h2>' + esc(section.title) + '</h2><p class="muted">' + esc(section.description) + '</p><p class="muted">Pass ' + section.summary.passCount + ' · Fail ' + section.summary.failCount + '</p></div><div class="grid">' + section.results.map((result) => (
  '<article class="card"><div><span class="pill ' + (result.pass ? 'pass' : 'failText') + '">' + (result.pass ? 'pass' : 'fail') + '</span></div>' +
  '<h2>' + esc(result.caseId) + '</h2><p class="muted">' + esc(result.title) + '</p>' +
  '<p class="copy">' + esc(result.visibleCopy.join(' · ')) + '</p>' +
  dimensions.map((dimension) => scoreRow(result, dimension)).join('') +
  '<p class="note">' + result.notes.map(esc).join('<br>') + '</p></article>'
)).join('') + '</div>';
}
document.querySelector('#current').innerHTML = cardsForSection(sectionById('current'));
document.querySelector('#historical').innerHTML = cardsForSection(sectionById('historical'));
document.querySelector('#matrix').innerHTML = '<table><thead><tr><th>Case</th>' + dimensions.map((dimension) => '<th>' + esc(dimension) + '</th>').join('') + '</tr></thead><tbody>' +
  report.results.map((result) => '<tr><td>' + esc(result.caseId) + '</td>' + dimensions.map((dimension) => '<td>' + result.scores[dimension] + '</td>').join('') + '</tr>').join('') +
  '<tr><td><strong>Average</strong></td>' + dimensions.map((dimension) => '<td><strong>' + report.summary.average[dimension].toFixed(2) + '</strong></td>').join('') + '</tr></tbody></table>';
const failures = sectionById('current').results.filter((result) => !result.pass);
document.querySelector('#failures').innerHTML = failures.length === 0
  ? '<div class="card"><h2>No current failing cases</h2><p class="muted">All current product-surface cases met their thresholds. Historical rows are trend-only.</p></div>'
  : '<div class="grid">' + failures.map((result) => '<article class="card"><h2>' + esc(result.caseId) + '</h2><p class="copy">' + esc(result.visibleCopy.join(' · ')) + '</p><p class="muted">Failed: ' + esc(result.failedDimensions.join(', ')) + '</p></article>').join('') + '</div>';
document.querySelector('#notes').innerHTML = '<div class="card"><h2>Human review</h2><p class="note">Use <code>review-notes.md</code> beside this report to record judgment calls: accepted exceptions, copy that should be tighter, or places where the score is wrong and the rubric needs to evolve.</p></div>';
document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button)));
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tab));
}));
</script>
</body>
</html>`;
}
