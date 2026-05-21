import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { notMeasured, optionalCollector, passed } from '../lib/collector.mjs';
import { exists, repoRelative, repoRoot, walkFiles } from '../lib/fs-utils.mjs';

function addExtensionStats(stats, extension, bytes) {
  const key = extension || '[none]';
  stats[key] ||= { files: 0, bytes: 0 };
  stats[key].files++;
  stats[key].bytes += bytes;
}

export async function collectBundleStats() {
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

      const byExtension = {};
      const assets = [];
      let totalBytes = 0;
      let totalGzipBytes = 0;

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
          bytes,
          gzipBytes,
          extension: extension || null,
        });
      }

      assets.sort((left, right) => right.bytes - left.bytes);
      const indexHtml = assets.find((asset) => asset.path === 'web/dist/index.html') || null;
      const data = {
        distDir: repoRelative(distDir),
        fileCount: files.length,
        totalBytes,
        totalGzipBytes,
        byExtension,
        largestAssets: assets.slice(0, 10),
        indexHtml,
      };

      return passed(
        'bundle-stats',
        `Measured ${files.length} built files totaling ${totalBytes} bytes.`,
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
        ]
      );
    }
  );
}
