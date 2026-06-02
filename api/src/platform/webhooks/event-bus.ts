// Boundary name canon requires. Event payload shape stays generic until domain
// write paths publish real webhook events.
export interface IEventBus<TEvent = unknown> {
  publish(event: TEvent): Promise<void>;
}
