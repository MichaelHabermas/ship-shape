// Public SDK errors normalize Ship API and OAuth failures for callers.
export type ShipErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'not_found'
  | 'validation'
  | 'network'
  | 'server';

export type ShipErrorData = {
  kind: ShipErrorKind;
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
  details?: unknown;
  retryAfter?: number;
};

export class ShipError extends Error implements ShipErrorData {
  readonly kind: ShipErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly retryAfter?: number;

  constructor(data: ShipErrorData) {
    super(data.message);
    this.name = 'ShipError';
    this.kind = data.kind;
    this.status = data.status;
    this.code = data.code;
    this.requestId = data.requestId;
    this.details = data.details;
    this.retryAfter = data.retryAfter;
  }
}
