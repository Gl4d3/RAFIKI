// RAFIKI AI layer — powered by Google Gemini
// This layer ONLY does: natural language generation.
// It never computes numbers. That is the Accountant's job.

import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Tool,
} from "@google/generative-ai";
import { z } from "zod";
import type { FinancialSummary, EntitySummary } from "./accountant";
import {
  type EnrichableTransaction,
  type CandidatePair,
  applyCategorise,
  applyFlagForGap,
  applyDetectRelationship,
  applyMarkInternalTransfer,
} from "./enrichment";

// Strict argument validators for the four Stage B tools.
// Anything that fails validation is rejected with `ok: false` so the
// model sees the rejection in its next turn instead of silently
// mutating state with garbage.
const CATEGORY_VALUES = [
  "rent", "utilities", "transport", "food", "family", "chama",
  "business", "savings", "income", "merchant", "entertainment",
  "healthcare", "education", "one_time", "unknown",
] as const;
const TIER_VALUES = ["1", "2", "3", "4", "unknown"] as const;

const TxIdsSchema = z.array(z.number().int().nonnegative()).min(1).max(500);

const CategoriseArgs = z.object({
  txIds: TxIdsSchema,
  category: z.enum(CATEGORY_VALUES),
  tier: z.enum(TIER_VALUES).optional(),
  note: z.string().min(1).max(280).optional(),
});

const FlagArgs = z.object({
  txIds: TxIdsSchema,
  reason: z.string().min(1).max(280),
});

const RelationshipArgs = z.object({
  counterpartyMatch: z.string().min(1).max(120),
  relationshipLabel: z.string().min(1).max(80),
  category: z.enum(CATEGORY_VALUES),
  tier: z.enum(TIER_VALUES).optional(),
});

const InternalTransferArgs = z.object({
  txIdA: z.number().int().nonnegative(),
  txIdB: z.number().int().nonnegative(),
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const generationConfig = {
  temperature: 0.7,
  maxOutputTokens: 1024,
};

// Model chain — try fast/cheap first, then heavier, then preview.
// We keep this list short and explicit so it's easy to audit.
const MODEL_CHAIN = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite-preview",
];

// Typed error so the pipeline can tell "AI is unavailable" apart from
// "the rest of the system is broken".
export class GeminiUnavailableError extends Error {
  reason: string;
  status: number | undefined;
  constructor(reason: string, status?: number) {
    super(reason);
    this.name = "GeminiUnavailableError";
    this.reason = reason;
    this.status = status;
  }
}

// Errors worth retrying on the next model in the chain
function isTransientError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 503 || status === 500) return true;
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("unavailable")
  );
}

// Quota / billing problems aren't worth retrying on another model — same key.
function isQuotaError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status === 429) return true;
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("quota") ||
    msg.includes("credits are depleted") ||
    msg.includes("billing")
  );
}

async function generateWithFallback(prompt: string): Promise<string> {
  let lastErr: any = null;
  for (const modelName of MODEL_CHAIN) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (err: any) {
      lastErr = err;
      if (isQuotaError(err)) {
        // No point trying other models — same key, same quota.
        throw new GeminiUnavailableError(
          "Gemini API quota or billing limit reached.",
          err?.status
        );
      }
      if (!isTransientError(err)) {
        // Hard error (auth, bad request, etc.) — surface it.
        throw new GeminiUnavailableError(
          err?.message || "Gemini API error",
          err?.status
        );
      }
      console.warn(
        `Gemini model "${modelName}" busy (${err?.status || "?"}). Trying next in chain...`
      );
    }
  }
  throw new GeminiUnavailableError(
    "All Gemini models are currently unavailable. Please try again shortly.",
    lastErr?.status
  );
}

// RAFIKI system personality
const RAFIKI_PERSONA = `You are RAFIKI, a warm, calm, and intelligent personal finance companion built for Kenya. 
You speak in a friendly, conversational tone — like a trusted financial friend, not a bank.
You use plain English. You may occasionally use a Swahili phrase naturally (like "pole pole" or "poa") but keep it minimal.
You never use emojis. You never use bullet points or lists in conversational messages.
You are concise — your messages are short, warm, and specific to the actual numbers.
You always reference actual numbers from the analysis — never speak in vague terms.
The currency is always written as "KSh" followed by the amount with commas (e.g. KSh 8,000).`;

