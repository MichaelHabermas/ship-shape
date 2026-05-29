// Checks changed TypeScript/JavaScript files with test-inclusive type-checking and strict ESLint.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowWarnings = process.argv.includes('--allow-warnings');
const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const typeExtensions = new Set(['.ts', '.tsx']);

const packageConfigs = [
  { name: 'api', root: 'api', tsconfig: 'api/tsconfig.json' },
  { name: 'web', root: 'web', tsconfig: 'web/tsconfig.json' },
  { name: 'shared', root: 'shared', tsconfig: 'shared/tsconfig.json' },
  { name: 'e2e', root: 'e2e', tsconfig: 'e2e/tsconfig.json' },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function changedFiles() {
  return [...new Set([
    ...capture('git', ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
    ...capture('git', ['ls-files', '--others', '--exclude-standard']),
  ])];
}

function isCodeFile(file) {
  return codeExtensions.has(path.extname(file)) && !file.endsWith('.d.ts');
}

function isTypeFile(file) {
  return typeExtensions.has(path.extname(file)) && !file.endsWith('.d.ts');
}

function packageFor(file) {
  return packageConfigs.find((config) => file === config.root || file.startsWith(`${config.root}/`));
}

function writeTempTsconfig(config, files) {
  const tempPath = path.join(repoRoot, config.root, '.tsconfig.affected.tmp.json');
  const packageRoot = path.join(repoRoot, config.root);
  const relativeFiles = files.map((file) => path.relative(packageRoot, path.join(repoRoot, file)));
  if (config.name === 'api' && !relativeFiles.includes('src/middleware/auth.ts')) {
    relativeFiles.push('src/middleware/auth.ts');
  }
  const compilerOptions = {
    noEmit: true,
    rootDir: undefined,
    outDir: undefined,
  };
  if (config.name === 'web') {
    compilerOptions.types = ['vite/client', 'node'];
  }
  writeFileSync(tempPath, JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions,
    include: relativeFiles,
    exclude: ['node_modules', 'dist', 'build'],
  }, null, 2));
  return tempPath;
}

const files = changedFiles();
const codeFiles = files.filter(isCodeFile);
const typeFiles = files.filter(isTypeFile);

if (codeFiles.length === 0) {
  console.log('No changed TS/JS files to check.');
  process.exit(0);
}

let exitCode = 0;
const typeFilesByPackage = new Map();
for (const file of typeFiles) {
  const config = packageFor(file);
  if (!config || !existsSync(path.join(repoRoot, config.tsconfig))) continue;
  const current = typeFilesByPackage.get(config) ?? [];
  current.push(file);
  typeFilesByPackage.set(config, current);
}

for (const [config, packageFiles] of typeFilesByPackage.entries()) {
  const tempTsconfig = writeTempTsconfig(config, packageFiles);
  console.log(`\nType-checking changed ${config.name} files, including tests.`);
  try {
    const status = run('pnpm', ['exec', 'tsc', '--noEmit', '-p', tempTsconfig]);
    if (status !== 0) exitCode = status;
  } finally {
    unlinkSync(tempTsconfig);
  }
}

console.log('\nBuilding @ship/shared so typed lint resolves current exports.');
const sharedBuildStatus = run('pnpm', ['build:shared']);
if (sharedBuildStatus !== 0) {
  process.exit(sharedBuildStatus);
}

console.log('\nLinting changed code files.');
const eslintArgs = ['exec', 'eslint', ...codeFiles.map((file) => path.join(repoRoot, file))];
if (!allowWarnings) eslintArgs.push('--max-warnings=0');
const lintStatus = run('pnpm', eslintArgs);
if (lintStatus !== 0) exitCode = lintStatus;

if (exitCode !== 0 && !allowWarnings) {
  console.error('\nChanged-file check failed. Fix the diagnostics or rerun with --allow-warnings only after explicitly accepting remaining warnings.');
}

process.exit(exitCode);
