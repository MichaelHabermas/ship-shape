-- FleetGraph attention event guards validate durable queue source references.

CREATE OR REPLACE FUNCTION validate_fleetgraph_attention_event_reference()
RETURNS TRIGGER AS $$
DECLARE
  issue_workspace UUID;
  issue_type TEXT;
  issue_deleted_at TIMESTAMPTZ;
  issue_archived_at TIMESTAMPTZ;
  sprint_workspace UUID;
  sprint_type TEXT;
  sprint_deleted_at TIMESTAMPTZ;
  sprint_archived_at TIMESTAMPTZ;
BEGIN
  SELECT workspace_id, document_type, deleted_at, archived_at
    INTO issue_workspace, issue_type, issue_deleted_at, issue_archived_at
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

  IF issue_deleted_at IS NOT NULL OR issue_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph attention event source issue must be active';
  END IF;

  IF NEW.source_sprint_id IS NOT NULL THEN
    SELECT workspace_id, document_type, deleted_at, archived_at
      INTO sprint_workspace, sprint_type, sprint_deleted_at, sprint_archived_at
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

    IF sprint_deleted_at IS NOT NULL OR sprint_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must be active';
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
