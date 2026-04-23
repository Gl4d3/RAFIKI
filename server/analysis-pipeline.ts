// Async analysis pipeline — runs after file upload
// Orchestrates: parsing → categorisation → entity resolution → AI reveal message

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
} from "./accountant";
import {
  generateRevealMessage,
  buildOfflineRevealMessage,
  buildOfflineGapQuestion,
  GeminiUnavailableError,
} from "./gemini";

export interface PipelineSource {
  // A buffer for a file source (CSV / PDF) OR a text string for pasted SMS.
  // `auto` / `csv` / `pdf` / `sms` are M-Pesa channels; `bank` is a bank
  // statement PDF (e.g. I&M Bank) routed to the bank-PDF parser.
  kind: "auto" | "csv" | "pdf" | "sms" | "bank";
  buffer?: Buffer;
  text?: string;
  fileName?: string | null;
  sourceName: string;
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

    // Run Accountant pipeline
    let categorized = categorizeTransactions(parsed);
    await updateJob(35, "Categorising transactions...");
    await sleep(300);

    categorized = detectInternalTransfers(categorized);
    await updateJob(45, "Spotting internal transfers...");
    await sleep(150);

    categorized = identifyRecurring(categorized);
    await updateJob(50, "Finding recurring obligations...");
    await sleep(300);

    categorized = identifySalary(categorized);
    await updateJob(60, "Identifying income sources...");
    await sleep(200);

    const summary = computeFinancialSummary(categorized);
    await updateJob(70, "Building your financial model...");
    await sleep(200);

    const priorityStack = generatePriorityStack(summary);
    await updateJob(80, "Preparing your priority stack...");
    await sleep(200);

    // Clear old data for user
    await storage.clearTransactions(userId);
    await storage.clearEntities(userId);
    await storage.clearPriorityStack(userId);

    // Store transactions
    await storage.createTransactions(
      categorized.map((tx) => ({
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
        // Tag internal transfers in rawText so the row remains in the
        // evidence table without polluting downstream aggregations.
        rawText: tx.isInternalTransfer
          ? `[INTERNAL_TRANSFER] ${tx.rawText}`
          : tx.rawText,
      }))
    );

    // Store entities
    const entityMap: Record<string, string> = {}; // normalizedName -> entityId
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

    // Store initial priority stack suggestion
    await storage.savePriorityStack(userId, priorityStack);

    await updateJob(88, "RAFIKI is reading your results...");

    // AI layer — DEGRADE GRACEFULLY but HONESTLY.
    // If Gemini is unavailable, finish the job with deterministic content
    // and a flag so the UI can tell the user "AI is offline".
    let aiDegraded = false;
    let aiDegradedReason: string | null = null;
    let revealMessage: string;
    try {
      revealMessage = await generateRevealMessage(summary);
    } catch (err: any) {
      if (err instanceof GeminiUnavailableError) {
        aiDegraded = true;
        aiDegradedReason = err.reason;
        revealMessage = buildOfflineRevealMessage(summary);
        console.warn("AI degraded:", err.reason);
      } else {
        throw err;
      }
    }
    await updateJob(95, "Almost ready...");
    await sleep(200);

    // Generate gap-filling questions. If AI is already known to be down,
    // use deterministic questions and don't keep retrying.
    const unknownsWithQuestions = [];
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
            console.warn("AI degraded mid-loop:", err.reason);
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

    // Finalize job
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
    };

    await storage.updateAnalysisJob(jobId, {
      status: "complete",
      progress: 100,
      progressLabel: "Analysis complete",
      transactionCount: summary.transactionCount,
      unknownCount: summary.unknownEntities.length,
      revealMessage,
      summaryData: summaryData as any,
    });

    // Update user
    await storage.updateUser(userId, {
      onboardingStage: "reveal",
      financialHealthScore: summary.healthScore,
      estimatedBalance: summary.estimatedBalance,
    });
  } catch (error: any) {
    console.error("Analysis pipeline error:", error);
    await storage.updateAnalysisJob(jobId, {
      status: "error",
      error: error.message || "Analysis failed",
      progressLabel: "Something went wrong",
    });
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
