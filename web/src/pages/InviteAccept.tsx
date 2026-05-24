import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';

type InviteStatus = 'loading' | 'valid' | 'invalid' | 'expired' | 'accepted' | 'already_member' | 'error';

interface InviteInfo {
  workspaceName: string;
  role: 'admin' | 'member';
  userExists: boolean;
  alreadyMember?: boolean;
}

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<InviteStatus>('loading');
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }

    validateInvite();
  }, [token]);

  async function validateInvite() {
    if (!token) return;

    const res = await api.invites.validate(token);
    if (res.success && res.data) {
      setInviteInfo(res.data);
      // Check if user is already a member - invite was auto-consumed
      if (res.data.alreadyMember) {
        setStatus('already_member');
      } else {
        setStatus('valid');
      }
    } else {
      const errorMsg = res.error?.message || '';
      if (errorMsg.includes('expired')) {
        setStatus('expired');
      } else if (errorMsg.includes('already accepted') || errorMsg.includes('already used')) {
        setStatus('accepted');
      } else {
        setStatus('invalid');
      }
      setError(errorMsg);
    }
  }

  async function handleAccept() {
    if (!token) return;

    setAccepting(true);
    setError(null);

    // For new users, pass name and password to create account
    const data = inviteInfo?.userExists === false
      ? { name: name || undefined, password }
      : undefined;
    const res = await api.invites.accept(token, data);
    if (res.success) {
      // Redirect to docs - user is now a member of the workspace
      navigate('/docs', { replace: true });
    } else {
      setError(res.error?.message || 'Failed to accept invite');
      setAccepting(false);
    }
  }

  if (authLoading || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  // Invalid token
  if (status === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md px-6">
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <ErrorIcon className="h-6 w-6 text-red-500" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Invalid Invite</h1>
            <p className="mt-2 text-sm text-muted">
              This invite link is not valid. It may have been revoked or the URL is incorrect.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
            >
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Expired token
  if (status === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md px-6">
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/10">
              <ClockIcon className="h-6 w-6 text-yellow-500" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Invite Expired</h1>
            <p className="mt-2 text-sm text-muted">
              This invite link has expired. Please contact your workspace admin for a new invite.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
            >
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Already accepted
  if (status === 'accepted') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md px-6">
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <CheckIcon className="h-6 w-6 text-green-500" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Already Accepted</h1>
            <p className="mt-2 text-sm text-muted">
              This invite has already been accepted.
            </p>
            <Link
              to="/docs"
              className="mt-6 inline-block px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
            >
              Go to Documents
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // User is already a member of this workspace
  if (status === 'already_member') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md px-6">
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <CheckIcon className="h-6 w-6 text-green-500" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Already a Member</h1>
            <p className="mt-2 text-sm text-muted">
              You're already a member of <span className="font-medium text-foreground">{inviteInfo?.workspaceName}</span>.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
            >
              Log In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Valid invite - show accept UI
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md px-6">
        <div className="rounded-lg border border-border bg-surface p-8">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
              <InviteIcon className="h-6 w-6 text-accent" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">You're Invited!</h1>
            <p className="mt-2 text-sm text-muted">
              You have been invited to join
            </p>
            <p className="mt-1 text-lg font-medium text-foreground">
              {inviteInfo?.workspaceName}
            </p>
          </div>

          <div className="mt-6 rounded-md bg-border/30 p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Role</span>
              <span className="text-foreground capitalize">{inviteInfo?.role}</span>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}

          {/* Case 1: New user - show registration form */}
          {inviteInfo?.userExists === false && (
            <div className="mt-6 space-y-4">
              <p className="text-center text-sm text-muted">
                Create an account to accept this invite.
              </p>
              <div>
                <label htmlFor="name" className="sr-only">Name</label>
                <input
                  id="name"
                  type="text"
                  placeholder="Your name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="password" className="sr-only">Password</label>
                <input
                  id="password"
                  type="password"
                  placeholder="Create password (8+ characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <button
                onClick={handleAccept}
                disabled={accepting || password.length < 8}
                className="w-full px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {accepting ? 'Creating Account...' : 'Create Account & Accept'}
              </button>
            </div>
          )}

          {/* Case 2: Existing user but not logged in - show login button */}
          {inviteInfo?.userExists === true && !user && (
            <div className="mt-6 space-y-3">
              <p className="text-center text-sm text-muted">
                Please log in to accept this invite.
              </p>
              <Link
                to={`/login?redirect=/invite/${token}`}
                className="block w-full px-4 py-2 bg-accent text-white text-center rounded-md hover:bg-accent/90 transition-colors"
              >
                Log In to Accept
              </Link>
            </div>
          )}

          {/* Case 3: Logged in - show accept button */}
          {user && (
            <div className="mt-6 space-y-3">
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {accepting ? 'Accepting...' : 'Accept Invite'}
              </button>
              <Link
                to="/docs"
                className="block w-full px-4 py-2 border border-border text-foreground text-center rounded-md hover:bg-border/30 transition-colors"
              >
                Decline
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function InviteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  );
}
