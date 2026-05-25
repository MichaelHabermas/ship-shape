import type { Response } from 'express';
import type { ZodError } from 'zod';

export function sendValidationError(res: Response, zodError: ZodError): void {
  res.status(400).json({ error: 'Invalid input', details: zodError.errors });
}

export function sendLegacyError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

export function sendInternalError(
  res: Response,
  err: unknown,
  context: string,
  body?: Record<string, unknown>,
): void {
  console.error(`${context}:`, err);
  res.status(500).json(body ?? { error: 'Internal server error' });
}

export function errorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}
