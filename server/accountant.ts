// THE ACCOUNTANT — deterministic financial engine
// Pure functions. No LLM calls. No side effects.
// Given the same inputs, always returns the same outputs.

import { resolveCounterparty } from "./paybill-lookup";
import type { ParsedTransaction } from "./parser";

export interface CategorizedTransaction extends ParsedTransaction {
  category: string;
  tier: string;
  isRecurring: boolean;
  isSalary: boolean;
}

export interface EntitySummary {
  name: string;
  normalizedName: string;
  category: string;
  tier: string;
  isRecurring: boolean;
  monthlyAmount: number;
  frequency: string;
  occurrences: number;
  isAutoResolved: boolean;
  totalAmount: number;
  lastSeen: Date;
}

export interface FinancialSummary {
  totalCredits: number;
  totalDebits: number;
  estimatedSalary: number;
  salarySource: string;
  topCategories: { category: string; total: number; label: string }[];
  recurringObligations: EntitySummary[];
  unknownEntities: EntitySummary[];
  allEntities: EntitySummary[];
  transactionCount: number;
  dateRange: { from: Date; to: Date };
  healthScore: number;
  estimatedBalance: number;
}

export interface PriorityStackSuggestion {
  rank: number;
  label: string;
  monthlyAmount: number;
  tier: string;
  category: string;
}

const TIER_CATEGORIES: Record<string, string> = {
  "1": "rent,utilities,transport,food,healthcare",
  "2": "family,chama,education",
  "3": "savings",
  "4": "entertainment",
  unknown: "unknown",
};

// Normalize counterparty name for grouping
function normalizeCounterparty(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(0[17]\d{8})\s+/, "$1 ") // Keep phone prefix
    .trim();
}

// Categorize all transactions using paybill lookup + pattern matching
export function categorizeTransactions(
  transactions: ParsedTransaction[]
): CategorizedTransaction[] {
  return transactions.map((tx) => {
    const resolved = resolveCounterparty(tx.counterparty);
    return {
      ...tx,
      category: resolved?.category || "unknown",
      tier: resolved?.tier || "unknown",
      isRecurring: false, // will be set by identifyRecurring
      isSalary: false, // will be set by identifySalary
    };
  });
}

// Identify recurring transactions: same counterparty, similar amounts, >2 occurrences
export function identifyRecurring(
  transactions: CategorizedTransaction[]
): CategorizedTransaction[] {
  // Group by normalized counterparty
  const groups: Record<string, CategorizedTransaction[]> = {};
  for (const tx of transactions) {
    if (tx.direction === "debit") {
      const key = normalizeCounterparty(tx.counterparty);
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    }
  }

  // Mark recurring: same counterparty appears >1 time with similar amounts
  const recurringKeys = new Set<string>();
  for (const [key, txs] of Object.entries(groups)) {
    if (txs.length >= 2) {
      const amounts = txs.map((t) => t.amount);
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const allSimilar = amounts.every(
        (a) => Math.abs(a - avg) / avg < 0.3 // within 30% of average
      );
      if (allSimilar) {
        recurringKeys.add(key);
      }
    }
  }

  return transactions.map((tx) => ({
    ...tx,
    isRecurring:
      tx.direction === "debit" &&
      recurringKeys.has(normalizeCounterparty(tx.counterparty)),
  }));
}

