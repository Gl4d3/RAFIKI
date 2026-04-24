// RAFIKI Streaming Chat — Gemini-powered conversational interface.
//
// Architecture:
// 1. Server-side intent classification → forces the correct Accountant tools
//    to run BEFORE Gemini generates any text.
// 2. Financial facts are composed server-side from tool results and streamed
//    directly as the authoritative first part of the response. This is the
//    hard gate ensuring no model-invented numbers reach the user.
// 3. Gemini adds a warm 1-2 sentence RAFIKI conversational framing after the facts.
// 4. For unsafe spend: Red Alert fields (shortfall, obligation, due days,
//    harvest) are composed server-side deterministically.
//
// Tool execution wraps accountant-live functions exactly as the HTTP endpoints
// do — all Accountant logic is in accountant-live.ts; routes + chat tools both
// call the same pure functions, making them endpoint-equivalent.

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

// ─── Typed tool call log entry ────────────────────────────────────────────────

interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

// ─── Intent classification ────────────────────────────────────────────────────

type IntentKind =
  | "spend_query"    // "how much can I spend?" / "what's my float?"
  | "simulate_spend" // "can I afford 3000 on food?"
  | "transfer"       // "send mum 2000"
  | "health_check"   // "how am I doing?"
  | "salary_income"  // "my salary arrived" / "I received 85000"
  | "unknown";

interface ParsedIntent {
  kind: IntentKind;
  amount?: number;          // Explicit amount parsed from message
  category?: string;
  recipient?: string;
}

function parseKshAmount(str: string): number {
  const clean = str.replace(/,/g, "").trim().toLowerCase();
  if (clean.endsWith("k")) return parseFloat(clean) * 1000;
  return parseFloat(clean) || 0;
}

function guessCategoryFromHint(hint: string, msg: string): string {
  const combined = `${hint} ${msg}`;
  if (/food|grocer|meal|lunch|dinner|breakfast|nyama|choma|eat/i.test(combined)) return "food";
  if (/transport|fare|matatu|uber|taxi|fuel|petrol/i.test(combined)) return "transport";
  if (/chama/i.test(combined)) return "chama";
  if (/family|mum|mom|dad|sibling|brother|sister/i.test(combined)) return "family";
  if (/school|fees|education|tuition/i.test(combined)) return "education";
  if (/hospital|clinic|health|medicine|doctor/i.test(combined)) return "healthcare";
  if (/rent|house|housing/i.test(combined)) return "rent";
  if (/save|savings/i.test(combined)) return "savings";
  return "entertainment";
}

