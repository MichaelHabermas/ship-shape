// OAuth provider facade re-exports grant flows; implementation lives in authorization-code, device-grant, and refresh modules.
export { OAuthProviderError } from './types.js';
export type {
  AuthorizationRequestInput,
  ApprovedAuthorizationRequest,
  CreatedAuthorizationRequest,
} from './types.js';

export {
  generateAuthorizationCode,
  generateRefreshToken,
  generateDeviceCode,
  generateUserCode,
  hashOAuthSecret,
} from './secrets.js';

export { parseOAuthScope } from './scopes.js';

export {
  createAuthorizationRequest,
  getConsentRequest,
  approveAuthorizationRequest,
} from './authorization-code.js';

export {
  createDeviceAuthorization,
  getDeviceVerificationRequest,
  approveDeviceAuthorization,
  exchangeDeviceCode,
} from './device-grant.js';

export { exchangeAuthorizationCode, rotateRefreshToken } from './refresh-rotation.js';
