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
 * priority stack.
 *
 * availableFloat = currentBalance − committedAmount − safeBuffer.
 * This value is NOT clamped to 0 — a negative float shows a real deficit.
 *
 * currentBalance uses the most recent balance field regardless of sign
 * (a zero or negative balance is meaningful financial data). When no
 * balance field is present, credits-minus-debits is used without clamping.
 *
 * committedAmount = sum of ALL active Tier 1 monthly amounts that fall
 * before the next salary date. No proration — full obligation amounts.
 *
 * When there are no transactions, all numeric fields are 0.
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
      safeBuffer: 0,
      daysToNextSalary: null,
      nextSalaryDate: null,
      salarySource: "Unknown",
      estimatedMonthlySalary: 0,
    };
  }

  // Current balance: use the most recent balance field regardless of sign.
  // A negative balance is valid data (overdraft). Fall back to running sum
  // only when no balance field is present at all — and never clamp.
  const sorted = [...txs].sort((a, b) => b.date.getTime() - a.date.getTime());
  const latestWithBalance = sorted.find((t) => t.balance != null);

  let currentBalance: number;
  if (latestWithBalance != null && latestWithBalance.balance != null) {
    currentBalance = latestWithBalance.balance;
  } else {
    const credits = txs.filter((t) => t.direction === "credit").reduce((s, t) => s + t.amount, 0);
    const debits = txs.filter((t) => t.direction === "debit").reduce((s, t) => s + t.amount, 0);
    // No clamping — overdraft is valid
    currentBalance = credits - debits;
  }

  // Salary detection
  const salaryTxs = txs.filter((t) => t.isSalary && t.direction === "credit");
  const estimatedMonthlySalary =
    salaryTxs.length > 0
      ? salaryTxs.reduce((s, t) => s + t.amount, 0) / salaryTxs.length
      : 0;
  const salarySource =
    salaryTxs.length > 0 ? salaryTxs[0].counterparty : "Unknown";

  // Next salary date: last salary date + 30 days
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

  // Committed amount: sum of all active Tier 1 monthly obligations.
  // These are obligations due before the next salary — we use the full monthly
  // amount (no proration). Zero when there are no Tier 1 items.
  const tier1Items = stackItems.filter((i) => i.tier === "1" && i.isActive);
  const committedAmount = Math.round(
    tier1Items.reduce((s, i) => s + (i.monthlyAmount || 0), 0)
  );

  // availableFloat: real deficit shown when negative — never clamped.
  const availableFloat = Math.round(currentBalance - committedAmount - safeBuffer);

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
  nearestThreatenedObligation: {
    label: string;
    monthlyAmount: number;
    daysUntilDue: number | null;
  } | null;
  harvestSuggestion: HarvestSuggestion | null;
}

/**
 * Determine whether a proposed spend is safe.
 *
 * Harvest suggestion criteria (both must hold):
 *  1. The Tier 2 item is NOT due within 7 days (days-to-next-salary > 7).
 *  2. The item's monthlyAmount >= the full shortfall (can cover the gap).
 */
