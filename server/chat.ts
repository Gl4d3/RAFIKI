// RAFIKI Streaming Chat — Gemini-powered conversational interface.
// Financial figures ONLY come from Accountant tool calls, never from model reasoning.
// Streams Server-Sent Events to the client.

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
  type SimulationResult,
  type CascadeAllocation,
} from "./accountant-live";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sseWrite(res: Response, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ─── Typed tool call log entry ────────────────────────────────────────────────

interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
}

// ─── System prompt ────────────────────────────────────────────────────────────

async function buildSystemPrompt(userId: string): Promise<string> {
  const [user, txs, stack] = await Promise.all([
    storage.getUser(userId),
    storage.getTransactions(userId),
    storage.getPriorityStack(userId),
  ]);

  if (!user) throw new Error("User not found");

  const state = computeFinancialState(txs, stack, user.safeBuffer ?? 2000);

  const stackLines = stack
    .filter((i) => i.isActive)
    .sort((a, b) => a.rank - b.rank)
    .map(
      (i) =>
        `  Tier ${i.tier} | ${i.label} | KSh ${(i.monthlyAmount || 0).toLocaleString()}/month`
    )
    .join("\n");

  const name = user.displayName || user.username;

  return `You are RAFIKI, a warm, calm, and intelligent personal finance companion built for Kenya.
You speak in a friendly, conversational tone — like a trusted financial friend, not a bank.
You use plain English. You may occasionally use a Swahili phrase naturally (like "sawa" or "poa") but keep it minimal.
You never use emojis. You never use bullet points or lists in conversational replies.
You are concise — your messages are 2–4 short sentences, warm and specific to actual numbers.
The currency is always written as "KSh" followed by the amount with commas (e.g. KSh 8,000).

USER CONTEXT (snapshot at start of conversation):
  Name: ${name}
  Estimated monthly salary: KSh ${state.estimatedMonthlySalary.toLocaleString()} from "${state.salarySource}"
  Current balance: KSh ${state.currentBalance.toLocaleString()}
  Safe buffer: KSh ${(user.safeBuffer ?? 2000).toLocaleString()}
  Available float (after committed obligations + safe buffer): KSh ${state.availableFloat.toLocaleString()}
  Days to next salary: ${state.daysToNextSalary ?? "unknown"}

PRIORITY STACK (monthly obligations):
${stackLines || "  (no priority stack items yet)"}

RULES — you MUST follow these exactly:
1. Never state a financial number that did not come from a tool call result in this conversation.
   Always call the appropriate tool before citing any figure.
2. When the user asks about spending — even a simple "how much can I spend?" — call get_financial_state first, then simulate_action if needed.
3. When the user proposes a specific spend or transfer (e.g. "send mum 2000"), call simulate_action(amount, category) to check safety.
   - If safe: respond warmly confirming it is fine.
   - If unsafe (Red Alert): NEVER just refuse. Always state:
       • The exact shortfall (KSh X).
       • Which Tier 1 obligation is at risk and how many days until it is due.
       • The harvest suggestion (a Tier 2 item that can be deferred) if one is available.
       • Offer a reduced amount or alternative if possible.
4. When the user mentions salary arriving or a large credit, call run_priority_cascade with the amount.
5. When the user asks "how am I doing?" or a general check-in, call get_financial_state and get_health_score.
6. Your conversational text must sound natural — never read like a report or a list of numbers.`;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const chatTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "get_financial_state",
        description:
          "Get the user's current financial state: available float, current balance, committed obligations, days to next salary. Call this before answering any question about money available.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "simulate_action",
        description:
          "Check whether a proposed spend is safe. Returns safe/unsafe, remaining float, shortfall, which obligation is at risk, and a harvest suggestion when one exists. ALWAYS call this before confirming or refusing a specific spend or transfer.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            amount: {
              type: SchemaType.NUMBER,
              description: "The spend amount in KSh.",
            },
            category: {
              type: SchemaType.STRING,
              description:
                "Category of the spend: food, transport, entertainment, family, chama, savings, healthcare, education, utilities, rent, one_time, unknown.",
            },
          },
          required: ["amount", "category"],
        },
      },
      {
        name: "get_health_score",
        description:
          "Get the user's financial health score (0–100) and a plain-language explanation. Call this when the user asks how they are doing financially.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: "run_priority_cascade",
        description:
          "Allocate an income amount across the user's priority stack waterfall (Tier 1 first, then 2, 3, 4). Call this when the user mentions salary arriving or wants to see how income should be allocated.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            incomeAmount: {
              type: SchemaType.NUMBER,
              description: "The income amount in KSh to allocate.",
            },
          },
          required: ["incomeAmount"],
        },
      },
    ] as FunctionDeclaration[],
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface ToolContext {
  userId: string;
  emitCascade: (allocation: CascadeAllocation[]) => void;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const [user, txs, stack] = await Promise.all([
      storage.getUser(ctx.userId),
      storage.getTransactions(ctx.userId),
      storage.getPriorityStack(ctx.userId),
    ]);
    if (!user) return { ok: false, error: "User not found" };

    const state = computeFinancialState(txs, stack, user.safeBuffer ?? 2000);

    if (name === "get_financial_state") {
      return { ok: true, data: state };
    }

    if (name === "simulate_action") {
      const amount = Number(args.amount);
      const category = String(args.category || "general");
      if (!amount || amount <= 0) return { ok: false, error: "amount must be positive" };

      const result: SimulationResult = simulateAction(amount, category, state, stack);

      if (result.bufferBreached) {
        await storage.createActivityEvent({
          userId: ctx.userId,
          kind: "alert",
          description: `Red Alert: KSh ${amount.toLocaleString()} would breach safe buffer.`,
          amount,
        });
      }

      return { ok: true, data: result };
    }

    if (name === "get_health_score") {
      const goals = await storage.getGoals(ctx.userId);
      const result = computeHealthScore(txs, state, stack, goals);
      return { ok: true, data: result };
    }

    if (name === "run_priority_cascade") {
      const incomeAmount = Number(args.incomeAmount);
      if (!incomeAmount || incomeAmount <= 0)
        return { ok: false, error: "incomeAmount must be positive" };

      const result = runPriorityCascade(incomeAmount, stack);
      ctx.emitCascade(result.waterfall);

      await storage.createActivityEvent({
        userId: ctx.userId,
        kind: "salary",
        description: `Salary of KSh ${incomeAmount.toLocaleString()} allocated across priority stack.`,
        amount: incomeAmount,
      });

      return { ok: true, data: result };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Tool execution failed";
    return { ok: false, error: msg };
  }
}

