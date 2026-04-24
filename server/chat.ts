// RAFIKI Streaming Chat — Gemini-powered conversational interface.
//
// Architecture: server-side intent classification forces the relevant
// Accountant tool(s) to run BEFORE Gemini generates any text. Tool results
// are injected as a pre-computed "model turn" in the chat history so that
// every financial figure in the streamed response comes from real tool calls.
//
// For unsafe simulate_action results the Red Alert is composed server-side
// (deterministically) and injected into Gemini's context so the required
// fields (shortfall, obligation, days, harvest suggestion) are always present.

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
  type HealthScore,
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
  | "simulate_spend" // "can I spend 3000 on food?"
  | "transfer"       // "send mum 2000"
  | "health_check"   // "how am I doing?"
  | "salary_income"  // "my salary arrived" / "I received 85000"
  | "unknown";

interface ParsedIntent {
  kind: IntentKind;
  amount?: number;
  category?: string;
  recipient?: string;
}

function classifyIntent(message: string): ParsedIntent {
  const msg = message.toLowerCase();

  // Transfer: "send mum 2000" / "pay john 5000" / "transfer 3k to sister"
  const transferPatterns = [
    /(?:send|pay|transfer)\s+([a-z][a-z\s]+?)\s+(?:ksh\s*)?(\d[\d,.]+k?)/i,
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
      if (amount > 0 && recipient.length > 0) {
        // Guess category from context words
        const cat = msg.includes("food") || msg.includes("grocer")
          ? "food"
          : msg.includes("transport") || msg.includes("fare")
          ? "transport"
          : "family";
        return { kind: "transfer", amount, recipient, category: cat };
      }
    }
  }

  // Simulate spend: "can I buy/spend/afford X" or "what if I spend Y"
  const simPatterns = [
    /(?:buy|spend|afford|do|get)\s+(?:ksh\s*)?(\d[\d,.]+k?)(?:\s+on\s+([a-z\s]+))?/i,
    /(?:ksh\s*)?(\d[\d,.]+k?)\s+on\s+([a-z\s]+)/i,
    /spend\s+(?:ksh\s*)?(\d[\d,.]+k?)/i,
    /(?:nyama choma|lunch|dinner|drinks)\s+(?:for\s+)?(?:ksh\s*)?(\d[\d,.]+k?)/i,
    /(?:ksh\s*)?(\d[\d,.]+k?)\s+(?:nyama choma|lunch|dinner|drinks)/i,
  ];
  for (const pat of simPatterns) {
    const m = message.match(pat);
    if (m) {
      const numStr = m[1] || m[2];
      const catHint = (m[2] || m[1] || "").toLowerCase();
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

  // Salary / income
  if (
    /salary|payslip|just (got|received|been paid)|got paid|income arrived|salary.*(arrived|landed|in)/i.test(msg) ||
    /(?:received|got|deposited)\s+(?:ksh\s*)?(\d[\d,.]+k?)/i.test(msg)
  ) {
    const incomeMatch = message.match(
      /(?:received|got|deposited|salary\s+of)\s+(?:ksh\s*)?(\d[\d,.]+k?)/i
    );
    const amount = incomeMatch ? parseKshAmount(incomeMatch[1]) : undefined;
    return { kind: "salary_income", amount };
  }

  // Health check
  if (
    /how\s+(am|are)\s+(i|we)\s+doing|financial.*(health|situation|status)|how.*(looking|going)/i.test(msg) ||
    /am i on track|health score|my finances/i.test(msg)
  ) {
    return { kind: "health_check" };
  }

  // Spend query (open-ended)
  if (
    /how much (can|do) i (spend|have|afford)|what.*(float|balance|available)|can i spend/i.test(msg) ||
    /(?:my|the)\s+(?:float|available\s+money|free\s+money)/i.test(msg)
  ) {
    return { kind: "spend_query" };
  }

  return { kind: "unknown" };
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
  if (/entertain|drinks|bar|club|movie|fun|nyama\s*choma/i.test(combined)) return "entertainment";
  if (/chama/i.test(combined)) return "chama";
  if (/family|mum|mom|dad|sibling|brother|sister/i.test(combined)) return "family";
  if (/school|fees|education|tuition/i.test(combined)) return "education";
  if (/hospital|clinic|health|medicine|doctor/i.test(combined)) return "healthcare";
  if (/rent|house|housing/i.test(combined)) return "rent";
  if (/save|savings/i.test(combined)) return "savings";
  return "entertainment"; // Default for unspecified leisure
}

// ─── Deterministic Red Alert composer ────────────────────────────────────────
// Called when simulate_action returns safe=false.
// Returns a structured context block that Gemini MUST use as the basis of response.

function composeRedAlert(sim: SimulationResult): string {
  const parts: string[] = [
    `RED ALERT — The spend is UNSAFE. You MUST include ALL of the following in your response:`,
    `• Shortfall: KSh ${sim.shortfall.toLocaleString()} (the exact amount they are short)`,
  ];

  if (sim.nearestThreatenedObligation) {
    const { label, daysUntilDue } = sim.nearestThreatenedObligation;
    const daysStr =
      daysUntilDue !== null ? `${daysUntilDue} days` : "this month";
    parts.push(`• Threatened obligation: ${label} is at risk — due in ${daysStr}`);
  }

  if (sim.harvestSuggestion) {
    const { sourceName, deferableAmount, reasoning } = sim.harvestSuggestion;
    parts.push(
      `• Harvest suggestion: defer KSh ${deferableAmount.toLocaleString()} from ${sourceName}. Reason: ${reasoning}`
    );
  } else {
    parts.push(`• No harvest suggestion available — there is no Tier 2 item that can be safely deferred right now.`);
  }

  parts.push(
    `Never say just "no". Offer a reduced amount or an alternative path. Then ask if they want to proceed with the harvest suggestion (if any).`
  );

  return parts.join("\n");
}

// ─── Pre-execution: forced tool runs for known intents ────────────────────────

interface PreExecContext {
  state?: FinancialState;
  simulation?: SimulationResult;
  health?: HealthScore;
  cascade?: PriorityCascadeResult;
  redAlert?: string;
  toolLog: ToolCallRecord[];
}

async function preExecuteForIntent(
  intent: ParsedIntent,
  userId: string,
  txs: Awaited<ReturnType<typeof storage.getTransactions>>,
  stack: PriorityStackItem[],
  safeBuffer: number
): Promise<PreExecContext> {
  const log: ToolCallRecord[] = [];
  const state = computeFinancialState(txs, stack, safeBuffer);

  const ctx: PreExecContext = { state, toolLog: log };

  if (intent.kind === "spend_query") {
    log.push({ name: "get_financial_state", args: {}, result: state });
  }

  if (intent.kind === "simulate_spend" || intent.kind === "transfer") {
    if (intent.amount && intent.amount > 0) {
      log.push({ name: "get_financial_state", args: {}, result: state });

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

      if (!sim.safe) {
        ctx.redAlert = composeRedAlert(sim);
      }
    }
  }

  if (intent.kind === "health_check") {
    const goals = await storage.getGoals(userId);
    log.push({ name: "get_financial_state", args: {}, result: state });

    const health = computeHealthScore(txs, state, stack, goals);
    ctx.health = health;
    log.push({ name: "get_health_score", args: {}, result: health });
  }

  if (intent.kind === "salary_income" && intent.amount && intent.amount > 0) {
    log.push({ name: "get_financial_state", args: {}, result: state });

    const cascade = runPriorityCascade(intent.amount, stack);
    ctx.cascade = cascade;
    log.push({
      name: "run_priority_cascade",
      args: { incomeAmount: intent.amount },
      result: cascade,
    });
  }

  // For "unknown" intents still pre-load financial state so the model has context.
  if (intent.kind === "unknown") {
    log.push({ name: "get_financial_state", args: {}, result: state });
  }

  return ctx;
}

// ─── System prompt ────────────────────────────────────────────────────────────

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
You are concise — your messages are 2–4 short sentences, warm and specific to actual numbers.
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

CORE RULES:
1. You MUST only state financial figures that appear in the pre-computed tool results provided to you in this conversation. Never invent or estimate your own numbers.
2. Respond in RAFIKI's warm, concise voice. Sound like a trusted friend, not a report.
3. If a RED ALERT context block is provided, you MUST include all the required Red Alert fields in your response. Never refuse without offering a path forward.
4. Never list bullet points. Write in flowing, natural sentences.`;
}

// ─── Tool definitions (for Gemini's own additional tool calls on edge cases) ──

const chatTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "get_financial_state",
        description:
          "Get the user's current financial state. Call only if the pre-computed context does not already include it.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "simulate_action",
        description:
          "Check if a proposed spend is safe. Returns safe/unsafe, shortfall, threatened obligation, harvest suggestion.",
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
        description:
          "Allocate an income amount across the priority stack waterfall.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            incomeAmount: { type: SchemaType.NUMBER, description: "Income amount in KSh." },
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
  if (name === "get_financial_state") {
    return state;
  }
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
      description: `Salary of KSh ${(intent.amount ?? 0).toLocaleString()} allocated across priority stack.`,
      amount: intent.amount ?? 0,
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

  // ── Build chat history ────────────────────────────────────────────────────
  const prevMessages = await storage.getMessages(conversationId);
  const history: Content[] = prevMessages.slice(-20).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  // Inject pre-executed tool results as a model turn (function calls + responses)
  // This guarantees Gemini sees the real numbers BEFORE generating any text.
  if (preCtx.toolLog.length > 0) {
    // Model turn: function calls
    const callParts: Part[] = preCtx.toolLog.map((tc) => ({
      functionCall: { name: tc.name, args: tc.args },
    }));
    history.push({ role: "model", parts: callParts });

    // User turn: function responses
    const responseParts: FunctionResponsePart[] = preCtx.toolLog.map((tc) => ({
      functionResponse: {
        name: tc.name,
        response: { result: JSON.stringify(tc.result) },
      },
    }));
    history.push({ role: "user", parts: responseParts });
  }

  // Build system prompt (synchronous now — state already computed)
  const systemPrompt = buildSystemPrompt(displayName, preCtx.state!, stack, safeBuffer);

  // If a Red Alert applies, inject it as an additional user context turn.
  const userParts: Part[] = [{ text: message }];
  if (preCtx.redAlert) {
    userParts.push({ text: `\n\n[SYSTEM CONTEXT — MANDATORY]\n${preCtx.redAlert}` });
  }

  // ── All tool calls that will be logged for persistence ────────────────────
  const allToolLog: ToolCallRecord[] = [...preCtx.toolLog];
  let fullAssistantText = "";

  // ── Gemini streaming with fallback ────────────────────────────────────────
  try {
    let lastTransientErr: Error | null = null;
    let succeeded = false;

    for (const modelName of CHAT_MODEL_CHAIN) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          tools: chatTools,
          systemInstruction: systemPrompt,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        });

        const chat = model.startChat({ history });
        let currentParts: Part[] = userParts;
        const MAX_TOOL_ROUNDS = 4;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const stream = await chat.sendMessageStream(currentParts);
          const roundFunctionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

          for await (const chunk of stream.stream) {
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              if ("text" in part && part.text) {
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
              preCtx.state!,
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

        if (isQuota) {
          throw e;
        }
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

    if (!fullAssistantText) {
      const errorMsg = isQuota
        ? "I'm not able to respond right now — my AI service has reached its limit. Please try again in a few minutes."
        : "Something went wrong on my end. Give it a moment and try again.";
      sseWrite(res, { type: "token", text: errorMsg });
      fullAssistantText = errorMsg;
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