// Identify salary: largest single credit, most regular timing
export function identifySalary(
  transactions: CategorizedTransaction[]
): CategorizedTransaction[] {
  const credits = transactions.filter((t) => t.direction === "credit");
  if (credits.length === 0) return transactions;

  // Group credits by counterparty
  const creditGroups: Record<string, CategorizedTransaction[]> = {};
  for (const tx of credits) {
    const key = normalizeCounterparty(tx.counterparty);
    if (!creditGroups[key]) creditGroups[key] = [];
    creditGroups[key].push(tx);
  }

  // Score each group: recurring monthly large credits = likely salary
  let bestKey = "";
  let bestScore = -1;

  for (const [key, txs] of Object.entries(creditGroups)) {
    const amounts = txs.map((t) => t.amount);
    const maxAmount = Math.max(...amounts);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const score = avgAmount * txs.length; // prefer larger amounts with more occurrences
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  const salaryKeys = new Set<string>([bestKey]);

  return transactions.map((tx) => ({
    ...tx,
    isSalary:
      tx.direction === "credit" &&
      salaryKeys.has(normalizeCounterparty(tx.counterparty)),
    category:
      tx.direction === "credit" &&
      salaryKeys.has(normalizeCounterparty(tx.counterparty))
        ? "income"
        : tx.category,
    tier:
      tx.direction === "credit" &&
      salaryKeys.has(normalizeCounterparty(tx.counterparty))
        ? "1"
        : tx.tier,
  }));
}

// Get a friendly display name for an entity
function getFriendlyName(name: string, resolved: { label: string } | null): string {
  if (resolved) return resolved.label;
  // If it's a phone number prefix pattern (0712... etc), truncate
  const phonePattern = /^(0[17]\d{8})\s+(.+)$/;
  const match = name.match(phonePattern);
  if (match) {
    const label = match[2].trim();
    // Return just the label part if it looks like a name
    if (label.length > 1) return label;
  }
  return name;
}

// Build entity summary from categorized transactions
export function buildEntitySummaries(
  transactions: CategorizedTransaction[]
): EntitySummary[] {
  const groups: Record<string, CategorizedTransaction[]> = {};

  for (const tx of transactions) {
    if (tx.direction === "debit") {
      const key = normalizeCounterparty(tx.counterparty);
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    }
  }

  const entities: EntitySummary[] = [];

  for (const [key, txs] of Object.entries(groups)) {
    const totalAmount = txs.reduce((sum, t) => sum + t.amount, 0);
    const amounts = txs.map((t) => t.amount);
    const avgAmount = totalAmount / txs.length;

    // Estimate monthly amount based on occurrences over time range
    const dates = txs.map((t) => t.date.getTime()).sort();
    const daySpan = (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);
    const monthsSpan = Math.max(daySpan / 30, 1);
    const monthlyAmount = totalAmount / monthsSpan;

    let frequency = "irregular";
    if (txs.length >= 2 && daySpan > 0) {
      const avgDays = daySpan / (txs.length - 1);
      if (avgDays < 10) frequency = "weekly";
      else if (avgDays < 35) frequency = "monthly";
      else if (avgDays < 100) frequency = "quarterly";
    }

    const firstTx = txs[0];
    const resolved = resolveCounterparty(firstTx.counterparty);
    const isAutoResolved = !!resolved;

    const friendlyName = getFriendlyName(firstTx.counterparty, resolved);

    entities.push({
      name: friendlyName,
      normalizedName: key,
      category: firstTx.category,
      tier: firstTx.tier,
      isRecurring: firstTx.isRecurring,
      monthlyAmount: Math.round(monthlyAmount),
      frequency,
      occurrences: txs.length,
      isAutoResolved,
      totalAmount: Math.round(totalAmount),
      lastSeen: new Date(Math.max(...txs.map((t) => t.date.getTime()))),
    });
  }

  return entities;
}

// Compute full financial summary from processed transactions
export function computeFinancialSummary(
  transactions: CategorizedTransaction[]
): FinancialSummary {
  const debits = transactions.filter((t) => t.direction === "debit");
  const credits = transactions.filter((t) => t.direction === "credit");

  const totalDebits = debits.reduce((sum, t) => sum + t.amount, 0);
  const totalCredits = credits.reduce((sum, t) => sum + t.amount, 0);

  // Salary
  const salaryTxs = transactions.filter((t) => t.isSalary);
  const estimatedSalary =
    salaryTxs.length > 0
      ? salaryTxs.reduce((sum, t) => sum + t.amount, 0) / salaryTxs.length
      : 0;
  const salarySource =
    salaryTxs.length > 0 ? salaryTxs[0].counterparty : "Unknown";

  // Category totals
  const categoryTotals: Record<string, number> = {};
  const categoryLabels: Record<string, string> = {
    transport: "Transport",
    food: "Food & Groceries",
    utilities: "Utilities",
    family: "Family Support",
    chama: "Chama",
    entertainment: "Entertainment",
    savings: "Savings",
    healthcare: "Healthcare",
    education: "Education",
    unknown: "Uncategorised",
  };

  for (const tx of debits) {
    const cat = tx.category || "unknown";
    categoryTotals[cat] = (categoryTotals[cat] || 0) + tx.amount;
  }

  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, total]) => ({
      category,
      total: Math.round(total),
      label: categoryLabels[category] || category,
    }));

  const entities = buildEntitySummaries(transactions);
  const recurringObligations = entities.filter(
    (e) => e.isRecurring && e.category !== "unknown"
  );
  const unknownEntities = entities.filter(
    (e) =>
      e.category === "unknown" &&
      e.occurrences >= 2 &&
      !e.isAutoResolved
  );

  // Date range
  const allDates = transactions.map((t) => t.date.getTime());
  const dateRange = {
    from: new Date(Math.min(...allDates)),
    to: new Date(Math.max(...allDates)),
  };

  // Health score (0-100, deterministic)
  const savingsRate = estimatedSalary > 0 ? (estimatedSalary - totalDebits / Math.max(1, allDates.length / (30 * 24 * 3600 * 1000))) / estimatedSalary : 0;
  const healthScore = Math.max(
    0,
    Math.min(100, Math.round(savingsRate * 100 * 0.6 + (recurringObligations.length > 0 ? 40 : 20)))
  );

  const estimatedBalance = Math.max(0, Math.round(totalCredits - totalDebits));

  return {
    totalCredits: Math.round(totalCredits),
    totalDebits: Math.round(totalDebits),
    estimatedSalary: Math.round(estimatedSalary),
    salarySource,
    topCategories,
    recurringObligations,
    unknownEntities,
    allEntities: entities,
    transactionCount: transactions.length,
    dateRange,
    healthScore,
    estimatedBalance,
  };
}