// ─── Intent detection ─────────────────────────────────────────────────────────

function detectTransferIntent(
  message: string
): { amount: number; recipient: string } | null {
  const patterns = [
    /(?:send|pay|transfer)\s+([a-z][a-z\s]+?)\s+(?:ksh\s*)?(\d[\d,]+)/i,
    /(?:send|pay|transfer)\s+(?:ksh\s*)?(\d[\d,]+)\s+(?:to\s+)?([a-z][a-z\s]+)/i,
  ];

  for (const pat of patterns) {
    const m = message.match(pat);
    if (m) {
      const [, a, b] = m;
      const isANumeric = /\d[\d,]+/.test(a);
      const numStr = isANumeric ? a : b;
      const nameStr = isANumeric ? b : a;
      const amount = parseInt(numStr.replace(/,/g, ""), 10);
      const recipient = nameStr.trim();
      if (amount > 0 && recipient.length > 0) {
        return { amount, recipient };
      }
    }
  }
  return null;
}

// ─── Model selection ──────────────────────────────────────────────────────────

const CHAT_MODEL_CHAIN = ["gemini-2.5-flash", "gemini-2.5-pro"];

// ─── Main streaming orchestrator ──────────────────────────────────────────────

export interface ChatRequest {
  userId: string;
  message: string;
  conversationId?: string;
}

