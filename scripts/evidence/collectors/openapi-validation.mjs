import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { failed, passed } from '../lib/collector.mjs';
import { exists, readJson, repoRelative, repoRoot } from '../lib/fs-utils.mjs';

function validateOpenApiObject(document, sourcePath) {
  const problems = [];
  if (!document || typeof document !== 'object') problems.push('document is not an object');
  if (!document.openapi || typeof document.openapi !== 'string') problems.push('missing openapi version');
  if (!document.info?.title) problems.push('missing info.title');
  if (!document.info?.version) problems.push('missing info.version');
  if (!document.paths || typeof document.paths !== 'object') problems.push('missing paths object');

  return {
    path: repoRelative(sourcePath),
    openapi: document.openapi || null,
    title: document.info?.title || null,
    version: document.info?.version || null,
    pathCount: document.paths ? Object.keys(document.paths).length : 0,
    schemaCount: document.components?.schemas ? Object.keys(document.components.schemas).length : 0,
    problems,
  };
}

function parseYamlSummary(source) {
  const lines = source.split(/\r?\n/);
  const summary = {
    openapi: null,
    title: null,
    version: null,
    pathCount: 0,
  };

  let inInfo = false;
  let inPaths = false;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inInfo = line === 'info:';
      inPaths = line === 'paths:';
    }
    if (line.startsWith('openapi:')) summary.openapi = line.slice('openapi:'.length).trim();
    if (inInfo && /^  title:/.test(line)) summary.title = line.slice('  title:'.length).trim();
    if (inInfo && /^  version:/.test(line)) summary.version = line.slice('  version:'.length).trim();
    if (inPaths && /^  \/[^:]+:/.test(line)) summary.pathCount++;
  }

  return summary;
}

async function prettierCheck(path) {
  try {
    const prettier = await import('prettier');
    const source = await readFile(path, 'utf8');
    return {
      available: true,
      clean: await prettier.check(source, { filepath: path }),
    };
  } catch (error) {
    return {
      available: false,
      clean: null,
      error: error.message,
    };
  }
}

export async function collectOpenApiValidation() {
  const jsonPath = resolve(repoRoot, 'api/openapi.json');
  const yamlPath = resolve(repoRoot, 'api/openapi.yaml');
  const artifacts = [];
  const problems = [];

  if (await exists(jsonPath)) {
    try {
      const document = await readJson(jsonPath);
      const validation = validateOpenApiObject(document, jsonPath);
      artifacts.push({
        type: 'json',
        ...validation,
        prettier: await prettierCheck(jsonPath),
      });
      problems.push(...validation.problems.map((problem) => `${repoRelative(jsonPath)}: ${problem}`));
    } catch (error) {
      problems.push(`${repoRelative(jsonPath)}: ${error.message}`);
      artifacts.push({
        type: 'json',
        path: repoRelative(jsonPath),
        problems: [error.message],
        prettier: await prettierCheck(jsonPath),
      });
    }
  }

  if (await exists(yamlPath)) {
    try {
      const source = await readFile(yamlPath, 'utf8');
      const summary = parseYamlSummary(source);
      const yamlProblems = [];
      if (!summary.openapi) yamlProblems.push('missing openapi version');
      if (!summary.title) yamlProblems.push('missing info.title');
      if (!summary.version) yamlProblems.push('missing info.version');
      if (summary.pathCount === 0) yamlProblems.push('no paths detected');

      artifacts.push({
        type: 'yaml',
        path: repoRelative(yamlPath),
        ...summary,
        problems: yamlProblems,
        prettier: await prettierCheck(yamlPath),
      });
      problems.push(...yamlProblems.map((problem) => `${repoRelative(yamlPath)}: ${problem}`));
    } catch (error) {
      problems.push(`${repoRelative(yamlPath)}: ${error.message}`);
      artifacts.push({
        type: 'yaml',
        path: repoRelative(yamlPath),
        problems: [error.message],
        prettier: await prettierCheck(yamlPath),
      });
    }
  }

  if (artifacts.length === 0) {
    return failed('openapi-validation', 'No api/openapi.json or api/openapi.yaml artifact found.', {
      artifacts,
      problems: ['missing OpenAPI artifact'],
    });
  }

  const primary = artifacts.find((artifact) => artifact.type === 'json') || artifacts[0];
  const status = problems.length === 0 ? 'passed' : 'failed';
  const result = {
    artifacts,
    primaryArtifact: primary.path,
    pathCount: primary.pathCount,
    schemaCount: primary.schemaCount ?? null,
    problems,
  };
  const claims = [
    {
      id: 'openapi.artifact-present',
      status: 'met',
      statement: `Found ${artifacts.length} OpenAPI artifact(s).`,
    },
    {
      id: 'openapi.parseable',
      status: problems.length === 0 ? 'met' : 'failed',
      statement:
        problems.length === 0
          ? `Parsed OpenAPI metadata from ${primary.path}.`
          : `OpenAPI validation found ${problems.length} problem(s).`,
    },
    ...artifacts.map((artifact) => ({
      id: `openapi.prettier.${artifact.type}`,
      status: artifact.prettier.available ? (artifact.prettier.clean ? 'met' : 'failed') : 'not_measured',
      statement: artifact.prettier.available
        ? `${artifact.path} prettier check is ${artifact.prettier.clean ? 'clean' : 'not clean'}.`
        : `Prettier was unavailable for ${artifact.path}.`,
    })),
  ];

  return status === 'passed'
    ? passed('openapi-validation', `Validated ${primary.path} with ${primary.pathCount} paths.`, result, claims)
    : failed('openapi-validation', `OpenAPI validation found ${problems.length} problem(s).`, result, claims);
}
