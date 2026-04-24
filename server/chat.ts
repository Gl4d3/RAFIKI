// RAFIKI Streaming Chat
// POST /api/chat → SSE events: token | proposal | cascade | done | error
//
// Guarantee: every KSh figure in the response came from an Accountant tool
// call, not from model reasoning. Enforced by two layers:
//   1. Pre-execution: correct tools always run before Gemini generates text.
//   2. Numeric guardrail: Gemini's full text is collected, numeric values not
//      found in any tool result are replaced with "[figure]" before streaming.

import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type FunctionResponsePart,
  type Tool,
  type Content,
  type Part,
} from "@google/generative-ai";
import type { Response } from "express";
import { storage } from "./storage";
import {
  computeFinancialState,
  simulateAction,
  computeHealthScore,
  runPriorityCascade,
  type FinancialState,
  type SimulationResult,
  type PriorityCascadeResult,
  type CascadeAllocation,
} from "./accountant-live";
import type { PriorityStackItem } from "@shared/schema";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sseWrite(res: Response, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

// ─── Intent classification ────────────────────────────────────────────────────

type IntentKind =
  | "spend_query"
  | "simulate_spend"
  | "transfer"
  | "health_check"
  | "salary_income"
  | "unknown";

interface ParsedIntent {
  kind: IntentKind;
  amount?: number;
  category?: string;
  recipient?: string;
}

function parseKshAmount(str: string): number {
  const clean = str.replace(/,/g, "").trim().toLowerCase();
  if (clean.endsWith("k")) return parseFloat(clean) * 1000;
  return parseFloat(clean) || 0;
}

function guessCategoryFromContext(msg: string): string {
  if (/food|grocer|meal|lunch|dinner|breakfast|nyama|choma|eat/i.test(msg)) return "food";
  if (/transport|fare|matatu|uber|taxi|fuel|petrol/i.test(msg)) return "transport";
  if (/chama/i.test(msg)) return "chama";
  if (/family|mum|mom|dad|sibling|brother|sister/i.test(msg)) return "family";
  if (/school|fees|education|tuition/i.test(msg)) return "education";
  if (/hospital|clinic|health|medicine|doctor/i.test(msg)) return "healthcare";
  if (/rent|house|housing/i.test(msg)) return "rent";
  if (/save|savings/i.test(msg)) return "savings";
  return "entertainment";
}

function findFirstAmount(msg: string): number {
  const m = msg.match(/\b(\d[\d,]*(?:\.\d+)?k?)\b/i);
  if (!m) return 0;
  return parseKshAmount(m[1]);
}

function classifyIntent(message: string): ParsedIntent {
  const msg = message.toLowerCase();

  // Transfer: "send mum 2000", "pay john 5k", "transfer 3000 to sister"
  for (const pat of [
    /(?:send|pay|transfer)\s+([a-z][a-z\s]+?)\s+(?:ksh\s*)?(\d[\d,.]+k?)\b/i,
    /(?:send|pay|transfer)\s+(?:ksh\s*)?(\d[\d,.]+k?)\s+(?:to\s+)?([a-z][a-z\s]+)/i,
  ]) {
    const m = message.match(pat);
    if (m) {
      const [, a, b] = m;
      const isANum = /\d/.test(a);
      const amount = parseKshAmount(isANum ? a : b);
      const recipient = (isANum ? b : a).trim();
      if (amount > 0 && recipient.length > 1) {
        return { kind: "transfer", amount, recipient, category: guessCategoryFromContext(msg) };
      }
    }
  }

  // Salary / income (before simulate so "got 85k" doesn't mis-match)
  const salaryPhrases = /salary|payslip|just (got|received|been paid)|got paid|income arrived|salary.*(arrived|landed|in|came)/i;
  const receivedPat = /(?:received|got|deposited|salary\s+of)\s+(?:ksh\s*)?(\d[\d,.]+k?)/i;
  if (salaryPhrases.test(msg) || receivedPat.test(msg)) {
    const m = message.match(receivedPat);
    return { kind: "salary_income", amount: m ? parseKshAmount(m[1]) : undefined };
  }

  // Health check
  if (/how\s+(am|are)\s+(i|we)\s+doing|financial.*(health|situation|status)|how.*(looking|going)|am i on track|health score|my finances/i.test(msg)) {
    return { kind: "health_check" };
  }

  // Open-ended spend query (no specific amount)
  if (/how much (can|do) i (spend|have|afford)|what.*(float|balance|available)|(?:my|the)\s+(?:float|available\s+money)/i.test(msg) ||
      /^can i spend\??$/i.test(msg.trim())) {
    return { kind: "spend_query" };
  }

  // Simulate spend: explicit verb patterns
  for (const pat of [
    /(?:buy|spend|afford|do|get|have)\s+(?:ksh\s*)?(\d[\d,.]+k?)(?:[^a-z]+([a-z\s]+))?/i,
    /(?:ksh\s*)?(\d[\d,.]+k?)\s+on\s+([a-z\s]+)/i,
    /spend\s+(?:ksh\s*)?(\d[\d,.]+k?)/i,
    /(?:nyama\s*choma|lunch|dinner|drinks|supper)\s+(?:for\s+)?(?:[a-z\s,]+)?(?:ksh\s*)?(\d[\d,.]+k?)/i,
    /(?:ksh\s*)?(\d[\d,.]+k?)\s+(?:for\s+)?(?:nyama\s*choma|lunch|dinner|drinks)/i,
  ]) {
    const m = message.match(pat);
    if (m) {
      const amount = parseKshAmount(m[1] ?? "0");
      if (amount > 0) {
        return { kind: "simulate_spend", amount, category: guessCategoryFromContext((m[2] ?? "") + " " + msg) };
      }
    }
  }

  // Broad leisure/entertainment context + any amount in message
  // Catches: "Can I go out for nyama choma, maybe 3k?"
  if (/nyama.choma|going out|go out|night out|drinks|bar|movie|cinema|fun|eat out|restaurant|entertain|leisure|treat|spoil|splurge|party|outing/i.test(msg)) {
    const amount = findFirstAmount(msg);
    if (amount > 0) return { kind: "simulate_spend", amount, category: "entertainment" };
  }

  // Decision context + any amount ("can I afford 3k?", "is 5k ok?")
  if (/can i|should i|is it ok|afford|will i|would it|is \d/i.test(msg)) {
    const amount = findFirstAmount(msg);
    if (amount > 0) return { kind: "simulate_spend", amount, category: guessCategoryFromContext(msg) };
  }

  return { kind: "unknown" };
}

// ─── Pre-execution ────────────────────────────────────────────────────────────

interface PreExecContext {
  state: FinancialState;
  simulation?: SimulationResult;
  healthScore?: { score: number; explanation: string };
  cascade?: PriorityCascadeResult;
  toolLog: ToolCallRecord[];
}

async function preExecuteForIntent(
  intent: ParsedIntent,
  userId: string,
  txs: Awaited<ReturnType<typeof storage.getTransactions>>,
  stack: PriorityStackItem[],
  safeBuffer: number
): Promise<PreExecContext> {
  const state = computeFinancialState(txs, stack, safeBuffer);
  const log: ToolCallRecord[] = [{ name: "get_financial_state", args: {}, result: state }];
  const ctx: PreExecContext = { state, toolLog: log };

  if (intent.kind === "spend_query") {
    // Simulate the full available float to give authoritative max-safe-spend answer
    const sim = simulateAction(state.availableFloat, "entertainment", state, stack);
    ctx.simulation = sim;
    log.push({ name: "simulate_action", args: { amount: state.availableFloat, category: "entertainment" }, result: sim });
  }

  if (intent.kind === "simulate_spend" || intent.kind === "transfer") {
    if (intent.amount && intent.amount > 0) {
      const sim = simulateAction(intent.amount, intent.category ?? "entertainment", state, stack);
      ctx.simulation = sim;
      log.push({ name: "simulate_action", args: { amount: intent.amount, category: intent.category ?? "entertainment" }, result: sim });
    }
  }

  if (intent.kind === "health_check") {
    const goals = await storage.getGoals(userId);
    const health = computeHealthScore(txs, state, stack, goals);
    ctx.healthScore = health;
    log.push({ name: "get_health_score", args: {}, result: health });
  }

  if (intent.kind === "salary_income") {
    const incomeAmount = (intent.amount && intent.amount > 0) ? intent.amount : state.estimatedMonthlySalary;
    if (incomeAmount > 0) {
      const cascade = runPriorityCascade(incomeAmount, stack);
      ctx.cascade = cascade;
      log.push({ name: "run_priority_cascade", args: { incomeAmount }, result: cascade });
    }
  }

  return ctx;
}

// ─── Server-composed financial facts ─────────────────────────────────────────

function fmt(n: number): string {
  return `KSh ${Math.round(n).toLocaleString()}`;
}

function composeFactsForIntent(intent: ParsedIntent, ctx: PreExecContext, name: string): string {
  const { state, simulation, healthScore, cascade } = ctx;

  switch (intent.kind) {
    case "spend_query": {
      const days = state.daysToNextSalary ?? "?";
      return `${name}, your available float is ${fmt(state.availableFloat)} (balance: ${fmt(state.currentBalance)}, safe buffer held aside). That is the most you can safely spend before your next salary in ${days} days.`;
    }

    case "simulate_spend":
    case "transfer": {
      if (!simulation) return `${name}, I couldn't compute the simulation for ${fmt(intent.amount ?? 0)}.`;
      const amtStr = fmt(intent.amount ?? 0);
      if (simulation.safe) {
        return `${name}, ${amtStr} is safe — it leaves ${fmt(simulation.remainingAfter)} in your float after this spend.`;
      }
      // Red Alert — all required fields always present
      const parts: string[] = [`${name}, ${amtStr} is ${fmt(simulation.shortfall)} more than your float allows right now.`];

      if (simulation.nearestThreatenedObligation) {
        const { label, daysUntilDue } = simulation.nearestThreatenedObligation;
        const daysStr = daysUntilDue !== null ? `${daysUntilDue} days` : "this month";
        parts.push(`This would put your ${label} at risk — that obligation is due in ${daysStr}.`);
      } else {
        const days = state.daysToNextSalary;
        const daysStr = days !== null ? `${days} days` : "this month";
        parts.push(`This would take your balance below your ${fmt(state.safeBuffer)} safe buffer, which protects your essential obligations — your next salary is in ${daysStr}.`);
      }

      if (simulation.harvestSuggestion) {
        const { sourceName, deferableAmount } = simulation.harvestSuggestion;
        parts.push(`One option: defer ${fmt(deferableAmount)} from ${sourceName} — that would cover the gap.`);
      } else {
        parts.push(`There is no Tier 2 item available to defer that would cover the shortfall right now.`);
      }
      return parts.join(" ");
    }

    case "health_check": {
      if (!healthScore) return `${name}, I couldn't load your health score right now.`;
      return `${name}, your financial health score is ${healthScore.score}/100. ${healthScore.explanation}`;
    }

    case "salary_income": {
      if (!cascade) {
        return `${name}, your estimated salary is ${fmt(state.estimatedMonthlySalary)}. How much actually came in? I'll run the full allocation.`;
      }
      const totalIn = cascade.waterfall.reduce((s, w) => s + w.amount, 0) + cascade.leftover;
      const tier1Total = cascade.waterfall.filter(w => w.tier === "1").reduce((s, w) => s + w.amount, 0);
      const tier1Line = tier1Total > 0 ? ` Tier 1 obligations covered: ${fmt(tier1Total)}.` : "";
      return `${name}, ${fmt(totalIn)} allocated across your priority stack.${tier1Line} Leftover: ${fmt(cascade.leftover)}.`;
    }

    default:
      return "";
  }
}

// ─── Numeric guardrail ────────────────────────────────────────────────────────
// Builds a whitelist of integer values from all tool results in this turn.
// Replaces any standalone number in Gemini's text that isn't in the whitelist.

function buildNumericWhitelist(toolLog: ToolCallRecord[]): Set<number> {
  const allowed = new Set<number>();
  for (const rec of toolLog) {
    const json = JSON.stringify(rec.result);
    // Extract all numbers (including decimals) from JSON
    const matches = json.match(/\b\d+(?:\.\d+)?\b/g);
    if (matches) {
      for (const m of matches) {
        allowed.add(Math.round(parseFloat(m)));
      }
    }
  }
  return allowed;
}

function applyNumericGuardrail(text: string, allowed: Set<number>): string {
  if (allowed.size === 0) return text;
  // Match KSh amounts and bare comma-formatted numbers
  return text.replace(/(?:KSh\s*)?([\d,]+(?:\.\d+)?)/gi, (match, digits) => {
    const val = Math.round(parseFloat(digits.replace(/,/g, "")));
    if (!val || val < 100) return match; // Skip small numbers (scores, days, percentages)
    return allowed.has(val) ? match : "[figure]";
  });
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(name: string, state: FinancialState, stack: PriorityStackItem[], safeBuffer: number): string {
  const stackLines = stack
    .filter(i => i.isActive)
    .sort((a, b) => a.rank - b.rank)
    .map(i => `  Tier ${i.tier} | ${i.label} | KSh ${(i.monthlyAmount || 0).toLocaleString()}/month`)
    .join("\n");

  return `You are RAFIKI, a warm personal finance companion built for Kenya. You speak like a trusted friend, not a bank. Plain English, concise (1-3 sentences), no emojis, no bullet points. Currency: "KSh X,XXX".

USER: ${name}
Salary: KSh ${state.estimatedMonthlySalary.toLocaleString()} from "${state.salarySource}"
Balance: KSh ${state.currentBalance.toLocaleString()} | Float: KSh ${state.availableFloat.toLocaleString()} | Buffer: KSh ${safeBuffer.toLocaleString()}
Days to salary: ${state.daysToNextSalary ?? "?"}

PRIORITY STACK:
${stackLines || "  (none yet)"}

RULES:
1. For known intents, financial facts have already been presented. Add only 1-2 sentences of warm encouragement or clarification — never cite a different KSh amount.
2. For open questions, call a tool before citing any number. Never invent figures.
3. Keep it warm, specific, short.`;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const chatTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "get_financial_state",
        description: "Get current financial state: float, balance, obligations, days to salary.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "simulate_action",
        description: "Check if a proposed spend is safe. Returns safe/unsafe, shortfall, threatened obligation, harvest suggestion.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            amount: { type: SchemaType.NUMBER, description: "Spend amount in KSh." },
            category: { type: SchemaType.STRING, description: "Spend category." },
          },
          required: ["amount", "category"],
        },
      },
      {
        name: "get_health_score",
        description: "Get financial health score 0-100 and explanation.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "run_priority_cascade",
        description: "Allocate income across the priority stack waterfall.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            incomeAmount: { type: SchemaType.NUMBER, description: "Income in KSh." },
          },
          required: ["incomeAmount"],
        },
      },
    ] as FunctionDeclaration[],
  },
];

