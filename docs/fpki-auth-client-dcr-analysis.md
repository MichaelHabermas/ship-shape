# @fpki/auth-client SDK - DCR Integration Analysis

> **HISTORICAL DISCLAIMER:** This document records FPKI/OAuth DCR research that was **not implemented** in Ship. Production PIV authentication uses **CAIA** (`api/src/routes/caia-auth.ts`), not `@fpki/auth-client`. Treat the analysis below as background only. Ship does not currently have `api/src/routes/federation.ts`, `/api/federation/*`, or a vendored `@fpki/auth-client` integration.

## Overview

This document analyzes the @fpki/auth-client SDK's Dynamic Client Registration (DCR) exports and how they work together to enable RFC 7591 OAuth client registration with PIV card authentication.

## SDK Exports for DCR

### 1. `createFederationDiscoveryHandler(options)`

**Purpose:** Express middleware for server-side OIDC discovery that returns the registration endpoint.

**Location:** `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/dcr/discovery.ts`

**Function Signature:**
```typescript
function createFederationDiscoveryHandler(options?: {
  rejectUnauthorized?: boolean;  // Reject self-signed certs (default: false)
  internalUrl?: string;           // Internal URL for server-to-server communication
}): ExpressMiddleware
```

**What it does:**
1. Accepts POST request with `{ issuerUrl: string }` in body
2. Calls `discoverRegistrationEndpoint()` server-side (avoids browser cert trust issues)
3. Fetches `/.well-known/openid-configuration` from IdP
4. Returns `{ registrationEndpoint, discoveryDocument }` to browser

**Returns:**
- Express middleware function that handles POST requests
- Response: `{ registrationEndpoint: string, discoveryDocument: OIDCDiscoveryDocument }`
- Error response: `{ error: string }` (400 or 500 status)

**Why it exists:**
- Browser cannot fetch discovery document from IdPs with self-signed certs
- Server-side fetch bypasses browser certificate validation
- Separates mTLS registration from discovery (only registration needs PIV card)

---

### 2. `generateRsaKeypair(options)`

**Purpose:** Generate RSA keypair for `private_key_jwt` client authentication.

**Location:** `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/dcr/keypair.ts`

**Function Signature:**
```typescript
async function generateRsaKeypair(options?: {
  modulusLength?: number;  // 2048, 3072, or 4096 (default: 2048)
}): Promise<GeneratedKeypair>
```

**Returns:**
```typescript
interface GeneratedKeypair {
  privateKeyPem: string;    // PEM-encoded private key (PKCS8)
  publicKeyPem: string;     // PEM-encoded public key (SPKI)
  jwk: JsonWebKey;          // Public JWK (for JWKS endpoint)
  privateJwk: JsonWebKey;   // Private JWK (for signing)
}
```

**JWK Structure:**
```typescript
interface JsonWebKey {
  kty: "RSA";
  kid: string;      // Random UUID
  use: "sig";
  alg: "RS256";
  n: string;        // RSA modulus (base64url)
  e: string;        // RSA exponent (base64url)
  // Private JWK also includes: d, p, q, dp, dq, qi
}
```

**What it does:**
1. Generates RSA keypair using Node.js crypto
2. Exports keys in PEM format (PKCS8 private, SPKI public)
3. Creates JWK with random `kid` for key identification
4. Sets `use: 'sig'` and `alg: 'RS256'` for OAuth signing

**Usage flow:**
1. Called before client registration to create signing keypair
2. Private key stored in Secrets Manager
3. Public JWK sent to IdP during registration
4. Public JWK served at `/.well-known/jwks.json` for IdP to verify signatures

---

### 3. `getFederationPageHtml(options)`

**Purpose:** Generate HTML for the OAuth client registration UI.

**Location:** `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/templates/federation.ts`

**Function Signature:**
```typescript
function getFederationPageHtml(options?: {
  saveEndpoint?: string;          // Default: '/federation/save-credentials'
  generateKeyEndpoint?: string;   // Default: '/federation/generate-keypair'
  homeUrl?: string;               // Default: '/'
  issuerUrl?: string;             // Pre-fill IdP URL
  clientName?: string;            // Pre-fill app name
  redirectUri?: string;           // Pre-fill callback URI
  error?: string;                 // Display error message
  errorDescription?: string;      // Error details
}): string
```

**Returns:** Complete HTML page as string

**What the page does:**