export async function generateRevealMessage(
  summary: FinancialSummary
): Promise<string> {
  const transportTotal = summary.topCategories.find(
    (c) => c.category === "transport"
  );
  const topCategory = summary.topCategories[0];

  const prompt = `${RAFIKI_PERSONA}

I've analysed the user's M-Pesa statement. Here is what the Accountant found:

Estimated monthly salary: KSh ${summary.estimatedSalary.toLocaleString()} from "${summary.salarySource}"
Total spending analysed: KSh ${summary.totalDebits.toLocaleString()} over ${summary.transactionCount} transactions

Top spending categories:
${summary.topCategories
  .slice(0, 4)
  .map((c) => `- ${c.label}: KSh ${c.total.toLocaleString()}`)
  .join("\n")}

Recurring obligations found: ${summary.recurringObligations.length}
${summary.recurringObligations
  .slice(0, 3)
  .map((e) => `- ${e.name}: KSh ${e.monthlyAmount.toLocaleString()}/month`)
  .join("\n")}

Unknown transactions needing clarification: ${summary.unknownEntities.length}

Write RAFIKI's reveal message. This is the "it already knows me" moment — the first time the user sees what RAFIKI found.

Rules:
- Lead with the most striking or surprising insight (usually transport total or a high spend category)
- Be specific — use the actual numbers
- Keep it to 3-4 short sentences maximum
- End with something like "Does that look right to you?" to invite confirmation
- Sound warm and human, not like a bank statement
- Do NOT list everything — pick the 1-2 most interesting findings and focus on those`;

  // Let GeminiUnavailableError bubble up — the pipeline decides whether to
  // degrade gracefully or surface the failure to the user.
  return await generateWithFallback(prompt);
}

// A deterministic, clearly-labelled message for when the AI layer is down.
// We never silently substitute this — the caller must mark it as degraded.
export function buildOfflineRevealMessage(summary: FinancialSummary): string {
  const top = summary.topCategories[0];
  const cat = top
    ? `KSh ${top.total.toLocaleString()} on ${top.label}`
    : "significant amounts";
  return `Here's what I found in your statement: you're spending ${cat}, and your salary from ${summary.salarySource} comes in at around KSh ${summary.estimatedSalary.toLocaleString()} a month. (My AI layer is offline right now, so this is the basic numbers-only view — full insights will return once the service is back.)`;
}

export async function generateGapFillingQuestion(
  entity: EntitySummary
): Promise<string> {
  const prompt = `${RAFIKI_PERSONA}

I need to ask the user about an unresolved transaction. Here are the details:

Counterparty name: "${entity.name}"
Total amount: KSh ${entity.totalAmount.toLocaleString()}
Number of times it appeared: ${entity.occurrences}
Estimated monthly amount: KSh ${entity.monthlyAmount.toLocaleString()}
Frequency: ${entity.frequency}
Last seen: ${entity.lastSeen.toLocaleDateString("en-KE")}

Write a single, natural, conversational question asking the user what this transaction is.
The question should:
- Reference the specific counterparty name and amount
- Be warm and non-judgmental
- Be one sentence only
- Not use the word "counterparty" or "transaction" — use "payment" or "transfer" instead
- Make it easy to answer by hinting at what kind of thing it might be

Example style: "I keep seeing KSh 2,000 going to Peter every month — is that a regular debt repayment or family support?"`;

  // Bubble up GeminiUnavailableError; the pipeline catches it once and falls
  // back to a deterministic question for the whole batch.
  return await generateWithFallback(prompt);
}

// Deterministic gap-filling question for when AI is offline. Honest, specific.
export function buildOfflineGapQuestion(entity: EntitySummary): string {
  return `I noticed ${entity.occurrences} payments to "${entity.name}" totalling KSh ${entity.totalAmount.toLocaleString()}. What is this for?`;
}

// ─────────────────────────────────────────────────────────────────────────
// Stage B — LLM enrichment with tool calling
// The model never returns free text we trust. It either calls one of the
// four tools below, or it stops. Numbers are read-only to the model.
// ─────────────────────────────────────────────────────────────────────────

const enrichmentTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "categorise_transaction",
        description:
          "Assign a category (and optional priority tier) to one or more transactions. Use this when the counterparty or context makes the category obvious (e.g. 'NAIVAS' → food, 'SHELL' → transport). Tier follows the Priority Cascade: 1=Survival, 2=Social Obligations, 3=Growth/Savings, 4=Lifestyle.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            txIds: {
              type: SchemaType.ARRAY,
              description: "The txId values of the transactions to categorise.",
              items: { type: SchemaType.NUMBER },
            },
            category: {
              type: SchemaType.STRING,
              description:
                "One of: rent, utilities, transport, food, family, chama, business, savings, income, merchant, entertainment, healthcare, education, one_time, unknown.",
            },
            tier: {
              type: SchemaType.STRING,
              description: "1, 2, 3, 4 or 'unknown'.",
            },
            note: {
              type: SchemaType.STRING,
              description: "Short human-readable rationale.",
            },
          },
          required: ["txIds", "category"],
        },
      },
      {
        name: "flag_for_gap_filling",
        description:
          "Mark one or more transactions as needing the user to clarify what they are. Only use this for genuinely ambiguous counterparties (raw phone numbers without a known relationship, unfamiliar paybill IDs).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            txIds: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
            },
            reason: {
              type: SchemaType.STRING,
              description: "Why this transaction is ambiguous.",
            },
          },
          required: ["txIds", "reason"],
        },
      },
      {
        name: "detect_relationship",
        description:
          "Record a recognised counterparty relationship (e.g. user said '0728125443 is my mother'). Every transaction whose counterparty contains the match string will be tagged with the given category.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            counterpartyMatch: {
              type: SchemaType.STRING,
              description:
                "Substring to match against transaction counterparties (case-insensitive).",
            },
            relationshipLabel: {
              type: SchemaType.STRING,
              description: "Friendly label e.g. 'Mum', 'Chama', 'Landlord'.",
            },
            category: {
              type: SchemaType.STRING,
              description: "Category to apply (typically 'family' or 'chama').",
            },
            tier: {
              type: SchemaType.STRING,
              description: "1, 2, 3, 4 or 'unknown'.",
            },
          },
          required: ["counterpartyMatch", "relationshipLabel", "category"],
        },
      },
      {
        name: "mark_internal_transfer",
        description:
          "Confirm that two transactions are the two legs of one internal transfer (e.g. bank debit → M-Pesa credit). Both legs will be excluded from spending totals. Only call this for pairs the system has already flagged as candidates.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            txIdA: { type: SchemaType.NUMBER },
            txIdB: { type: SchemaType.NUMBER },
          },
          required: ["txIdA", "txIdB"],
        },
      },
    ] as FunctionDeclaration[],
  },
];

// A compact representation of a transaction for the prompt. We omit
// rawText and balance to keep the token budget modest.
function compactTx(tx: EnrichableTransaction) {
  return {
    txId: tx.txId,
    date: tx.date.toISOString().slice(0, 10),
    amount: tx.amount,
    direction: tx.direction,
    counterparty: tx.counterparty,
    reference: tx.reference || "",
    account: tx.source || "mpesa",
    category: tx.category,
    candidateInternalTransfer: tx.candidateInternalTransfer,
    ...(tx.originalCurrency && tx.originalCurrency !== "KES"
      ? { originalAmount: tx.originalAmount, originalCurrency: tx.originalCurrency }
      : {}),
  };
}

const ENRICHMENT_SYSTEM = `You are RAFIKI's enrichment layer. Your job is to look at a batch of categorised Kenyan financial transactions and improve the categorisation by calling the provided tools. You MUST follow these rules:
1. Never re-compute or restate amounts. Numbers are not yours to invent.
2. The user's annotation (when provided) is the highest-priority context. If they tell you a phone number is their mother, treat every transaction to that number as Social Obligations (category=family) without asking again.
3. Confirm or reject every candidateInternalTransfer pair using mark_internal_transfer. If you reject, do nothing.
4. Only call flag_for_gap_filling for transactions that remain genuinely ambiguous AFTER you've applied the annotation and detected relationships. Do not flag transactions that already have a confident category.
5. Stop calling tools when there is nothing more to do. Do NOT return free text.`;

export interface EnrichmentResult {
  toolCallCount: number;
  rounds: number;
  appliedSummary: {
    categorise: number;
    flag: number;
    relationship: number;
    internalTransfer: number;
  };
}

