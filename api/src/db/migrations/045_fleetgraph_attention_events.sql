-- FleetGraph durable attention events and per-user notification read state.

CREATE TABLE IF NOT EXISTS fleetgraph_attention_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_issue_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_sprint_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  source_sprint_key UUID GENERATED ALWAYS AS (COALESCE(source_sprint_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'issue_changed',
    'issue_iteration_added',
    'issue_week_changed',
    'issue_visibility_changed',
    'repair_scan'
  )),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'processing',
    'completed',
    'failed',
    'skipped'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fleetgraph_attention_events_processing_lock_check CHECK (
    (status = 'processing' AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
    OR (status <> 'processing')
  ),
  CONSTRAINT fleetgraph_attention_events_processed_check CHECK (
    (status IN ('completed', 'failed', 'skipped') AND processed_at IS NOT NULL)
    OR (status IN ('pending', 'processing'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetgraph_attention_events_active_dedupe
  ON fleetgraph_attention_events(
    workspace_id,
    source_issue_id,
    source_sprint_key,
    event_type
  )
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_fleetgraph_attention_events_claim
  ON fleetgraph_attention_events(status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_attention_events_source
  ON fleetgraph_attention_events(workspace_id, source_issue_id, source_sprint_id, status);

CREATE OR REPLACE FUNCTION validate_fleetgraph_attention_event_reference()
RETURNS TRIGGER AS $$
DECLARE
  issue_workspace UUID;
  issue_type TEXT;
  issue_deleted_at TIMESTAMPTZ;
  sprint_workspace UUID;
  sprint_type TEXT;
  sprint_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT workspace_id, document_type, deleted_at
    INTO issue_workspace, issue_type, issue_deleted_at
    FROM documents
   WHERE id = NEW.source_issue_id;

  IF issue_workspace IS NULL THEN
    IF TG_OP = 'UPDATE'
      AND OLD.source_issue_id = NEW.source_issue_id
      AND OLD.source_sprint_id IS NOT NULL
      AND NEW.source_sprint_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FleetGraph attention event source issue must exist';
  END IF;

  IF issue_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'FleetGraph attention event source issue must be in the event workspace';
  END IF;

  IF issue_type <> 'issue' THEN
    RAISE EXCEPTION 'FleetGraph attention event source issue must be an issue document';
  END IF;

  IF issue_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph attention event source issue must not be deleted';
  END IF;

  IF NEW.source_sprint_id IS NOT NULL THEN
    SELECT workspace_id, document_type, deleted_at
      INTO sprint_workspace, sprint_type, sprint_deleted_at
      FROM documents
     WHERE id = NEW.source_sprint_id;

    IF sprint_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must exist';
    END IF;

    IF sprint_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must be in the event workspace';
    END IF;

    IF sprint_type <> 'sprint' THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must be a sprint document';
    END IF;

    IF sprint_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must not be deleted';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_attention_event_reference_trigger ON fleetgraph_attention_events;
CREATE TRIGGER validate_fleetgraph_attention_event_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, source_issue_id, source_sprint_id ON fleetgraph_attention_events
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_attention_event_reference();

CREATE TABLE IF NOT EXISTS fleetgraph_notification_reads (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  finding_id UUID NOT NULL REFERENCES fleetgraph_findings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (finding_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_notification_reads_workspace_user
  ON fleetgraph_notification_reads(workspace_id, user_id, read_at DESC);

COMMENT ON TABLE fleetgraph_attention_events IS 'FleetGraph-owned durable queue for targeted attention rechecks after Ship source changes.';
COMMENT ON TABLE fleetgraph_notification_reads IS 'Per-user read state for FleetGraph-produced notification rows; source finding state remains FleetGraph-owned.';
