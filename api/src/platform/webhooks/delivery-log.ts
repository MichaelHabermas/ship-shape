// Webhook delivery log types keep attempt fields aligned with the public contract.
export type WebhookDeliveryAttemptRecord = {
  subscription_id: string;
  event_id: string;
  attempt_number: number;
  response_status: number | null;
  response_excerpt: string | null;
  latency_ms: number | null;
};
