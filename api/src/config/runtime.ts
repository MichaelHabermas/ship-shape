export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.E2E_TEST === '1';
}

export function isDevEnv(): boolean {
  return !isProduction();
}

export function isRenderProduction(): boolean {
  return isProduction() && process.env.ENVIRONMENT === 'render';
}

export function useS3Uploads(): boolean {
  return isProduction() && !!process.env.S3_UPLOADS_BUCKET;
}

export function databaseSslOptions(): boolean | { rejectUnauthorized: boolean } {
  return isProduction() ? { rejectUnauthorized: false } : false;
}