#### Automatic Registration Flow (Recommended):
1. **Step 0:** Generate keypair (if using `private_key_jwt`)
   - Calls `POST /federation/generate-keypair`
   - Stores keypair temporarily in browser

2. **Step 1:** Server-side discovery
   - Calls `POST /federation/discover` with `{ issuerUrl }`
   - Gets `registration_endpoint` from IdP

3. **Step 2:** Browser mTLS registration
   - Builds registration request:
     ```json
     {
       "client_name": "My App",
       "redirect_uris": ["https://myapp.gov/auth/callback"],
       "scope": "openid profile",
       "token_endpoint_auth_method": "private_key_jwt",
       "jwks_uri": "https://myapp.gov/.well-known/jwks.json",
       "token_endpoint_auth_signing_alg": "RS256"
     }
     ```
   - POSTs to `registration_endpoint` with `credentials: 'include'` (triggers PIV prompt)
   - IdP validates admin's PIV cert via mTLS
   - Returns `{ client_id, client_secret }` (or just `client_id` for private_key_jwt)

4. **Step 3:** Save credentials locally
   - Calls `POST /federation/save-credentials` with:
     ```json
     {
       "clientId": "...",
       "tokenEndpointAuthMethod": "private_key_jwt",
       "privateKeyPem": "...",
       "privateKeyAlgorithm": "RS256",
       "publicJwk": { ... }
     }
     ```
   - Backend saves to Secrets Manager
   - Initializes OAuth client

#### Manual Entry Flow:
- Fallback for pre-registered clients
- Admin enters `client_id` and either `client_secret` or `private_key_pem`
- Calls same `save-credentials` endpoint

#### Auth Method Selection:
- **private_key_jwt** (Recommended):
  - More secure: private key never leaves server
  - Supports key rotation without IdP coordination
  - Requires serving `/.well-known/jwks.json`

- **client_secret_post**:
  - Simpler setup: just client_id and client_secret
  - Shared secret must be rotated carefully
  - No JWKS endpoint needed

---

### 4. `SecretsManagerCredentialStore`

**Purpose:** AWS Secrets Manager implementation of the `CredentialStore` interface.

**Location:** `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/stores/secrets-manager.ts`

**Class Signature:**
```typescript
class SecretsManagerCredentialStore implements CredentialStore {
  constructor(options?: {
    secretName?: string;   // Default: 'fpki-validator/oauth-credentials'
    region?: string;       // Default: process.env.AWS_REGION || 'us-east-1'
    endpoint?: string;     // For LocalStack/custom endpoints
  });

  async load(): Promise<StoredCredentials | null>;
  async save(credentials: StoredCredentials): Promise<boolean>;
  isAvailable(): boolean;
}
```

**StoredCredentials Interface:**
```typescript
interface StoredCredentials {
  clientId: string;
  tokenEndpointAuthMethod: 'private_key_jwt' | 'client_secret_post';

  // For client_secret_post:
  clientSecret?: string;

  // For private_key_jwt:
  privateKeyPem?: string;
  privateKeyAlgorithm?: 'RS256' | 'RS384' | 'RS512' | 'ES256' | ...;
  publicJwk?: JsonWebKey;
  jwksUri?: string;
}
```

**Secret Storage Format (JSON):**
```json
{
  "client_id": "my-app-a1b2c3d4",
  "token_endpoint_auth_method": "private_key_jwt",
  "private_key_pem": "-----BEGIN PRIVATE KEY-----\n...",
  "private_key_algorithm": "RS256",
  "public_jwk": {
    "kty": "RSA",
    "kid": "uuid-...",
    "use": "sig",
    "alg": "RS256",
    "n": "...",
    "e": "AQAB"
  }
}
```

**Methods:**

#### `load()`
- Fetches secret from AWS Secrets Manager
- Parses JSON and converts to `StoredCredentials` format
- Returns `null` if secret doesn't exist (ResourceNotFoundException)
- Lazy initializes AWS SDK (`@aws-sdk/client-secrets-manager`)

#### `save(credentials)`
- Converts `StoredCredentials` to JSON
- Updates existing secret or creates new one
- Adds tag: `{ Application: 'fpki-auth-client' }`
- Returns `true` on success, `false` on failure

#### `isAvailable()`
- Checks if AWS SDK is installed and client can be initialized
- Returns `false` if SDK missing or initialization fails