export async function runEnrichment(
  txs: EnrichableTransaction[],
  annotation: string | null,
  candidatePairs: CandidatePair[]
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {
    toolCallCount: 0,
    rounds: 0,
    appliedSummary: {
      categorise: 0,
      flag: 0,
      relationship: 0,
      internalTransfer: 0,
    },
  };

  // Empty batch — nothing to enrich.
  if (txs.length === 0) return result;

  const compactBatch = txs.map(compactTx);
  const userAnnotation =
    annotation && annotation.trim()
      ? `USER ANNOTATION (highest priority context):\n"""${annotation.trim()}"""`
      : "USER ANNOTATION: (none)";

  const candidateBlock = candidatePairs.length
    ? `CANDIDATE INTERNAL TRANSFER PAIRS (deterministic dedup found these — confirm or reject each):\n${candidatePairs
        .map(
          (p) =>
            `- txId ${p.txIdA} ↔ txId ${p.txIdB} | KSh ${p.amount} on ${p.date
              .toISOString()
              .slice(0, 10)} | ${p.reason}`
        )
        .join("\n")}`
    : "CANDIDATE INTERNAL TRANSFER PAIRS: (none)";

  const initialPrompt = `${ENRICHMENT_SYSTEM}

${userAnnotation}

${candidateBlock}

TRANSACTIONS (JSON, one per line):
${compactBatch.map((t) => JSON.stringify(t)).join("\n")}

Begin enriching. Call tools as needed. Stop when done.`;

  // Walk the model chain like generateWithFallback, but with tools.
  let lastErr: any = null;
  for (const modelName of MODEL_CHAIN) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        tools: enrichmentTools,
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      });
      const chat = model.startChat();
      let resp = await chat.sendMessage(initialPrompt);

      // Loop processing tool calls until the model stops calling them
      // or we hit a safety cap.
      const MAX_ROUNDS = 8;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        result.rounds = round + 1;
        const calls = resp.response.functionCalls?.() || [];
        if (calls.length === 0) break;
        result.toolCallCount += calls.length;

        const parts = calls.map((call) => {
          const out = dispatchTool(
            txs,
            call.name,
            call.args || {},
            result,
            candidatePairs
          );
          return {
            functionResponse: {
              name: call.name,
              response: out,
            },
          };
        });
        resp = await chat.sendMessage(parts);
      }
      return result;
    } catch (err: any) {
      lastErr = err;
      if (isQuotaError(err)) {
        throw new GeminiUnavailableError(
          "Gemini API quota or billing limit reached.",
          err?.status
        );
      }
      if (!isTransientError(err)) {
        throw new GeminiUnavailableError(
          err?.message || "Gemini API error during enrichment",
          err?.status
        );
      }
      console.warn(
        `Gemini model "${modelName}" busy during enrichment. Trying next...`
      );
    }
  }
  throw new GeminiUnavailableError(
    "All Gemini models are currently unavailable for enrichment.",
    lastErr?.status
  );
}

function dispatchTool(
  txs: EnrichableTransaction[],
  name: string,
  args: Record<string, any>,
  result: EnrichmentResult,
  candidatePairs: CandidatePair[]
): Record<string, any> {
  try {
    if (name === "categorise_transaction") {
      const parsed = CategoriseArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: "invalid args", issues: parsed.error.issues };
      }
      const r = applyCategorise(txs, parsed.data);
      result.appliedSummary.categorise += r.applied;
      return { ok: true, applied: r.applied, skipped: r.skipped };
    }
    if (name === "flag_for_gap_filling") {
      const parsed = FlagArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: "invalid args", issues: parsed.error.issues };
      }
      const r = applyFlagForGap(txs, parsed.data);
      result.appliedSummary.flag += r.applied;
      return { ok: true, applied: r.applied, skipped: r.skipped };
    }
    if (name === "detect_relationship") {
      const parsed = RelationshipArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: "invalid args", issues: parsed.error.issues };
      }
      const r = applyDetectRelationship(txs, parsed.data);
      result.appliedSummary.relationship += r.applied;
      return { ok: true, applied: r.applied };
    }
    if (name === "mark_internal_transfer") {
      const parsed = InternalTransferArgs.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: "invalid args", issues: parsed.error.issues };
      }
      const { txIdA, txIdB } = parsed.data;
      // Hard constraint: the model may only confirm pairs that the
      // deterministic dedup pass pre-flagged as candidates. This keeps
      // the contract one-directional — LLM confirms or rejects, never
      // invents transfers.
      const isCandidate = candidatePairs.some(
        (p) =>
          (p.txIdA === txIdA && p.txIdB === txIdB) ||
          (p.txIdA === txIdB && p.txIdB === txIdA)
      );
      if (!isCandidate) {
        return {
          ok: false,
          error:
            "pair is not a candidateInternalTransfer — only pairs flagged by deterministic dedup may be marked",
        };
      }
      const r = applyMarkInternalTransfer(txs, { txIdA, txIdB });
      if (r.applied) result.appliedSummary.internalTransfer += 1;
      return r;
    }
    return { ok: false, error: `unknown tool: ${name}` };
  } catch (err: any) {
    return { ok: false, error: err?.message || "tool call failed" };
  }
}
