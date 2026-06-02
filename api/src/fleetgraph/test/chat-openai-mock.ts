// TEST ONLY — synthesizes ChatOpenAI.invoke replies for rubric tests. Not imported by product code.
import type { FleetGraphChatHistoryEntry } from '@ship/shared';

export function synthesizeTestChatCompletion(messages: Array<[string, string]>): string {
  const human = messages.find(([role]) => role === 'human')?.[1] ?? '';
  const prompt = extractSection(human, 'User question:') ?? '';
  const context = extractSection(human, 'Ship context:') ?? '';
  const history = parseHistory(extractSection(human, 'Recent conversation:') ?? '');
  const normalized = prompt.trim().toLowerCase();
  const lastAssistant = [...history].reverse().find((entry) => entry.role === 'assistant')?.content?.trim();

  if (/^(hi|hello|hey|yo|sup)[!.?\s]*$/i.test(normalized)) {
    return 'Hi — what would you like to talk about?';
  }
  if (/^(thanks|thank you|ty)[!.?\s]*$/i.test(normalized)) {
    return "You're welcome.";
  }
  if (/\beven simpler\b/.test(normalized)) {
    if (contextIncludes(context, 'sample integration approval')) {
      return 'Blocked pending approval.';
    }
    if (lastAssistant) return shortenText(lastAssistant, 0.25);
  }
  if (/\b(simpler|make it simpler|make that simpler)\b/.test(normalized) && lastAssistant) {
    return shortenText(lastAssistant, 0.55);
  }
  if (/\b(bullets|bullet)\b/.test(normalized) && lastAssistant) {
    const segments = lastAssistant
      .replace(/^-\s+/gm, '')
      .split(/\n+|\.\s+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);
    return segments.map((line) => `- ${shortenText(line, 0.55)}`).join('\n');
  }
  if (/\b(contact|notify)\b/.test(normalized)) {
    return [
      'Human approval is required before FleetGraph contacts anyone or changes Ship records.',
      contextIncludes(context, 'sample integration approval') ? 'The attached context points to sample integration approval as the blocker.' : '',
    ].filter(Boolean).join('\n\n');
  }
  if (/\b(compare|comparison)\b/.test(normalized)) {
    const titles = titlesFromContext(context);
    return titles.map((title) => `- ${title}: ${compareFactForTitle(context, title)}`).join('\n');
  }
  if (contextIncludes(context, 'Empty deploy readiness issue')
    && (normalized.includes('description') || normalized.includes('supposed to do') || normalized.includes('doesn'))) {
    return 'This issue has no visible issue description in Ship, so it is under-described for deploy readiness work.';
  }
  if (/\b(summarize|summary|what'?s in this issue)\b/i.test(normalized)) {
    if (!context || context === '(none)') {
      return 'Open an issue or add a source chip so I can summarize authorized Ship context.';
    }
    if (contextIncludes(context, 'Sparse onboarding task')) {
      return 'Sparse onboarding task is a lightweight todo issue with limited detail in the visible body.';
    }
    if (contextIncludes(context, 'Empty deploy readiness issue')) {
      return 'Empty deploy readiness issue is open, but the visible issue description is missing.';
    }
    if (contextIncludes(context, 'Launch readiness notes')) {
      return summarizeAttachedDocuments(context);
    }
    return summarizeFromContext(context);
  }

  return summarizeFromContext(context) || 'I do not have enough context to answer that yet.';
}

function extractSection(human: string, label: string): string | null {
  const start = human.indexOf(label);
  if (start < 0) return null;
  const rest = human.slice(start + label.length).trimStart();
  const labels = ['Ship context:', 'Recent conversation:', 'User question:'];
  let end = rest.length;
  for (const next of labels) {
    if (next === label) continue;
    const index = rest.indexOf(`\n\n${next}`);
    if (index >= 0) end = Math.min(end, index);
  }
  return rest.slice(0, end).trim();
}

function parseHistory(block: string): FleetGraphChatHistoryEntry[] {
  if (!block || block === '(none)') return [];
  return block.split('\n').flatMap((line) => {
    const match = line.match(/^(user|assistant):\s*(.+)$/i);
    if (!match?.[1] || !match[2]) return [];
    return [{ role: match[1].toLowerCase() as 'user' | 'assistant', content: match[2] }];
  });
}

function summarizeFromContext(context: string): string {
  const titles = titlesFromContext(context);
  if (titles.length > 1) return summarizeAttachedDocuments(context);
  const title = titles[0];
  const state = propertyFromContext(context, 'state');
  const priority = propertyFromContext(context, 'priority');
  const body = paragraphTextFromContext(context);
  return [title, state ? `State: ${state}` : '', priority ? `Priority: ${priority}` : '', body].filter(Boolean).join('\n');
}

function summarizeAttachedDocuments(context: string): string {
  return titlesFromContext(context).map((title) => {
    const section = sectionForTitle(context, title);
    const state = propertyFromContext(section, 'state');
    const priority = propertyFromContext(section, 'priority');
    const body = paragraphTextFromContext(section);
    return [title, state ? `State: ${state}` : '', priority ? `Priority: ${priority}` : '', body].filter(Boolean).join('\n');
  }).join('\n\n');
}

function compareFactForTitle(context: string, title: string): string {
  const section = sectionForTitle(context, title);
  if (contextIncludes(section, 'QA owns launch smoke coverage')) return 'QA owns launch smoke coverage';
  if (contextIncludes(section, 'sample integration approval')) return 'blocked on sample integration approval';
  return paragraphTextFromContext(section).slice(0, 120);
}

function sectionForTitle(context: string, title: string): string {
  const blocks = context.split(/\n\n+/);
  return blocks.find((block) => block.includes(`Title: ${title}`)) ?? context;
}

function titlesFromContext(context: string): string[] {
  const titles: string[] = [];
  for (const match of context.matchAll(/^Title: (.+)$/gm)) {
    const title = match[1]?.trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

function propertyFromContext(context: string, key: string): string | null {
  const match = context.match(new RegExp(`\\b${key}:\\s*([a-z0-9_ -]+)`, 'i'));
  return match?.[1]?.trim() ?? null;
}

function paragraphTextFromContext(context: string): string {
  const lines = context.split('\n').map((line) => line.trim()).filter(Boolean);
  const skipPrefixes = ['Title:', 'Type:', 'State:', 'Priority:', 'Connected to:', 'Signal:', 'Summary:', 'Reason:', 'Recommended action:', 'Surface:', 'Route:', 'Visible item count hint:', 'Selected item count hint:', 'Authorized items:'];
  return lines.filter((line) => !skipPrefixes.some((prefix) => line.startsWith(prefix))).join(' ');
}

function contextIncludes(context: string, needle: string): boolean {
  return context.toLowerCase().includes(needle.toLowerCase());
}

function shortenText(value: string, ratio: number): string {
  const words = value.replace(/\s+/g, ' ').trim().split(' ');
  const count = Math.max(6, Math.floor(words.length * ratio));
  return words.slice(0, count).join(' ');
}
