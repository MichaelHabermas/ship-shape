#!/usr/bin/env node
// Ensures PlugForge platform, portal, SDK, CLI, and integration traffic cannot call LLM providers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const scanTargets = [
  'api/src/platform',
  'api/src/fleetgraph/public-api-client.ts',
  'api/src/fleetgraph/attention-context-factory.ts',
  'api/src/fleetgraph/attention-context-reader.ts',
  'sdk/src',
  'integrations',
  'web/src/lib/platform-apps-api.ts',
  'web/src/pages/DeveloperSettingsTab.tsx',
  'web/src/pages/DeveloperSettingsControls.tsx',
  'web/src/pages/OAuthConsent.tsx',
  'web/src/pages/OAuthDevice.tsx',
];
const forbiddenPatterns = [
  /@langchain\/openai/,
  /@aws-sdk\/client-bedrock-runtime/,
  /\bChatOpenAI\b/,
  /\bBedrockRuntimeClient\b/,
  /\bInvokeModelCommand\b/,
  /\bgenerateContextChatText\b/,
  /\bgenerateProactiveCreateText\b/,
  /\bOPENAI_API_KEY\b/,
  /\bFLEETGRAPH_MODEL\b/,
  /services\/ai-analysis/,
  /fleetgraph\/model/,
];
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const ignoredSegments = new Set(['node_modules', 'dist', 'build', 'coverage']);

const violations = [];
for (const target of scanTargets) {
  for (const filePath of sourceFiles(resolve(rootDir, target))) {
    const source = readFileSync(filePath, 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(source)) {
        violations.push(`${relative(rootDir, filePath)} matches ${pattern}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('PlugForge zero-LLM boundary failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`PlugForge zero-LLM boundary OK (${scanTargets.length} targets scanned)`);

function* sourceFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    if (sourceExtensions.has(extension(path))) yield path;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path)) {
    if (ignoredSegments.has(entry)) continue;
    yield* sourceFiles(join(path, entry));
  }
}

function extension(path) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}
