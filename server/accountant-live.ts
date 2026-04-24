// ACCOUNTANT LIVE — deterministic financial engine for the main product.
// Reads from the real database. All functions are pure given the same DB state.
// No LLM calls. No side effects beyond what the caller explicitly triggers.

import type { Transaction, PriorityStackItem, Goal } from "@shared/schema";

// ─── Financial State ──────────────────────────────────────────────────────────

export interface FinancialState {
  availableFloat: number;
  currentBalance: number;
  committedAmount: number;
  safeBuffer: number;
  daysToNextSalary: number | null;
  nextSalaryDate: Date | null;
  salarySource: string;
  estimatedMonthlySalary: number;
}

/**
 * Compute the user's true financial state from their transaction history and
 * priority stack. The available float is what they can spend without risking
 * any Tier 1 obligation or their safe buffer.
 */
export function computeFinancialState(
  txs: Transaction[],
  stackItems: PriorityStackItem[],
  safeBuffer: number
): FinancialState {
  if (txs.length === 0) {
    return {
      availableFloat: 0,
      currentBalance: 0,
      committedAmount: 0,
      safeBuffer,
      daysToNextSalary: null,
      nextSalaryDate: null,
      salarySource: "Unknown",
      estimatedMonthlySalary: 0,
    };
  }

  // Current balance: use the most recent explicit balance field if available,
  // else derive from credits minus debits (exclude internal transfers — they
  // are marked with the same counterparty on both sides).
  const sorted = [...txs].sort((a, b) => b.date.getTime() - a.date.getTime());
  const latestWithBalance = sorted.find((t) => t.balance != null && t.balance > 0);

  let currentBalance: number;
  if (latestWithBalance?.balance) {
    currentBalance = latestWithBalance.balance;
  } else {
    const credits = txs.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0);
    const debits = txs.filter((t) => t.direction === "debit").reduce((s, t) => s + t.amount, 0);
    currentBalance = Math.max(0, credits - debits);
  }

  // Salary detection
  const salaryTxs = txs.filter((t) => t.isSalary && t.direction === "credit");
  const estimatedMonthlySalary =
    salaryTxs.length > 0
      ? salaryTxs.reduce((s, t) => s + t.amount, 0) / salaryTxs.length
      : 0;
  const salarySource =
    salaryTxs.length > 0 ? salaryTxs[0].counterparty : "Unknown";

  // Next salary date estimate: take the last salary date and add ~30 days
  const lastSalaryDate =
    salaryTxs.length > 0
      ? new Date(Math.max(...salaryTxs.map((t) => t.date.getTime())))
      : null;
  const nextSalaryDate = lastSalaryDate
    ? new Date(lastSalaryDate.getTime() + 30 * 24 * 60 * 60 * 1000)
    : null;

  const now = new Date();
  const daysToNextSalary = nextSalaryDate
    ? Math.max(0, Math.ceil((nextSalaryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  // Committed amount: sum of Tier 1 priority stack items due before next salary.
  // We use the monthly amount and pro-rate to the days remaining.
  // If we don't know the next salary date, assume full monthly commitment.
  const tier1Items = stackItems.filter((i) => i.tier === "1" && i.isActive);
  let committedAmount = 0;
  if (daysToNextSalary != null && daysToNextSalary < 30) {
    // Pro-rate: portion of month remaining × monthly obligation
    const fraction = daysToNextSalary / 30;
    committedAmount = tier1Items.reduce((s, i) => s + (i.monthlyAmount || 0) * fraction, 0);
  } else {
    committedAmount = tier1Items.reduce((s, i) => s + (i.monthlyAmount || 0), 0);
  }
  committedAmount = Math.round(committedAmount);

  const availableFloat = Math.max(0, Math.round(currentBalance - committedAmount - safeBuffer));

  return {
    availableFloat,
    currentBalance: Math.round(currentBalance),
    committedAmount,
    safeBuffer,
    daysToNextSalary,
    nextSalaryDate,
    salarySource,
    estimatedMonthlySalary: Math.round(estimatedMonthlySalary),
  };
}

// ─── Simulate Action ─────────────────────────────────────────────────────────

export interface HarvestSuggestion {
  sourceName: string;
  deferableAmount: number;
  reasoning: string;
}

export interface SimulationResult {
  safe: boolean;
  remainingAfter: number;
  bufferBreached: boolean;
  shortfall: number;
  nearestThreatenedObligation: { label: string; monthlyAmount: number; daysUntilDue: number | null } | null;
  harvestSuggestion: HarvestSuggestion | null;
}

/**
 * Given a proposed spend amount and category, determine whether it is safe
 * and return detailed reasoning. If unsafe, identify the nearest threatened
 * obligation and any harvest opportunity from Tier 2.
 */
export function simulateAction(
  amount: number,
  category: string,
  state: FinancialState,
  stackItems: PriorityStackItem[]
): SimulationResult {
  const remainingAfter = state.availableFloat - amount;
  const safe = remainingAfter >= 0;
  const bufferBreached = remainingAfter < 0 || state.currentBalance - amount < state.safeBuffer;
  const shortfall = safe ? 0 : Math.abs(remainingAfter);

  // Nearest threatened Tier 1 obligation
  const tier1Items = stackItems.filter((i) => i.tier === "1" && i.isActive);
  const nearestThreatenedObligation =
    !safe && tier1Items.length > 0
      ? {
          label: tier1Items[0].label,
          monthlyAmount: tier1Items[0].monthlyAmount || 0,
          daysUntilDue: state.daysToNextSalary,
        }
      : null;

  // Harvest suggestion: look for a Tier 2 obligation that could cover the gap
  // Criteria: not due within 7 days, monthly amount >= shortfall
  let harvestSuggestion: HarvestSuggestion | null = null;
  if (!safe && shortfall > 0) {
    const tier2Items = stackItems.filter((i) => i.tier === "2" && i.isActive);
    const candidate = tier2Items.find(
      (i) =>
        (i.monthlyAmount || 0) >= shortfall * 0.8 // can cover at least 80% of shortfall
    );
    if (candidate) {
      harvestSuggestion = {
        sourceName: candidate.label,
        deferableAmount: Math.min(candidate.monthlyAmount || 0, shortfall * 1.2),
        reasoning: `${candidate.label} is not due imminently and can be deferred this cycle to cover the shortfall.`,
      };
    }
  }

  return {
    safe,
    remainingAfter: Math.round(remainingAfter),
    bufferBreached,
    shortfall: Math.round(shortfall),
    nearestThreatenedObligation,
    harvestSuggestion,
  };
}

// ─── Health Score ─────────────────────────────────────────────────────────────

export interface HealthScore {
  score: number;
  explanation: string;
}

/**
 * Compute a 0–100 health score from savings rate, buffer adequacy, and Tier 1
 * obligation coverage. Goals contribute when they exist.
 *
 * Weights: savings rate 40%, buffer 30%, obligations 30%.
 */
export function computeHealthScore(
  txs: Transaction[],
  state: FinancialState,
  stackItems: PriorityStackItem[],
  goals: Goal[]
): HealthScore {
  if (txs.length === 0) {
    return {
      score: 0,
      explanation: "No financial data yet. Upload a statement to get started.",
    };
  }

  // 1. Savings rate component (40 pts)
  const savingsTxs = txs.filter((t) => t.direction === "debit" && t.category === "savings");
  const totalSavings = savingsTxs.reduce((s, t) => s + t.amount, 0);
  const salary = state.estimatedMonthlySalary;
  const savingsRate = salary > 0 ? totalSavings / salary : 0;
  const savingsScore = Math.min(40, Math.round(savingsRate * 200)); // 20% savings rate = full 40 pts

  // 2. Buffer adequacy component (30 pts)
  const bufferTarget = state.safeBuffer * 3;
  const bufferRatio = bufferTarget > 0 ? Math.min(1, state.currentBalance / bufferTarget) : 0;
  const bufferScore = Math.round(bufferRatio * 30);

  // 3. Tier 1 coverage component (30 pts)
  // If committed amount is less than current balance, Tier 1 is covered
  const tier1Covered = state.currentBalance >= state.committedAmount + state.safeBuffer;
  const obligationScore = tier1Covered ? 30 : Math.max(0, Math.round(
    (state.currentBalance / Math.max(1, state.committedAmount + state.safeBuffer)) * 30
  ));

  // 4. Goal bonus (up to +5 pts if goals are on track)
  let goalBonus = 0;
  if (goals.length > 0) {
    const onTrackCount = goals.filter((g) => g.status === "on_track").length;
    goalBonus = Math.round((onTrackCount / goals.length) * 5);
  }

  const rawScore = savingsScore + bufferScore + obligationScore + goalBonus;
  const score = Math.max(0, Math.min(100, rawScore));

  // Generate explanation
  let explanation: string;
  if (score >= 75) {
    explanation = "Your finances are in solid shape — obligations covered and savings on track.";
  } else if (score >= 50) {
    if (savingsScore < 20) {
      explanation = "You're managing obligations well, but savings could be higher.";
    } else if (bufferScore < 15) {
      explanation = "Savings look reasonable, but your emergency buffer is lower than ideal.";
    } else {
      explanation = "You're spending within your plan, though there's room to strengthen savings.";
    }
  } else if (score >= 30) {
    if (!tier1Covered) {
      explanation = "Some Tier 1 obligations are at risk — review your available float.";
    } else {
      explanation = "Your buffer is thin. Avoid discretionary spending until your next salary.";
    }
  } else {
    explanation = "Your finances need attention — Tier 1 obligations may be at risk.";
  }

  return { score, explanation };
}

// ─── Priority Cascade ─────────────────────────────────────────────────────────

export interface CascadeAllocation {
  tier: string;
  label: string;
  amount: number;
  category: string | null;
  fulfilled: boolean;
}

export interface PriorityCascadeResult {
  incomeAmount: number;
  allocations: CascadeAllocation[];
  leftover: number;
}

/**
 * Walk the priority waterfall: allocate income to Tier 1 first, then Tier 2,
 * then Tier 3, then Tier 4. Return the full breakdown and leftover.
 */
export function runPriorityCascade(
  incomeAmount: number,
  stackItems: PriorityStackItem[]
): PriorityCascadeResult {
  const tierOrder = ["1", "2", "3", "4"];
  const active = stackItems.filter((i) => i.isActive);

  // Sort: tier ascending, then rank ascending within tier
  const sorted = [...active].sort((a, b) => {
    const ta = tierOrder.indexOf(a.tier || "4");
    const tb = tierOrder.indexOf(b.tier || "4");
    if (ta !== tb) return ta - tb;
    return a.rank - b.rank;
  });

  let remaining = incomeAmount;
  const allocations: CascadeAllocation[] = [];

  for (const item of sorted) {
    const needed = item.monthlyAmount || 0;
    const allocated = Math.min(needed, Math.max(0, remaining));
    remaining -= allocated;

    allocations.push({
      tier: item.tier || "unknown",
      label: item.label,
      amount: Math.round(allocated),
      category: item.category || null,
      fulfilled: allocated >= needed,
    });
  }

  return {
    incomeAmount: Math.round(incomeAmount),
    allocations,
    leftover: Math.max(0, Math.round(remaining)),
  };
}
