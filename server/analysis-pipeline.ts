// Async analysis pipeline — runs after file upload
// Stages:
//   A1 — deterministic parse (server/parsers/*)
//   A2 — deterministic categorisation + recurring + salary detection
//        + cross-source dedup of candidate internal transfers
//   B  — LLM enrichment (tool calls only) — Gemini decides categories,
//        relationships, gap-flags, and confirms internal transfers
//   C  — financial summary + priority stack + reveal message

import { storage } from "./storage";
import { parseSource, SourceParseError } from "./parsers";
import type { ParsedTransaction } from "./parsers/types";
import {
  categorizeTransactions,
  detectInternalTransfers,
  identifyRecurring,
  identifySalary,
  computeFinancialSummary,
  generatePriorityStack,
  type CategorizedTransaction,
} from "./accountant";
import {
  generateRevealMessage,
  buildOfflineRevealMessage,
  buildOfflineGapQuestion,
  runEnrichment,
  GeminiUnavailableError,
} from "./gemini";
import {
  toEnrichable,
  tagInternalTransferCandidates,
  stripStageBFields,
  type EnrichableTransaction,
} from "./enrichment";

export interface PipelineSource {
  // A buffer for a file source (CSV / PDF) OR a text string for pasted SMS.
  // `auto` / `csv` / `pdf` / `sms` are M-Pesa channels; `bank` is a bank
  // statement PDF (e.g. I&M Bank) routed to the bank-PDF parser.
  kind: "auto" | "csv" | "pdf" | "sms" | "bank";
  buffer?: Buffer;
  text?: string;
  fileName?: string | null;
  sourceName: string;
  source?: "mpesa" | "bank";
}

// In-memory stash of post-Stage-A state, keyed by jobId. Lets the user
// retry Stage B (or skip it) without re-parsing every file. Lost on
// process restart — that's acceptable for the current threat model.
interface PendingAi {
  userId: string;
  enrichable: EnrichableTransaction[];
  // Pristine pre-Stage-B snapshot. Used by the "basic" branch so that
  // partial Stage B mutations (from a Gemini failure mid-enrichment)
  // never leak into the deterministic-only output.
  enrichableSnapshot: EnrichableTransaction[];
  candidatePairs: ReturnType<typeof tagInternalTransferCandidates>;
  annotation: string | null;
}

// Deep-clone the enrichable list so the snapshot is fully insulated
// from in-place tool-call mutations. Dates are reconstructed because
// structuredClone preserves them but JSON does not — we use JSON for
// portability across runtimes that lack structuredClone, then rehydrate.
function cloneEnrichable(
  txs: EnrichableTransaction[]
): EnrichableTransaction[] {
  return txs.map((t) => ({ ...t, date: new Date(t.date.getTime()) }));
}
const pendingAi: Map<string, PendingAi> = new Map();

// Quick predicate so the /ai-choice route can fail fast (truthfully)
// when the in-memory state has been lost — e.g. process restart between
// the pause and the user clicking a button.
export function hasPendingAi(jobId: string): boolean {
  return pendingAi.has(jobId);
}

