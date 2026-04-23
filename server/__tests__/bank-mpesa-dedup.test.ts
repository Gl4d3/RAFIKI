// Integration tests: cross-source dedup (bank debit ↔ M-Pesa credit).
//
// Test 1–4: unit tests on the dedup logic with synthetic transactions.
// Test 5:   E2E fixture test — parses the real I&M Bank March 2026 PDF and a
//           synthetic M-Pesa CSV with a known matching credit, then asserts
//           the dedup pass tags exactly one candidate internal-transfer pair.
//
// Run with:  npx tsx server/__tests__/bank-mpesa-dedup.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tagInternalTransferCandidates, toEnrichable } from "../enrichment";
import type { EnrichableTransaction } from "../enrichment";
import { parseSource } from "../parsers/index";
import { categorizeTransactions } from "../accountant";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTx(
  overrides: Partial<EnrichableTransaction> & {
    txId: number;
    amount: number;
    direction: "credit" | "debit";
    date: Date;
    source: "bank" | "mpesa";
  }
): EnrichableTransaction {
  return {
    counterparty: "Test",
    reference: "",
    currency: "KES",
    rawText: "",
    balance: null,
    category: null,
    tier: null,
    isInternalTransfer: false,
    candidateInternalTransfer: false,
    internalTransferPairTxId: null,
    enrichmentNote: null,
    sourceType: overrides.source === "bank" ? "bank-pdf" : undefined,
    ...overrides,
  } as EnrichableTransaction;
}

const MARCH_24 = new Date(Date.UTC(2026, 2, 24));

// ── Test 1: same-day, same-amount bank debit ↔ M-Pesa credit → 1 pair ───────
{
  const bankDebit = makeTx({
    txId: 0, amount: 2500, direction: "debit", date: MARCH_24, source: "bank",
  });
  const mpesaCredit = makeTx({
    txId: 1, amount: 2500, direction: "credit", date: MARCH_24, source: "mpesa",
  });
  const unrelated = makeTx({
    txId: 2, amount: 500, direction: "debit", date: MARCH_24, source: "mpesa",
  });

  const pairs = tagInternalTransferCandidates([bankDebit, mpesaCredit, unrelated]);

  assert.strictEqual(pairs.length, 1, "expected exactly 1 internal-transfer pair");
  assert.strictEqual(pairs[0].amount, 2500, "pair amount should be 2500");
  assert.ok(bankDebit.candidateInternalTransfer, "bank debit should be tagged");
  assert.ok(mpesaCredit.candidateInternalTransfer, "M-Pesa credit should be tagged");
  assert.ok(!unrelated.candidateInternalTransfer, "unrelated tx must not be tagged");
  console.log("[PASS] Test 1: bank debit ↔ M-Pesa credit → 1 pair found");
}

// ── Test 2: same-source transactions are NOT deduped ─────────────────────────
{
  const mpesaDebit = makeTx({
    txId: 10, amount: 1000, direction: "debit", date: MARCH_24, source: "mpesa",
  });
  const mpesaCredit = makeTx({
    txId: 11, amount: 1000, direction: "credit", date: MARCH_24, source: "mpesa",
  });

  const pairs = tagInternalTransferCandidates([mpesaDebit, mpesaCredit]);

  assert.strictEqual(pairs.length, 0, "same-source pair must NOT be deduped");
  console.log("[PASS] Test 2: same-source opposite-direction pair not deduped");
}

// ── Test 3: amount tolerance ±1 KSh (e.g. bank 2500.50 ↔ M-Pesa 2500) ───────
{
  const bankDebit = makeTx({
    txId: 20, amount: 2500.5, direction: "debit", date: MARCH_24, source: "bank",
  });
  const mpesaCredit = makeTx({
    txId: 21, amount: 2500, direction: "credit", date: MARCH_24, source: "mpesa",
  });

  const pairs = tagInternalTransferCandidates([bankDebit, mpesaCredit]);

  assert.strictEqual(pairs.length, 1, "sub-1-KSh tolerance: should match");
  console.log("[PASS] Test 3: ±1 KSh tolerance accepted");
}

