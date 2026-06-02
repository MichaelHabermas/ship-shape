// Exact delivery attempt fields canon names. This is not the full database table
// shape; ids, replay metadata, and status modeling will be decided with storage.
export type WebhookDeliveryAttemptRecord = {
  subscription_id: string;
  event_id: string;
  attempt_number: number;
  response_status: number | null;
  response_excerpt: string | null;
  latency_ms: number | null;
};