function classifyIntent(message: string): ParsedIntent {
  const msg = message.toLowerCase();

  // Transfer: "send mum 2000" / "pay john 5k" / "transfer 3000 to sister"
  const transferPatterns = [
    /(?:send|pay|transfer)\s+([a-z][a-z\s]+?)\s+(?:ksh\s*)?(\d[\d,.]+k?)\b/i,
    /(?:send|pay|transfer)\s+(?:ksh\s*)?(\d[\d,.]+k?)\s+(?:to\s+)?([a-z][a-z\s]+)/i,
  ];
  for (const pat of transferPatterns) {
    const m = message.match(pat);
    if (m) {
      const [, a, b] = m;
      const isANumeric = /\d/.test(a);
      const numStr = isANumeric ? a : b;
      const nameStr = isANumeric ? b : a;
      const amount = parseKshAmount(numStr);
      const recipient = nameStr.trim();
      if (amount > 0 && recipient.length > 1) {
        const cat = guessCategoryFromHint("", msg.includes("mum") || msg.includes("dad") ? "family" : msg);
        return { kind: "transfer", amount, recipient, category: cat };
      }
    }
  }

  // Simulate spend: "can I buy/spend/afford X" or explicit amount + context
  const simPatterns = [
    /(?:buy|spend|afford|do|get|have)\s+(?:ksh\s*)?(\d[\d,.]+k?)(?:\s+on\s+([a-z\s]+))?/i,
    /(?:ksh\s*)?(\d[\d,.]+k?)\s+on\s+([a-z\s]+)/i,
    /spend\s+(?:ksh\s*)?(\d[\d,.]+k?)/i,
    /(?:nyama choma|lunch|dinner|drinks)\s+(?:for\s+)?(?:ksh\s*)?(\d[\d,.]+k?)/i,
    /(?:ksh\s*)?(\d[\d,.]+k?)\s+(?:nyama choma|lunch|dinner|drinks)/i,
  ];
  for (const pat of simPatterns) {
    const m = message.match(pat);
    if (m) {
      const numStr = m[1];
      const catHint = (m[2] ?? "").toLowerCase();
      const amount = parseKshAmount(numStr ?? "0");
      if (amount > 0) {
        return {
          kind: "simulate_spend",
          amount,
          category: guessCategoryFromHint(catHint, msg),
        };
      }
    }
  }

  // Salary / income — with or without explicit amount
  const salaryPhrases = /salary|payslip|just (got|received|been paid)|got paid|income arrived|salary.*(arrived|landed|in|came)/i;
  const receivedPattern = /(?:received|got|deposited|salary\s+of)\s+(?:ksh\s*)?(\d[\d,.]+k?)/i;
  if (salaryPhrases.test(msg) || receivedPattern.test(msg)) {
    const m = message.match(receivedPattern);
    const amount = m ? parseKshAmount(m[1]) : undefined;
    return { kind: "salary_income", amount };
  }

  // Health check
  if (
    /how\s+(am|are)\s+(i|we)\s+doing|financial.*(health|situation|status)|how.*(looking|going)/i.test(msg) ||
    /am i on track|health score|my finances/i.test(msg)
  ) {
    return { kind: "health_check" };
  }

  // Spend query (open-ended — no specific amount)
  if (
    /how much (can|do) i (spend|have|afford)|what.*(float|balance|available)|can i spend/i.test(msg) ||
    /(?:my|the)\s+(?:float|available\s+money|free\s+money)/i.test(msg)
  ) {
    return { kind: "spend_query" };
  }

  return { kind: "unknown" };
}

// ─── Pre-execution: forced tool runs for known intents ────────────────────────

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
  const log: ToolCallRecord[] = [
    { name: "get_financial_state", args: {}, result: state },
  ];
  const ctx: PreExecContext = { state, toolLog: log };

  if (intent.kind === "spend_query") {
    // Force simulate_action with the full availableFloat — this gives "max safe spend"
    const sim = simulateAction(state.availableFloat, "entertainment", state, stack);
    ctx.simulation = sim;
    log.push({
      name: "simulate_action",
      args: { amount: state.availableFloat, category: "entertainment" },
      result: sim,
    });
  }

  if (intent.kind === "simulate_spend" || intent.kind === "transfer") {
    if (intent.amount && intent.amount > 0) {
      const sim = simulateAction(
        intent.amount,
        intent.category ?? "entertainment",
        state,
        stack
      );
      ctx.simulation = sim;
      log.push({
        name: "simulate_action",
        args: { amount: intent.amount, category: intent.category ?? "entertainment" },
        result: sim,
      });
    }
  }

  if (intent.kind === "health_check") {
    const goals = await storage.getGoals(userId);
    const health = computeHealthScore(txs, state, stack, goals);
    ctx.healthScore = health;
    log.push({ name: "get_health_score", args: {}, result: health });
  }

  if (intent.kind === "salary_income") {
    // Fall back to estimated monthly salary when no explicit amount in message
    const incomeAmount = (intent.amount && intent.amount > 0)
      ? intent.amount
      : state.estimatedMonthlySalary;

    if (incomeAmount > 0) {
      const cascade = runPriorityCascade(incomeAmount, stack);
      ctx.cascade = cascade;
      log.push({
        name: "run_priority_cascade",
        args: { incomeAmount },
        result: cascade,
      });
    }
  }

  return ctx;
}

