/**
 * AWS Secrets Manager Service
 *
 * Provides secure storage and retrieval of sensitive credentials.
 * Used for CAIA OAuth credentials that can be configured via admin UI.
 *
 * Secret path convention: /ship/{env}/secret-name
 * Environment determined by process.env.ENVIRONMENT (defaults to 'prod')
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { logHotError } from '../utils/hot-log.js';

// Lazy-initialized client to avoid keeping Node.js alive during import tests
let _client: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  if (!_client) {
    _client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return _client;
}

/**
 * Get the environment-specific base path for secrets
 */
function getBasePath(): string {
  const environment = process.env.ENVIRONMENT || 'prod';
  return `/ship/${environment}`;
}

/**
 * CAIA OAuth credentials structure
 */
export interface CAIACredentials {
  issuer_url: string;
  client_id: string;
  client_secret: string;
}

/**
 * Result of credential fetch - includes metadata about the fetch
 */
export interface CAIACredentialsResult {
  credentials: CAIACredentials | null;
  configured: boolean;
  error?: string;
}

/**
 * Get CAIA OAuth credentials from Secrets Manager
 *
 * Returns null credentials if:
 * - Secret doesn't exist (will be created as empty)
 * - Secret exists but is empty/incomplete
 * - Secrets Manager is unreachable (fail closed)
 */
export async function getCAIACredentials(): Promise<CAIACredentialsResult> {
  const secretName = `${getBasePath()}/caia-credentials`;

  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await getClient().send(command);

    if (!response.SecretString) {
      return { credentials: null, configured: false };
    }

    const parsed = JSON.parse(response.SecretString) as Partial<CAIACredentials>;

    // Check if all required fields are present and non-empty
    if (!parsed.issuer_url || !parsed.client_id || !parsed.client_secret) {
      return { credentials: null, configured: false };
    }

    return {
      credentials: {
        issuer_url: parsed.issuer_url,
        client_id: parsed.client_id,
        client_secret: parsed.client_secret,
      },
      configured: true,
    };
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      await ensureSecretExists(secretName);
      return { credentials: null, configured: false };
    }

    // Secrets Manager failure - fail closed
    logHotError('secrets.caia', 'Failed to fetch CAIA credentials', err);
    return {
      credentials: null,
      configured: false,
      error: err instanceof Error ? err.message : 'Unknown error fetching credentials',
    };
  }
}

/**
 * Save CAIA OAuth credentials to Secrets Manager
 *
 * @throws Error if save fails
 */
export async function saveCAIACredentials(credentials: CAIACredentials): Promise<void> {
  const secretName = `${getBasePath()}/caia-credentials`;
  const secretValue = JSON.stringify(credentials);

  try {
    const command = new PutSecretValueCommand({
      SecretId: secretName,
      SecretString: secretValue,
    });
    await getClient().send(command);
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      const createCommand = new CreateSecretCommand({
        Name: secretName,
        SecretString: secretValue,
        Description: 'CAIA OAuth credentials for PIV authentication',
      });
      await getClient().send(createCommand);
      return;
    }
    logHotError('secrets.caia', 'Failed to save CAIA credentials', err);
    throw err;
  }
}

/**
 * Ensure the CAIA credentials secret exists (create empty if missing)
 * Called during bootstrap to ensure admin UI can save credentials
 */
async function ensureSecretExists(secretName: string): Promise<void> {
  try {
    const createCommand = new CreateSecretCommand({
      Name: secretName,
      SecretString: JSON.stringify({}),
      Description: 'CAIA OAuth credentials for PIV authentication',
    });
    await getClient().send(createCommand);
  } catch (err) {
    // Ignore if secret already exists (race condition)
    const awsErr = err as { name?: string };
    if (awsErr.name === 'ResourceExistsException') {
      return;
    }
    logHotError('secrets.caia', 'Failed to create CAIA credentials secret', err);
    // Don't throw - this is a bootstrap operation
  }
}

/**
 * Get the secret path for CAIA credentials (for display in admin UI)
 */
export function getCAIASecretPath(): string {
  return `${getBasePath()}/caia-credentials`;
}

/**
 * Compare two credential objects and return which fields changed
 * Used for audit logging
 */
export function getChangedFields(
  oldCreds: Partial<CAIACredentials> | null,
  newCreds: CAIACredentials
): string[] {
  const changed: string[] = [];

  if (!oldCreds) {
    // All fields are new
    return ['issuer_url', 'client_id', 'client_secret'];
  }

  if (oldCreds.issuer_url !== newCreds.issuer_url) {
    changed.push('issuer_url');
  }
  if (oldCreds.client_id !== newCreds.client_id) {
    changed.push('client_id');
  }
  if (oldCreds.client_secret !== newCreds.client_secret) {
    changed.push('client_secret');
  }

  return changed;
}
