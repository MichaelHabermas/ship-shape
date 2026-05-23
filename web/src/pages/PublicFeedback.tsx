import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { readJson } from '@/api/read-json';

const API_URL = typeof import.meta.env.VITE_API_URL === 'string' ? import.meta.env.VITE_API_URL : '';

interface Program {
  id: string;
  name: string;
  emoji?: string | null;
  color: string;
}

export function PublicFeedbackPage() {
  const { programId } = useParams<{ programId: string }>();
  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Fetch program info
  useEffect(() => {
    if (!programId) {
      setError('Invalid program');
      setLoading(false);
      return;
    }

    fetch(`${API_URL}/api/feedback/program/${programId}`)
      .then(res => {
        if (!res.ok) throw new Error('Program not found');
        return readJson<Program>(res);
      })
      .then(data => {
        setProgram(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Program not found');
        setLoading(false);
      });
  }, [programId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !email.trim() || !programId) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          submitter_email: email.trim(),
          program_id: programId,
        }),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        setError('Failed to submit feedback. Please try again.');
      }
    } catch {
      setError('Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (error && !program) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-xl font-medium text-foreground">Error</h1>
          <p className="mt-2 text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md rounded-lg border border-border bg-background p-8 text-center">
          <div className="mb-4 text-4xl">&#10003;</div>
          <h1 className="text-xl font-medium text-foreground">Thank you!</h1>
          <p className="mt-2 text-muted">
            Your feedback has been submitted successfully. We appreciate you taking the time to share your thoughts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-8">
        <h1 className="mb-2 text-xl font-medium text-foreground">
          Submit Feedback
        </h1>
        {program && (
          <p className="mb-6 text-sm text-muted">
            for {program.name}
          </p>
        )}

        {error && (
          <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium text-foreground">
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of your feedback"
              className="w-full rounded border border-border bg-border/50 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="email"
              name="submitter_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full rounded border border-border bg-border/50 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !title.trim() || !email.trim()}
            className="w-full rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </form>
      </div>
    </div>
  );
}
