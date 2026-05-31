// FleetGraph product-surface evals score user-facing copy quality without replacing reviewer proof.
export const FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS = [
  'actionability',
  'groundedness',
  'specificity',
  'brevity',
  'repetitionBudget',
  'informationDensity',
  'cavemanCopy',
  'duplicateFactControl',
  'uncertaintyHonesty',
  'missingDataUsefulness',
  'uiProofSeparation',
] as const;

export type FleetGraphProductSurfaceDimension = typeof FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS[number];

export type FleetGraphProductSurfaceScores = Record<FleetGraphProductSurfaceDimension, number>;

export type FleetGraphProductSurfaceCase = {
  id: string;
  title: string;
  input: {
    cardTitle: string;
    cardSummary: string;
    blockerText?: string;
    owner?: string | null;
    context?: string | null;
    nextAction?: string;
    visibleCopy: readonly string[];
  };
  expectedMinimum: FleetGraphProductSurfaceScores;
  notes: readonly string[];
};

export type FleetGraphProductSurfaceResult = {
  caseId: string;
  scores: FleetGraphProductSurfaceScores;
  pass: boolean;
  failedDimensions: FleetGraphProductSurfaceDimension[];
};

export type FleetGraphProductSurfaceSummary = {
  average: FleetGraphProductSurfaceScores;
  passCount: number;
  failCount: number;
};

const maxScore = 4;

export const fleetGraphProductSurfaceCases = [
  {
    id: 'fg-surface-clear-blocker',
    title: 'Blocked issue copy names the concrete blocker and next move once',
    input: {
      cardTitle: 'Audit issue 110',
      cardSummary: 'Audit issue 110 is blocked by missing API credentials.',
      blockerText: 'Missing API credentials',
      owner: 'Audit Load User 029',
      context: 'Week 11',
      nextAction: 'Ask Audit Load User 029 to confirm who owns the API credentials.',
      visibleCopy: [
        'Blocked',
        'Audit issue 110',
        'Missing API credentials',
        'Audit Load User 029',
        'Week 11',
        'Confirm credential owner.',
      ],
    },
    expectedMinimum: scoreThresholds({
      actionability: 4,
      specificity: 4,
      repetitionBudget: 4,
      informationDensity: 4,
      duplicateFactControl: 4,
    }),
    notes: [
      'User can see the blocker and next move without reading architecture proof.',
      'Blocked appears as useful state, not repeated filler.',
    ],
  },
  {
    id: 'fg-surface-missing-blocker-text',
    title: 'Missing blocker text is explained as a useful data gap',
    input: {
      cardTitle: 'Audit issue 110',
      cardSummary: 'Issue is marked blocked, but no blocker reason is recorded.',
      blockerText: '',
      owner: 'Audit Load User 029',
      context: 'Week 11',
      nextAction: 'Add reason.',
      visibleCopy: [
        'Blocked',
        'Audit issue 110',
        'Blocker missing',
        'Audit Load User 029',
        'Week 11',
        'Add reason.',
      ],
    },
    expectedMinimum: scoreThresholds({
      uncertaintyHonesty: 4,
      missingDataUsefulness: 4,
      actionability: 4,
      cavemanCopy: 4,
    }),
    notes: [
      'Missing evidence should become a concrete next step.',
      'The copy should not pretend the blocker is known.',
    ],
  },
  {
    id: 'fg-surface-ui-proof-boundary',
    title: 'User copy stays free of reviewer-proof scaffolding',
    input: {
      cardTitle: 'Audit issue 110',
      cardSummary: 'Issue is marked blocked and needs owner follow-up.',
      blockerText: 'Waiting on review',
      owner: null,
      context: 'Audit Project',
      nextAction: 'Find approver.',
      visibleCopy: [
        'Blocked',
        'Audit issue 110',
        'Owner missing',
        'Waiting on review',
        '-',
        'Audit Project',
        'Find approver.',
      ],
    },
    expectedMinimum: scoreThresholds({
      uiProofSeparation: 4,
      uncertaintyHonesty: 3,
      missingDataUsefulness: 4,
      cavemanCopy: 4,
    }),
    notes: [
      'Reviewer evidence belongs in traces, logs, tests, and docs.',
      'User copy can show missing owner compactly without exposing graph/debug fields.',
    ],
  },
  {
    id: 'fg-surface-stale-active-work',
    title: 'Stale work copy names inactivity and the review move',
    input: {
      cardTitle: 'Integration cleanup',
      cardSummary: 'Integration cleanup looks stale. No meaningful update for 30+ days.',
      blockerText: 'No meaningful update for 30+ days',
      owner: 'Riley Builder',
      context: 'Week 11',
      nextAction: 'Review or close.',
      visibleCopy: [
        'Stale',
        'Integration cleanup',
        'No meaningful update for 30+ days',
        'Riley Builder',
        'Week 11',
        'Review or close.',
      ],
    },
    expectedMinimum: scoreThresholds({
      actionability: 4,
      uncertaintyHonesty: 4,
      missingDataUsefulness: 4,
      uiProofSeparation: 4,
    }),
    notes: [
      'Stale copy should explain the time-based evidence.',
      'The next step stays human-owned instead of pretending FleetGraph closed work.',
    ],
  },
  {
    id: 'fg-surface-at-risk-current-week',
    title: 'At-risk work copy names current-week risk and owner decision',
    input: {
      cardTitle: 'Rollout checklist',
      cardSummary: 'Rollout checklist is at risk because current-week high-priority work has no owner.',
      blockerText: 'Owner missing',
      owner: null,
      context: 'Week 11',
      nextAction: 'Confirm owner.',
      visibleCopy: [
        'At risk',
        'Rollout checklist',
        'Owner missing',
        'High-priority current-week work',
        'Week 11',
        'Confirm owner.',
      ],
    },
    expectedMinimum: scoreThresholds({
      actionability: 4,
      specificity: 3,
      missingDataUsefulness: 4,
      uiProofSeparation: 4,
    }),
    notes: [
      'At-risk copy should identify the planning risk, not only urgency.',
      'Missing owner becomes a decision prompt for the PM.',
    ],
  },
] as const satisfies readonly FleetGraphProductSurfaceCase[];

