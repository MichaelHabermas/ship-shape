/**
 * AI-powered plan and retro quality analysis using AWS Bedrock (Claude Opus 4.5).
 *
 * Provides two analysis functions:
 * - analyzePlan: Evaluates weekly plan items for falsifiability and workload
 * - analyzeRetro: Compares retro against plan for coverage and evidence
 *
 * Uses AWS Bedrock's Claude Opus 4.5 model via the standard credential chain.
 * Gracefully degrades when Bedrock is unavailable.
 */

import { createHash } from 'crypto';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { extractPlanItemsFromContent } from '@ship/shared';
import { extractText } from '../utils/document-content.js';

const MODEL_ID = 'global.anthropic.claude-opus-4-5-20251101-v1:0';
const REGION = 'us-east-1';

// Lazy-initialize client (fails gracefully if AWS credentials unavailable)
let bedrockClient: BedrockRuntimeClient | null = null;
let clientInitFailed = false;

function getClient(): BedrockRuntimeClient | null {
  if (clientInitFailed) return null;
  if (bedrockClient) return bedrockClient;

  try {
    bedrockClient = new BedrockRuntimeClient({ region: REGION });
    return bedrockClient;
  } catch (err) {
    console.warn('Failed to initialize Bedrock client:', err);
    clientInitFailed = true;
    return null;
  }
}

// Simple in-memory rate limiter with periodic cleanup
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 120; // max requests per hour per user (polling every 5s, but only analyzes on content change)
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms
const MAX_CONTENT_TEXT_LENGTH = 50_000; // 50KB max extracted text sent to Bedrock

// Periodically clean up expired entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now >= entry.resetAt) rateLimits.delete(key);
  }
}, 10 * 60 * 1000); // Clean every 10 minutes

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(userId);

  if (!entry || now >= entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// Analysis result types
export interface PlanItemAnalysis {
  text: string;
  score: number; // 0-1 falsifiability score
  feedback: string;
  issues: string[];
  conciseness_score?: number; // 0-1, penalizes verbose items
  is_verbose?: boolean;
  conciseness_feedback?: string;
}

export interface PlanAnalysisResult {
  overall_score: number; // 0-1
  items: PlanItemAnalysis[];
  workload_assessment: 'light' | 'moderate' | 'heavy' | 'excessive';
  workload_feedback: string;
  content_hash?: string; // SHA-256 of input content for cache invalidation
}

export interface RetroItemAnalysis {
  plan_item: string;
  addressed: boolean;
  has_evidence: boolean;
  feedback: string;
}

export interface RetroAnalysisResult {
  overall_score: number; // 0-1
  plan_coverage: RetroItemAnalysis[];
  suggestions: string[];
  content_hash?: string; // SHA-256 of input content for cache invalidation
}

export type AnalysisError = { error: string };

/** Compute SHA-256 hash of content for cache invalidation */
function computeContentHash(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

const PLAN_SYSTEM_PROMPT = `You are an AI assistant that evaluates weekly work plans for government employees.

Your job is to assess each plan item on THREE dimensions:
1. **Verifiability (score 0-1)**: Can an independent observer determine whether this item was completed by examining evidence? A score of 1.0 means the item has a clear, measurable deliverable. A score of 0.0 means it's completely vague.
2. **Conciseness (conciseness_score 0-1)**: Is the item stated concisely as a falsifiable deliverable? A score of 1.0 means it's a crisp 1-sentence deliverable. A score of 0.0 means it's a rambling multi-paragraph description.
3. **Workload**: Is the overall plan a reasonable amount of work for a full-time employee's week?

Key criteria for a good plan item:
- It produces a specific, tangible deliverable (document, report, shipped feature, completed calls)
- It has a clear definition of done
- Someone unfamiliar with the work could verify completion
- It is stated in 1-2 SHORT sentences maximum — just the deliverable, not a detailed description of how

Conciseness rules (IMPORTANT):
- A plan item should be a SINGLE falsifiable statement: "Ship the login page with OAuth integration"
- NOT a paragraph: "I plan to work on the login page. This will involve setting up OAuth, configuring the redirect URIs, testing with multiple providers, and deploying to staging."
- If an item is more than ~30 words, it's probably too verbose. Penalize the conciseness_score.
- If an item contains multiple sentences describing process/method rather than outcome, set is_verbose=true
- The overall_score should factor in conciseness: verbose items should drag down the overall score even if they're verifiable

Common problems:
- Activities instead of outcomes: "meet with", "coordinate with", "work on" describe what you'll DO, not what you'll PRODUCE
- Vague scope: "improve X", "investigate Y" have no definition of done
- Too verbose: describing HOW you'll do something instead of WHAT you'll deliver
- Too little work: "take 5 calls" in a week is light for a full-time employee

Workload assessment:
- "light": Fewer than 3 significant items or items that represent less than a full week of work
- "moderate": 3-5 significant items representing a solid week of work
- "heavy": More than 5 significant items or items that are very ambitious
- "excessive": Unrealistically large amount of work

Respond ONLY with valid JSON matching this exact structure:
{
  "overall_score": <0-1 average of item scores, factoring in conciseness>,
  "items": [
    {
      "text": "<the plan item text>",
      "score": <0-1 verifiability>,
      "feedback": "<specific, actionable feedback>",
      "issues": ["<issue tag: not_falsifiable, no_deliverable, too_vague, too_verbose, too_light, etc>"],
      "conciseness_score": <0-1>,
      "is_verbose": <true/false>,
      "conciseness_feedback": "<specific feedback about conciseness, or empty string if concise>"
    }
  ],
  "workload_assessment": "<light|moderate|heavy|excessive>",
  "workload_feedback": "<brief assessment of overall workload>"
}`;

const RETRO_SYSTEM_PROMPT = `You are an AI assistant that evaluates weekly retrospectives for government employees.

If plan items are provided, compare the retro against the plan:
1. **Plan coverage**: Is each plan item addressed in the retro?
2. **Evidence**: For completed items, is there evidence of completion (links, screenshots, specific results, or the deliverable itself)?
3. **Gap explanations**: For incomplete items, is there an explanation of what happened?

If NO plan items are provided, evaluate the retro on its own quality:
1. **Specificity**: Does the retro describe specific deliverables with concrete outcomes, or is it vague ("did some stuff")?
2. **Evidence**: Does the retro include proof of work (links, documents, metrics, screenshots)?
3. **Substance**: Does the retro represent a meaningful week of work?

Key criteria for ALL retros:
- Vague statements like "did some stuff", "worked on things", "made progress" are UNACCEPTABLE and should score very low (0.1-0.2)
- Completed items need evidence (link, screenshot, specific result, or embedded deliverable)
- Each item should be specific enough that a manager can verify it was done
- "Coordinate with team" or "had meetings" are activities, not deliverables — they score low

Respond ONLY with valid JSON matching this exact structure:
{
  "overall_score": <0-1>,
  "plan_coverage": [
    {
      "plan_item": "<text from the plan, or the retro item itself if no plan>",
      "addressed": <true/false>,
      "has_evidence": <true/false>,
      "feedback": "<specific feedback>"
    }
  ],
  "suggestions": ["<actionable suggestion 1>", "<actionable suggestion 2>"]
}`;

async function callBedrock(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt },
    ],
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  if (responseBody.content && responseBody.content[0]?.text) {
    return responseBody.content[0].text;
  }

  return null;
}

