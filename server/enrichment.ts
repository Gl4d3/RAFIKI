// Stage B helpers — cross-source dedup + the in-memory transaction set
// the LLM enrichment loop mutates via tool calls. The numbers on each
// transaction are NEVER recomputed here. We only set/overwrite category,
// tier, notes, and the internal-transfer flag.

import type { CategorizedTransaction } from "./accountant";

export interface EnrichableTransaction extends CategorizedTransaction {
  // A stable index used by the LLM to refer to this transaction.
  txId: number;
  // True when the deterministic dedup pass found a candidate match
  // on another account (e.g. bank debit ↔ M-Pesa credit). The LLM
  // confirms or rejects via mark_internal_transfer.
  candidateInternalTransfer: boolean;
  // Set when mark_internal_transfer fires.
  isInternalTransfer: boolean;
  // The txId of the matching leg, if any.
  internalTransferPairTxId: number | null;
  // Free-form note set by enrichment (e.g. "user said this is mum").
  enrichmentNote: string | null;
}

// Wrap categorised transactions with the Stage B fields. Pure.
export function toEnrichable(
  txs: CategorizedTransaction[]
): EnrichableTransaction[] {
  return txs.map((tx, i) => ({
    ...tx,
    txId: i,
    candidateInternalTransfer: false,
    // Preserve any deterministic isInternalTransfer flag set by Stage A
    // (`detectInternalTransfers`). Stage B may upgrade more pairs but it
    // must never erase prior detection — those rows would otherwise be
    // double-counted in summary aggregates, especially on the
    // basic-only path where Stage B is skipped.
    isInternalTransfer: tx.isInternalTransfer ?? false,
    internalTransferPairTxId: null,
    enrichmentNote: null,
  }));
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Cross-source dedup. Looks for opposite-direction pairs across
// different accounts on the same calendar day with the same amount
// (within ±1 KSh to absorb rounding). Tags both legs as candidates.
// Returns the tagged set + the list of pairs (for the LLM prompt).
export interface CandidatePair {
  txIdA: number;
  txIdB: number;
  amount: number;
  date: Date;
  reason: string;
}

export function tagInternalTransferCandidates(
  txs: EnrichableTransaction[]
): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  const used = new Set<number>();

  // Bucket by calendar day for an O(n) sweep instead of O(n²).
  const byDay: Map<string, EnrichableTransaction[]> = new Map();
  for (const tx of txs) {
    const key = `${tx.date.getFullYear()}-${tx.date.getMonth()}-${tx.date.getDate()}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(tx);
  }

  for (const dayTxs of Array.from(byDay.values())) {
    for (let i = 0; i < dayTxs.length; i++) {
      const a = dayTxs[i];
      if (used.has(a.txId)) continue;
      for (let j = i + 1; j < dayTxs.length; j++) {
        const b = dayTxs[j];
        if (used.has(b.txId)) continue;
        if ((a.source || "mpesa") === (b.source || "mpesa")) continue;
        if (a.direction === b.direction) continue;
        if (Math.abs(a.amount - b.amount) > 1) continue;
        if (!sameCalendarDay(a.date, b.date)) continue;

        a.candidateInternalTransfer = true;
        b.candidateInternalTransfer = true;
        used.add(a.txId);
        used.add(b.txId);
        pairs.push({
          txIdA: a.txId,
          txIdB: b.txId,
          amount: a.amount,
          date: a.date,
          reason: `${a.source || "mpesa"} ${a.direction} ↔ ${
            b.source || "mpesa"
          } ${b.direction} same day, same amount`,
        });
        break;
      }
    }
  }
  return pairs;
}

// Apply a categorise_transaction tool call. Returns true if applied.
export function applyCategorise(
  txs: EnrichableTransaction[],
  args: {
    txIds: number[];
    category: string;
    tier?: string;
    note?: string;
  }
): { applied: number; skipped: number[] } {
  const skipped: number[] = [];
  let applied = 0;
  for (const id of args.txIds) {
    const tx = txs[id];
    if (!tx) {
      skipped.push(id);
      continue;
    }
    tx.category = args.category;
    if (args.tier) tx.tier = args.tier;
    if (args.note) tx.enrichmentNote = args.note;
    applied++;
  }
  return { applied, skipped };
}

// Apply a flag_for_gap_filling tool call.
export function applyFlagForGap(
  txs: EnrichableTransaction[],
  args: { txIds: number[]; reason: string }
): { applied: number; skipped: number[] } {
  const skipped: number[] = [];
  let applied = 0;
  for (const id of args.txIds) {
    const tx = txs[id];
    if (!tx) {
      skipped.push(id);
      continue;
    }
    tx.category = "unknown";
    tx.tier = "unknown";
    tx.enrichmentNote = args.reason;
    applied++;
  }
  return { applied, skipped };
}

// Apply a detect_relationship tool call. We attach a friendly note on
// every matching transaction and let the Accountant aggregate.
export function applyDetectRelationship(
  txs: EnrichableTransaction[],
  args: {
    counterpartyMatch: string;
    relationshipLabel: string;
    category: string;
    tier?: string;
  }
): { applied: number } {
  const needle = args.counterpartyMatch.toLowerCase();
  let applied = 0;
  for (const tx of txs) {
    if (tx.counterparty.toLowerCase().includes(needle)) {
      tx.category = args.category;
      if (args.tier) tx.tier = args.tier;
      tx.enrichmentNote = args.relationshipLabel;
      applied++;
    }
  }
  return { applied };
}

// Apply a mark_internal_transfer tool call.
export function applyMarkInternalTransfer(
  txs: EnrichableTransaction[],
  args: { txIdA: number; txIdB: number }
): { applied: boolean; reason?: string } {
  const a = txs[args.txIdA];
  const b = txs[args.txIdB];
  if (!a || !b) return { applied: false, reason: "unknown txId" };
  if (a.direction === b.direction) {
    return { applied: false, reason: "same direction — not a transfer pair" };
  }
  a.isInternalTransfer = true;
  b.isInternalTransfer = true;
  a.internalTransferPairTxId = b.txId;
  b.internalTransferPairTxId = a.txId;
  // Internal transfers are not real spending — neutralise category so
  // they don't pollute the priority stack.
  a.category = "one_time";
  b.category = "one_time";
  a.tier = "unknown";
  b.tier = "unknown";
  a.enrichmentNote = "internal transfer";
  b.enrichmentNote = "internal transfer";
  return { applied: true };
}

// Strip Stage-B-only fields off and return plain CategorizedTransactions.
// Internal-transfer legs are KEPT (with `isInternalTransfer: true`) so
// they remain visible as evidence in the persisted transaction log.
// Downstream aggregations (computeFinancialSummary, identifyRecurring,
// identifySalary) already filter on `isInternalTransfer` so they won't
// double-count.
export function stripStageBFields(
  txs: EnrichableTransaction[]
): CategorizedTransaction[] {
  return txs.map(
    ({
      txId,
      candidateInternalTransfer,
      internalTransferPairTxId,
      enrichmentNote,
      ...rest
    }) => rest
  );
}
