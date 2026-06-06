// Repo paths for PlugForge reviewer packet generation and evidence loading.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptDir, '../../..');

export const evidenceRoot = path.join(repoRoot, 'my-docs/evidence');

export const integrationEvidenceDir = path.join(evidenceRoot, 'plugforge-integrations/live');

export const metricsEvidenceDir = path.join(evidenceRoot, 'plugforge-metrics');

export const packetOutputs = [
  path.join(repoRoot, 'web/public/plugforge-reviewer-packet.html'),
  path.join(repoRoot, 'my-docs/project-weeks-sot/week-6/plugforge-reviewer-packet.html'),
];

export const slackScreenshotSource = path.join(integrationEvidenceDir, 'slack-proof.png');

export const plugforgeEvidencePublicDir = path.join(repoRoot, 'web/public/plugforge-evidence');

export const deployedWebBase = 'https://ship-shape-web.onrender.com';

export const deployedApiBase = 'https://ship-shape-api.onrender.com';

export const ciWorkflowUrl = 'https://github.com/MichaelHabermas/ship-shape/actions/workflows/plugforge-submission.yml';
