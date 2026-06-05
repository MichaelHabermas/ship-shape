// Platform app API client owns developer control-plane request shapes and calls.
import type { ApiResponse } from '@ship/shared';

export type ApiRequester = <T>(endpoint: string, options?: RequestInit) => Promise<ApiResponse<T>>;

export interface OAuthAppSecret {
  id: string;
  status: 'active' | 'grace' | 'revoked';
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface OAuthApp {
  id: string;
  name: string;
  client_id: string;
  redirect_uris: string[];
  requested_scopes: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  secrets: OAuthAppSecret[];
}

export interface OAuthAppCreateResponse extends Omit<OAuthApp, 'secrets'> {
  client_secret_id: string;
  client_secret: string;
  warning: string;
}

export interface OAuthSecretRotationResponse {
  app_id: string;
  client_secret_id: string;
  client_secret: string;
  previous_secret_expires_at: string | null;
  warning: string;
}

export interface WebhookSubscription {
  id: string;
  event: string;
  target_url: string;
  active: boolean;
  created_at: string;
}

export interface WebhookSubscriptionCreated extends WebhookSubscription {
  signing_secret: string;
}

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  attempt_number: number;
  status: 'pending' | 'sending' | 'succeeded' | 'retrying' | 'failed' | 'dlq';
  idempotency_key: string;
  response_status: number | null;
  response_excerpt: string | null;
  latency_ms: number | null;
  next_attempt_at: string | null;
  replay_of_delivery_id: string | null;
  created_at: string;
}

export interface PublicApiAuditRow {
  id: string;
  request_id: string;
  client_id: string | null;
  user_id: string | null;
  method: string;
  route: string;
  scope_used: string | null;
  status: number;
  latency_ms: number;
  error_code: string | null;
  rate_limited: boolean;
  created_at: string;
}

export interface CursorPage<T> {
  data: T[];
  next_cursor: string | null;
}

export function createPlatformAppsApi(request: ApiRequester) {
  return {
    list: () =>
      request<{ apps: OAuthApp[] }>('/api/platform/apps'),

    create: (data: { name: string; redirect_uris: string[]; requested_scopes: string[] }) =>
      request<OAuthAppCreateResponse>('/api/platform/apps', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    rotateSecret: (appId: string, data: { revoke_previous_immediately?: boolean }) =>
      request<OAuthSecretRotationResponse>(`/api/platform/apps/${appId}/secrets/rotate`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    revokeSecret: (appId: string, secretId: string) =>
      request<OAuthAppSecret>(`/api/platform/apps/${appId}/secrets/${secretId}/revoke`, {
        method: 'POST',
      }),

    listWebhooks: (appId: string, params?: { limit?: number; cursor?: string }) =>
      request<CursorPage<WebhookSubscription>>(`/api/platform/apps/${appId}/webhooks${cursorParams(params)}`),

    createWebhook: (appId: string, data: { event: string; target_url: string }) =>
      request<WebhookSubscriptionCreated>(`/api/platform/apps/${appId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    listWebhookDeliveries: (appId: string, params?: { limit?: number; cursor?: string }) =>
      request<CursorPage<WebhookDelivery>>(`/api/platform/apps/${appId}/webhooks/deliveries${cursorParams(params)}`),

    replayWebhookDelivery: (appId: string, deliveryId: string) =>
      request<WebhookDelivery>(`/api/platform/apps/${appId}/webhooks/deliveries/${deliveryId}/replay`, {
        method: 'POST',
      }),

    listAudit: (appId: string, params?: { limit?: number; cursor?: string }) =>
      request<CursorPage<PublicApiAuditRow>>(`/api/platform/apps/${appId}/audit${cursorParams(params)}`),
  };
}

function cursorParams(params?: { limit?: number; cursor?: string }): string {
  if (!params) return '';
  const search = new URLSearchParams();
  if (params.limit) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  const query = search.toString();
  return query ? `?${query}` : '';
}
