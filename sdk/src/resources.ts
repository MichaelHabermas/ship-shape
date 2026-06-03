// SDK resource clients map Ship public API namespaces to typed request helpers.
import { PUBLIC_API_RELATIVE_PATHS } from '@ship/shared';
import type {
  CursorPage as Page,
  PublicDocument,
  PublicDocumentCreateInput as DocumentCreateInput,
  PublicDocumentListParams as DocumentListParams,
  PublicFleetGraphAttentionContextListParams as FleetGraphAttentionContextListParams,
  PublicFleetGraphAttentionContextsListResponse,
  PublicIssue,
  PublicIssueCreateInput as IssueCreateInput,
  PublicIssueExternalLink as IssueExternalLink,
  PublicIssueExternalLinkInput as IssueExternalLinkInput,
  PublicIssueListParams as IssueListParams,
  PublicIssueUpdateInput as IssueUpdateInput,
  PublicSprint,
  PublicSprintIssueListParams as SprintIssueListParams,
  PublicSprintListParams as SprintListParams,
  PublicWebhookDelivery as WebhookDelivery,
  PublicWebhookListParams as WebhookListParams,
  PublicWebhookSubscription as WebhookSubscription,
  PublicWebhookSubscriptionCreated as WebhookSubscriptionCreated,
  WebhookEventType,
} from '@ship/shared';
import { ShipError } from './errors.js';
import type { ShipClient } from './index.js';

const P = PUBLIC_API_RELATIVE_PATHS;

function pathWithId(template: string, id: string): string {
  return template.replace(':id', encodeURIComponent(id));
}

export class DocumentsClient {
  constructor(private readonly client: ShipClient) {}

  list(params: DocumentListParams = {}): Promise<Page<PublicDocument>> {
    return this.client.request<Page<PublicDocument>>('GET', P.documents, { query: params });
  }

  get(id: string): Promise<PublicDocument> {
    return this.client.request<PublicDocument>('GET', pathWithId(P.document, id));
  }

  create(input: DocumentCreateInput): Promise<PublicDocument> {
    return this.client.request<PublicDocument>('POST', P.documents, { body: input });
  }

  async *iterate(params: Omit<DocumentListParams, 'cursor'> = {}): AsyncIterable<PublicDocument> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...params, cursor });
      for (const document of page.data) yield document;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
}

export class FleetGraphAttentionContextsClient {
  constructor(private readonly client: ShipClient) {}

  list(params: FleetGraphAttentionContextListParams = {}): Promise<PublicFleetGraphAttentionContextsListResponse> {
    return this.client.request<PublicFleetGraphAttentionContextsListResponse>(
      'GET',
      P.fleetgraphAttentionContexts,
      { query: params }
    );
  }
}

export class FleetgraphClient {
  readonly attentionContexts: FleetGraphAttentionContextsClient;

  constructor(private readonly client: ShipClient) {
    this.attentionContexts = new FleetGraphAttentionContextsClient(client);
  }
}

export class IssuesClient {
  constructor(private readonly client: ShipClient) {}

  list(params: IssueListParams = {}): Promise<Page<PublicIssue>> {
    return this.client.request<Page<PublicIssue>>('GET', P.issues, { query: params });
  }

  get(id: string): Promise<PublicIssue> {
    return this.client.request<PublicIssue>('GET', pathWithId(P.issue, id));
  }

  create(input: IssueCreateInput): Promise<PublicIssue> {
    return this.client.request<PublicIssue>('POST', P.issues, { body: input });
  }

  update(id: string, input: IssueUpdateInput): Promise<PublicIssue> {
    return this.client.request<PublicIssue>('PATCH', pathWithId(P.issue, id), {
      body: input,
    });
  }

  upsertExternalLink(id: string, input: IssueExternalLinkInput): Promise<IssueExternalLink> {
    return this.client.request<IssueExternalLink>(
      'POST',
      pathWithId(P.issueExternalLinks, id),
      { body: input }
    );
  }

  async *iterate(params: Omit<IssueListParams, 'cursor'> = {}): AsyncIterable<PublicIssue> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...params, cursor });
      for (const issue of page.data) yield issue;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
}

export class SprintsClient {
  constructor(private readonly client: ShipClient) {}

  list(params: SprintListParams = {}): Promise<Page<PublicSprint>> {
    return this.client.request<Page<PublicSprint>>('GET', P.sprints, { query: params });
  }

  get(id: string): Promise<PublicSprint> {
    return this.client.request<PublicSprint>('GET', pathWithId(P.sprint, id));
  }

  listIssues(id: string, params: SprintIssueListParams = {}): Promise<Page<PublicIssue>> {
    return this.client.request<Page<PublicIssue>>('GET', pathWithId(P.sprintIssues, id), {
      query: params,
    });
  }

  async *iterate(params: Omit<SprintListParams, 'cursor'> = {}): AsyncIterable<PublicSprint> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...params, cursor });
      for (const sprint of page.data) yield sprint;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
}

export class WebhooksClient {
  constructor(private readonly client: ShipClient) {}

  list(params: WebhookListParams = {}): Promise<Page<WebhookSubscription>> {
    return this.client.request<Page<WebhookSubscription>>('GET', P.webhooks, { query: params });
  }

  create(input: { event: WebhookEventType; targetUrl?: string; target_url?: string }): Promise<WebhookSubscriptionCreated> {
    const targetUrl = input.target_url ?? input.targetUrl;
    if (!targetUrl) {
      throw new ShipError({ kind: 'validation', message: 'Webhook targetUrl is required' });
    }
    return this.client.request<WebhookSubscriptionCreated>('POST', P.webhooks, {
      body: {
        event: input.event,
        target_url: targetUrl,
      },
    });
  }

  replay(deliveryId: string): Promise<WebhookDelivery> {
    return this.client.request<WebhookDelivery>(
      'POST',
      pathWithId(P.webhookDeliveryReplay, deliveryId)
    );
  }

  listDeliveries(params: WebhookListParams = {}): Promise<Page<WebhookDelivery>> {
    return this.client.request<Page<WebhookDelivery>>('GET', P.webhookDeliveries, { query: params });
  }
}
