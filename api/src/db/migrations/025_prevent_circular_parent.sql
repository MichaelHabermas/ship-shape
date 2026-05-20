-- Prevent circular references in document parent_id
-- This protects against infinite loops in recursive CTE queries

-- Step 1: Add simple CHECK constraint for self-reference
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_no_self_parent'
      AND conrelid = 'documents'::regclass
  ) THEN
    ALTER TABLE documents
    ADD CONSTRAINT documents_no_self_parent
    CHECK (id != parent_id);
  END IF;
END;
$$;

-- Step 2: Create function to detect circular references by traversing ancestors
CREATE OR REPLACE FUNCTION prevent_circular_parent()
RETURNS TRIGGER AS $$
DECLARE
  current_parent UUID;
  depth INT := 0;
  max_depth INT := 100;
BEGIN
  -- Skip check if parent_id is NULL or unchanged
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- For updates, skip if parent_id hasn't changed
  IF TG_OP = 'UPDATE' AND OLD.parent_id IS NOT DISTINCT FROM NEW.parent_id THEN
    RETURN NEW;
  END IF;

  -- Traverse up the tree to check for cycles
  current_parent := NEW.parent_id;

  WHILE current_parent IS NOT NULL AND depth < max_depth LOOP
    -- If we find the new document's ID in ancestors, it's a cycle
    IF current_parent = NEW.id THEN
      RAISE EXCEPTION 'Circular reference detected: document % cannot be a descendant of itself', NEW.id;
    END IF;

    -- Move up to the parent's parent
    SELECT parent_id INTO current_parent
    FROM documents
    WHERE id = current_parent;

    depth := depth + 1;
  END LOOP;

  -- If we hit max depth, something is wrong
  IF depth >= max_depth THEN
    RAISE EXCEPTION 'Maximum nesting depth (%) exceeded while checking for circular reference', max_depth;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create trigger to run the function
DROP TRIGGER IF EXISTS prevent_circular_parent_trigger ON documents;
CREATE TRIGGER prevent_circular_parent_trigger
BEFORE INSERT OR UPDATE OF parent_id ON documents
FOR EACH ROW
EXECUTE FUNCTION prevent_circular_parent();