**Error Handling:**
- Lazy initialization: AWS SDK loaded on first use
- Graceful degradation: returns `null`/`false` if SDK unavailable
- Logs warnings but doesn't throw (allows app to work without Secrets Manager)

---

## How test-app Wires It Together

### Initialization Flow

**1. Load credentials from Secrets Manager:**
```javascript
const credentialStore = new SecretsManagerCredentialStore({
  secretName: 'fpki-validator/test-app-credentials',
});

const savedCreds = await credentialStore.load();
if (savedCreds) {
  CONFIG.clientId = savedCreds.clientId;
  CONFIG.tokenEndpointAuthMethod = savedCreds.tokenEndpointAuthMethod;

  if (savedCreds.tokenEndpointAuthMethod === 'private_key_jwt') {
    CONFIG.privateKeyPem = savedCreds.privateKeyPem;
    CONFIG.publicJwk = savedCreds.publicJwk;
  } else {
    CONFIG.clientSecret = savedCreds.clientSecret;
  }
}
```

**2. Initialize FPKIAuthClient:**
```javascript
authClient = new FPKIAuthClient({
  issuerUrl: CONFIG.fpkiIssuer,
  clientId: CONFIG.clientId,
  redirectUri: `${CONFIG.baseUrl}/auth/callback`,
  scopes: ['openid', 'profile'],
  tokenEndpointAuthMethod: CONFIG.tokenEndpointAuthMethod,

  // Method-specific config:
  privateKeyPem: CONFIG.privateKeyPem,        // for private_key_jwt
  privateKeyAlgorithm: CONFIG.privateKeyAlgorithm,
  publicJwk: CONFIG.publicJwk,

  // OR
  clientSecret: CONFIG.clientSecret,          // for client_secret_post

  trustSelfSigned: CONFIG.trustSelfSigned,
  authorizationEndpointOverride: CONFIG.fpkiAuthUrl,
});
```

### Federation Routes

**1. Federation page:**
```javascript
app.get('/federation', (req, res) => {
  res.send(getFederationPageHtml({
    redirectUri: `${CONFIG.baseUrl}/auth/callback`,
    clientName: 'PIV Test App',
    error: req.query.error,
    errorDescription: req.query.error_description,
  }));
});
```

**2. Discovery endpoint:**
```javascript
app.post('/federation/discover', createFederationDiscoveryHandler({
  rejectUnauthorized: true,
  internalUrl: CONFIG.fpkiInternalUrl
}));
```

**3. Keypair generation endpoint:**
```javascript
app.post('/federation/generate-keypair', async (req, res) => {
  const { privateKeyPem, jwk } = await generateRsaKeypair();
  res.json({ privateKeyPem, jwk });
});
```

**4. Save credentials endpoint:**
```javascript
app.post('/federation/save-credentials', async (req, res) => {
  const credentials = {
    clientId: req.body.clientId,
    tokenEndpointAuthMethod: req.body.tokenEndpointAuthMethod,
  };

  if (req.body.tokenEndpointAuthMethod === 'private_key_jwt') {
    credentials.privateKeyPem = req.body.privateKeyPem;
    credentials.privateKeyAlgorithm = req.body.privateKeyAlgorithm;
    credentials.publicJwk = req.body.publicJwk;
  } else {
    credentials.clientSecret = req.body.clientSecret;
  }

  await credentialStore.save(credentials);

  // Update in-memory config and reinitialize client
  CONFIG.clientId = credentials.clientId;
  CONFIG.tokenEndpointAuthMethod = credentials.tokenEndpointAuthMethod;
  // ...
  initializeAuthClient();

  res.json({ success: true });
});
```

**5. JWKS endpoint (for private_key_jwt):**
```javascript
app.get('/.well-known/jwks.json', (req, res) => {
  if (CONFIG.tokenEndpointAuthMethod !== 'private_key_jwt') {
    return res.status(404).json({ error: 'JWKS not available' });
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ keys: [CONFIG.publicJwk] });
});
```

### OAuth Login Flow (After Registration)

**1. Login initiation:**
```javascript
app.get('/auth/login', async (req, res) => {
  const { url, state, nonce, codeVerifier } = await authClient.getAuthorizationUrl();
  req.session.oauth = { state, nonce, codeVerifier };
  res.redirect(url);
});
```

