-- FleetGraph-owned diagnosis state for findings and graph runs.
-- Ship documents, issues, weeks, ownership, priority, and status remain canonical.

CREATE TABLE IF NOT EXISTS fleetgraph_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_issue_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_sprint_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'needs_confirmation', 'dismissed', 'resolved', 'suppressed', 'error')),
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'urgent')),
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.000
    CHECK (confidence >= 0 AND confidence <= 1),

  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_action JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_content JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_recipient JSONB NOT NULL DEFAULT '{}'::jsonb,
  human_gate JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fleetgraph_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  finding_id UUID REFERENCES fleetgraph_findings(id) ON DELETE SET NULL,
  source_issue_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  source_sprint_id UUID REFERENCES documents(id) ON DELETE SET NULL,

  mode TEXT NOT NULL CHECK (mode IN ('proactive', 'on_demand')),
  trigger_reason TEXT NOT NULL,
  decision TEXT NOT NULL
    CHECK (decision IN ('quiet_exit', 'create_finding', 'update_finding', 'explain', 'refine_draft', 'needs_confirmation', 'dismiss', 'resolve', 'error')),
  dedupe_key TEXT,

  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetgraph_findings_open_dedupe
  ON fleetgraph_findings(dedupe_key)
  WHERE status IN ('open', 'needs_confirmation', 'error');

CREATE INDEX IF NOT EXISTS idx_fleetgraph_findings_workspace_status
  ON fleetgraph_findings(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_findings_source_issue
  ON fleetgraph_findings(source_issue_id, status);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_findings_source_sprint
  ON fleetgraph_findings(source_sprint_id, status);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_runs_workspace_created
  ON fleetgraph_runs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_runs_finding
  ON fleetgraph_runs(finding_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_runs_decision
  ON fleetgraph_runs(decision, created_at DESC);

COMMENT ON TABLE fleetgraph_findings IS 'FleetGraph-owned diagnosis findings. Does not replace Ship document, issue, week, or ownership state.';
COMMENT ON TABLE fleetgraph_runs IS 'FleetGraph run ledger for proactive, on-demand, quiet, trace, token, cost, and error metadata.';
COMMENT ON COLUMN fleetgraph_findings.dedupe_key IS 'Open-finding dedupe key, e.g. blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}.';
COMMENT ON COLUMN fleetgraph_findings.evidence_snapshot IS 'Permission-filterable evidence snapshot backing user-visible FleetGraph claims.';
COMMENT ON COLUMN fleetgraph_findings.draft_content IS 'FleetGraph-owned draft content requiring a human gate before Ship mutation or communication.';
