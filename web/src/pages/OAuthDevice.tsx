// OAuth Device Grant verification page approves CLI login requests for signed-in users.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  ApiResponse,
  OAuthDeviceApprovalResponse,
  OAuthDeviceVerificationRequest,
} from '@ship/shared';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { cn } from '@/lib/cn';

export function OAuthDevicePage() {
  const [searchParams] = useSearchParams();
  const [userCode, setUserCode] = useState(searchParams.get('user_code') ?? '');
  const [request, setRequest] = useState<OAuthDeviceVerificationRequest | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (userCode) void loadRequest(userCode);
  }, []);

  async function loadRequest(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setError('');
    setIsLoading(true);
    setApproved(false);
    try {
      const response = await apiGetJson<ApiResponse<OAuthDeviceVerificationRequest>>(
        `/oauth/device/verify?user_code=${encodeURIComponent(trimmed)}`,
        'Failed to load device request'
      );
      if (response.success && response.data) {
        setRequest(response.data);
        return;
      }
      setRequest(null);
      setError(response.error?.message ?? 'Device request is unavailable.');
    } catch (loadError) {
      setRequest(null);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load device request.');
    } finally {
      setIsLoading(false);
    }
  }

  async function approve() {
    if (!request) return;
    setError('');
    setIsLoading(true);
    try {
      const response = await apiPostJson<ApiResponse<OAuthDeviceApprovalResponse>>(
        '/oauth/device/verify',
        { user_code: userCode.trim() },
        'Failed to approve device request'
      );
      if (response.success && response.data?.approved) {
        setApproved(true);
        return;
      }
      setError(response.error?.message ?? 'Device request was not approved.');
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : 'Failed to approve device request.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-[520px] rounded-lg border border-border bg-background p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-medium text-accent">Ship OAuth</p>
          <h1 className="mt-2 text-2xl font-semibold">Approve device login</h1>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="user-code" className="text-sm font-medium">Code</label>
            <div className="mt-2 flex gap-2">
              <input
                id="user-code"
                value={userCode}
                onChange={(event) => setUserCode(event.target.value.toUpperCase())}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                placeholder="ABCD-1234"
              />
              <button
                type="button"
                onClick={() => void loadRequest(userCode)}
                disabled={isLoading}
                className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
              >
                Check
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {approved && (
            <div className="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-300">
              Approved. You can return to the CLI.
            </div>
          )}

          {request && !approved && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">{request.app.name}</h2>
                <p className="mt-1 break-all font-mono text-xs text-muted">{request.app.client_id}</p>
              </div>
              <div className="space-y-2">
                {request.requested_scopes.map((scope) => (
                  <div key={scope} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <span className="font-mono text-sm">{scope}</span>
                    <span className="text-xs text-muted">
                      {request.new_scopes.includes(scope) ? 'New' : 'Granted'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={isLoading}
                  className={cn(
                    'rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white',
                    'hover:bg-accent-hover disabled:opacity-50'
                  )}
                >
                  Approve
                </button>
                <Link
                  to="/docs"
                  className="rounded-md border border-border px-4 py-2.5 text-center text-sm font-medium hover:bg-muted/50"
                >
                  Cancel
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