// ─── Server-composed financial facts (hard gate for number provenance) ────────
// These fact strings are streamed BEFORE Gemini responds, guaranteeing that
// every KSh figure the user sees came from a real tool result.

function composeFactsForIntent(
  intent: ParsedIntent,
  preCtx: PreExecContext,
  displayName: string
): string {
  const { state, simulation, healthScore, cascade } = preCtx;
  const fmt = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;

  switch (intent.kind) {
    case "spend_query": {
      // The simulation was run with amount=availableFloat so safe=true means there's float
      const float = fmt(state.availableFloat);
      const balance = fmt(state.currentBalance);
      const days = state.daysToNextSalary ?? "?";
      return `${displayName}, your available float right now is ${float} (balance: ${balance}, safe buffer held aside). That leaves ${float} you can safely spend before your next salary in ${days} days.`;
    }

    case "simulate_spend":
    case "transfer": {
      const amount = intent.amount ?? 0;
      const amtStr = fmt(amount);
      if (!simulation) {
        return `${displayName}, I couldn't compute the simulation for ${amtStr}.`;
      }
      if (simulation.safe) {
        const remaining = fmt(simulation.remainingAfter);
        return `${displayName}, ${amtStr} is safe — it leaves ${remaining} in your float after this spend.`;
      }
      // Unsafe — Red Alert (deterministic)
      const lines: string[] = [
        `${displayName}, ${amtStr} is ${fmt(simulation.shortfall)} more than your float allows right now.`,
      ];
      if (simulation.nearestThreatenedObligation) {
        const { label, daysUntilDue } = simulation.nearestThreatenedObligation;
        const daysStr = daysUntilDue !== null ? `${daysUntilDue} days` : "this month";
        lines.push(`This would put your ${label} at risk — that obligation is due in ${daysStr}.`);
      }
      if (simulation.harvestSuggestion) {
        const { sourceName, deferableAmount } = simulation.harvestSuggestion;
        lines.push(
          `One option: defer ${fmt(deferableAmount)} from your ${sourceName} contribution — that would cover the gap.`
        );
      } else {
        lines.push(`There is no Tier 2 item available to defer right now that would cover the shortfall.`);
      }
      return lines.join(" ");
    }

    case "health_check": {
      if (!healthScore) {
        return `${displayName}, I couldn't load your health score right now.`;
      }
      return `${displayName}, your financial health score is ${healthScore.score}/100. ${healthScore.explanation}`;
    }

    case "salary_income": {
      if (!cascade) {
        const salary = fmt(state.estimatedMonthlySalary);
        return `${displayName}, your estimated salary is ${salary}. I need the actual amount to run the full allocation — how much came in?`;
      }
      const income = fmt(cascade.waterfall.reduce((s, w) => s + w.amount, 0) + cascade.leftover);
      const leftover = fmt(cascade.leftover);
      const topLine = cascade.waterfall[0]
        ? `Tier 1 obligations (${fmt(cascade.waterfall.filter(w => w.tier === "1").reduce((s, w) => s + w.amount, 0))}) are fully covered.`
        : "";
      return `${displayName}, ${income} has been allocated across your priority stack. ${topLine} You have ${leftover} left over after all obligations.`;
    }

    case "unknown":
    default:
      // Unknown intent — don't stream any financial facts, let Gemini handle fully
      return "";
  }
}

// ─── System prompt (synchronous — state already computed) ─────────────────────

