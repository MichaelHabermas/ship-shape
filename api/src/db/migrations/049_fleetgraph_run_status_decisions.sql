ALTER TABLE fleetgraph_runs
  DROP CONSTRAINT IF EXISTS fleetgraph_runs_decision_check;

ALTER TABLE fleetgraph_runs
  ADD CONSTRAINT fleetgraph_runs_decision_check
  CHECK (decision IN (
    'quiet_exit',
    'create_finding',
    'update_finding',
    'explain',
    'refine_draft',
    'summarize_changes',
    'needs_confirmation',
    'dismiss',
    'resolve',
    'suppress',
    'error'
  ));
