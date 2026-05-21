-- Keep relationship guardrails valid when referenced documents mutate after an
-- association or parent link was originally created.

DELETE FROM document_associations da
USING documents source, documents related
WHERE source.id = da.document_id
  AND related.id = da.related_id
  AND (
    source.deleted_at IS NOT NULL
    OR related.deleted_at IS NOT NULL
    OR source.workspace_id <> related.workspace_id
    OR (da.relationship_type = 'program' AND related.document_type <> 'program')
    OR (da.relationship_type = 'project' AND related.document_type <> 'project')
    OR (da.relationship_type = 'sprint' AND related.document_type <> 'sprint')
  );

UPDATE documents child
SET parent_id = NULL,
    updated_at = NOW()
FROM documents parent
WHERE child.parent_id = parent.id
  AND (
    parent.deleted_at IS NOT NULL
    OR child.workspace_id <> parent.workspace_id
  );

CREATE OR REPLACE FUNCTION guard_document_relationship_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    IF EXISTS (
      SELECT 1
      FROM documents child
      WHERE child.parent_id = NEW.id
    ) OR NEW.parent_id IS NOT NULL OR EXISTS (
      SELECT 1
      FROM document_associations da
      WHERE da.document_id = NEW.id OR da.related_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Cannot move document % to another workspace while relationships exist', NEW.id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.document_type IS DISTINCT FROM NEW.document_type THEN
    IF EXISTS (
      SELECT 1
      FROM document_associations da
      WHERE da.related_id = NEW.id
        AND (
          (da.relationship_type = 'program' AND NEW.document_type <> 'program')
          OR (da.relationship_type = 'project' AND NEW.document_type <> 'project')
          OR (da.relationship_type = 'sprint' AND NEW.document_type <> 'sprint')
        )
    ) THEN
      RAISE EXCEPTION 'Cannot change document % type while typed associations depend on it', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_document_relationship_mutation_trigger ON documents;
CREATE TRIGGER guard_document_relationship_mutation_trigger
BEFORE UPDATE OF workspace_id, document_type ON documents
FOR EACH ROW
EXECUTE FUNCTION guard_document_relationship_mutation();

CREATE OR REPLACE FUNCTION cleanup_document_relationships_on_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM document_associations
    WHERE document_id = NEW.id OR related_id = NEW.id;

    UPDATE documents
    SET parent_id = NULL,
        updated_at = NOW()
    WHERE parent_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cleanup_document_relationships_on_soft_delete_trigger ON documents;
CREATE TRIGGER cleanup_document_relationships_on_soft_delete_trigger
AFTER UPDATE OF deleted_at ON documents
FOR EACH ROW
EXECUTE FUNCTION cleanup_document_relationships_on_soft_delete();