export function scoreFleetGraphProductSurfaceCase(
  testCase: FleetGraphProductSurfaceCase
): FleetGraphProductSurfaceResult {
  const text = testCase.input.visibleCopy.join(' ').replace(/\s+/g, ' ').trim();
  const scores: FleetGraphProductSurfaceScores = {
    actionability: scoreActionability(testCase, text),
    groundedness: scoreGroundedness(testCase, text),
    specificity: scoreSpecificity(testCase, text),
    brevity: scoreBrevity(text),
    repetitionBudget: scoreRepetitionBudget(text),
    informationDensity: scoreInformationDensity(testCase, text),
    cavemanCopy: scoreCavemanCopy(text),
    duplicateFactControl: scoreDuplicateFactControl(testCase, text),
    uncertaintyHonesty: scoreUncertaintyHonesty(testCase, text),
    missingDataUsefulness: scoreMissingDataUsefulness(testCase, text),
    uiProofSeparation: scoreUiProofSeparation(text),
  };
  const failedDimensions = FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS.filter(
    (dimension) => scores[dimension] < testCase.expectedMinimum[dimension]
  );

  return {
    caseId: testCase.id,
    scores,
    pass: failedDimensions.length === 0,
    failedDimensions,
  };
}

export function summarizeFleetGraphProductSurfaceResults(
  results: readonly FleetGraphProductSurfaceResult[]
): FleetGraphProductSurfaceSummary {
  const totals = Object.fromEntries(
    FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS.map((dimension) => [dimension, 0])
  ) as FleetGraphProductSurfaceScores;

  for (const result of results) {
    for (const dimension of FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS) {
      totals[dimension] += result.scores[dimension];
    }
  }

  const average = Object.fromEntries(
    FLEETGRAPH_PRODUCT_SURFACE_DIMENSIONS.map((dimension) => [
      dimension,
      results.length > 0 ? Number((totals[dimension] / results.length).toFixed(2)) : 0,
    ])
  ) as FleetGraphProductSurfaceScores;

  return {
    average,
    passCount: results.filter((result) => result.pass).length,
    failCount: results.filter((result) => !result.pass).length,
  };
}

function scoreThresholds(
  overrides: Partial<FleetGraphProductSurfaceScores> = {}
): FleetGraphProductSurfaceScores {
  return {
    actionability: 3,
    groundedness: 3,
    specificity: 3,
    brevity: 3,
    repetitionBudget: 3,
    informationDensity: 3,
    cavemanCopy: 3,
    duplicateFactControl: 3,
    uncertaintyHonesty: 3,
    missingDataUsefulness: 3,
    uiProofSeparation: 4,
    ...overrides,
  };
}

function scoreActionability(testCase: FleetGraphProductSurfaceCase, text: string): number {
  if (!testCase.input.nextAction?.trim()) return 1;
  const actionWords = /\b(ask|confirm|add|find|record|open|review|follow up)\b/i;
  return actionWords.test(text) ? maxScore : 2;
}

function scoreGroundedness(testCase: FleetGraphProductSurfaceCase, text: string): number {
  const normalizedText = normalizeForScoring(text);
  const groundedSignals = [
    testCase.input.cardTitle,
    testCase.input.blockerText,
    testCase.input.owner || undefined,
    testCase.input.context || undefined,
  ].filter((value): value is string => Boolean(value?.trim()));
  const present = groundedSignals.filter((signal) => normalizedText.includes(normalizeForScoring(signal))).length;
  return Math.min(maxScore, Math.max(1, present));
}

