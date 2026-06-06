// Read-only PlugForge integration proof panel fed from committed evidence JSON on the static site.
import { useEffect, useState } from 'react';

interface MatrixFlow {
  id: string;
  status: string;
  proof_class?: string;
}

interface MatrixEvidence {
  run_id?: string;
  status?: string;
  generated_at?: string;
  flows?: MatrixFlow[];
}

interface TtfeEvidence {
  result?: { totalMs?: number };
  durationMs?: number;
}

interface GitlabEvidence {
  merge_request?: { url?: string; iid?: number };
  issue?: { id?: string };
}

const FLOW_LABELS: Record<string, string> = {
  cli_ttfe: 'CLI + TTFE',
  slack: 'Slack',
  browser: 'Browser SDK',
  gitlab: 'GitLab',
  refresh_token_theft: 'Refresh-token theft',
  idempotency_replay: 'Idempotency replay',
};

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

export function IntegrationProofPanel() {
  const [matrix, setMatrix] = useState<MatrixEvidence | null>(null);
  const [ttfe, setTtfe] = useState<TtfeEvidence | null>(null);
  const [gitlab, setGitlab] = useState<GitlabEvidence | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [matrixJson, ttfeJson, gitlabJson] = await Promise.all([
        fetchJson<MatrixEvidence>('/plugforge-evidence/matrix.json'),
        fetchJson<TtfeEvidence>('/plugforge-evidence/ttfe-timing.json'),
        fetchJson<GitlabEvidence>('/plugforge-evidence/gitlab.json'),
      ]);
      if (!matrixJson) {
        setLoadError('Integration proof evidence is not published on this deploy yet.');
        return;
      }
      setMatrix(matrixJson);
      setTtfe(ttfeJson);
      setGitlab(gitlabJson);
      setLoadError(null);
    })();
  }, []);

  if (loadError) {
    return (
      <section className="rounded border border-border bg-surface p-4 text-sm text-muted">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Integration proof</h3>
        <p>{loadError}</p>
      </section>
    );
  }

  if (!matrix) {
    return (
      <section className="rounded border border-border bg-surface p-4 text-sm text-muted">
        Loading integration proof…
      </section>
    );
  }

  const totalMs = ttfe?.result?.totalMs ?? ttfe?.durationMs;

  return (
    <section className="rounded border border-dashed border-accent/50 bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold text-foreground">Integration proof (read-only)</h3>
      <p className="mb-3 text-xs text-muted">
        Six-flow matrix from committed evidence. Run <code className="text-foreground">pnpm plugforge:render-reviewer</code> after live drill updates.
      </p>
      <dl className="mb-3 grid gap-1 text-xs text-muted">
        <div>Matrix run: <span className="font-mono text-foreground">{matrix.run_id ?? 'n/a'}</span></div>
        <div>Status: <span className="font-medium text-green-700">{matrix.status ?? 'unknown'}</span></div>
        {totalMs ? <div>TTFE total: <span className="text-foreground">{totalMs} ms</span></div> : null}
      </dl>
      <ul className="mb-3 flex flex-wrap gap-2">
        {(matrix.flows ?? []).map((flow) => (
          <li
            key={flow.id}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <span className="font-medium text-foreground">{FLOW_LABELS[flow.id] ?? flow.id}</span>
            <span className="ml-1 text-green-700">{flow.status}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3 text-xs">
        <a
          href="/plugforge-reviewer-packet.html#integrations"
          className="text-accent hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Reviewer packet →
        </a>
        {gitlab?.merge_request?.url ? (
          <a
            href={gitlab.merge_request.url}
            className="text-accent hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            GitLab MR !{gitlab.merge_request.iid} →
          </a>
        ) : null}
        {gitlab?.issue?.id ? (
          <a
            href={`/documents/${gitlab.issue.id}`}
            className="text-accent hover:underline"
          >
            Proof issue →
          </a>
        ) : null}
        <a
          href="/plugforge-evidence/slack-proof.png"
          className="text-accent hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Slack screenshot →
        </a>
      </div>
    </section>
  );
}
