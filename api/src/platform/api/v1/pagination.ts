// Cursor contract anchor only. Encoding, validation, and stability behavior are
// still implementation work; every public list response keeps this envelope.
export type PublicCursorPayload = {
  id: string;
  timestamp: string;
};

export type PublicListResponse<T> = {
  data: T[];
  next_cursor: string | null;
};