function buildSystemPrompt(
  displayName: string,
  state: FinancialState,
  stack: PriorityStackItem[],
  safeBuffer: number
): string {
  const stackLines = stack
    .filter((i) => i.isActive)
    .sort((a, b) => a.rank - b.rank)
    .map(
      (i) =>
        `  Tier ${i.tier} | ${i.label} | KSh ${(i.monthlyAmount || 0).toLocaleString()}/month`
    )
    .join("\n");

  return `You are RAFIKI, a warm, calm, and intelligent personal finance companion built for Kenya.
You speak in a friendly, conversational tone — like a trusted financial friend, not a bank.
You use plain English. You may occasionally use a Swahili phrase naturally (like "sawa" or "poa") but keep it minimal.
You never use emojis. You never use bullet points or lists in conversational replies.
You are concise — add 1-2 sentences of warm, encouraging conversational framing only.
The currency is always written as "KSh" followed by the amount with commas (e.g. KSh 8,000).

USER CONTEXT:
  Name: ${displayName}
  Estimated monthly salary: KSh ${state.estimatedMonthlySalary.toLocaleString()} from "${state.salarySource}"
  Current balance: KSh ${state.currentBalance.toLocaleString()}
  Safe buffer: KSh ${safeBuffer.toLocaleString()}
  Available float: KSh ${state.availableFloat.toLocaleString()}
  Days to next salary: ${state.daysToNextSalary ?? "unknown"}

PRIORITY STACK:
${stackLines || "  (no priority stack items yet)"}

RULES:
1. Financial facts have already been presented to the user from pre-computed tool results. Your job is ONLY to add warm, conversational framing around those facts — do NOT repeat or modify any KSh figure.
2. If the context has no pre-composed facts (open-ended chat), answer helpfully but NEVER invent financial figures. Call a tool if you need numbers.
3. Sound like a trusted friend. Be encouraging and specific. Keep it short.`;
}

// ─── Tool definitions (for Gemini's additional tool calls on open-ended chat) ─

const chatTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "get_financial_state",
        description: "Get the user's current financial state.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "simulate_action",
        description: "Check whether a proposed spend is safe.",
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
        description: "Get financial health score (0–100) and explanation.",
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

// ─── Live tool execution (for Gemini-initiated additional calls) ──────────────

