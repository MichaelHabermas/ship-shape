// OAuth consent page approves a pending server-owned authorization request.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  ApiResponse,
  OAuthConsentApprovalResponse,
  OAuthConsentRequest,
} from '@ship/shared';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { cn } from '@/lib/cn';

export function OAuthConsentPage() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('request_id');
  const [request, setRequest] = useState<OAuthConsentRequest | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);

  const newScopeSet = useMemo(() => new Set(request?.new_scopes ?? []), [request]);

  useEffect(() => {
    let mounted = true;

    async function loadRequest() {
      if (!requestId) {
        setError('Consent request is missing.');
        setIsLoading(false);
        return;
      }

      try {
        const response = await apiGetJson<ApiResponse<OAuthConsentRequest>>(
          `/oauth/consent/request/${requestId}`,
          'Failed to load consent request'
        );
        if (mounted) {
          if (response.success && response.data) {
            setRequest(response.data);
          } else {
            setError(response.error?.message ?? 'Consent request is no longer available.');
          }
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load consent request.');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadRequest();
    return () => {
      mounted = false;
    };
  }, [requestId]);

  async function approveConsent() {
    if (!request) return;

    setError('');
    setIsApproving(true);
    try {
      const response = await apiPostJson<ApiResponse<OAuthConsentApprovalResponse>>(
        '/oauth/consent/approve',
        { request_id: request.request_id },
        'Failed to approve consent'
      );
      if (response.success && response.data?.redirect_url) {
        window.location.href = response.data.redirect_url;
        return;
      }
      setError(response.error?.message ?? 'Failed to approve consent.');
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : 'Failed to approve consent.');
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-[520px] rounded-lg border border-border bg-background p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-medium text-accent">Ship OAuth</p>
          <h1 className="mt-2 text-2xl font-semibold">Authorize app access</h1>
        </div>

        {isLoading && (
          <div className="text-sm text-muted">Loading...</div>
        )}

        {!isLoading && error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
          >
            {error}
          </div>
        )}

        {!isLoading && request && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">{request.app.name}</h2>
              <p className="mt-1 break-all text-xs text-muted">{request.app.client_id}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Redirect URI</p>
              <p className="break-all rounded-md border border-border bg-muted/10 px-3 py-2 font-mono text-xs text-muted">
                {request.redirect_uri}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Scopes</p>
              <div className="space-y-2">
                {request.requested_scopes.map((scope) => (
                  <div
                    key={scope}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span className="font-mono text-sm">{scope}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        newScopeSet.has(scope)
                          ? 'bg-accent/10 text-accent'
                          : 'bg-muted/10 text-muted'
                      )}
                    >
                      {newScopeSet.has(scope) ? 'New' : 'Granted'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <button
                type="button"
                onClick={approveConsent}
                disabled={isApproving}
                className={cn(
                  'rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white',
                  'transition-colors hover:bg-accent-hover',
                  'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background',
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                {isApproving ? 'Approving...' : 'Authorize'}
              </button>
              <Link
                to="/docs"
                className="rounded-md border border-border px-4 py-2.5 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                Cancel
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
