import { runRunCommand } from './commands/run.mjs';
import { runFindingsCommand } from './commands/findings.mjs';
import { runCiCommand } from './commands/ci.mjs';
import { runBaselineCommand } from './commands/baseline.mjs';
import { runComplianceCommand } from './commands/compliance.mjs';
import { runTuiCommand } from './commands/tui.mjs';

const HELP = `shipshape-security — ShipShape Category 8 security audit tool

USAGE
  shipshape-security <command> [options]

COMMANDS
  run              Run live security probe against API (default: 5 surfaces)
  ci               Full CI gate: DB, API, tests, probe --fail-on=new, findings check
  findings         Manage SS-FIND backlog (security-findings.json)
  baseline         Dependency baselines and Cat 8 deliverable table
  compliance       Print audit deliverable vs latest probe
  tui              Deprecated — use pnpm security:console

  help             Show this help

PROBE (shipshape-security run)
  --run-id <id>           Immutable report folder name
  --api-url <url>         API base (default: .ports or localhost:3000)
  --web-url <url>         Web origin for CORS/WS tests
  --quick                 Skip slow probe groups
  --probe <id>            Run one probe or prefix
  --fail-on=new|high|...  Exit policy (default: high)
  --record-verifications  Append probe results to security-findings.json
  --cat8-perimeter        4 surfaces only (historical Cat 8 closeout mode)

FINDINGS (shipshape-security findings)
  list | show <id> | status <id> <status> [--note]
  render | check | link-probe | record-manual | migrate

EXAMPLES
  shipshape-security run
  shipshape-security run --fail-on=new --record-verifications
  shipshape-security ci
  shipshape-security findings list
  shipshape-security findings status SS-FIND-008 open --note "document scope open"
  shipshape-security compliance
  pnpm security:console

Evidence: my-docs/evidence/security-audit/
Source:   my-docs/project-weeks-sot/week-4/Shipshape-Security-Audit.txt
`;

export async function runCli(argv) {
  const [command, subcommand, ...rest] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  switch (command) {
    case 'run':
    case 'probe':
      await runRunCommand(argv.slice(1));
      break;
    case 'ci':
      await runCiCommand();
      break;
    case 'findings':
      await runFindingsCommand(subcommand, rest);
      break;
    case 'baseline':
      await runBaselineCommand(subcommand);
      break;
    case 'compliance':
      runComplianceCommand();
      break;
    case 'tui':
      await runTuiCommand();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}
