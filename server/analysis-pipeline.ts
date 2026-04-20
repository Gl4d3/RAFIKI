// Async analysis pipeline — runs after file upload
// Orchestrates: parsing → categorisation → entity resolution → AI reveal message

import { storage } from "./storage";
import { parseMpesaCsv } from "./parser";
import {
  categorizeTransactions,
  identifyRecurring,
  identifySalary,
  computeFinancialSummary,
  generatePriorityStack,
} from "./accountant";
import { generateRevealMessage } from "./gemini";

export async function runAnalysisPipeline(
  jobId: string,
  userId: string,
  fileBuffer: Buffer,
  isDemo: boolean = false
): Promise<void> {
  const updateJob = (progress: number, label: string) =>
    storage.updateAnalysisJob(jobId, { progress, progressLabel: label, status: "running" });

  try {
    await updateJob(5, "Reading your statement...");
    await sleep(300);

    let parsed;
    if (isDemo) {
      const { generateDemoTransactions } = await import("./parser");
      parsed = generateDemoTransactions();
    } else {
      try {
        parsed = parseMpesaCsv(fileBuffer);
      } catch (err: any) {
        throw new Error(`Could not read your statement: ${err.message}`);
      }
    }

    await updateJob(20, `Found ${parsed.length} transactions. Identifying patterns...`);
    await sleep(400);

    // Run Accountant pipeline
    let categorized = categorizeTransactions(parsed);
    await updateJob(35, "Categorising transactions...");
    await sleep(300);

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
        rawText: tx.rawText,
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

    // Generate AI reveal message
    const revealMessage = await generateRevealMessage(summary);
    await updateJob(95, "Almost ready...");
    await sleep(200);

    // Generate AI gap-filling questions for unknowns
    const unknownsWithQuestions = [];
    for (const entity of summary.unknownEntities.slice(0, 8)) {
      const { generateGapFillingQuestion } = await import("./gemini");
      const question = await generateGapFillingQuestion(entity);
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
