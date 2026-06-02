// Public SDK error kind anchor. Add fields and any new kinds only when SDK
// request handling exists; keep consumers able to switch exhaustively.
export type ShipErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'not_found'
  | 'validation'
  | 'server';

export type ShipErrorData = {
  kind: ShipErrorKind;
};
