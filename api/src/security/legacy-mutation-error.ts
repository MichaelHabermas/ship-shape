// Maps capability deny reasons to legacy route/service JSON error strings (404/403/Forbidden).
import { capabilityDenialStatus, type CapabilityDenyReason } from './capabilities.js';

export function legacyMutationErrorMessage(
  reason: CapabilityDenyReason | 'allowed',
  notFoundMessage = 'Not found'
): string {
  const status = capabilityDenialStatus(reason);
  if (status === 404) return notFoundMessage;
  if (reason === 'token_scope_denied') return 'token_scope_denied';
  return 'Forbidden';
}
