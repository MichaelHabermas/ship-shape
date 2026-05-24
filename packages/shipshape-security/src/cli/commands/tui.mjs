export function runTuiCommand() {
  console.warn(
    'shipshape-security tui is deprecated. Use: pnpm submission:render-dashboard && pnpm security:console'
  );
  console.error('Open the Security Console tab in the reviewer dashboard for interactive probe, CI mirror, and SS-FIND triage.');
  process.exit(1);
}
