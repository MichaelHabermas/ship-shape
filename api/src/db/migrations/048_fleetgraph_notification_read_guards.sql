-- FleetGraph notification read guards keep per-user read state in the finding workspace.

CREATE OR REPLACE FUNCTION validate_fleetgraph_notification_read_reference()
RETURNS TRIGGER AS $$
DECLARE
  finding_workspace UUID;
BEGIN
  SELECT workspace_id
    INTO finding_workspace
    FROM fleetgraph_findings
   WHERE id = NEW.finding_id;

  IF finding_workspace IS NULL THEN
    RAISE EXCEPTION 'FleetGraph notification read finding must exist';
  END IF;

  IF finding_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'FleetGraph notification read workspace must match finding workspace';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_notification_read_reference_trigger ON fleetgraph_notification_reads;
CREATE TRIGGER validate_fleetgraph_notification_read_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, finding_id ON fleetgraph_notification_reads
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_notification_read_reference();