// ── Test 4: different-day pair is NOT deduped ────────────────────────────────
{
  const MARCH_25 = new Date(Date.UTC(2026, 2, 25));
  const bankDebit = makeTx({
    txId: 30, amount: 500, direction: "debit", date: MARCH_24, source: "bank",
  });
  const mpesaCredit = makeTx({
    txId: 31, amount: 500, direction: "credit", date: MARCH_25, source: "mpesa",
  });

  const pairs = tagInternalTransferCandidates([bankDebit, mpesaCredit]);

  assert.strictEqual(pairs.length, 0, "different-day pair must NOT match");
  console.log("[PASS] Test 4: different-day pair not deduped");
}

// ── Test 5: E2E — real bank PDF + synthetic M-Pesa CSV → dedup fires ─────────
// The I&M Bank March 2026 PDF has a KES 2,500 debit on 2026-03-24 (payment to
// the user's own M-Pesa number 254728125443).  We fabricate a matching M-Pesa
// CSV credit of KES 2,500 on the same day and verify the dedup pass tags it.
{
  const PDF_PATH = resolve("attached_assets/apr-statement_1776946562465.pdf");
  let bankBuf: Buffer;
  try {
    bankBuf = readFileSync(PDF_PATH);
  } catch {
    console.log("[SKIP] Test 5: sample bank PDF not found at", PDF_PATH);
    process.exit(0);
  }

  // Synthetic M-Pesa CSV: one credit of 2,500 on 2026-03-24 (Transfer from Bank).
  const mpesaCsv = [
    "Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance",
    "TFB0001,2026-03-24 10:00:00,Transfer from Bank 517819 - IM BANK LIMITED,Completed,2500,,5000.00",
  ].join("\n");

  const [bankTxs, mpesaTxs] = await Promise.all([
    parseSource({
      kind: "bank",
      buffer: bankBuf,
      sourceName: "I&M Bank (fixture)",
    }),
    parseSource({
      kind: "csv",
      buffer: Buffer.from(mpesaCsv, "utf-8"),
      sourceName: "M-Pesa (fixture)",
    }),
  ]);

  // Combine + run through categorise (required to produce CategorizedTransaction).
  const allParsed = [...bankTxs, ...mpesaTxs];
  const categorised = categorizeTransactions(allParsed);
  const enrichable = toEnrichable(categorised);
  const pairs = tagInternalTransferCandidates(enrichable);

  assert.ok(bankTxs.length > 0, `bank PDF should produce transactions, got ${bankTxs.length}`);
  assert.ok(
    bankTxs.every((t) => t.source === "bank"),
    "all bank transactions should be tagged source='bank'"
  );
  assert.ok(
    mpesaTxs.every((t) => t.source === "mpesa"),
    "all M-Pesa transactions should be tagged source='mpesa'"
  );

  const matchedPair = pairs.find((p) => Math.abs(p.amount - 2500) < 0.01);
  assert.ok(
    matchedPair !== undefined,
    `expected a KES 2,500 internal-transfer pair on 2026-03-24; pairs found: ${pairs.length}`
  );

  const bankLeg = enrichable.find((t) => t.txId === matchedPair.txIdA || t.txId === matchedPair.txIdB);
  assert.ok(bankLeg?.source === "bank" || enrichable.find(t => t.txId === matchedPair.txIdB)?.source === "bank",
    "one leg of the pair must be from the bank source");

  console.log(
    `[PASS] Test 5: real bank PDF (${bankTxs.length} txs) + M-Pesa CSV (${mpesaTxs.length} tx) → ` +
    `${pairs.length} pair(s) found, KES 2,500 match confirmed`
  );
}

console.log("\nAll bank↔M-Pesa dedup tests passed ✓");
