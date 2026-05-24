import { authSessionProbes } from '../probes/auth-session.mjs';
import { authorizationProbes } from '../probes/authorization.mjs';
import { websocketValidationProbes } from '../probes/websocket-validation.mjs';
import { inputSanitizationProbes } from '../probes/input-sanitization.mjs';
import { dependencyCveProbes } from '../probes/dependency-cves.mjs';
import { manualReviewProbes } from '../probes/manual-review.mjs';
import { abuseSurfaceProbes } from '../probes/abuse-surfaces.mjs';

/** Measured attack surfaces (Cat 8 four + authorization extension). */
export const MEASURED_SURFACE_COUNT = 5;

export const probeRegistry = [
  { id: 'auth-session', quick: true, needsLogin: true, surface: 'auth-session', run: authSessionProbes },
  { id: 'authorization', quick: true, needsLogin: true, surface: 'authorization', run: authorizationProbes },
  { id: 'websocket', quick: true, needsLogin: true, surface: 'websocket', run: websocketValidationProbes },
  { id: 'input', quick: true, needsLogin: true, surface: 'input', run: inputSanitizationProbes },
  { id: 'dependency', quick: false, needsLogin: false, surface: 'dependency', run: dependencyCveProbes },
  { id: 'manual', quick: true, needsLogin: true, surface: null, run: manualReviewProbes },
  { id: 'abuse', quick: true, needsLogin: true, surface: null, run: abuseSurfaceProbes },
];

export function selectedGroups(config) {
  return probeRegistry.filter((group) => {
    if (config.cat8Perimeter && group.id === 'authorization') return false;
    if (config.quick && !group.quick) return false;
    if (config.probe && group.id !== config.probe && !config.probe.startsWith(`${group.id}-`)) return false;
    return true;
  });
}
