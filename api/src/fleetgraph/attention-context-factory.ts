// Factory selects in-process or HTTP loopback attention-context readers for FleetGraph.
import type { ShipClient } from '@ship/sdk';
import {
  HttpAttentionContextReader,
  InProcessAttentionContextReader,
  type AttentionContextReader,
} from './attention-context-reader.js';
import { createShipAgentPublicClient } from './public-api-client.js';

export type AttentionContextReaderMode = 'in_process' | 'http_loopback';

export async function createAttentionContextReader(input: {
  mode: AttentionContextReaderMode;
  workspaceId: string;
  viewerUserId: string;
  shipClient?: ShipClient;
}): Promise<AttentionContextReader> {
  if (input.mode === 'in_process') {
    return new InProcessAttentionContextReader();
  }
  if (input.shipClient) {
    return new HttpAttentionContextReader(input.shipClient);
  }
  const { client } = await createShipAgentPublicClient({
    workspaceId: input.workspaceId,
    userId: input.viewerUserId,
  });
  return new HttpAttentionContextReader(client);
}
