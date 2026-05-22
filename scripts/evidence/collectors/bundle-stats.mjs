import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { notMeasured, optionalCollector, passed } from '../lib/collector.mjs';
import { exists, repoRelative, repoRoot, walkFiles } from '../lib/fs-utils.mjs';

function addExtensionStats(stats, extension, bytes) {
  const key = extension || '[none]';
  stats[key] ||= { files: 0, bytes: 0 };
  stats[key].files++;
  stats[key].bytes += bytes;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function findCurrentEntry(indexHtmlText) {
  const matches = [...indexHtmlText.matchAll(/<script\b[^>]*\bsrc=["']([^"']*\/index-[^"']+\.js)["'][^>]*>/gi)];
  const moduleMatch = matches.find((match) => /\btype=["']module["']/i.test(match[0]));
  const match = moduleMatch || matches[0];
  return match ? match[1].replace(/^\//, '') : null;
}

function renderBundleAnalysis({ currentEntry, jsStats, cssStats, topBuiltChunks }) {
  const rows = topBuiltChunks
    .map(
      (chunk) =>
        `<tr><td>${escapeHtml(chunk.path)}</td><td>${escapeHtml(chunk.extension || '')}</td><td>${chunk.bytes}</td><td>${chunk.gzipBytes ?? ''}</td></tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Bundle Analysis</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; color: #1f2937; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #d1d5db; padding: 8px; text-align: left; }
    th { background: #f3f4f6; }
    .stats { display: flex; gap: 24px; margin: 24px 0; }
  </style>
</head>
<body>
  <h1>Bundle Analysis</h1>
  <p>Current entry: <code>${escapeHtml(currentEntry || 'not found')}</code></p>
  <div class="stats">
    <section>
      <h2>JavaScript</h2>
      <p>${jsStats.count} chunks, ${jsStats.bytes} bytes</p>
    </section>
    <section>
      <h2>CSS</h2>
      <p>${cssStats.count} chunks, ${cssStats.bytes} bytes</p>
    </section>
  </div>
  <h2>Top Built Chunks</h2>
  <table>
    <thead><tr><th>Path</th><th>Type</th><th>Bytes</th><th>Gzip Bytes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

export async function collectBundleStats(context = {}) {
  const distDir = resolve(repoRoot, 'web/dist');

  return optionalCollector(
    'bundle-stats',
    'web/dist is missing; run pnpm build:web before measuring bundle output.',
    () => exists(distDir),
    async () => {
      const files = await walkFiles(distDir);
      if (files.length === 0) {
        return notMeasured('bundle-stats', 'web/dist exists but contains no files.', {
          distDir: repoRelative(distDir),
        });
      }

      const collectorsDir = context.runDir ? resolve(context.runDir, 'collectors') : null;
      const byExtension = {};
      const assets = [];
      let totalBytes = 0;
      let totalGzipBytes = 0;
      let totalJsBytes = 0;
      let totalCssBytes = 0;
      let jsChunkCount = 0;
      let cssChunkCount = 0;

      for (const file of files) {
        const fileStat = await stat(file);
        const bytes = fileStat.size;
        const extension = extname(file).toLowerCase();
        totalBytes += bytes;
        addExtensionStats(byExtension, extension, bytes);

        let gzipBytes = null;
        if (['.js', '.css', '.html', '.json', '.svg'].includes(extension)) {
          gzipBytes = gzipSync(await readFile(file)).length;
          totalGzipBytes += gzipBytes;
        }

        assets.push({
          path: repoRelative(file),
          name: basename(file),
          bytes,
          gzipBytes,
          extension: extension || null,
        });

        if (extension === '.js') {
          jsChunkCount++;
          totalJsBytes += bytes;
        } else if (extension === '.css') {
          cssChunkCount++;
          totalCssBytes += bytes;
        }
      }

      assets.sort((left, right) => right.bytes - left.bytes);
      const indexHtml = assets.find((asset) => asset.path === 'web/dist/index.html') || null;
      const indexHtmlText = indexHtml ? await readFile(resolve(repoRoot, indexHtml.path), 'utf8') : '';
      const currentEntry = findCurrentEntry(indexHtmlText);
      const currentEntryAsset = currentEntry
        ? assets.find((asset) => asset.path === `web/dist/${currentEntry}` || asset.path.endsWith(`/${currentEntry}`)) || null
        : null;
      const topBuiltChunks = assets
        .filter((asset) => asset.extension === '.js' || asset.extension === '.css')
        .slice(0, 10);
      const reportPath = collectorsDir ? resolve(collectorsDir, 'bundle-analysis.html') : null;
      const report = {
        path: reportPath ? repoRelative(reportPath) : null,
        title: 'Bundle Analysis',
      };

      if (reportPath) {
        await writeFile(
          reportPath,
          renderBundleAnalysis({
            currentEntry,
            jsStats: { count: jsChunkCount, bytes: totalJsBytes },
            cssStats: { count: cssChunkCount, bytes: totalCssBytes },
            topBuiltChunks,
          })
        );
      }

      const data = {
        distDir: repoRelative(distDir),
        fileCount: files.length,
        totalBytes,
        totalGzipBytes,
        totalJsBytes,
        totalCssBytes,
        jsChunkCount,
        cssChunkCount,
        byExtension,
        largestAssets: assets.slice(0, 10),
        topBuiltChunks,
        currentEntry,
        currentEntryAsset,
        indexHtml,
        report,
      };

      return passed(
        'bundle-stats',
        `Measured ${files.length} built files totaling ${totalBytes} bytes, including ${jsChunkCount} JS chunks and ${cssChunkCount} CSS chunks.`,
        data,
        [
          {
            id: 'bundle.dist-present',
            status: 'met',
            statement: 'web/dist exists and was measured.',
          },
          {
            id: 'bundle.index-html',
            status: indexHtml ? 'met' : 'failed',
            statement: indexHtml ? 'web/dist/index.html is present.' : 'web/dist/index.html is missing.',
          },
          {
            id: 'bundle.entry-js',
            status: currentEntryAsset ? 'met' : 'failed',
            statement: currentEntryAsset
              ? `Current entry JS was found at ${currentEntryAsset.path}.`
              : 'Current entry index-*.js could not be resolved from web/dist/index.html.',
          },
        ]
      );
    }
  );
}
