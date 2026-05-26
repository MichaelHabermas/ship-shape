// FleetGraph state panel renders contextual loading, empty, and error states.
type FleetGraphStatePanelProps = {
  state: 'loading' | 'empty' | 'error';
  message?: string;
};

export function FleetGraphStatePanel({ state, message }: FleetGraphStatePanelProps) {
  if (state === 'loading') {
    return (
      <div className="rounded border border-border bg-border/20 px-3 py-2 text-sm text-muted" role="status">
        Loading FleetGraph...
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
        {message ?? 'FleetGraph is unavailable for this context.'}
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-border/20 px-3 py-2 text-sm text-muted">
      {message ?? 'No visible FleetGraph finding here.'}
    </div>
  );
}
