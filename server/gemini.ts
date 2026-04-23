// RAFIKI AI layer — powered by Google Gemini
// This layer ONLY does: natural language generation.
// It never computes numbers. That is the Accountant's job.

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { FinancialSummary, EntitySummary } from "./accountant";

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