export function simulateAction(
  amount: number,
  category: string,
  state: FinancialState,
  stackItems: PriorityStackItem[]
): SimulationResult {
  const remainingAfter = state.availableFloat - amount;
  const safe = remainingAfter >= 0;
  const bufferBreached = state.currentBalance - amount < state.safeBuffer;
  const shortfall = safe ? 0 : Math.abs(remainingAfter);

  // Nearest threatened Tier 1 obligation (only when spend is unsafe)
  const tier1Items = stackItems.filter((i) => i.tier === "1" && i.isActive);
  const nearestThreatenedObligation =
    !safe && tier1Items.length > 0
      ? {
          label: tier1Items[0].label,
          monthlyAmount: tier1Items[0].monthlyAmount || 0,
          daysUntilDue: state.daysToNextSalary,
        }
      : null;

  // Harvest suggestion:
  //  - Tier 2 item not due within 7 days (daysToNextSalary > 7)
  //  - monthlyAmount >= full shortfall (exact spec requirement — not 0.8×)
  let harvestSuggestion: HarvestSuggestion | null = null;
  if (!safe && shortfall > 0) {
    const daysRemaining = state.daysToNextSalary ?? 30;
    const tier2Items = stackItems.filter((i) => i.tier === "2" && i.isActive);
    const candidate = tier2Items.find(
      (i) =>
        daysRemaining > 7 && // criterion 1: not due within 7 days
        (i.monthlyAmount || 0) >= shortfall // criterion 2: covers full shortfall
    );
    if (candidate) {
      harvestSuggestion = {
        sourceName: candidate.label,
        deferableAmount: Math.min(candidate.monthlyAmount || 0, shortfall),
        reasoning: `${candidate.label} is not due for another ${daysRemaining} days and its monthly amount (KSh ${(candidate.monthlyAmount || 0).toLocaleString()}) covers the KSh ${Math.round(shortfall).toLocaleString()} shortfall.`,
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
 * Compute a 0–100 health score.
 * Weights: savings rate 40%, buffer adequacy 30%, Tier 1 obligation coverage 30%.
 *
 * Goal progress contributes within the obligations component when goals exist:
 * if all active goals are on track (savedAmount >= targetAmount * progress
 * fraction), obligation score is boosted proportionally to goals on-track ratio.
 * Goals contribute 0 to the score when the goals table has no rows.
 *
 * "Past due" check: if committedAmount > currentBalance the user cannot fund
 * their Tier 1 obligations — obligation score is 0.
 */
export function computeHealthScore(
  txs: Transaction[],
  state: FinancialState,
  stackItems: PriorityStackItem[],
  userGoals: Goal[]
): HealthScore {
  if (txs.length === 0) {
    return {
      score: 0,
      explanation: "No financial data yet. Upload a statement to get started.",
    };
  }

  // 1. Savings rate component (40 pts)
  // Target: 20% savings rate earns full 40 pts. Ratio capped at 1.
  const savingsTxs = txs.filter((t) => t.direction === "debit" && t.category === "savings");
  const totalSavings = savingsTxs.reduce((s, t) => s + t.amount, 0);
  const salary = state.estimatedMonthlySalary;
  const savingsRate = salary > 0 ? totalSavings / salary : 0;
  const savingsScore = Math.min(40, Math.round(Math.min(1, savingsRate / 0.2) * 40));

  // 2. Buffer adequacy component (30 pts)
  // Full 30 pts when currentBalance >= safeBuffer * 3.
  const bufferTarget = (state.safeBuffer || 2000) * 3;
  const bufferRatio = bufferTarget > 0 ? Math.min(1, state.currentBalance / bufferTarget) : 0;
  const bufferScore = Math.round(bufferRatio * 30);

  // 3. Tier 1 obligation coverage component (30 pts)
  // Past-due check: committedAmount > currentBalance means obligations can't be met.
  const anyPastDue = state.committedAmount > state.currentBalance;
  let obligationScore: number;
  if (anyPastDue) {
    obligationScore = 0;
  } else if (state.committedAmount === 0) {
    obligationScore = 30; // no obligations = full score
  } else {
    // Coverage ratio: how much headroom above committed amount
    const headroom = state.currentBalance - state.committedAmount;
    const coverage = Math.min(1, headroom / (state.safeBuffer || 2000));
    obligationScore = Math.round(coverage * 30);
  }

  // Goal progress adjustment: when goals exist, compute on-track ratio and
  // apply it to partially recover the obligation score (up to 10 pts bonus,
  // capped so total never exceeds 100). Goals contribute 0 when no rows.
  let goalBonus = 0;
  if (userGoals.length > 0 && !anyPastDue) {
    const activeGoals = userGoals.filter((g) => g.status === "active");
    if (activeGoals.length > 0) {
      const onTrack = activeGoals.filter((g) => {
        if (!g.targetAmount || g.targetAmount === 0) return false;
        const progressFraction =
          g.targetDate
            ? Math.min(
                1,
                (Date.now() - new Date(g.createdAt).getTime()) /
                  (new Date(g.targetDate).getTime() - new Date(g.createdAt).getTime())
              )
            : 0.5;
        const expectedSaved = g.targetAmount * progressFraction;
        return (g.savedAmount || 0) >= expectedSaved;
      });
      const onTrackRatio = onTrack.length / activeGoals.length;
      goalBonus = Math.round(onTrackRatio * 10);
    }
  }

  const rawScore = savingsScore + bufferScore + obligationScore + goalBonus;
  const score = Math.max(0, Math.min(100, rawScore));

  // Explanation
  let explanation: string;
  if (anyPastDue) {
    explanation = "Some Tier 1 obligations cannot be covered from your current balance.";
  } else if (score >= 75) {
    explanation = "Your finances are in solid shape — obligations covered and savings on track.";
  } else if (score >= 50) {
    if (savingsScore < 20) {
      explanation = "You're managing obligations well, but your savings rate could be higher.";
    } else if (bufferScore < 15) {
      explanation = "Savings look reasonable, but your emergency buffer is lower than ideal.";
    } else {
      explanation = "You're spending within your plan, though there is room to strengthen savings.";
    }
  } else if (score >= 30) {
    explanation = "Your buffer is thin. Avoid discretionary spending until your next salary.";
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
}

export interface PriorityCascadeResult {
  waterfall: CascadeAllocation[];
  leftover: number;
}

/**
 * Walk the priority waterfall: allocate income to Tier 1 first, then Tier 2,
 * then Tier 3, then Tier 4. Return the waterfall list and leftover.
 *
 * Response shape: { waterfall: [{ tier, label, amount, category }], leftover }
 */
export function runPriorityCascade(
  incomeAmount: number,
  stackItems: PriorityStackItem[]
): PriorityCascadeResult {
  const tierOrder = ["1", "2", "3", "4"];
  const active = stackItems.filter((i) => i.isActive);

  const sorted = [...active].sort((a, b) => {
    const ta = tierOrder.indexOf(a.tier || "4");
    const tb = tierOrder.indexOf(b.tier || "4");
    if (ta !== tb) return ta - tb;
    return a.rank - b.rank;
  });

  let remaining = incomeAmount;
  const waterfall: CascadeAllocation[] = [];

  for (const item of sorted) {
    const needed = item.monthlyAmount || 0;
    const allocated = Math.min(needed, Math.max(0, remaining));
    remaining -= allocated;

    waterfall.push({
      tier: item.tier || "unknown",
      label: item.label,
      amount: Math.round(allocated),
      category: item.category || null,
    });
  }

  return {
    waterfall,
    leftover: Math.max(0, Math.round(remaining)),
  };
}
