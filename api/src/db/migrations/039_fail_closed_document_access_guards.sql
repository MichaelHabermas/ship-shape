-- Fail-closed authorization guardrails.
-- Keep this narrow: enforce impossible relationship states without changing the
-- unified document model or introducing per-document ACLs.

UPDATE api_tokens t
SET revoked_at = COALESCE(t.revoked_at, NOW())
FROM users u
WHERE t.user_id = u.id
  AND u.is_super_admin = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    WHERE wm.user_id = t.user_id
      AND wm.workspace_id = t.workspace_id
  );

CREATE OR REPLACE FUNCTION validate_document_parent_reference()
RETURNS TRIGGER AS $$
DECLARE
  parent_workspace UUID;
  parent_deleted_at TIMESTAMPTZ;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT workspace_id, deleted_at
  INTO parent_workspace, parent_deleted_at
  FROM documents
  WHERE id = NEW.parent_id;

  IF parent_workspace IS NULL THEN
    RAISE EXCEPTION 'Parent document % does not exist', NEW.parent_id;
  END IF;

  IF parent_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Parent document % is in a different workspace', NEW.parent_id;
  END IF;

  IF parent_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Parent document % is deleted', NEW.parent_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_document_parent_reference_trigger ON documents;
CREATE TRIGGER validate_document_parent_reference_trigger
BEFORE INSERT OR UPDATE OF parent_id, workspace_id ON documents
FOR EACH ROW
EXECUTE FUNCTION validate_document_parent_reference();

CREATE OR REPLACE FUNCTION validate_document_association_reference()
RETURNS TRIGGER AS $$
DECLARE
  source_workspace UUID;
  source_deleted_at TIMESTAMPTZ;
  related_workspace UUID;
  related_deleted_at TIMESTAMPTZ;
  related_type document_type;
BEGIN
  SELECT workspace_id, deleted_at
  INTO source_workspace, source_deleted_at
  FROM documents
  WHERE id = NEW.document_id;

  SELECT workspace_id, deleted_at, document_type
  INTO related_workspace, related_deleted_at, related_type
  FROM documents
  WHERE id = NEW.related_id;

  IF source_workspace IS NULL THEN
    RAISE EXCEPTION 'Source document % does not exist', NEW.document_id;
  END IF;

  IF related_workspace IS NULL THEN
    RAISE EXCEPTION 'Related document % does not exist', NEW.related_id;
  END IF;

  IF source_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Source document % is deleted', NEW.document_id;
  END IF;

  IF related_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Related document % is deleted', NEW.related_id;
  END IF;

  IF source_workspace <> related_workspace THEN
    RAISE EXCEPTION 'Association documents must be in the same workspace';
  END IF;

  IF NEW.relationship_type = 'program' AND related_type <> 'program' THEN
    RAISE EXCEPTION 'Program association target must be a program document';
  END IF;

  IF NEW.relationship_type = 'project' AND related_type <> 'project' THEN
    RAISE EXCEPTION 'Project association target must be a project document';
  END IF;

  IF NEW.relationship_type = 'sprint' AND related_type <> 'sprint' THEN
    RAISE EXCEPTION 'Sprint association target must be a sprint document';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_document_association_reference_trigger ON document_associations;
CREATE TRIGGER validate_document_association_reference_trigger
BEFORE INSERT OR UPDATE OF document_id, related_id, relationship_type ON document_associations
FOR EACH ROW
EXECUTE FUNCTION validate_document_association_reference();
