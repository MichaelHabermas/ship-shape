#!/usr/bin/env node
// Report-only SDK bundle probe: uses esbuild when installed, then records minified and gzipped byte sizes.
import { gzipSync } from 'node:zlib';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { nowIso, parseArgs, rootDir, writeJsonReport } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const entryPoint = path.join(rootDir, 'sdk', 'src', 'index.ts');
const requireFromRoot = createRequire(path.join(rootDir, 'package.json'));

let report;

try {
  const esbuildPath = requireFromRoot.resolve('esbuild');
  const esbuildModule = await import(pathToFileURL(esbuildPath));
  const esbuild = esbuildModule.default ?? esbuildModule;
  const external = String(args.external ?? '@ship/shared')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!external.includes('node:*')) external.push('node:*');
  const platform = String(args.platform ?? 'browser');

  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform,
    target: String(args.target ?? 'es2022'),
    external,
    metafile: true,
    logLevel: 'silent',
  });
  const output = result.outputFiles[0].contents;
  const bytes = output.byteLength;
  const gzipBytes = gzipSync(output).length;

  report = {
    metric: 'sdk-minified-gzip-size',
    status: 'measured',
    ok: true,
    generatedAt: nowIso(),
    durationMs: Date.now() - startedAt,
    input: {
      entryPoint: path.relative(rootDir, entryPoint),
      bundler: 'esbuild',
      platform,
      target: String(args.target ?? 'es2022'),
      external,
    },
    result: {
      minifiedBytes: bytes,
      gzipBytes,
    },
    metafile: result.metafile,
  };
} catch (error) {
  report = {
    metric: 'sdk-minified-gzip-size',
    status: 'not_measured',
    ok: false,
    generatedAt: nowIso(),
    durationMs: Date.now() - startedAt,
    reason: 'esbuild is not installed or could not bundle sdk/src/index.ts.',
    error: error instanceof Error ? error.message : String(error),
    input: {
      entryPoint: path.relative(rootDir, entryPoint),
      expectedBundler: 'esbuild',
    },
  };
}

const outputPath = await writeJsonReport('sdk-size.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exitCode = 0;