// Default tier per category (Priority Cascade)
// Tier 1 — Survival; Tier 2 — Social Obligations; Tier 3 — Growth; Tier 4 — Lifestyle
const CATEGORY_TIER: Record<string, string> = {
  rent: "1",
  food: "1",
  transport: "1",
  utilities: "1",
  healthcare: "1",
  family: "2",
  chama: "2",
  education: "2",
  savings: "3",
  entertainment: "4",
};

// Friendly labels per category for the Priority Stack
const CATEGORY_DISPLAY: Record<string, string> = {
  rent: "Housing & Rent",
  food: "Food & Groceries",
  transport: "Transport",
  utilities: "Utilities",
  healthcare: "Health",
  family: "Social Obligations",
  chama: "Chama",
  education: "Education",
  savings: "Savings",
  entertainment: "Lifestyle & Entertainment",
};

// Generate the Priority Stack — one card per CATEGORY (not per merchant).
// Aggregates every debit transaction into its category, sums to a monthly total,
// and applies the default Priority Cascade tier. Unknown / uncategorised debits
// are intentionally excluded — they live in the gap-filling flow.
export function generatePriorityStack(
  summary: FinancialSummary
): PriorityStackSuggestion[] {
  // Build category totals from ALL entities (recurring + one-off), excluding
  // income and unknown — those don't belong in the stack.
  const buckets: Record<string, { monthly: number; total: number }> = {};

  for (const entity of summary.allEntities) {
    const cat = entity.category;
    if (!cat || cat === "unknown" || cat === "income") continue;
    if (!CATEGORY_TIER[cat]) continue; // skip categories we don't recognise

    if (!buckets[cat]) buckets[cat] = { monthly: 0, total: 0 };
    buckets[cat].monthly += entity.monthlyAmount;
    buckets[cat].total += entity.totalAmount;
  }

  // Order: tier ascending, then monthly amount descending within tier
  const tierOrder = ["1", "2", "3", "4"];
  const sorted = Object.entries(buckets)
    .map(([category, sums]) => ({
      category,
      monthlyAmount: Math.round(sums.monthly),
      tier: CATEGORY_TIER[category],
      label: CATEGORY_DISPLAY[category] || category,
    }))
    .filter((b) => b.monthlyAmount > 0)
    .sort((a, b) => {
      const ta = tierOrder.indexOf(a.tier);
      const tb = tierOrder.indexOf(b.tier);
      if (ta !== tb) return ta - tb;
      return b.monthlyAmount - a.monthlyAmount;
    });

  return sorted.map((b, i) => ({
    rank: i + 1,
    label: b.label,
    monthlyAmount: b.monthlyAmount,
    tier: b.tier,
    category: b.category,
  }));
}