function scoreSpecificity(testCase: FleetGraphProductSurfaceCase, text: string): number {
  const normalizedText = normalizeForScoring(text);
  let score = 1;
  if (testCase.input.owner && normalizedText.includes(normalizeForScoring(testCase.input.owner))) score += 1;
  if (testCase.input.context && normalizedText.includes(normalizeForScoring(testCase.input.context))) score += 1;
  if (testCase.input.blockerText && normalizedText.includes(normalizeForScoring(testCase.input.blockerText))) score += 1;
  if (!testCase.input.blockerText?.trim() && /\b(no|missing|not recorded)\b/i.test(text)) score += 1;
  return Math.min(maxScore, score);
}

function scoreBrevity(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 34) return 4;
  if (wordCount <= 48) return 3;
  if (wordCount <= 64) return 2;
  return 1;
}

function scoreRepetitionBudget(text: string): number {
  const blockMentions = countMatches(text, /\bblock(?:ed|er|ing)?\b/gi);
  const repeatedWords = repeatedMeaningfulWords(text);
  if (blockMentions <= 2 && repeatedWords <= 1) return 4;
  if (blockMentions <= 3 && repeatedWords <= 2) return 3;
  if (blockMentions <= 5 && repeatedWords <= 4) return 2;
  return 1;
}

function scoreInformationDensity(testCase: FleetGraphProductSurfaceCase, text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const facts = [
    testCase.input.cardTitle,
    testCase.input.blockerText,
    testCase.input.owner || undefined,
    testCase.input.context || undefined,
    testCase.input.nextAction,
  ].filter((value): value is string => Boolean(value?.trim()))
    .filter((value) => normalizeForScoring(text).includes(normalizeForScoring(value))).length;
  const density = facts / Math.max(1, wordCount / 12);
  if (density >= 1.4) return 4;
  if (density >= 1.0) return 3;
  if (density >= 0.65) return 2;
  return 1;
}

function scoreCavemanCopy(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const longSentenceSignals = countMatches(text, /\b(currently|recorded|encountered|approximately|information|notification|explanation)\b/gi);
  const punctuationClauses = countMatches(text, /[,;]/g);
  if (wordCount <= 34 && longSentenceSignals === 0 && punctuationClauses <= 1) return 4;
  if (wordCount <= 48 && longSentenceSignals <= 1 && punctuationClauses <= 2) return 3;
  if (wordCount <= 64 && longSentenceSignals <= 2) return 2;
  return 1;
}

function scoreDuplicateFactControl(testCase: FleetGraphProductSurfaceCase, text: string): number {
  const normalizedText = normalizeForScoring(text);
  const duplicateFacts = [
    testCase.input.cardTitle,
    testCase.input.blockerText,
    testCase.input.owner || undefined,
    testCase.input.context || undefined,
  ].filter((value): value is string => Boolean(value?.trim()))
    .filter((value) => countOccurrences(normalizedText, normalizeForScoring(value)) > 1).length;
  if (duplicateFacts === 0) return 4;
  if (duplicateFacts === 1) return 3;
  if (duplicateFacts === 2) return 2;
  return 1;
}

function scoreUncertaintyHonesty(testCase: FleetGraphProductSurfaceCase, text: string): number {
  const missingOwner = !testCase.input.owner;
  const missingBlocker = !testCase.input.blockerText?.trim();
  if (!missingOwner && !missingBlocker) return 4;
  const namesMissingOwner = !missingOwner || /\b(owner|assignee|who owns|find the owner)\b/i.test(text);
  const namesMissingBlocker = !missingBlocker || /\b(no blocker|missing|not recorded|add the blocker)\b/i.test(text);
  if (namesMissingOwner && namesMissingBlocker) return 4;
  if (namesMissingOwner || namesMissingBlocker) return 2;
  return 1;
}

function scoreMissingDataUsefulness(testCase: FleetGraphProductSurfaceCase, text: string): number {
  const missingOwner = !testCase.input.owner;
  const missingBlocker = !testCase.input.blockerText?.trim();
  if (!missingOwner && !missingBlocker) return 4;

  const hasUsefulOwnerAction = !missingOwner || /\b(owner missing|find the owner|who owns|assign|owner for)\b/i.test(text);
  const hasUsefulBlockerAction = !missingBlocker || /\b(blocker missing|add the blocker|record the blocker|no blocker)\b/i.test(text);
  if (hasUsefulOwnerAction && hasUsefulBlockerAction) return 4;
  if (hasUsefulOwnerAction || hasUsefulBlockerAction) return 2;
  return 1;
}

function scoreUiProofSeparation(text: string): number {
  const proofTerms = /\b(trace|nodePath|graph branch|decision=|mode=|dedupe|evidence_snapshot|visibleOutput|reviewer|LangSmith)\b/i;
  return proofTerms.test(text) ? 1 : 4;
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  return text.split(search).length - 1;
}

function repeatedMeaningfulWords(text: string): number {
  const ignored = new Set(['the', 'a', 'an', 'to', 'for', 'on', 'in', 'is', 'and', 'or', 'of', 'by']);
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (ignored.has(word) || word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function normalizeForScoring(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}
