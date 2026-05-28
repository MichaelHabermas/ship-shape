// Shapes FleetGraph decision packets, persisted runs, and deltas into visible output.
import { proposedRecipientForVisibleOutput, recipientRationaleForRole } from '../evidence.js';
import type { FleetGraphRun } from '../persistence.js';
import type {
  FleetGraphChangeSummary,
  FleetGraphDecisionPacket,
  FleetGraphEvidenceItem,
  FleetGraphVisibleOutput,
} from '../types.js';
import { isJsonRecord, stringFromJsonRecord } from './json.js';

export function visibleOutputFromPacket(
  packet: FleetGraphDecisionPacket,
  evidence: FleetGraphEvidenceItem[]
): FleetGraphVisibleOutput {
  return {
    title: packet.title,
    summary: packet.summary,
    severity: packet.severity,
    confidence: packet.confidence,
    recommendedAction: packet.recommendedAction,
    proposedRecipient: proposedRecipientForVisibleOutput(packet.proposedRecipient),
    recipientRationale: recipientRationaleForRole(packet.proposedRecipient.role),
    uncertaintyNotes: packet.uncertaintyNotes,
    evidence,
    humanGate: packet.humanGate,
    draftContent: packet.draftContent,
  };
}

export function visibleOutputFromRun(run: FleetGraphRun | undefined): FleetGraphVisibleOutput | null {
  if (!run || !isJsonRecord(run.output_snapshot)) return null;
  const output = run.output_snapshot;
  if (typeof output.title !== 'string' || typeof output.summary !== 'string') return null;
  return {
    title: output.title,
    summary: output.summary,
    severity: fleetGraphSeverity(output.severity),
    recommendedAction: isJsonRecord(output.recommendedAction) ? output.recommendedAction : undefined,
    proposedRecipient: isJsonRecord(output.proposedRecipient) ? output.proposedRecipient : undefined,
    uncertaintyNotes: Array.isArray(output.uncertaintyNotes)
      ? output.uncertaintyNotes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
      : undefined,
    evidence: [],
    humanGate: isJsonRecord(output.humanGate) ? output.humanGate : {},
    draftContent: isJsonRecord(output.draftContent) ? output.draftContent : undefined,
  };
}

export function changeSummaryFromOutputs(current: FleetGraphVisibleOutput, previous: FleetGraphVisibleOutput | null): FleetGraphChangeSummary {
  if (!previous) {
    return {
      headline: 'No prior run',
      rows: [
        { label: 'Now', text: blockerLine(current.summary) },
        { label: 'Not done', text: 'No issue changed. No message sent.' },
      ],
    };
  }

  const rows: FleetGraphChangeSummary['rows'] = [];
  const previousBlocker = blockerLine(previous.summary);
  const currentBlocker = blockerLine(current.summary);
  if (previousBlocker !== currentBlocker) rows.push({ label: 'Now', text: currentBlocker });
  if (previous.severity !== current.severity && current.severity) {
    rows.push({ label: 'Changed', text: `Priority ${sentenceLabel(previous.severity)} -> ${sentenceLabel(current.severity)}.` });
  }

  const previousAction = actionLabel(previous);
  const currentAction = actionLabel(current);
  if (currentAction && currentAction !== previousAction) rows.push({ label: 'Next', text: currentAction });

  if (rows.length === 0) {
    return {
      headline: 'No meaningful change',
      rows: [{ label: 'Not done', text: 'No issue changed. No message sent.' }],
    };
  }

  rows.push({ label: 'Not done', text: 'No issue changed. No message sent.' });
  return {
    headline: rows[0]?.text ?? 'Changed',
    rows,
  };
}

function blockerLine(summary: string): string {
  const recordedBlocker = summary.match(/recorded blocker:\s*(.+)$/i)?.[1];
  return (recordedBlocker ?? summary).replace(/\.$/, '').trim();
}

function actionLabel(output: FleetGraphVisibleOutput): string | null {
  return stringFromJsonRecord(output.recommendedAction, ['label', 'text', 'summary']);
}

function sentenceLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Unknown';
  const text = value.replace(/_/g, ' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function fleetGraphSeverity(value: unknown): FleetGraphVisibleOutput['severity'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent' ? value : undefined;
}
