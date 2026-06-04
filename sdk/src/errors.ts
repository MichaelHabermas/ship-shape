// Public SDK errors normalize Ship API and OAuth failures for callers.
export type ShipErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'not_found'
  | 'validation'
  | 'network'
  | 'server';

type BaseShipErrorData<K extends ShipErrorKind> = {
  kind: K;
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
  details?: unknown;
  retryAfter?: number;
};

export type ShipAuthErrorData = BaseShipErrorData<'auth'>;
export type ShipRateLimitErrorData = BaseShipErrorData<'rate_limit'>;
export type ShipNotFoundErrorData = BaseShipErrorData<'not_found'>;
export type ShipValidationErrorData = BaseShipErrorData<'validation'>;
export type ShipNetworkErrorData = BaseShipErrorData<'network'>;
export type ShipServerErrorData = BaseShipErrorData<'server'>;
export type ShipErrorVariantData =
  | ShipAuthErrorData
  | ShipRateLimitErrorData
  | ShipNotFoundErrorData
  | ShipValidationErrorData
  | ShipNetworkErrorData
  | ShipServerErrorData;
export type ShipErrorData = BaseShipErrorData<ShipErrorKind>;

export class ShipError extends Error {
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
