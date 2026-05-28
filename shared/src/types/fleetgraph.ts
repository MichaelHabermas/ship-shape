// FleetGraph wire types shared between API and web clients.

export type FleetGraphChatAnswer = {
  title: string;
  body: string;
  nextStep?: string;
  sources: Array<{ label: string; kind: string }>;
  humanGate: Record<string, unknown>;
};
