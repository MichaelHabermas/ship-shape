// Proof packet generation via fleetgraph:proof and artifact validation.
import { execFile } from 'child_process';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type {
  FleetGraphReviewerChain,
  FleetGraphReviewerProofResponse,
  FleetGraphReviewerProofVerdict,
} from '@ship/shared';
import type { Principal } from '../../security/principal.js';
import { publicReviewerChainProof } from './chain-build.js';
import {
  PROOF_COMMAND_ENV_ALLOWLIST,
  PROOF_OUTPUT_TAIL_LINES,
  ReviewerProofCommandError,
} from './constants.js';
import {
  bestFleetGraphReviewerProofChain,
  getFleetGraphReviewerChain,
} from './operations.js';
import type { ReviewerProofArtifact } from './types.js';

const execFileAsync = promisify(execFile);

export async function generateFleetGraphReviewerProof(input: {
  workspaceId: string;
  principal: Principal;
  chainId?: string;
}): Promise<FleetGraphReviewerProofResponse> {
  const chain = input.chainId
    ? await getFleetGraphReviewerChain({
        workspaceId: input.workspaceId,
        principal: input.principal,
        chainId: input.chainId,
      })
    : await bestFleetGraphReviewerProofChain({
        workspaceId: input.workspaceId,
        principal: input.principal,
      });
  if (!chain) {
    throw new Error('No FleetGraph reviewer chain is available for proof generation.');
  }

  const artifact = await runReviewerProofCommand(chain);

  return {
    verdict: artifact.verdict,
    generatedAt: new Date().toISOString(),
    chainId: chain.chainId,
    artifactPaths: {
      json: 'my-docs/evidence/fleetgraph-proof/latest.json',
      markdown: 'my-docs/evidence/fleetgraph-proof/latest.md',
      html: 'my-docs/evidence/fleetgraph-proof/latest.html',
      publicJson: 'web/public/fleetgraph-observability/proof/latest.json',
      publicMarkdown: 'web/public/fleetgraph-observability/proof/latest.md',
      publicHtml: 'web/public/fleetgraph-observability/proof/latest.html',
    },
  };
}

export function reviewerProofRepoRoot(): string {
  if (process.env.FLEETGRAPH_PROOF_REPO_ROOT) return process.env.FLEETGRAPH_PROOF_REPO_ROOT;
  return path.basename(process.cwd()) === 'api'
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

export function proofCommandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => PROOF_COMMAND_ENV_ALLOWLIST.has(key))
  );
  const testDatabaseUrl = env.FLEETGRAPH_PROOF_TEST_DATABASE_URL ?? fleetGraphProofTestDatabaseUrl(env.DATABASE_URL);
  if (testDatabaseUrl) {
    childEnv.FLEETGRAPH_PROOF_TEST_DATABASE_URL = testDatabaseUrl;
  }
  return childEnv;
}

async function runReviewerProofCommand(chain: FleetGraphReviewerChain): Promise<{ verdict: FleetGraphReviewerProofVerdict }> {
  const cwd = reviewerProofRepoRoot();
  const startedAt = new Date();
  try {
    await execFileAsync('pnpm', [
      'fleetgraph:proof',
      '--',
      '--mode',
      'local',
      '--no-refresh-evals',
      '--skip-tests',
    ], {
      cwd,
      timeout: 120_000,
      env: {
        ...proofCommandEnv(process.env),
        FLEETGRAPH_REVIEWER_CHAIN_ID: chain.chainId,
        FLEETGRAPH_REVIEWER_CHAIN_JSON: JSON.stringify(publicReviewerChainProof(chain)),
      },
    });
  } catch (err) {
    const artifact = await readProofArtifact(cwd, chain.chainId, startedAt);
    if (artifact?.verdict) {
      throw new ReviewerProofCommandError(`Proof packet verdict ${artifact.verdict}`, safeProofOutputTail(proofCommandOutput(err)));
    }
    throw reviewerProofCommandError(err);
  }
  const artifact = await readProofArtifact(cwd, chain.chainId, startedAt);
  if (!artifact?.verdict) {
    throw new ReviewerProofCommandError('Proof packet artifact was not written for the selected chain', []);
  }
  if (artifact.verdict !== 'pass') {
    throw new ReviewerProofCommandError(`Proof packet verdict ${artifact.verdict}`, []);
  }
  return { verdict: artifact.verdict };
}

function reviewerProofCommandError(err: unknown): ReviewerProofCommandError {
  const output = proofCommandOutput(err);
  const tail = safeProofOutputTail(output);
  const summary = tail.find((line) => line.includes('FleetGraph proof check failed:'))
    ?? tail.find((line) => line.startsWith('FleetGraph proof '))
    ?? (err instanceof Error && err.message ? err.message.split('\n')[0] ?? 'Proof packet command failed.' : 'Proof packet command failed.');
  return new ReviewerProofCommandError(summary, tail);
}

function proofCommandOutput(err: unknown): string {
  const stdout = typeof Reflect.get(Object(err), 'stdout') === 'string'
    ? Reflect.get(Object(err), 'stdout') as string
    : '';
  const stderr = typeof Reflect.get(Object(err), 'stderr') === 'string'
    ? Reflect.get(Object(err), 'stderr') as string
    : '';
  if (stdout || stderr) return `${stdout}\n${stderr}`;
  return err instanceof Error ? err.message : String(err);
}

function safeProofOutputTail(output: string): string[] {
  const secretEnvPattern = /(TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL|CONNECTION_STRING)/i;
  const envSecrets = Object.entries(process.env)
    .filter(([key, value]) => secretEnvPattern.test(key) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value as string);
  return output
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted database url]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL|CONNECTION_STRING)[A-Z0-9_]*)=\S+/gi, '$1=[redacted]')
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .split('\n')
    .map((line) => envSecrets.reduce((current, value) => current.replaceAll(value, '[redacted]'), line))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-PROOF_OUTPUT_TAIL_LINES);
}

function fleetGraphProofTestDatabaseUrl(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return undefined;
  try {
    const url = new URL(databaseUrl);
    url.pathname = '/ship_test_audit';
    return url.toString();
  } catch {
    return undefined;
  }
}

async function readProofArtifact(
  cwd: string,
  chainId: string,
  startedAt: Date
): Promise<ReviewerProofArtifact | null> {
  try {
    const artifactPath = path.join(cwd, 'my-docs/evidence/fleetgraph-proof/latest.json');
    const artifactStat = await stat(artifactPath);
    if (artifactStat.mtimeMs + 1000 < startedAt.getTime()) return null;
    const content = await readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(content) as ReviewerProofArtifact;
    if (parsed.reviewerChain?.chainId !== chainId) return null;
    if (!['pass', 'blocked', 'fail', 'risk'].includes(String(parsed.verdict))) return null;
    return parsed;
  } catch {
    return null;
  }
}
