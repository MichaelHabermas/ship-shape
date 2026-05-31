-- Stores reviewer-only before/after chat source snapshots for FleetGraph mutation proof.
CREATE TABLE IF NOT EXISTS fleetgraph_reviewer_chat_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_issue_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  finding_id UUID REFERENCES fleetgraph_findings(id) ON DELETE SET NULL,
  chat_run_id UUID REFERENCES fleetgraph_runs(id) ON DELETE SET NULL,
  before_state JSONB NOT NULL DEFAULT '{}',
  after_state JSONB NOT NULL DEFAULT '{}',
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_reviewer_chat_proofs_workspace_created
  ON fleetgraph_reviewer_chat_proofs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_reviewer_chat_proofs_source
  ON fleetgraph_reviewer_chat_proofs (workspace_id, source_issue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_reviewer_chat_proofs_finding
  ON fleetgraph_reviewer_chat_proofs (workspace_id, finding_id, created_at DESC)
  WHERE finding_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_fleetgraph_reviewer_chat_proof_reference()
RETURNS TRIGGER AS $$
DECLARE
  issue_workspace UUID;
  issue_type document_type;
  issue_deleted_at TIMESTAMPTZ;
  finding_workspace UUID;
  finding_source_issue_id UUID;
  run_workspace UUID;
  run_source_issue_id UUID;
  run_finding_id UUID;
  run_mode TEXT;
  run_trigger_reason TEXT;
BEGIN
  SELECT workspace_id, document_type, deleted_at
  INTO issue_workspace, issue_type, issue_deleted_at
  FROM documents
  WHERE id = NEW.source_issue_id;

  IF issue_workspace IS NULL THEN
    RAISE EXCEPTION 'FleetGraph reviewer proof source issue % does not exist', NEW.source_issue_id;
  END IF;

  IF issue_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph reviewer proof source issue % is deleted', NEW.source_issue_id;
  END IF;

  IF issue_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'FleetGraph reviewer proof source issue must be in the proof workspace';
  END IF;

  IF issue_type <> 'issue' THEN
    RAISE EXCEPTION 'FleetGraph reviewer proof source issue must be an issue document';
  END IF;

  IF NEW.finding_id IS NOT NULL THEN
    SELECT workspace_id, source_issue_id
    INTO finding_workspace, finding_source_issue_id
    FROM fleetgraph_findings
    WHERE id = NEW.finding_id;

    IF finding_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof finding % does not exist', NEW.finding_id;
    END IF;

    IF finding_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof finding must be in the proof workspace';
    END IF;

    IF finding_source_issue_id <> NEW.source_issue_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof finding must match the proof source issue';
    END IF;
  END IF;

  IF NEW.chat_run_id IS NOT NULL THEN
    SELECT workspace_id, source_issue_id, finding_id, mode, trigger_reason
    INTO run_workspace, run_source_issue_id, run_finding_id, run_mode, run_trigger_reason
    FROM fleetgraph_runs
    WHERE id = NEW.chat_run_id;

    IF run_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run % does not exist', NEW.chat_run_id;
    END IF;

    IF run_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run must be in the proof workspace';
    END IF;

    IF run_source_issue_id <> NEW.source_issue_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run must match the proof source issue';
    END IF;

    IF NEW.finding_id IS NOT NULL AND run_finding_id <> NEW.finding_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run must match the proof finding';
    END IF;

    IF run_mode <> 'on_demand' OR run_trigger_reason <> 'reviewer-source-mutation-proof' THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run must be the reviewer source mutation proof run';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_reviewer_chat_proof_reference_trigger ON fleetgraph_reviewer_chat_proofs;
CREATE TRIGGER validate_fleetgraph_reviewer_chat_proof_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, source_issue_id, finding_id, chat_run_id ON fleetgraph_reviewer_chat_proofs
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_reviewer_chat_proof_reference();