/**
 * Analyze a weekly plan for quality (falsifiability and workload).
 */
export async function analyzePlan(content: unknown): Promise<PlanAnalysisResult | AnalysisError> {
  const contentHash = computeContentHash(content);
  const planItems = extractPlanItemsFromContent(content);

  if (planItems.length === 0) {
    return {
      overall_score: 0,
      items: [],
      workload_assessment: 'light',
      workload_feedback: 'No plan items found. Add specific, verifiable deliverables for your week.',
      content_hash: contentHash,
    };
  }

  // Limit content size to prevent cost amplification
  const itemsText = planItems.map((item, i) => `${i + 1}. ${item}`).join('\n');
  if (itemsText.length > MAX_CONTENT_TEXT_LENGTH) {
    return { error: 'content_too_large' };
  }

  const userPrompt = `Analyze this weekly plan. Here are the plan items:\n\n${itemsText}`;

  try {
    const responseText = await callBedrock(PLAN_SYSTEM_PROMPT, userPrompt);
    if (!responseText) {
      return { error: 'ai_unavailable' };
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: 'ai_parse_error' };
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const result = JSON.parse(jsonStr) as PlanAnalysisResult;

    // Validate and clamp scores
    result.overall_score = Math.max(0, Math.min(1, result.overall_score || 0));
    for (const item of result.items) {
      item.score = Math.max(0, Math.min(1, item.score || 0));
    }

    result.content_hash = contentHash;
    return result;
  } catch (err) {
    console.error('Plan analysis error:', err);
    return { error: 'ai_unavailable' };
  }
}

/**
 * Analyze a weekly retro against its plan for coverage and evidence.
 */
export async function analyzeRetro(
  retroContent: unknown,
  planContent: unknown
): Promise<RetroAnalysisResult | AnalysisError> {
  const contentHash = computeContentHash({ retro_content: retroContent, plan_content: planContent });
  const planItems = extractPlanItemsFromContent(planContent);
  const retroText = extractText(retroContent);

  if (!retroText.trim()) {
    return {
      overall_score: 0,
      plan_coverage: planItems.map(item => ({
        plan_item: item,
        addressed: false,
        has_evidence: false,
        feedback: 'This plan item is not addressed in the retro.',
      })),
      suggestions: ['Your retro is empty. Address each item from your plan.'],
      content_hash: contentHash,
    };
  }

  // Limit content size to prevent cost amplification
  const planItemsText = planItems.length > 0
    ? planItems.map((item, i) => `${i + 1}. ${item}`).join('\n')
    : '';
  const totalLength = planItemsText.length + retroText.length;
  if (totalLength > MAX_CONTENT_TEXT_LENGTH) {
    return { error: 'content_too_large' };
  }

  const userPrompt = planItems.length > 0
    ? `Compare this weekly retro against the plan.\n\nPLAN ITEMS:\n${planItemsText}\n\nRETRO CONTENT:\n${retroText}`
    : `Evaluate this weekly retro for quality. No plan was found for comparison, so evaluate the retro items on their own specificity, evidence, and substance.\n\nRETRO CONTENT:\n${retroText}`;

  try {
    const responseText = await callBedrock(RETRO_SYSTEM_PROMPT, userPrompt);
    if (!responseText) {
      return { error: 'ai_unavailable' };
    }

    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: 'ai_parse_error' };
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const result = JSON.parse(jsonStr) as RetroAnalysisResult;
    result.overall_score = Math.max(0, Math.min(1, result.overall_score || 0));
    result.content_hash = contentHash;

    return result;
  } catch (err) {
    console.error('Retro analysis error:', err);
    return { error: 'ai_unavailable' };
  }
}

/** Check if Bedrock client is available (for UI to decide whether to render quality assistant) */
export function isAiAvailable(): boolean {
  return getClient() !== null;
}

export { checkRateLimit };