**2. Callback handling:**
```javascript
app.get('/auth/callback', async (req, res) => {
  const stored = req.session.oauth;
  const { user, tokens } = await authClient.handleCallback(req.query, stored);

  req.session.user = {
    sub: user.sub,
    name: user.name,
    email: user.email,
    x509_issuer: user.x509Issuer,
    x509_subject: user.x509Subject,
    // ...
  };

  req.session.tokens = {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt,
    id_token: tokens.idToken,
  };

  res.redirect('/dashboard');
});
```

---

## What plane-treasury Needs to Implement

### Required Implementation (Must Do)

#### 1. Credential Store Initialization
```javascript
const credentialStore = new SecretsManagerCredentialStore({
  secretName: 'plane-treasury/oauth-credentials',
  region: process.env.AWS_REGION,
});
```

#### 2. Load Credentials at Startup
```javascript
const savedCreds = await credentialStore.load();
if (savedCreds) {
  // Populate config from stored credentials
  // Initialize FPKIAuthClient with loaded credentials
}
```

#### 3. Federation Routes (4 endpoints)
- `GET /federation` - Render registration page
- `POST /federation/discover` - Server-side OIDC discovery
- `POST /federation/generate-keypair` - Create RSA keypair
- `POST /federation/save-credentials` - Store credentials in Secrets Manager

#### 4. JWKS Endpoint (if using private_key_jwt)
- `GET /.well-known/jwks.json` - Serve public key for IdP verification

#### 5. Update Config After Registration
- Load new credentials into memory
- Reinitialize FPKIAuthClient with new config

### What the SDK Provides (Don't Re-implement)

#### Authentication Flow
- ✅ `FPKIAuthClient.getAuthorizationUrl()` - Generate auth URL with PKCE
- ✅ `FPKIAuthClient.handleCallback()` - Exchange code for tokens
- ✅ `FPKIAuthClient.refreshTokens()` - Refresh expired tokens
- ✅ `FPKIAuthClient.validateIdToken()` - Verify ID token signature

#### DCR Helpers
- ✅ `createFederationDiscoveryHandler()` - Discovery middleware
- ✅ `generateRsaKeypair()` - Keypair generation
- ✅ `getFederationPageHtml()` - Registration UI
- ✅ `getAuthErrorHtml()` - Error pages

#### Credential Storage
- ✅ `SecretsManagerCredentialStore` - AWS Secrets Manager integration
- ✅ Automatic secret creation/update
- ✅ JSON serialization/deserialization

#### Security Features
- ✅ PKCE (RFC 7636) for authorization code flow
- ✅ State parameter for CSRF protection
- ✅ Nonce for ID token replay protection
- ✅ Self-signed cert handling for development
- ✅ JWT signing for private_key_jwt authentication

---

## Configuration Requirements

### Environment Variables

```bash
# OAuth IdP Configuration
FPKI_ISSUER=https://api.fpki-validator.example.gov
FPKI_AUTH_URL=https://auth.fpki-validator.example.gov/oauth/authorize
FPKI_INTERNAL_URL=http://fpki-validator:8443  # Optional: Docker network

# Application Configuration
APP_BASE_URL=https://plane-treasury.example.gov
SESSION_SECRET=<random-secret>

# AWS Configuration (for Secrets Manager)
AWS_REGION=us-east-1
SECRETS_MANAGER_SECRET_NAME=plane-treasury/oauth-credentials

# OAuth Credentials (loaded from Secrets Manager after registration)
# These are populated automatically after /federation flow
OAUTH_CLIENT_ID=<auto-populated>
TOKEN_ENDPOINT_AUTH_METHOD=private_key_jwt
```

### Secrets Manager Secret Structure

**Secret Name:** `plane-treasury/oauth-credentials`

**Secret Value (JSON):**
```json
{
  "client_id": "plane-treasury-a1b2c3d4",
  "token_endpoint_auth_method": "private_key_jwt",
  "private_key_pem": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w...",
  "private_key_algorithm": "RS256",
  "public_jwk": {
    "kty": "RSA",
    "kid": "550e8400-e29b-41d4-a716-446655440000",
    "use": "sig",
    "alg": "RS256",
    "n": "xGOr...",
    "e": "AQAB"
  }
}
```

---

## Authentication Methods Comparison

### private_key_jwt (Recommended)

**Pros:**
- Private key never leaves server
- Supports key rotation without IdP coordination
- More secure: cryptographic proof of possession
- Standard in government/high-security environments

**Cons:**
- More complex setup: requires JWKS endpoint
- Must generate and manage keypair

