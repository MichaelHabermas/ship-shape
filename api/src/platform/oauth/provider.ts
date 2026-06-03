// OAuth provider facade re-exports grant flows from focused submodules for stable imports.
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
  exchangeAuthorizationCode,
} from './authorization-code.js';

export {
  createDeviceAuthorization,
  getDeviceVerificationRequest,
  approveDeviceAuthorization,
  exchangeDeviceCode,
} from './device-grant.js';

export { rotateRefreshToken } from './refresh-rotation.js';
