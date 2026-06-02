// Delivery boundary anchor. Transport details, retry scheduling, and persistence
// are not fixed by this interface.
export interface IWebhookDeliverer<TDelivery = unknown> {
  deliver(delivery: TDelivery): Promise<void>;
}
