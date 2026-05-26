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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fleetgraph_findings_status_timestamps_check CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL AND dismissed_at IS NULL AND dismissed_by IS NULL)
    OR (status = 'dismissed' AND dismissed_at IS NOT NULL AND dismissed_by IS NOT NULL AND resolved_at IS NULL)
    OR (status IN ('open', 'needs_confirmation', 'error') AND resolved_at IS NULL AND dismissed_at IS NULL AND dismissed_by IS NULL)
    OR status = 'suppressed'
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fleetgraph_findings_status_timestamps_check'
  ) THEN
    ALTER TABLE fleetgraph_findings
      ADD CONSTRAINT fleetgraph_findings_status_timestamps_check CHECK (
        (status = 'resolved' AND resolved_at IS NOT NULL AND dismissed_at IS NULL AND dismissed_by IS NULL)
        OR (status = 'dismissed' AND dismissed_at IS NOT NULL AND dismissed_by IS NOT NULL AND resolved_at IS NULL)
        OR (status IN ('open', 'needs_confirmation', 'error') AND resolved_at IS NULL AND dismissed_at IS NULL AND dismissed_by IS NULL)
        OR status = 'suppressed'
      );
  END IF;
END $$;

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

CREATE OR REPLACE FUNCTION validate_fleetgraph_finding_reference()
RETURNS TRIGGER AS $$
DECLARE
  issue_workspace UUID;
  issue_type document_type;
  issue_deleted_at TIMESTAMPTZ;
  sprint_workspace UUID;
  sprint_type document_type;
  sprint_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT workspace_id, document_type, deleted_at
  INTO issue_workspace, issue_type, issue_deleted_at
  FROM documents
  WHERE id = NEW.source_issue_id;

  SELECT workspace_id, document_type, deleted_at
  INTO sprint_workspace, sprint_type, sprint_deleted_at
  FROM documents
  WHERE id = NEW.source_sprint_id;

  IF issue_workspace IS NULL THEN
    RAISE EXCEPTION 'FleetGraph source issue % does not exist', NEW.source_issue_id;
  END IF;

  IF sprint_workspace IS NULL THEN
    RAISE EXCEPTION 'FleetGraph source sprint % does not exist', NEW.source_sprint_id;
  END IF;

  IF issue_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph source issue % is deleted', NEW.source_issue_id;
  END IF;

  IF sprint_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph source sprint % is deleted', NEW.source_sprint_id;
  END IF;

  IF issue_workspace <> NEW.workspace_id OR sprint_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'FleetGraph source documents must be in the finding workspace';
  END IF;

  IF issue_type <> 'issue' THEN
    RAISE EXCEPTION 'FleetGraph source issue must be an issue document';
  END IF;

  IF sprint_type <> 'sprint' THEN
    RAISE EXCEPTION 'FleetGraph source sprint must be a sprint document';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_finding_reference_trigger ON fleetgraph_findings;
CREATE TRIGGER validate_fleetgraph_finding_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, source_issue_id, source_sprint_id ON fleetgraph_findings
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_finding_reference();

CREATE OR REPLACE FUNCTION validate_fleetgraph_run_reference()
RETURNS TRIGGER AS $$
DECLARE
  finding_workspace UUID;
  issue_workspace UUID;
  issue_type document_type;
  issue_deleted_at TIMESTAMPTZ;
  sprint_workspace UUID;
  sprint_type document_type;
  sprint_deleted_at TIMESTAMPTZ;