**Setup:**
1. Generate RSA keypair during registration
2. Store private key in Secrets Manager
3. Send public JWK to IdP during registration
4. Serve public JWK at `/.well-known/jwks.json`
5. SDK signs `client_assertion` JWT at token request time

**Token Request:**
```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=abc123
&redirect_uri=https://myapp.gov/callback
&client_id=my-client
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=eyJhbGciOiJSUzI1NiIsImtpZCI6IjU1MGU4NDAwLi4uIn0.eyJpc3MiOiJteS1jbGllbnQiLCJzdWIiOiJteS1jbGllbnQiLCJhdWQiOiJodHRwczovL2lkcC9vYXV0aC90b2tlbiIsImlhdCI6MTY3MDAwMDAwMCwiZXhwIjoxNjcwMDAwMDYwfQ.signature
```

### client_secret_post

**Pros:**
- Simpler setup: no JWKS endpoint needed
- Easier to understand for developers
- Widely supported

**Cons:**
- Shared secret must be stored and rotated
- Less secure: static credential
- Cannot rotate without IdP coordination

**Setup:**
1. IdP generates `client_secret` during registration
2. Store `client_secret` in Secrets Manager
3. SDK sends secret in token request

**Token Request:**
```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=abc123
&redirect_uri=https://myapp.gov/callback
&client_id=my-client
&client_secret=super-secret-value
```

---

## Security Considerations

### 1. Secrets Management
- Use AWS Secrets Manager (not environment variables)
- Rotate secrets regularly
- Use IAM roles for Secrets Manager access (no hardcoded credentials)

### 2. Session Security
- Use `secure: true` cookies (HTTPS only)
- Set `httpOnly: true` to prevent XSS
- Implement session timeouts (absolute + inactivity)
- Use `sameSite: 'lax'` to prevent CSRF

### 3. OAuth Security
- SDK handles PKCE automatically (no action needed)
- SDK handles state verification (no action needed)
- SDK handles nonce verification (no action needed)
- Store OAuth state in server-side session (not localStorage)

### 4. TLS Configuration
- Require TLS 1.2+ in production
- Set `trustSelfSigned: false` in production
- Use valid certificates (Let's Encrypt, AWS ACM)

### 5. Key Rotation (private_key_jwt)
- Generate new keypair
- Add new key to JWKS endpoint (serve multiple keys)
- Update registration with new `jwks_uri`
- Remove old key after grace period

---

## Common Pitfalls

### 1. Docker Network URLs
**Problem:** Browser cannot reach `http://fpki-validator:8443` (Docker hostname)

**Solution:** Use `internalUrl` for server-to-server, external URL for browser redirects
```javascript
{
  issuerUrl: 'http://fpki-validator:8443',  // Server-to-server
  authorizationEndpointOverride: 'https://auth.fpki-validator.example.gov/oauth/authorize'  // Browser redirect
}
```

### 2. Self-Signed Certificates
**Problem:** Discovery fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**Solution:** Use `rejectUnauthorized: false` in development
```javascript
createFederationDiscoveryHandler({
  rejectUnauthorized: process.env.NODE_ENV === 'production'
})
```

### 3. Missing JWKS Endpoint
**Problem:** Token request fails with "Cannot verify client_assertion"

**Solution:** Serve public JWK at `/.well-known/jwks.json`
```javascript
app.get('/.well-known/jwks.json', (req, res) => {
  res.json({ keys: [CONFIG.publicJwk] });
});
```

### 4. Credentials Not Persisted
**Problem:** App forgets client_id after restart

**Solution:** Always load from Secrets Manager at startup
```javascript
const savedCreds = await credentialStore.load();
if (savedCreds) {
  CONFIG.clientId = savedCreds.clientId;
  // ...
}
```

### 5. Session Lost During Registration
**Problem:** OAuth state cleared before callback

**Solution:** Only clear OAuth state after successful token exchange
```javascript
const { user, tokens } = await authClient.handleCallback(req.query, stored);
delete req.session.oauth;  // Only delete AFTER success
```

---

## File Locations Reference

### SDK Files
- Discovery: `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/dcr/discovery.ts`
- Keypair: `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/dcr/keypair.ts`
- Templates: `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/templates/federation.ts`
- Store: `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/stores/secrets-manager.ts`
- Types: `/Users/neumankyle/coding/fpki-validator/packages/auth-client-node/src/types/index.ts`

### Example Implementation
- test-app: `/Users/neumankyle/coding/fpki-validator/test-app/server.js`

---
