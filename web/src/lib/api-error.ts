export class ApiStatusError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiStatusError';
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function createApiStatusError(message: string, status: number, details?: unknown): ApiStatusError {
  return new ApiStatusError(message, status, details);
}

export function getApiErrorStatus(error: unknown): number | undefined {
  if (error instanceof ApiStatusError) {
    return error.status;
  }

  if (!(error instanceof Error) || !('status' in error)) {
    return undefined;
  }

  const status = Reflect.get(error, 'status');
  return typeof status === 'number' ? status : undefined;
}
