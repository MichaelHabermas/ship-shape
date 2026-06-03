// Public failure contract for /api/v1. Do not add route-specific codes here unless
// the public ApiError union changes; narrower machine reasons can live in details.
import type { Response } from 'express';
import type { PublicApiError } from '@ship/shared';

export function sendPublicApiError(
  res: Response,
  status: number,
  error: PublicApiError
): void {
  res.status(status).json(error);
}