export async function runAnalysisPipeline(
  jobId: string,
  userId: string,
  sources: PipelineSource[],
  isDemo: boolean = false
): Promise<void> {
  const updateJob = (progress: number, label: string) =>
    storage.updateAnalysisJob(jobId, { progress, progressLabel: label, status: "running" });

  try {
    await updateJob(5, "Reading your statement...");
    await sleep(300);

    let parsed: ParsedTransaction[];
    if (isDemo) {
      const { generateDemoTransactions } = await import("./parser");
      parsed = generateDemoTransactions();
    } else {
      // Deterministic parse — failures here are HARD errors tagged with the
      // specific source name. We never silently substitute demo data for a
      // real upload. The dispatcher routes M-Pesa CSV/PDF/SMS and I&M Bank
      // PDFs to the appropriate parser and tags every transaction with its
      // channel so the Accountant can reason about cross-source patterns.
      parsed = [];
      for (const src of sources) {
        const tx = await parseSource({
          kind: src.kind,
          buffer: src.buffer,
          text: src.text,
          fileName: src.fileName ?? null,
          sourceName: src.sourceName,
        } as any);
        // Tag every transaction with which account it came from so Stage B
        // can dedup across them.
        const channel = src.source || "mpesa";
        for (const t of tx) {
          t.source = channel;
          t.sourceName = src.sourceName;
        }
        parsed.push(...tx);
      }
      if (parsed.length === 0) {
        throw new SourceParseError(
          "statement",
          "unknown",
          "no transactions were found across the sources you provided."
        );
      }
      // Sort chronologically so downstream stages see a coherent timeline.
      parsed.sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    await updateJob(20, `Found ${parsed.length} transactions. Identifying patterns...`);
    await sleep(400);

    // Stage A2 — deterministic categorisation
    let categorized = categorizeTransactions(parsed);
    await updateJob(35, "Categorising transactions...");
    await sleep(200);

    categorized = detectInternalTransfers(categorized);
    await updateJob(45, "Spotting internal transfers...");
    await sleep(150);

    categorized = identifyRecurring(categorized);
    await updateJob(45, "Finding recurring obligations...");
    await sleep(200);

    categorized = identifySalary(categorized);
    await updateJob(55, "Identifying income sources...");
    await sleep(200);

    // Cross-source dedup before Stage B
    const enrichable = toEnrichable(categorized);
    const candidatePairs = tagInternalTransferCandidates(enrichable);

    // Read the user's annotation from the job (set at upload time).
    const job = await storage.getAnalysisJob(jobId);
    const annotation = job?.annotation || null;

    // Stash for possible retry / skip. Capture an immutable snapshot
    // BEFORE Stage B so the basic-only path can fall back to a pristine
    // deterministic result even if Stage B partially mutated `enrichable`
    // before failing.
    pendingAi.set(jobId, {
      userId,
      enrichable,
      enrichableSnapshot: cloneEnrichable(enrichable),
      candidatePairs,
      annotation,
    });

    await updateJob(65, "Asking RAFIKI to review...");

    // Stage B — LLM enrichment. If Gemini is unavailable, pause the job
    // and surface a typed choice to the UI.
    try {
      await runEnrichment(enrichable, annotation, candidatePairs);
    } catch (err: any) {
      if (err instanceof GeminiUnavailableError) {
        await storage.updateAnalysisJob(jobId, {
          status: "ai_unavailable",
          progressLabel: "RAFIKI is offline",
          error: err.reason,
        });
        // Leave pendingAi in place so /ai-choice can resume.
        return;
      }
      throw err;
    }

    await finishWithEnriched(jobId, userId, enrichable, candidatePairs.length, {
      basicOnly: false,
      aiDegradedReason: null,
    });
    pendingAi.delete(jobId);
  } catch (error: any) {
    console.error("Analysis pipeline error:", error);
    await storage.updateAnalysisJob(jobId, {
      status: "error",
      error: error.message || "Analysis failed",
      progressLabel: "Something went wrong",
    });
  }
}

// Resume a job that paused at the AI-unavailable choice.
// `choice === "retry"` re-runs Stage B; `choice === "basic"` skips it.
export async function resumeAfterAiChoice(
  jobId: string,
  choice: "retry" | "basic"
): Promise<{ ok: boolean; reason?: string }> {
  const pending = pendingAi.get(jobId);
  if (!pending) {
    return {
      ok: false,
      reason:
        "This analysis can no longer be resumed. Please upload your statement again.",
    };
  }
  const { userId, enrichableSnapshot, candidatePairs, annotation } = pending;

  if (choice === "retry") {
    await storage.updateAnalysisJob(jobId, {
      status: "running",
      progressLabel: "Asking RAFIKI again...",
      progress: 65,
      error: null,
    });
    // Re-clone from the pristine snapshot for every attempt so partial
    // mutations from previous (failed) Stage B runs never accumulate.
    const fresh = cloneEnrichable(enrichableSnapshot);
    try {
      await runEnrichment(fresh, annotation, candidatePairs);
    } catch (err: any) {
      if (err instanceof GeminiUnavailableError) {
        await storage.updateAnalysisJob(jobId, {
          status: "ai_unavailable",
          progressLabel: "RAFIKI is still offline",
          error: err.reason,
        });
        // Keep the snapshot in pendingAi for the next attempt.
        return { ok: true };
      }
      await storage.updateAnalysisJob(jobId, {
        status: "error",
        error: err?.message || "Analysis failed",
        progressLabel: "Something went wrong",
      });
      pendingAi.delete(jobId);
      return { ok: false, reason: err?.message };
    }
    // Replace the live enrichable so downstream sees the new run, not
    // any orphaned mutations from the previous failed attempt.
    pending.enrichable = fresh;
    await finishWithEnriched(jobId, userId, fresh, candidatePairs.length, {
      basicOnly: false,
      aiDegradedReason: null,
    });
    pendingAi.delete(jobId);
    return { ok: true };
  }

  // basic: skip Stage B entirely. Use the pristine snapshot so any
  // partial Stage B mutations from an earlier failed attempt are
  // discarded — the basic-only output is purely Stage A + C.
  const previousReason =
    (await storage.getAnalysisJob(jobId))?.error || "AI layer offline";
  const pristine = cloneEnrichable(enrichableSnapshot);
  await finishWithEnriched(jobId, userId, pristine, candidatePairs.length, {
    basicOnly: true,
    aiDegradedReason: previousReason,
  });
  pendingAi.delete(jobId);
  return { ok: true };
}

// Final stages C — summary, persist, reveal message. Shared between the
// happy path and the basic-only path.
async function finishWithEnriched(
  jobId: string,
  userId: string,
  enrichable: EnrichableTransaction[],
  candidatePairCount: number,
  opts: { basicOnly: boolean; aiDegradedReason: string | null }
): Promise<void> {
  await storage.updateAnalysisJob(jobId, {
    status: "running",
    progress: 78,
    progressLabel: "Building your financial model...",
  });

  const finalCategorized: CategorizedTransaction[] = stripStageBFields(enrichable);
  const summary = computeFinancialSummary(finalCategorized);
  const priorityStack = generatePriorityStack(summary);

  await storage.clearTransactions(userId);
  await storage.clearEntities(userId);
  await storage.clearPriorityStack(userId);

  await storage.createTransactions(
    finalCategorized.map((tx) => ({
      userId,
      date: tx.date,
      amount: tx.amount,
      direction: tx.direction,
      counterparty: tx.counterparty,
      reference: tx.reference || null,
      balance: tx.balance ?? null,
      category: tx.category as any,
      tier: tx.tier as any,
      isRecurring: tx.isRecurring,
      isSalary: tx.isSalary,
      // Tag internal transfers in rawText so the row stays in the
      // evidence table without polluting downstream aggregations.
      rawText: tx.isInternalTransfer
        ? `[INTERNAL_TRANSFER] ${tx.rawText}`
        : tx.rawText,
    }))
  );

  const entityMap: Record<string, string> = {};
  for (const entity of summary.allEntities) {
    const stored = await storage.createEntity({
      userId,
      name: entity.name,
      normalizedName: entity.normalizedName,
      category: entity.category as any,
      tier: entity.tier as any,
      isRecurring: entity.isRecurring,
      monthlyAmount: entity.monthlyAmount,
      frequency: entity.frequency,
      occurrences: entity.occurrences,
      isAutoResolved: entity.isAutoResolved,
      isUserResolved: false,
      notes: null,
    });
    entityMap[entity.normalizedName] = stored.id;
  }

  await storage.savePriorityStack(userId, priorityStack);

  // Reveal message — AI for the happy path, deterministic for basic-only.
  let aiDegraded = opts.basicOnly;
  let aiDegradedReason: string | null = opts.aiDegradedReason;
  let revealMessage: string;
  if (opts.basicOnly) {
    revealMessage = buildOfflineRevealMessage(summary);
  } else {
    try {
      revealMessage = await generateRevealMessage(summary);
    } catch (err: any) {
      if (err instanceof GeminiUnavailableError) {
        aiDegraded = true;
        aiDegradedReason = err.reason;
        revealMessage = buildOfflineRevealMessage(summary);
        console.warn("AI degraded on reveal:", err.reason);
      } else {
        throw err;
      }
    }
  }

  // Gap-filling questions — deterministic when the AI is degraded so we
  // don't keep banging on a known-down service.
  const unknownsWithQuestions: any[] = [];
  for (const entity of summary.unknownEntities.slice(0, 8)) {
    let question: string;
    if (aiDegraded) {
      question = buildOfflineGapQuestion(entity);
    } else {
      try {
        const { generateGapFillingQuestion } = await import("./gemini");
        question = await generateGapFillingQuestion(entity);
      } catch (err: any) {
        if (err instanceof GeminiUnavailableError) {
          aiDegraded = true;
          aiDegradedReason = err.reason;
          question = buildOfflineGapQuestion(entity);
        } else {
          throw err;
        }
      }
    }
    unknownsWithQuestions.push({
      entityId: entityMap[entity.normalizedName] || "",
      name: entity.name,
      amount: entity.monthlyAmount,
      occurrences: entity.occurrences,
      lastSeen: entity.lastSeen.toISOString(),
      question,
    });
  }

  const summaryData = {
    totalCredits: summary.totalCredits,
    totalDebits: summary.totalDebits,
    estimatedSalary: summary.estimatedSalary,
    salarySource: summary.salarySource,
    topCategories: summary.topCategories,
    recurringObligations: summary.recurringObligations.map((e) => ({
      name: e.name,
      amount: e.monthlyAmount,
      category: e.category,
      tier: e.tier,
    })),
    unknownEntities: unknownsWithQuestions,
    transactionCount: summary.transactionCount,
    healthScore: summary.healthScore,
    estimatedBalance: summary.estimatedBalance,
    priorityStack,
    aiDegraded,
    aiDegradedReason,
    basicOnly: opts.basicOnly,
    internalTransferPairCount: candidatePairCount,
  };

  await storage.updateAnalysisJob(jobId, {
    status: "complete",
    progress: 100,
    progressLabel: opts.basicOnly
      ? "Basic analysis complete"
      : "Analysis complete",
    transactionCount: summary.transactionCount,
    unknownCount: summary.unknownEntities.length,
    revealMessage,
    summaryData: summaryData as any,
    error: null,
  });

  await storage.updateUser(userId, {
    onboardingStage: "reveal",
    financialHealthScore: summary.healthScore,
    estimatedBalance: summary.estimatedBalance,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
