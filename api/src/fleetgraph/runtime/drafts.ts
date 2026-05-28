// Builds deterministic FleetGraph draft revisions without model calls.
import type { FleetGraphFinding } from '../persistence.js';
import { stringFromJsonRecord } from './json.js';

export function deterministicRefinedDraft(finding: FleetGraphFinding, instruction: string): string {
  const normalizedInstruction = instruction.toLowerCase();
  const existingDraft = stringFromJsonRecord(finding.draft_content, ['message', 'text', 'draft', 'body']) ?? finding.summary;
  const evidenceClaims = Array.isArray(finding.evidence_snapshot)
    ? finding.evidence_snapshot
        .map((item) => stringFromJsonRecord(item, ['claim']))
        .filter((claim): claim is string => Boolean(claim))
        .slice(0, 3)
    : [];
  const blockerExcerpt = evidenceClaims[0] ?? finding.summary;
  const wantsMoreDetail = /\b(detail|detailed|context|explain|longer|specific|far more|a lot more)\b/.test(normalizedInstruction);
  const wantsFirmer = /\b(firm|firmer|direct|harsher|harder|urgent|pressure|forceful)\b/.test(normalizedInstruction);
  const wantsSofter = /\b(soft|softer|gentle|polite|warmer)\b/.test(normalizedInstruction);
  const wantsShorter = /\b(short|shorter|concise|brief|tight)\b/.test(normalizedInstruction);

  if (wantsShorter && !wantsMoreDetail) {
    return `${finding.title}: please confirm the unblock path today. ${finding.summary}`;
  }

  if (wantsMoreDetail) {
    const opener = wantsFirmer
      ? `This needs a clear unblock decision now: ${finding.title}.`
      : wantsSofter
        ? `Can you help clarify the unblock path for ${finding.title}?`
        : `Can you confirm the unblock path for ${finding.title}?`;
    const consequence = wantsFirmer
      ? 'Without a concrete owner, decision, or dependency update, this active-week work remains blocked and FleetGraph will continue treating it as PM-review work.'
      : 'FleetGraph is keeping this in PM review until the current unblock path is confirmed.';
    const evidenceText = evidenceClaims.length > 0
      ? evidenceClaims.map((claim) => `- ${claim}`).join('\n')
      : `- ${blockerExcerpt}`;

    return `${opener}\n\nCurrent signal:\n${evidenceText}\n\nRequested next step: confirm who owns the unblock, what decision or approval is needed, and whether this can move today. ${consequence}`;
  }

  if (wantsFirmer) {
    return `${finding.title} is still blocked and needs a direct unblock decision. ${finding.summary}\n\nPlease confirm the owner, dependency, and next step today so this does not stay stuck in active-week work.`;
  }

  if (wantsSofter) {
    return `Can you help confirm the current unblock path for ${finding.title}? ${finding.summary}\n\nA quick owner or dependency update would help FleetGraph keep the active-week plan accurate.`;
  }

  return `${existingDraft}\n\nRevision request applied: ${instruction}`;
}