BEGIN
  IF NEW.finding_id IS NOT NULL THEN
    SELECT workspace_id
    INTO finding_workspace
    FROM fleetgraph_findings
    WHERE id = NEW.finding_id;

    IF finding_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph finding % does not exist', NEW.finding_id;
    END IF;

    IF finding_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph run finding must be in the run workspace';
    END IF;
  END IF;

  IF NEW.source_issue_id IS NOT NULL THEN
    SELECT workspace_id, document_type, deleted_at
    INTO issue_workspace, issue_type, issue_deleted_at
    FROM documents
    WHERE id = NEW.source_issue_id;

    IF issue_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph run source issue % does not exist', NEW.source_issue_id;
    END IF;

    IF issue_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'FleetGraph run source issue % is deleted', NEW.source_issue_id;
    END IF;

    IF issue_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph run source issue must be in the run workspace';
    END IF;

    IF issue_type <> 'issue' THEN
      RAISE EXCEPTION 'FleetGraph run source issue must be an issue document';
    END IF;
  END IF;

  IF NEW.source_sprint_id IS NOT NULL THEN
    SELECT workspace_id, document_type, deleted_at
    INTO sprint_workspace, sprint_type, sprint_deleted_at
    FROM documents
    WHERE id = NEW.source_sprint_id;

    IF sprint_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph run source sprint % does not exist', NEW.source_sprint_id;
    END IF;

    IF sprint_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'FleetGraph run source sprint % is deleted', NEW.source_sprint_id;
    END IF;

    IF sprint_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph run source sprint must be in the run workspace';
    END IF;

    IF sprint_type <> 'sprint' THEN
      RAISE EXCEPTION 'FleetGraph run source sprint must be a sprint document';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_run_reference_trigger ON fleetgraph_runs;
CREATE TRIGGER validate_fleetgraph_run_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, finding_id, source_issue_id, source_sprint_id ON fleetgraph_runs
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_run_reference();

CREATE OR REPLACE FUNCTION suppress_invalid_fleetgraph_findings_on_document_mutation()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE fleetgraph_findings
     SET status = 'suppressed',
         updated_at = NOW(),
         run_metadata = run_metadata || jsonb_build_object(
           'suppressed_reason', 'source_issue_invalidated',
           'suppressed_at', NOW()
         )
   WHERE source_issue_id = NEW.id
     AND status IN ('open', 'needs_confirmation', 'error')
     AND (
       NEW.workspace_id <> workspace_id
       OR NEW.document_type <> 'issue'
       OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
     );

  UPDATE fleetgraph_findings
     SET status = 'suppressed',
         updated_at = NOW(),
         run_metadata = run_metadata || jsonb_build_object(
           'suppressed_reason', 'source_sprint_invalidated',
           'suppressed_at', NOW()
         )
   WHERE source_sprint_id = NEW.id
     AND status IN ('open', 'needs_confirmation', 'error')
     AND (
       NEW.workspace_id <> workspace_id
       OR NEW.document_type <> 'sprint'
       OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
     );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_fleetgraph_source_document_mutation_trigger ON documents;
DROP TRIGGER IF EXISTS suppress_invalid_fleetgraph_findings_on_document_mutation_trigger ON documents;
CREATE TRIGGER suppress_invalid_fleetgraph_findings_on_document_mutation_trigger
AFTER UPDATE OF workspace_id, document_type, deleted_at ON documents
FOR EACH ROW
EXECUTE FUNCTION suppress_invalid_fleetgraph_findings_on_document_mutation();

COMMENT ON TABLE fleetgraph_findings IS 'FleetGraph-owned diagnosis findings. Does not replace Ship document, issue, week, or ownership state.';
COMMENT ON TABLE fleetgraph_runs IS 'FleetGraph run ledger for proactive, on-demand, quiet, trace, token, cost, and error metadata.';
COMMENT ON COLUMN fleetgraph_findings.dedupe_key IS 'Open-finding dedupe key, e.g. blocked-important-issue:{workspace_id}:{issue_id}:{sprint_id}.';
COMMENT ON COLUMN fleetgraph_findings.evidence_snapshot IS 'Permission-filterable evidence snapshot backing user-visible FleetGraph claims.';
COMMENT ON COLUMN fleetgraph_findings.draft_content IS 'FleetGraph-owned draft content requiring a human gate before Ship mutation or communication.';
