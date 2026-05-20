import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/icons/uswds';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// Validate that returnTo URL is same-origin (security measure)
function isValidReturnTo(url: string): boolean {
  try {
    // If it starts with /, it's a relative path - safe
    if (url.startsWith('/') && !url.startsWith('//')) {
      return true;
    }
    // Otherwise check if it's same origin
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function LoginPage() {
  // Don't pre-fill in E2E tests (navigator.webdriver is true when controlled by Playwright)
  const isAutomated = typeof navigator !== 'undefined' && navigator.webdriver;
  const shouldPrefill = import.meta.env.DEV && !isAutomated;
  const [email, setEmail] = useState(shouldPrefill ? 'dev@ship.local' : '');
  const [password, setPassword] = useState(shouldPrefill ? 'admin123' : '');
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<'email' | 'password' | 'general' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [caiaAvailable, setCaiaAvailable] = useState(false);
  const [isCaiaLoading, setIsCaiaLoading] = useState(false);

  // Subscribe to online/offline status changes using native browser events
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Check if session expired
  const sessionExpired = searchParams.get('expired') === 'true';

  // Check for error from OAuth callback (PIV auth failures)
  const urlError = searchParams.get('error');

  // Get returnTo URL with validation
  const returnTo = useMemo(() => {
    const returnToParam = searchParams.get('returnTo');
    if (returnToParam) {
      const decoded = decodeURIComponent(returnToParam);
      if (isValidReturnTo(decoded)) {
        return decoded;
      }
    }
    return null;
  }, [searchParams]);

  // Default redirect path from location state or returnTo param
  const from = returnTo || (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  // Check if setup is needed and if PIV auth is available
  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await fetch(`${API_URL}/api/setup/status`, {
          credentials: 'include',
        });
        const data = await res.json();

        if (data.success && data.data.needsSetup) {
          navigate('/setup', { replace: true });
          return;
        }
      } catch (err) {
        // If we can't check, just show login
        console.error('Failed to check setup status:', err);
      }
      setIsCheckingSetup(false);
    }

    async function checkCaiaStatus() {
      try {
        const res = await fetch(`${API_URL}/api/auth/caia/status`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (data.success && data.data.available) {
          setCaiaAvailable(true);
        }
      } catch (err) {
        // CAIA not available, that's fine
        console.debug('CAIA auth not available:', err);
      }
    }

    checkSetup();
    checkCaiaStatus();
  }, [navigate]);

  async function handleCaiaLogin() {
    setError('');
    setErrorField(null);
    setIsCaiaLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/auth/caia/login`, {
        credentials: 'include',
      });
      const data = await res.json();

      if (data.success && data.data.authorizationUrl) {
        // Redirect to CAIA for PIV authentication
        window.location.href = data.data.authorizationUrl;
      } else {
        setError(data.error?.message || 'Failed to initiate CAIA login');
        setErrorField('general');
        setIsCaiaLoading(false);
      }
    } catch (err) {
      console.error('CAIA login error:', err);
      setError('Failed to connect to CAIA authentication service');
      setErrorField('general');
      setIsCaiaLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setErrorField(null);

    // Manual validation for accessibility (shows role="alert" error messages)
    if (!email.trim()) {
      setError('Email address is required');
      setErrorField('email');
      return;
    }
    if (!password) {
      setError('Password is required');
      setErrorField('password');
      return;
    }

    setIsLoading(true);

    const result = await login(email, password);

    if (result.success) {
      navigate(from, { replace: true });
    } else {
      setError(result.error || 'Login failed');
      setErrorField('email'); // Associate general login errors with email field
      setIsLoading(false);
    }
  }

  if (isCheckingSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[360px]">
        {/* Logo / Brand */}
        <div className="mb-8 text-center">
          <img
            src="/icons/white/logo-128.png"
            alt="Ship"
            className="mx-auto h-16 w-16"
          />
          <h1 className="mt-4 text-2xl font-semibold text-foreground">Sign in to Ship</h1>
          <p className="mt-2 text-sm text-muted">Enter your credentials to continue</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Offline message */}
          {!isOnline && (
            <div
              role="alert"
              className="rounded-md border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400"
            >
              You're currently offline. Please connect to the internet to sign in.
            </div>
          )}

          {/* Session expired message */}
          {sessionExpired && (
            <div
              role="alert"
              className="rounded-md border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400"
            >
              Your session expired due to inactivity. Please log in again.
            </div>
          )}

          {/* Error from URL (OAuth callback failures) */}
          {urlError && !error && (
            <div
              id="login-error"
              role="alert"
              className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
              {urlError}
            </div>
          )}

          {/* Error from form submission */}
          {error && (
            <div
              id="login-error"
              role="alert"
              className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              aria-invalid={errorField === 'email' ? 'true' : undefined}
              aria-describedby={errorField === 'email' ? 'login-error' : undefined}
              className={cn(
                'w-full rounded-md border border-border bg-background px-4 py-2.5',
                'text-sm text-foreground placeholder:text-muted',
                'transition-colors focus:border-accent focus:outline-none'
              )}
            />
          </div>

          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-invalid={errorField === 'password' ? 'true' : undefined}
              aria-describedby={errorField === 'password' ? 'login-error' : undefined}
              className={cn(
                'w-full rounded-md border border-border bg-background px-4 py-2.5',
                'text-sm text-foreground placeholder:text-muted',
                'transition-colors focus:border-accent focus:outline-none'
              )}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={cn(
              'w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white',
              'transition-colors hover:bg-accent-hover',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {/* PIV Authentication via CAIA */}
        {caiaAvailable && (
          <>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background px-2 text-muted">or sign in with PIV</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCaiaLogin}
              disabled={isCaiaLoading || !isOnline}
              className={cn(
                'w-full rounded-md border border-border bg-background px-4 py-2.5',
                'text-sm font-medium text-foreground',
                'transition-colors hover:bg-muted/50',
                'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'flex items-center justify-center gap-2'
              )}
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <rect x="7" y="8" width="3" height="3" rx="0.5" />
                <line x1="14" y1="9.5" x2="17" y2="9.5" />
                <line x1="7" y1="14" x2="17" y2="14" />
                <line x1="7" y1="17" x2="13" y2="17" />
              </svg>
              {isCaiaLoading ? 'Connecting...' : 'Sign in with PIV Card'}
            </button>
          </>
        )}

        {/* Dev credentials hint - only shown in development */}
        {import.meta.env.DEV && (
          <div className="mt-8 text-center text-xs text-muted">
            <p>Dev credentials:</p>
            <p className="mt-1 font-mono text-muted">
              dev@ship.local / admin123
            </p>
          </div>
        )}

        {/*
          USWDS Icon visual verification - different sizes and colors
          Used in E2E tests to verify icons are loading correctly 
        */}
        {import.meta.env.VITE_APP_ENV !== 'production' && (
          <div data-testid="uswds-icons" className="mt-6 border-t border-border pt-4 text-center text-xs text-muted">
            <p className="mb-2 text-muted">USWDS Icons:</p>
            <div className="flex items-center justify-center gap-3">
              <Icon name="check" className="h-3 w-3 text-green-500" title="Check (h-3)" />
              <Icon name="close" className="h-4 w-4 text-red-400" title="Close (h-4)" />
              <Icon name="warning" className="h-5 w-5 text-yellow-500" title="Warning (h-5)" />
              <Icon name="info" className="h-6 w-6 text-accent" title="Info (h-6)" />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
