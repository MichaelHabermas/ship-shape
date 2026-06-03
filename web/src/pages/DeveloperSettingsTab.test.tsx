// Developer settings tab tests pin shown-once secret state to memory-only UI behavior.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeveloperSettingsTab } from './DeveloperSettingsTab';

const platformAppsMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  rotateSecret: vi.fn(),
  revokeSecret: vi.fn(),
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  listWebhookDeliveries: vi.fn(),
  replayWebhookDelivery: vi.fn(),
  listAudit: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    platformApps: platformAppsMock,
  },
}));

const createdApp = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Demo Developer App',
  client_id: 'ship_app_demo',
  redirect_uris: ['https://example.test/callback'],
  requested_scopes: ['documents:read', 'webhooks:manage'],
  is_active: true,
  created_at: '2026-06-02T00:00:00.000Z',
  updated_at: '2026-06-02T00:00:00.000Z',
  secrets: [{
    id: '22222222-2222-4222-8222-222222222222',
    status: 'active' as const,
    expires_at: null,
    revoked_at: null,
    created_at: '2026-06-02T00:00:00.000Z',
  }],
};

const createdSecretResponse = {
  ...createdApp,
  client_secret_id: createdApp.secrets[0].id,
  client_secret: 'ship_secret_once_only',
  warning: 'Save this client_secret now. It will not be shown again.',
};

describe('DeveloperSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    platformAppsMock.list.mockResolvedValue({ success: true, data: { apps: [] } });
    platformAppsMock.create.mockResolvedValue({ success: true, data: createdSecretResponse });
    platformAppsMock.listWebhooks.mockResolvedValue({ success: true, data: { data: [], next_cursor: null } });
    platformAppsMock.listWebhookDeliveries.mockResolvedValue({ success: true, data: { data: [], next_cursor: null } });
    platformAppsMock.listAudit.mockResolvedValue({ success: true, data: { data: [], next_cursor: null } });
  });

  it('dismisses shown-once client secrets without persisting them', async () => {
    platformAppsMock.list
      .mockResolvedValueOnce({ success: true, data: { apps: [] } })
      .mockResolvedValueOnce({ success: true, data: { apps: [createdApp] } });

    render(<DeveloperSettingsTab />);
    await screen.findByText('No apps');

    fireEvent.change(screen.getByPlaceholderText('App name'), {
      target: { value: 'Demo Developer App' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://example.com/oauth/callback'), {
      target: { value: 'https://example.test/callback' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create App' }));

    expect(await screen.findByText('ship_secret_once_only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(screen.queryByText('ship_secret_once_only')).not.toBeInTheDocument();
    });
    expect(localStorageValues()).not.toContain('ship_secret_once_only');
  });

  it('does not restore a shown-once client secret after remount', async () => {
    platformAppsMock.list
      .mockResolvedValueOnce({ success: true, data: { apps: [] } })
      .mockResolvedValueOnce({ success: true, data: { apps: [createdApp] } });

    const rendered = render(<DeveloperSettingsTab />);
    await screen.findByText('No apps');

    fireEvent.change(screen.getByPlaceholderText('App name'), {
      target: { value: 'Demo Developer App' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://example.com/oauth/callback'), {
      target: { value: 'https://example.test/callback' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create App' }));
    expect(await screen.findByText('ship_secret_once_only')).toBeInTheDocument();

    rendered.unmount();
    platformAppsMock.list.mockResolvedValue({ success: true, data: { apps: [createdApp] } });

    render(<DeveloperSettingsTab />);
    expect(await screen.findAllByText('Demo Developer App')).not.toHaveLength(0);
    expect(screen.queryByText('ship_secret_once_only')).not.toBeInTheDocument();
  });
});

function localStorageValues(): string {
  const values: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) values.push(localStorage.getItem(key) ?? '');
  }
  return values.join('\n');
}
