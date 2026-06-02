export type { ShipErrorData, ShipErrorKind } from './errors.js';

export type ShipClientOptions = {
  token: string;
};

// Contract anchor only; the storage method shape is not fixed yet.
export type ITokenStore = unknown;

// Resource client homes are canon; method surfaces are intentionally empty until
// OpenAPI-backed operations exist.
export type DocumentsClient = Record<string, never>;
export type IssuesClient = Record<string, never>;
export type SprintsClient = Record<string, never>;
export type WebhooksClient = Record<string, never>;

// Inert anchors must fail loudly until wired; no fake-green SDK behavior.
function notWired(name: string): never {
  throw new Error(`${name} is not wired yet.`);
}

export class ShipClient {
  readonly documents: DocumentsClient;
  readonly issues: IssuesClient;
  readonly sprints: SprintsClient;
  readonly webhooks: WebhooksClient;

  constructor(_opts: ShipClientOptions) {
    this.documents = {};
    this.issues = {};
    this.sprints = {};
    this.webhooks = {};
  }

  // MVP contract anchor; authenticated-user response shape is not fixed yet.
  async me(): Promise<unknown> {
    return notWired('ShipClient.me');
  }

  // Contract anchor only; the options shape is not fixed yet.
  static async authorizationCodeFlow(): Promise<ShipClient> {
    return notWired('ShipClient.authorizationCodeFlow');
  }

  // Contract anchor only; behavior is not wired yet.
  static async deviceLogin(_opts: {
    onUserCode: (code: string, verifyUrl: string) => void;
    tokenStore?: ITokenStore;
  }): Promise<ShipClient> {
    return notWired('ShipClient.deviceLogin');
  }
}

// Contract anchor only; signature verification is not wired yet.
export function verifyWebhook(
  _headers: Record<string, string>,
  _rawBody: string,
  _secret: string,
  _toleranceSec?: number
): boolean {
  return notWired('verifyWebhook');
}
