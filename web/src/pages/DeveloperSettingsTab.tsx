// Developer settings tab exposes OAuth app, webhook delivery, DLQ, replay, and audit controls.
import { useEffect, useMemo, useState } from 'react';
import { PUBLIC_API_SCOPES, WEBHOOK_EVENT_TYPES } from '@ship/shared';
import { api } from '@/lib/api';
import type {
  OAuthApp,
  OAuthAppSecret,
  PublicApiAuditRow,
  WebhookDelivery,
  WebhookSubscription,
} from '@/lib/platform-apps-api';
import {
  AppSelector,
  CreateAppForm,
  formatDate,
  OneTimeSecretPanel,
  SimpleTable,
  StatusPill,
  type OneTimeSecret,
} from './DeveloperSettingsControls';

const scopeOptions = [...PUBLIC_API_SCOPES];
const eventOptions = [...WEBHOOK_EVENT_TYPES];

export function DeveloperSettingsTab() {
  const [apps, setApps] = useState<OAuthApp[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [auditRows, setAuditRows] = useState<PublicApiAuditRow[]>([]);
  const [deliveryCursor, setDeliveryCursor] = useState<string | null>(null);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOps, setLoadingOps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [createRedirectUri, setCreateRedirectUri] = useState('');
  const [createScopes, setCreateScopes] = useState<string[]>(['documents:read', 'webhooks:manage']);
  const [newSecret, setNewSecret] = useState<OneTimeSecret | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [revokeImmediately, setRevokeImmediately] = useState(false);
  const [subscriptionEvent, setSubscriptionEvent] = useState<string>(eventOptions[0]);
  const [subscriptionTargetUrl, setSubscriptionTargetUrl] = useState('');
  const [showDlqOnly, setShowDlqOnly] = useState(false);

  const selectedApp = useMemo(
    () => apps.find(app => app.id === selectedAppId) ?? null,
    [apps, selectedAppId]
  );
  const visibleDeliveries = showDlqOnly
    ? deliveries.filter(delivery => delivery.status === 'dlq')
    : deliveries;

  useEffect(() => {
    void loadApps();
  }, []);

  useEffect(() => {
    if (!selectedAppId) {
      setSubscriptions([]);
      setDeliveries([]);
      setAuditRows([]);
      setDeliveryCursor(null);
      setAuditCursor(null);
      return;
    }
    void loadOperations(selectedAppId);
  }, [selectedAppId]);

  async function loadApps(preferredAppId?: string) {
    setLoading(true);
    setError(null);
    const response = await api.platformApps.list();
    if (!response.success || !response.data) {
      setError(response.error?.message ?? 'Failed to load developer apps');
      setLoading(false);
      return;
    }

    const nextApps = response.data.apps;
    setApps(nextApps);
    const preferred = preferredAppId ?? selectedAppId;
    const nextSelected = nextApps.find(app => app.id === preferred)?.id ?? nextApps[0]?.id ?? null;
    setSelectedAppId(nextSelected);
    setLoading(false);
  }

  async function loadOperations(appId: string) {
    setLoadingOps(true);
    setError(null);
    const [webhookResponse, deliveryResponse, auditResponse] = await Promise.all([
      api.platformApps.listWebhooks(appId, { limit: 50 }),
      api.platformApps.listWebhookDeliveries(appId, { limit: 50 }),
      api.platformApps.listAudit(appId, { limit: 50 }),
    ]);

    if (webhookResponse.success && webhookResponse.data) {
      setSubscriptions(webhookResponse.data.data);
    } else {
      setError(webhookResponse.error?.message ?? 'Failed to load webhook subscriptions');
    }
    if (deliveryResponse.success && deliveryResponse.data) {
      setDeliveries(deliveryResponse.data.data);
      setDeliveryCursor(deliveryResponse.data.next_cursor);
    }
    if (auditResponse.success && auditResponse.data) {
      setAuditRows(auditResponse.data.data);
      setAuditCursor(auditResponse.data.next_cursor);
    }
    setLoadingOps(false);
  }

  async function handleCreateApp(event: React.FormEvent) {
    event.preventDefault();
    if (!createName.trim() || !createRedirectUri.trim() || createScopes.length === 0) return;

    setBusy(true);
    setError(null);
    const response = await api.platformApps.create({
      name: createName.trim(),
      redirect_uris: [createRedirectUri.trim()],
      requested_scopes: createScopes,
    });
    if (response.success && response.data) {
      setNewSecret({
        appName: response.data.name,
        secretId: response.data.client_secret_id,
        value: response.data.client_secret,
        previousExpiresAt: null,
      });
      setCreateName('');
      setCreateRedirectUri('');
      setCopiedSecret(false);
      await loadApps(response.data.id);
    } else {
      setError(response.error?.message ?? 'Failed to create OAuth app');
    }
    setBusy(false);
  }

  async function handleRotateSecret() {
    if (!selectedApp) return;
    setBusy(true);
    setError(null);
    const response = await api.platformApps.rotateSecret(selectedApp.id, {
      revoke_previous_immediately: revokeImmediately,
    });
    if (response.success && response.data) {
      setNewSecret({
        appName: selectedApp.name,
        secretId: response.data.client_secret_id,
        value: response.data.client_secret,
        previousExpiresAt: response.data.previous_secret_expires_at,
      });
      setCopiedSecret(false);
      await loadApps(selectedApp.id);
    } else {
      setError(response.error?.message ?? 'Failed to rotate client secret');
    }
    setBusy(false);
  }

  async function handleRevokeSecret(secret: OAuthAppSecret) {
    if (!selectedApp || secret.status === 'active') return;
    if (!confirm('Revoke this client secret now?')) return;

    setBusy(true);
    setError(null);
    const response = await api.platformApps.revokeSecret(selectedApp.id, secret.id);
    if (response.success) {
      await loadApps(selectedApp.id);
    } else {
      setError(response.error?.message ?? 'Failed to revoke client secret');
    }
    setBusy(false);
  }

  async function handleCreateSubscription(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedApp || !subscriptionTargetUrl.trim()) return;

    setBusy(true);
    setError(null);
    const response = await api.platformApps.createWebhook(selectedApp.id, {
      event: subscriptionEvent,
      target_url: subscriptionTargetUrl.trim(),
    });
    if (response.success) {
      setSubscriptionTargetUrl('');
      await loadOperations(selectedApp.id);
    } else {
      setError(response.error?.message ?? 'Failed to create webhook subscription');
    }
    setBusy(false);
  }

  async function handleReplay(delivery: WebhookDelivery) {
    if (!selectedApp) return;

    setBusy(true);
    setError(null);
    const response = await api.platformApps.replayWebhookDelivery(selectedApp.id, delivery.id);
    if (response.success) {
      await loadOperations(selectedApp.id);
    } else {
      setError(response.error?.message ?? 'Failed to replay webhook delivery');
    }
    setBusy(false);
  }

  async function handleLoadMoreDeliveries() {
    if (!selectedApp || !deliveryCursor) return;
    const response = await api.platformApps.listWebhookDeliveries(selectedApp.id, {
      limit: 50,
      cursor: deliveryCursor,
    });
    if (response.success && response.data) {
      const page = response.data;
      setDeliveries(prev => [...prev, ...page.data]);
      setDeliveryCursor(page.next_cursor);
    }
  }

  async function handleLoadMoreAudit() {
    if (!selectedApp || !auditCursor) return;
    const response = await api.platformApps.listAudit(selectedApp.id, {
      limit: 50,
      cursor: auditCursor,
    });
    if (response.success && response.data) {
      const page = response.data;
      setAuditRows(prev => [...prev, ...page.data]);
      setAuditCursor(page.next_cursor);
    }
  }

  async function handleCopySecret() {
    if (!newSecret) return;
    await navigator.clipboard?.writeText(newSecret.value);
    setCopiedSecret(true);
  }

  function toggleScope(scope: string) {
    setCreateScopes(prev => (
      prev.includes(scope)
        ? prev.filter(value => value !== scope)
        : [...prev, scope]
    ));
  }

  if (loading) {
    return <div className="text-sm text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {newSecret && (
        <OneTimeSecretPanel
          secret={newSecret}
          copied={copiedSecret}
          onCopy={handleCopySecret}
          onDismiss={() => setNewSecret(null)}
        />
      )}

      <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <CreateAppForm
            name={createName}
            redirectUri={createRedirectUri}
            scopes={createScopes}
            scopeOptions={scopeOptions}
            busy={busy}
            onNameChange={setCreateName}
            onRedirectUriChange={setCreateRedirectUri}
            onToggleScope={toggleScope}
            onSubmit={handleCreateApp}
          />

          <AppSelector
            apps={apps}
            selectedAppId={selectedAppId}
            onSelectApp={setSelectedAppId}
          />
        </div>

        {!selectedApp ? (
          <div className="text-sm text-muted">Select or create an app</div>
        ) : (
          <div className="space-y-5">
            {/* Dashboard summary cards - makes the dev portal feel like a real platform dashboard */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-paper p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted">Active Subscriptions</div>
                <div className="mt-1 text-2xl font-semibold">{subscriptions.filter(s => s.active).length}</div>
              </div>
              <div className="rounded-lg border border-border bg-paper p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted">Deliveries (loaded)</div>
                <div className="mt-1 text-2xl font-semibold">{deliveries.length}</div>
                <div className="text-[10px] text-muted">{deliveries.filter(d => d.status === 'dlq').length} in DLQ</div>
              </div>
              <div className="rounded-lg border border-border bg-paper p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted">Audit Events</div>
                <div className="mt-1 text-2xl font-semibold">{auditRows.length}</div>
              </div>
              <div className="rounded-lg border border-border bg-paper p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted">App Scopes</div>
                <div className="mt-1 text-xs font-mono text-muted">{selectedApp.requested_scopes.join(', ')}</div>
              </div>
            </div>

            <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-xs">
              <strong>Human demo tip:</strong> Create a webhook subscription above for "document.created". Then create a document anywhere in the app. Come back here and refresh the Delivery Log — you will see the signed event appear with latency and status. Use the Replay button on any DLQ row.
            </div>
            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{selectedApp.name}</h3>
                  <div className="mt-1 font-mono text-xs text-muted">{selectedApp.client_id}</div>
                </div>
                <button
                  type="button"
                  onClick={() => loadOperations(selectedApp.id)}
                  disabled={loadingOps}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-border/30 disabled:opacity-50"
                >
                  {loadingOps ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedApp.requested_scopes.map(scope => (
                  <span key={scope} className="rounded border border-border px-2 py-1 font-mono text-xs text-muted">
                    {scope}
                  </span>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">Client Secrets</h3>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={revokeImmediately}
                      onChange={(event) => setRevokeImmediately(event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent/50"
                    />
                    Revoke previous immediately
                  </label>
                  <button
                    type="button"
                    onClick={handleRotateSecret}
                    disabled={busy}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-border/30 disabled:opacity-50"
                  >
                    Rotate
                  </button>
                </div>
              </div>
              <SimpleTable
                headers={['Secret', 'Status', 'Expires', 'Created', '']}
                empty="No secrets"
                rows={selectedApp.secrets.map(secret => [
                  <span className="font-mono">{secret.id.slice(0, 8)}</span>,
                  <StatusPill key="status" value={secret.status} />,
                  secret.expires_at ? formatDate(secret.expires_at) : '-',
                  formatDate(secret.created_at),
                  secret.status !== 'active' && secret.status !== 'revoked' ? (
                    <button
                      type="button"
                      onClick={() => handleRevokeSecret(secret)}
                      disabled={busy}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  ) : null,
                ])}
              />
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">Webhook Subscriptions</h3>
                <form onSubmit={handleCreateSubscription} className="flex flex-wrap gap-2">
                  <select
                    value={subscriptionEvent}
                    onChange={(event) => setSubscriptionEvent(event.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  >
                    {eventOptions.map(event => (
                      <option key={event} value={event}>{event}</option>
                    ))}
                  </select>
                  <input
                    type="url"
                    value={subscriptionTargetUrl}
                    onChange={(event) => setSubscriptionTargetUrl(event.target.value)}
                    placeholder="https://hooks.example.com/ship"
                    className="w-72 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted"
                    required
                  />
                  <button
                    type="submit"
                    disabled={busy || !subscriptionTargetUrl.trim()}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-border/30 disabled:opacity-50"
                  >
                    Add
                  </button>
                </form>
              </div>
              <SimpleTable
                headers={['Event', 'Target', 'Active', 'Created']}
                empty="No subscriptions"
                rows={subscriptions.map(subscription => [
                  subscription.event,
                  <span className="break-all font-mono text-xs">{subscription.target_url}</span>,
                  subscription.active ? 'Yes' : 'No',
                  formatDate(subscription.created_at),
                ])}
              />
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Delivery Log</h3>
                  <div className="text-[10px] text-muted">Every webhook attempt. Signed. Queryable. Replayable.</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={showDlqOnly}
                    onChange={(event) => setShowDlqOnly(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent/50"
                  />
                  DLQ only
                </label>
              </div>
              <SimpleTable
                headers={['Status', 'Event', 'Attempt', 'HTTP', 'Latency', 'Next', '']}
                empty="No deliveries"
                rows={visibleDeliveries.map(delivery => [
                  <StatusPill key="status" value={delivery.status} />,
                  <div>
                    <div className="font-mono text-[10px] text-muted">{delivery.event_type || 'webhook'}</div>
                    <div className="font-mono text-xs break-all">{delivery.idempotency_key}</div>
                  </div>,
                  String(delivery.attempt_number),
                  delivery.response_status ?? '-',
                  delivery.latency_ms === null ? '-' : `${delivery.latency_ms}ms`,
                  delivery.next_attempt_at ? formatDate(delivery.next_attempt_at) : '-',
                  delivery.status === 'dlq' ? (
                    <button
                      type="button"
                      onClick={() => handleReplay(delivery)}
                      disabled={busy}
                      className="rounded border border-accent px-2 py-0.5 text-xs text-accent hover:bg-accent/10"
                    >
                      Replay
                    </button>
                  ) : null,
                ])}
              />
              {deliveryCursor && !showDlqOnly && (
                <button
                  type="button"
                  onClick={handleLoadMoreDeliveries}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-border/30"
                >
                  Load more
                </button>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">Public API Audit</h3>
              <SimpleTable
                headers={['Route', 'Status', 'Request', 'Scope', 'Latency', 'Rate Limited', 'Time']}
                empty="No audit rows"
                rows={auditRows.map(row => [
                  `${row.method} ${row.route}`,
                  String(row.status),
                  <span className="font-mono text-xs">{row.request_id}</span>,
                  row.scope_used ?? '-',
                  `${row.latency_ms}ms`,
                  row.rate_limited ? 'Yes' : 'No',
                  formatDate(row.created_at),
                ])}
              />
              {auditCursor && (
                <button
                  type="button"
                  onClick={handleLoadMoreAudit}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-border/30"
                >
                  Load more
                </button>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
