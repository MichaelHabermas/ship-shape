-- FleetGraph worker lifecycle ledger for scheduled proactive scans.

CREATE TABLE IF NOT EXISTS fleetgraph_worker_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'completed', 'failed', 'skipped_lock')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deadline_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  workspace_count INTEGER NOT NULL DEFAULT 0 CHECK (workspace_count >= 0),
  detector_decision_count INTEGER NOT NULL DEFAULT 0 CHECK (detector_decision_count >= 0),
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  model_call_count INTEGER NOT NULL DEFAULT 0 CHECK (model_call_count >= 0),
  error_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fleetgraph_worker_ticks_completed_check CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status IN ('completed', 'failed', 'skipped_lock') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_worker_ticks_started
  ON fleetgraph_worker_ticks(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_fleetgraph_worker_ticks_status
  ON fleetgraph_worker_ticks(status, started_at DESC);