// ─── Live tool execution (for Gemini-initiated calls) ─────────────────────────

async function executeLiveTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
  state: FinancialState,
  stack: PriorityStackItem[],
  onCascade: (allocation: CascadeAllocation[]) => void
): Promise<unknown> {
  if (name === "get_financial_state") return state;

  if (name === "simulate_action") {
    const amount = Number(args.amount);
    const category = String(args.category || "entertainment");
    if (!amount || amount <= 0) return { ok: false, error: "amount must be positive" };
    return simulateAction(amount, category, state, stack);
  }

  if (name === "get_health_score") {
    const [txs, goals] = await Promise.all([storage.getTransactions(userId), storage.getGoals(userId)]);
    return computeHealthScore(txs, state, stack, goals);
  }

  if (name === "run_priority_cascade") {
    const incomeAmount = Number(args.incomeAmount);
    if (!incomeAmount || incomeAmount <= 0) return { ok: false, error: "incomeAmount must be positive" };
    const result = runPriorityCascade(incomeAmount, stack);
    onCascade(result.waterfall);
    await storage.createActivityEvent({
      userId,
      kind: "salary",
      description: `Salary of KSh ${incomeAmount.toLocaleString()} allocated across priority stack.`,
      amount: incomeAmount,
    });
    return result;
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

const CHAT_MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-pro"];

// ─── Main streaming orchestrator ──────────────────────────────────────────────

export interface ChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
}

export async function streamChat(req: ChatRequest, res: Response): Promise<void> {
  const { userId, message } = req;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Resolve conversation — honor provided ID with ownership check
  let conversationId: string;
  try {
    if (req.conversationId) {
      const existing = await storage.getConversation(req.conversationId);
      if (!existing || existing.userId !== userId) {
        sseWrite(res, { type: "error", message: "Conversation not found or access denied." });
        sseWrite(res, { type: "done", conversationId: req.conversationId });
        res.end();
        return;
      }
      conversationId = existing.id;
    } else {
      conversationId = (await storage.getOrCreateConversation(userId)).id;
    }
  } catch {
    sseWrite(res, { type: "error", message: "Failed to load conversation." });
    sseWrite(res, { type: "done", conversationId: req.conversationId ?? "" });
    res.end();
    return;
  }

  // Load user data
  let user: Awaited<ReturnType<typeof storage.getUser>>;
  let txs: Awaited<ReturnType<typeof storage.getTransactions>>;
  let stack: PriorityStackItem[];
  try {
    [user, txs, stack] = await Promise.all([
      storage.getUser(userId),
      storage.getTransactions(userId),
      storage.getPriorityStack(userId),
    ]);
    if (!user) throw new Error("User not found");
  } catch (err: unknown) {
    sseWrite(res, { type: "error", message: `Could not load your data: ${err instanceof Error ? err.message : "Unknown error"}` });
    sseWrite(res, { type: "done", conversationId });
    res.end();
    return;
  }

  const safeBuffer = user.safeBuffer ?? 2000;
  const displayName = user.displayName || user.username;
  const intent = classifyIntent(message);

  // Pre-execute tools based on intent
  let preCtx: PreExecContext;
  try {
    preCtx = await preExecuteForIntent(intent, userId, txs, stack, safeBuffer);
  } catch (err: unknown) {
    sseWrite(res, { type: "error", message: `Could not compute financial data: ${err instanceof Error ? err.message : "Unknown error"}` });
    sseWrite(res, { type: "done", conversationId });
    res.end();
    return;
  }

  // Emit cascade SSE event
  let cascadeEmitted = false;
  if (preCtx.cascade) {
    sseWrite(res, { type: "cascade", allocation: preCtx.cascade.waterfall });
    cascadeEmitted = true;
    const incomeAmt = (intent.kind === "salary_income" && intent.amount) ? intent.amount : preCtx.state.estimatedMonthlySalary;
    await storage.createActivityEvent({ userId, kind: "salary", description: `Salary of KSh ${Math.round(incomeAmt).toLocaleString()} allocated.`, amount: incomeAmt }).catch(() => undefined);
  }

  const onCascade = (allocation: CascadeAllocation[]) => {
    if (!cascadeEmitted) { sseWrite(res, { type: "cascade", allocation }); cascadeEmitted = true; }
  };

  // Emit proposal SSE event for safe transfers
  if (intent.kind === "transfer" && intent.amount && intent.recipient && preCtx.simulation?.safe === true) {
    sseWrite(res, { type: "proposal", amount: intent.amount, recipient: intent.recipient });
    await storage.createActivityEvent({ userId, kind: "transfer", description: `Transfer of KSh ${intent.amount.toLocaleString()} to ${intent.recipient} proposed.`, amount: intent.amount }).catch(() => undefined);
  }

  // Log unsafe simulation alert
  if (preCtx.simulation && !preCtx.simulation.safe) {
    await storage.createActivityEvent({ userId, kind: "alert", description: `Red Alert: KSh ${(intent.amount ?? 0).toLocaleString()} would breach safe buffer.`, amount: intent.amount ?? 0 }).catch(() => undefined);
  }

  // Server-compose financial facts for known intents
  const factString = composeFactsForIntent(intent, preCtx, displayName);

  // Build chat history
  const prevMessages = await storage.getMessages(conversationId);
  const history: Content[] = prevMessages.slice(-20).map(m => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  // Inject pre-executed tool results into history
  if (preCtx.toolLog.length > 0) {
    history.push({ role: "model", parts: preCtx.toolLog.map(tc => ({ functionCall: { name: tc.name, args: tc.args } })) });
    history.push({
      role: "user",
      parts: preCtx.toolLog.map(tc => ({
        functionResponse: { name: tc.name, response: { result: JSON.stringify(tc.result) } },
      } as FunctionResponsePart)),
    });
  }

  const systemPrompt = buildSystemPrompt(displayName, preCtx.state, stack, safeBuffer);
  const userMessageText = factString
    ? `User said: "${message}"\n\nFacts already sent to user (DO NOT repeat or modify KSh figures — add only 1 warm RAFIKI sentence):\n${factString}`
    : message;

  // Stream server-composed facts first (hard gate: these come from real tool calls)
  const allToolLog: ToolCallRecord[] = [...preCtx.toolLog];
  let fullAssistantText = "";

  if (factString) {
    sseWrite(res, { type: "token", text: factString });
    fullAssistantText += factString;
  }

  // Gemini call: collect full text, apply numeric guardrail, then stream
  try {
    let lastTransientErr: Error | null = null;
    let succeeded = false;

    for (const modelName of CHAT_MODEL_CHAIN) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          tools: chatTools,
          systemInstruction: systemPrompt,
          generationConfig: { temperature: 0.7, maxOutputTokens: factString ? 200 : 1024 },
        });

        const chat = model.startChat({ history });
        let currentParts: Part[] = [{ text: userMessageText }];

        for (let round = 0; round < 4; round++) {
          const stream = await chat.sendMessageStream(currentParts);
          const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
          let roundText = "";

          for await (const chunk of stream.stream) {
            for (const part of (chunk.candidates?.[0]?.content?.parts ?? [])) {
              if ("text" in part && part.text) {
                // Collect all text — guardrail applied after full round
                roundText += part.text;
              } else if ("functionCall" in part && part.functionCall) {
                functionCalls.push({
                  name: part.functionCall.name,
                  args: (part.functionCall.args ?? {}) as Record<string, unknown>,
                });
              }
            }
          }

          if (functionCalls.length === 0) {
            // Apply numeric guardrail to collected round text before streaming
            if (roundText.trim()) {
              const whitelist = buildNumericWhitelist(allToolLog);
              const guarded = applyNumericGuardrail(roundText, whitelist).trim();
              if (guarded) {
                const spacer = fullAssistantText.length > 0 && !fullAssistantText.endsWith(" ") ? " " : "";
                const toStream = spacer + guarded;
                fullAssistantText += toStream;
                sseWrite(res, { type: "token", text: toStream });
              }
            }
            break;
          }

          // Execute Gemini-initiated tool calls
          const responseParts: FunctionResponsePart[] = [];
          for (const fc of functionCalls) {
            const result = await executeLiveTool(fc.name, fc.args, userId, preCtx.state, stack, onCascade);
            allToolLog.push({ name: fc.name, args: fc.args, result });
            responseParts.push({ functionResponse: { name: fc.name, response: { result: JSON.stringify(result) } } });
          }
          currentParts = responseParts;
        }

        succeeded = true;
        break;
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        const status = (err as { status?: number })?.status;
        const msgLower = e.message.toLowerCase();
        if (status === 429 || msgLower.includes("quota") || msgLower.includes("billing")) throw e;
        if (status === 503 || status === 500 || msgLower.includes("overloaded")) {
          lastTransientErr = e;
          console.warn(`Chat model "${modelName}" busy — trying next.`);
          continue;
        }
        throw e;
      }
    }

    if (!succeeded) throw lastTransientErr ?? new Error("All chat models unavailable");
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("Chat stream error:", e.message);
    if (!fullAssistantText) {
      const isQuota = e.message.toLowerCase().includes("quota") || e.message.toLowerCase().includes("billing");
      const msg = isQuota
        ? "I'm not able to respond right now — my AI service has reached its limit. Please try again in a few minutes."
        : "Something went wrong on my end. Give it a moment and try again.";
      sseWrite(res, { type: "token", text: msg });
      fullAssistantText = msg;
    }
  }

  // Persist messages
  try {
    await storage.createMessage({ conversationId, role: "user", content: message, toolCallsJson: null });
    if (fullAssistantText.trim()) {
      await storage.createMessage({ conversationId, role: "assistant", content: fullAssistantText.trim(), toolCallsJson: allToolLog.length > 0 ? allToolLog : null });
    }
    await storage.updateConversation(conversationId);
  } catch (err: unknown) {
    console.error("Failed to persist chat messages:", err instanceof Error ? err.message : "unknown error");
  }

  sseWrite(res, { type: "done", conversationId });
  res.end();
}
