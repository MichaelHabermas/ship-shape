import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { passed } from '../lib/collector.mjs';
import { exists, readJson, repoRelative, repoRoot } from '../lib/fs-utils.mjs';

async function packageSummary(dir) {
  const path = resolve(repoRoot, dir, 'package.json');
  if (!(await exists(path))) return null;
  const pkg = await readJson(path);
  return {
    path: repoRelative(path),
    name: pkg.name || null,
    version: pkg.version || null,
    private: Boolean(pkg.private),
    scripts: Object.keys(pkg.scripts || {}).sort(),
    dependencies: Object.keys(pkg.dependencies || {}).sort(),
    devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
  };
}

export async function collectRepoMetadata() {
  const rootPackage = await readJson(resolve(repoRoot, 'package.json'));
  const workspacePackageDirs = ['api', 'web', 'shared'];
  const workspacePackages = (await Promise.all(workspacePackageDirs.map(packageSummary))).filter(Boolean);
  const docs = await readdir(resolve(repoRoot, 'docs'), { withFileTypes: true });

  const data = {
    repository: repoRelative(repoRoot) || '.',
    packageManager: rootPackage.packageManager || null,
    engines: rootPackage.engines || {},
    rootScripts: Object.keys(rootPackage.scripts || {}).sort(),
    workspacePackages,
    docs: docs
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => `docs/${entry.name}`)
      .sort(),
  };

  return passed(
    'repo-metadata',
    `Captured ${workspacePackages.length} workspace packages and ${data.docs.length} top-level docs.`,
    data,
    [
      {
        id: 'repo.package-manager',
        status: data.packageManager ? 'met' : 'failed',
        statement: data.packageManager
          ? `Root package manager is ${data.packageManager}.`
          : 'Root package manager is not declared.',
      },
      {
        id: 'repo.workspace-packages',
        status: workspacePackages.length > 0 ? 'met' : 'failed',
        statement: `Workspace package metadata captured for ${workspacePackages.length} packages.`,
      },
    ]
  );
}