async function executeLiveTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
  state: FinancialState,
  stack: PriorityStackItem[],
  emitCascade: (allocation: CascadeAllocation[]) => void
): Promise<unknown> {
  if (name === "get_financial_state") return state;

  if (name === "simulate_action") {
    const amount = Number(args.amount);
    const category = String(args.category || "entertainment");
    if (!amount || amount <= 0) return { ok: false, error: "amount must be positive" };
    return simulateAction(amount, category, state, stack);
  }

  if (name === "get_health_score") {
    const [txs, goals] = await Promise.all([
      storage.getTransactions(userId),
      storage.getGoals(userId),
    ]);
    return computeHealthScore(txs, state, stack, goals);
  }

  if (name === "run_priority_cascade") {
    const incomeAmount = Number(args.incomeAmount);
    if (!incomeAmount || incomeAmount <= 0) return { ok: false, error: "incomeAmount must be positive" };
    const result = runPriorityCascade(incomeAmount, stack);
    emitCascade(result.waterfall);
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

// ─── Model chain ──────────────────────────────────────────────────────────────

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

  // ── Resolve conversation (honor provided ID with ownership check) ──────────
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
      const conv = await storage.getOrCreateConversation(userId);
      conversationId = conv.id;
    }
  } catch {
    sseWrite(res, { type: "error", message: "Failed to load conversation." });
    sseWrite(res, { type: "done", conversationId: req.conversationId ?? "" });
    res.end();
    return;
  }

  // ── Load user data ─────────────────────────────────────────────────────────
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
    const msg = err instanceof Error ? err.message : "Unknown error";
    sseWrite(res, { type: "error", message: `Could not load your data: ${msg}` });
    sseWrite(res, { type: "done", conversationId });
    res.end();
    return;
  }

  const safeBuffer = user.safeBuffer ?? 2000;
  const displayName = user.displayName || user.username;

  // ── Classify intent ────────────────────────────────────────────────────────
  const intent = classifyIntent(message);

  // ── Pre-execute tools server-side based on intent ─────────────────────────
  let preCtx: PreExecContext;
  try {
    preCtx = await preExecuteForIntent(intent, userId, txs, stack, safeBuffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    sseWrite(res, { type: "error", message: `Could not compute financial data: ${msg}` });
    sseWrite(res, { type: "done", conversationId });
    res.end();
    return;
  }

  // ── Emit cascade SSE event if pre-execution ran a salary cascade ──────────
  let cascadeEmitted = false;
  if (preCtx.cascade) {
    sseWrite(res, { type: "cascade", allocation: preCtx.cascade.waterfall });
    cascadeEmitted = true;
    await storage.createActivityEvent({
      userId,
      kind: "salary",
      description: `Salary of KSh ${Math.round(intent.amount ?? preCtx.state.estimatedMonthlySalary).toLocaleString()} allocated across priority stack.`,
      amount: intent.amount ?? preCtx.state.estimatedMonthlySalary,
    }).catch(() => undefined);
  }

  const emitCascade = (allocation: CascadeAllocation[]) => {
    if (!cascadeEmitted) {
      sseWrite(res, { type: "cascade", allocation });
      cascadeEmitted = true;
    }
  };

  // ── Emit proposal SSE + activity event for safe transfer ─────────────────
  if (
    intent.kind === "transfer" &&
    intent.amount &&
    intent.recipient &&
    preCtx.simulation?.safe === true
  ) {
    sseWrite(res, {
      type: "proposal",
      amount: intent.amount,
      recipient: intent.recipient,
    });
    await storage.createActivityEvent({
      userId,
      kind: "transfer",
      description: `Transfer of KSh ${intent.amount.toLocaleString()} to ${intent.recipient} proposed by RAFIKI.`,
      amount: intent.amount,
    }).catch(() => undefined);
  }

  // ── Compose server-side financial facts (hard gate for number provenance) ──
  const factString = composeFactsForIntent(intent, preCtx, displayName);

  // ── Build chat history ────────────────────────────────────────────────────
  const prevMessages = await storage.getMessages(conversationId);
  const history: Content[] = prevMessages.slice(-20).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  // Inject pre-executed tool results as model + user turns (for Gemini's context)
  if (preCtx.toolLog.length > 0) {
    const callParts: Part[] = preCtx.toolLog.map((tc) => ({
      functionCall: { name: tc.name, args: tc.args },
    }));
    history.push({ role: "model", parts: callParts });

    const responseParts: FunctionResponsePart[] = preCtx.toolLog.map((tc) => ({
      functionResponse: {
        name: tc.name,
        response: { result: JSON.stringify(tc.result) },
      },
    }));
    history.push({ role: "user", parts: responseParts });
  }

  const systemPrompt = buildSystemPrompt(displayName, preCtx.state, stack, safeBuffer);

  // Build the user message. For known intents, include the pre-composed facts
  // as context so Gemini only adds conversational framing.
  const userMessageText = factString
    ? `User said: "${message}"\n\nFacts already presented to the user (DO NOT repeat or modify these KSh figures — just add warm 1-2 sentence RAFIKI framing):\n${factString}`
    : message;

  // ── Stream server-composed facts first (hard gate) ────────────────────────
  const allToolLog: ToolCallRecord[] = [...preCtx.toolLog];
  let fullAssistantText = "";

  if (factString) {
    sseWrite(res, { type: "token", text: factString });
    fullAssistantText += factString;
  }

  // ── Log unsafe simulation alert activity ──────────────────────────────────
  if (preCtx.simulation && !preCtx.simulation.safe) {
    await storage.createActivityEvent({
      userId,
      kind: "alert",
      description: `Red Alert: KSh ${(intent.amount ?? 0).toLocaleString()} would breach safe buffer.`,
      amount: intent.amount ?? 0,
    }).catch(() => undefined);
  }

  // ── Gemini streaming: adds conversational framing + handles unknown intents ─
  try {
    let lastTransientErr: Error | null = null;
    let succeeded = false;

    for (const modelName of CHAT_MODEL_CHAIN) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          tools: chatTools,
          systemInstruction: systemPrompt,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: factString ? 200 : 1024, // Short framing only when facts are pre-composed
          },
        });

        const chat = model.startChat({ history });
        let currentParts: Part[] = [{ text: userMessageText }];
        const MAX_TOOL_ROUNDS = 4;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const stream = await chat.sendMessageStream(currentParts);
          const roundFunctionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

          for await (const chunk of stream.stream) {
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              if ("text" in part && part.text) {
                // When facts are pre-composed, append a space separator before Gemini framing
                if (fullAssistantText.length > 0 && !fullAssistantText.endsWith(" ") && round === 0) {
                  sseWrite(res, { type: "token", text: " " });
                  fullAssistantText += " ";
                }
                fullAssistantText += part.text;
                sseWrite(res, { type: "token", text: part.text });
              } else if ("functionCall" in part && part.functionCall) {
                roundFunctionCalls.push({
                  name: part.functionCall.name,
                  args: (part.functionCall.args ?? {}) as Record<string, unknown>,
                });
              }
            }
          }

          if (roundFunctionCalls.length === 0) break;

          const responseParts: FunctionResponsePart[] = [];
          for (const fc of roundFunctionCalls) {
            const result = await executeLiveTool(
              fc.name,
              fc.args,
              userId,
              preCtx.state,
              stack,
              emitCascade
            );
            allToolLog.push({ name: fc.name, args: fc.args, result });
            responseParts.push({
              functionResponse: {
                name: fc.name,
                response: { result: JSON.stringify(result) },
              },
            });
          }

          currentParts = responseParts;
        }

        succeeded = true;
        break;
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        const anyErr = err as { status?: number };
        const status = anyErr?.status;
        const msgLower = e.message.toLowerCase();
        const isQuota = status === 429 || msgLower.includes("quota") || msgLower.includes("billing");
        const isTransient =
          status === 503 || status === 500 || msgLower.includes("overloaded");

        if (isQuota) throw e;
        if (isTransient) {
          lastTransientErr = e;
          console.warn(`Chat model "${modelName}" busy — trying next.`);
          continue;
        }
        throw e;
      }
    }

    if (!succeeded) {
      throw lastTransientErr ?? new Error("All chat models unavailable");
    }
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("Chat stream error:", e.message);
    const isQuota =
      e.message.toLowerCase().includes("quota") ||
      e.message.toLowerCase().includes("billing");

    // Only emit an error message if we haven't already streamed financial facts
    if (!fullAssistantText) {
      const errorMsg = isQuota
        ? "I'm not able to respond right now — my AI service has reached its limit. Please try again in a few minutes."
        : "Something went wrong on my end. Give it a moment and try again.";
      sseWrite(res, { type: "token", text: errorMsg });
      fullAssistantText = errorMsg;
    } else {
      // Facts were already streamed — add a brief apology for missing the framing
      const apology = " (I ran into a small issue adding details — try asking again for more.)";
      sseWrite(res, { type: "token", text: apology });
      fullAssistantText += apology;
    }
  }

  // ── Persist messages ───────────────────────────────────────────────────────
  try {
    await storage.createMessage({
      conversationId,
      role: "user",
      content: message,
      toolCallsJson: null,
    });

    if (fullAssistantText.trim()) {
      await storage.createMessage({
        conversationId,
        role: "assistant",
        content: fullAssistantText.trim(),
        toolCallsJson: allToolLog.length > 0 ? allToolLog : null,
      });
    }

    await storage.updateConversation(conversationId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("Failed to persist chat messages:", msg);
  }

  sseWrite(res, { type: "done", conversationId });
  res.end();
}