export async function streamChat(
  req: ChatRequest,
  res: Response
): Promise<void> {
  const { userId, message } = req;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Resolve conversation — honor the supplied ID if it belongs to this user.
  let conversationId: string;
  try {
    if (req.conversationId) {
      const existing = await storage.getConversation(req.conversationId);
      if (!existing || existing.userId !== userId) {
        sseWrite(res, {
          type: "error",
          message: "Conversation not found or access denied.",
        });
        sseWrite(res, { type: "done", conversationId: req.conversationId });
        res.end();
        return;
      }
      conversationId = existing.id;
    } else {
      const conv = await storage.getOrCreateConversation(userId);
      conversationId = conv.id;
    }
  } catch (err: unknown) {
    sseWrite(res, { type: "error", message: "Failed to load conversation." });
    sseWrite(res, { type: "done", conversationId: req.conversationId ?? "" });
    res.end();
    return;
  }

  const prevMessages = await storage.getMessages(conversationId);
  const history: Content[] = prevMessages.slice(-20).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  let systemPrompt: string;
  try {
    systemPrompt = await buildSystemPrompt(userId);
  } catch (err: unknown) {
    sseWrite(res, {
      type: "error",
      message: "Could not load your financial data. Please try again.",
    });
    sseWrite(res, { type: "done", conversationId });
    res.end();
    return;
  }

  const transferIntent = detectTransferIntent(message);

  let cascadeEmitted = false;
  const emitCascade = (allocation: CascadeAllocation[]) => {
    if (!cascadeEmitted) {
      sseWrite(res, { type: "cascade", allocation });
      cascadeEmitted = true;
    }
  };

  const toolCtx: ToolContext = { userId, emitCascade };

  const toolCallLog: ToolCallRecord[] = [];
  let fullAssistantText = "";
  let proposalEmitted = false;
  let streamError: Error | null = null;

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
        let currentParts: Part[] = [{ text: message }];
        const MAX_TOOL_ROUNDS = 6;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const stream = await chat.sendMessageStream(currentParts);

          const roundFunctionCalls: Array<{
            name: string;
            args: Record<string, unknown>;
          }> = [];

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
            const result = await executeTool(fc.name, fc.args, toolCtx);
            toolCallLog.push({ name: fc.name, args: fc.args, result });

            // Emit proposal SSE + activity event when simulate_action is safe
            // and the user expressed a transfer intent.
            if (
              fc.name === "simulate_action" &&
              !proposalEmitted &&
              transferIntent !== null
            ) {
              const sim = result.data as SimulationResult | undefined;
              if (sim?.safe === true) {
                sseWrite(res, {
                  type: "proposal",
                  amount: transferIntent.amount,
                  recipient: transferIntent.recipient,
                });
                proposalEmitted = true;

                await storage.createActivityEvent({
                  userId,
                  kind: "transfer",
                  description: `Transfer of KSh ${transferIntent.amount.toLocaleString()} to ${transferIntent.recipient} proposed by RAFIKI.`,
                  amount: transferIntent.amount,
                });
              }
            }

            responseParts.push({
              functionResponse: {
                name: fc.name,
                response: { result: JSON.stringify(result.data ?? result) },
              },
            });
          }

          currentParts = responseParts;
        }

        succeeded = true;
        break;
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        const anyErr = err as { status?: number; response?: { status?: number } };
        const status = anyErr?.status ?? anyErr?.response?.status;
        const msg = e.message.toLowerCase();
        const isQuota = status === 429 || msg.includes("quota") || msg.includes("billing");
        const isTransient = status === 503 || status === 500 || msg.includes("overloaded");

        if (isQuota) {
          streamError = e;
          break;
        }
        if (isTransient) {
          lastTransientErr = e;
          console.warn(`Chat model "${modelName}" busy — trying next.`);
          continue;
        }
        streamError = e;
        break;
      }
    }

    // If all models failed transiently, propagate the last error.
    if (!succeeded && streamError === null && lastTransientErr !== null) {
      throw lastTransientErr;
    }
    if (!succeeded && streamError !== null) {
      throw streamError;
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

  // Persist conversation messages.
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
        toolCallsJson: toolCallLog.length > 0 ? toolCallLog : null,
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
