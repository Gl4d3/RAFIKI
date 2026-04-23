// Unit tests for server/parsers/bank-pdf.ts internal parsers.
//
// These tests exercise the text-based parsers directly (no PDF needed),
// covering both the I&M-specific path and the generic tabular path used
// for Equity / KCB / Co-operative Bank style statements.
//
// Run with:  npx tsx server/__tests__/bank-pdf-parser.test.ts

import assert from "node:assert/strict";
import { parseImText, parseGenericText } from "../parsers/bank-pdf";

// ── I&M Bank PAYGO-LCY parser tests ──────────────────────────────────────────

// Synthetic slice representative of the real I&M Bank March 2026 statement.
// All balances are kept consistent so direction detection (balance-delta) works.
// Sequence: B/F 34.70 → credit 1000 → balance 1,034.70
//           → debit 350 → balance 684.70
//           → debit 500 → balance 184.70   (MPESA payment)
//           → debit 66  → balance 118.70   (Charge — fee-folded into MPESA debit above)
const IM_SAMPLE_LINES = [
  "Tran Date Value Date Ref No Withdrawals Deposits Balance Transaction Narrative",
  "01-03-26 34.70 Cr B/F",
  "02-03-26 02-03-26 1,000.00 1,034.70 Cr 00204980506150/",
  "02-03-26 02-03-26 350.00 684.70 Cr MICROSOFT*STORE",
  "MSBILL0302 103419PRCR5506",
  "04-03-26 04-03-26 500.00 184.70 Cr 254728125443/MPESA Payment",
  "to 254728125443",
  "04-03-26 04-03-26 66.00 118.70 Cr Charge 254728125443/MPESA Payment",
  "to 254728125443",
];

{
  const txs = parseImText(IM_SAMPLE_LINES);

  assert.ok(txs.length > 0, "should parse at least one transaction");

  // Opening B/F row must be skipped.
  const bfRow = txs.find((t) => /B\/F/i.test(t.rawText ?? ""));
  assert.ok(bfRow === undefined, "B/F opening balance row must not be a transaction");

  // Credit of 1,000: balance went from 34.70 → 1,034.70.
  const credit = txs.find((t) => Math.abs(t.amount - 1000) < 0.01);
  assert.ok(credit, "should find a KES 1,000 credit");
  assert.strictEqual(credit!.direction, "credit", "1,000 row should be a credit");

  // Debit of 350: balance went from 1,034.70 → 684.70.
  const debit = txs.find((t) => Math.abs(t.amount - 350) < 0.01);
  assert.ok(debit, "should find a KES 350 debit");
  assert.strictEqual(debit!.direction, "debit", "350 row should be a debit");

  // MPESA debit of 500 on 2026-03-04 (with 66 charge fee folded in).
  const mpesaDebit = txs.find((t) => /mpesa/i.test(t.rawText ?? "") && t.direction === "debit");
  assert.ok(mpesaDebit, "should find an MPESA debit row");
  assert.strictEqual(mpesaDebit!.direction, "debit");
  assert.strictEqual(
    mpesaDebit!.date.getUTCDate(),
    4,
    "MPESA debit should be on the 4th"
  );
  assert.strictEqual(mpesaDebit!.date.getUTCMonth(), 2, "month should be March (0-indexed)");

  // Charge row (66.00) should be folded into the MPESA debit, not a standalone tx.
  const chargeStandalone = txs.find(
    (t) => Math.abs(t.amount - 66) < 0.01 && /charge/i.test(t.rawText ?? "")
  );
  assert.ok(chargeStandalone === undefined, "charge row should be folded into parent");

  // Continuation narrative appended.
  assert.ok(
    /MICROSOFT|STORE/i.test(txs[0].rawText ?? "") ||
      txs.some((t) => /MICROSOFT|STORE/i.test(t.counterparty ?? "")),
    "Microsoft narrative should be present"
  );

  console.log(`[PASS] I&M parser: ${txs.length} transactions, debit/credit directions correct, fee-folding works`);
}

// ── Generic tabular parser tests (Equity / KCB / Co-op style) ────────────────

// Synthetic Equity Bank Kenya style statement (DD/MM/YYYY, separate D/C columns).
const EQUITY_SAMPLE_LINES = [
  "Account Statement",
  "Date        Description                  Ref No       Debit      Credit      Balance",
  "01/03/2026  Opening Balance              -                         -          50,000.00",
  "05/03/2026  M-PESA WITHDRAWAL            MPS001       5,000.00               45,000.00",
  "10/03/2026  SALARY CREDIT                SAL001                  80,000.00  125,000.00",
  "12/03/2026  EQUITY MOBILE TRANSFER       MOB002       2,500.00              122,500.00",
  "15/03/2026  ATM WITHDRAWAL               ATM003       3,000.00              119,500.00",
  "Total                                                10,500.00   80,000.00",
];

{
  const txs = parseGenericText(EQUITY_SAMPLE_LINES);

  // Should have parsed some transactions (exact count depends on heuristic).
  assert.ok(txs.length >= 2, `should parse at least 2 Equity-style transactions, got ${txs.length}`);

  // Salary credit row: balance goes from 45,000 → 125,000.
  const salary = txs.find((t) => /salary/i.test(t.rawText ?? "") || /salary/i.test(t.counterparty ?? ""));
  assert.ok(salary, "should find a salary credit row");
  assert.strictEqual(salary!.direction, "credit", "salary should be a credit");

  // M-PESA withdrawal: balance goes from 50,000 → 45,000.
  const withdrawal = txs.find((t) => /m.pesa|mpesa/i.test(t.rawText ?? "") || /m.pesa|mpesa/i.test(t.counterparty ?? ""));
  assert.ok(withdrawal, "should find an M-PESA withdrawal row");
  assert.strictEqual(withdrawal!.direction, "debit", "M-PESA withdrawal should be a debit");

  console.log(`[PASS] Generic parser (Equity/KCB/Co-op style): ${txs.length} transactions, debit/credit correct`);
}

// Synthetic KCB-style statement (DD-Mon-YYYY dates, ref on same line).
const KCB_SAMPLE_LINES = [
  "Account: 1234567890  KCB Bank Kenya",
  "Date           Narration                      Ref No        Debit      Credit     Balance",
  "01-Mar-2026    Opening Balance                              -          -          10,000.00",
  "03-Mar-2026    ATM Withdrawal Westgate        WG001234      2,000.00              8,000.00",
  "08-Mar-2026    Salary Payment                 SAL202603                50,000.00  58,000.00",
  "Total",
];

{
  const txs = parseGenericText(KCB_SAMPLE_LINES);

  assert.ok(txs.length >= 1, `should parse at least 1 KCB-style transaction, got ${txs.length}`);

  const kcbSalary = txs.find(
    (t) => /salary/i.test(t.rawText ?? "") || /salary/i.test(t.counterparty ?? "")
  );
  if (kcbSalary) {
    assert.strictEqual(kcbSalary.direction, "credit", "KCB salary should be a credit");
  }

  console.log(`[PASS] Generic parser (KCB DD-Mon-YYYY style): ${txs.length} transactions`);
}

console.log("\nAll bank PDF parser unit tests passed ✓");
