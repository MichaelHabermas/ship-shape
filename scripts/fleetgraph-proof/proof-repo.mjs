// Shared FleetGraph proof script paths and default deployed target URLs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptDir, '../..');
export const outputRoot = path.join(repoRoot, 'my-docs/evidence/fleetgraph-proof');
export const runsRoot = path.join(outputRoot, 'runs');
export const publicProofRoot = path.join(repoRoot, 'web/public/fleetgraph-observability/proof');
export const defaultDeployedApiUrl = 'https://ship-shape-api.onrender.com';
export const defaultDeployedWebUrl = 'https://ship-shape-web.onrender.com';
