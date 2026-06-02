// Public failure contract for /api/v1. Do not add route-specific codes here unless
// the public ApiError union changes; narrower machine reasons can live in details.
export type PublicApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'rate_limited'
  | 'server_error';

export type PublicApiError = {
  code: PublicApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
};
