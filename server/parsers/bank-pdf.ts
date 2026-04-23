// Multi-bank Kenyan bank statement PDF parser.
//
// Supports:
//   - I&M Bank PAYGO-LCY (text-based, DD-MM-YY dates, amount + balance Cr/Dr)
//   - Equity Bank Kenya (text-based, DD/MM/YYYY dates, separate debit/credit columns)
//   - KCB Bank Kenya (text-based, DD/MM/YYYY or DD-Mon-YYYY dates)
//   - Co-operative Bank of Kenya (text-based, DD/MM/YYYY dates)
//   - Generic fallback for other Kenyan bank PDFs
//
// Text is extracted via pdf-parse (the same library used by the M-Pesa PDF
// parser), avoiding the pdfjs-dist worker version conflict that arises when
// pdfjs is initialised twice in the same process.

import type { ParsedTransaction } from "./types";
import { normaliseBankCounterparty } from "../counterparty-normaliser";
import { SourceParseError } from "./types";
import { extractPdfText } from "./pdf-text";

// ── Bank detection ────────────────────────────────────────────────────────────

type BankKind = "im" | "equity" | "kcb" | "coop" | "generic";

function detectBank(text: string): BankKind {
  const lower = text.slice(0, 3000).toLowerCase();
  if (lower.includes("i&m bank") || lower.includes("im bank electronic")) return "im";
  if (lower.includes("equity bank")) return "equity";
  if (
    lower.includes("kenya commercial bank") ||
    lower.includes("kcb bank") ||
    lower.includes("kcb group")
  )
    return "kcb";
  if (
    lower.includes("co-operative bank") ||
    lower.includes("cooperative bank") ||
    lower.includes("co-op bank")
  )
    return "coop";
  return "generic";
}

// ── Shared amount helpers ─────────────────────────────────────────────────────

function parseAmount(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Matches comma-formatted numbers (e.g. "1,234.56" or "56.88").
const NUM_RE = /[\d,]+\.\d{2}/g;

// ── Date helpers ──────────────────────────────────────────────────────────────

// DD-MM-YY (2-digit year, used by I&M)
const DATE_DMYY_RE = /^\d{2}-\d{2}-\d{2}$/;
// DD-MM-YYYY or DD/MM/YYYY (used by Equity, KCB, Co-op)
const DATE_DMYYYY_RE = /^\d{2}[-/]\d{2}[-/]\d{4}$/;
// DD-Mon-YYYY (used by some KCB variants)
const DATE_DMONYYYY_RE =
  /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}$/i;

function isDateLike(s: string): boolean {
  return (
    DATE_DMYY_RE.test(s) || DATE_DMYYYY_RE.test(s) || DATE_DMONYYYY_RE.test(s)
  );
}

const MONTH_IDX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(s: string): Date {
  const m3 = s.match(
    /^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})$/i
  );
  if (m3) {
    return new Date(Date.UTC(+m3[3], MONTH_IDX[m3[2].toLowerCase()], +m3[1]));
  }
  const sep = s.includes("/") ? "/" : "-";
  const parts = s.split(sep).map(Number);
  if (parts.length !== 3) return new Date(NaN);
  const [d, m, y] = parts;
  const fullY = y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y;
  return new Date(Date.UTC(fullY, m - 1, d));
}

// ── Reference extractor ───────────────────────────────────────────────────────

function extractReference(narrative: string): string {
  const m =
    narrative.match(/^(\d{6,15})\//) ||
    narrative.match(/(254\d{9})/) ||
    narrative.match(/(\d{4,15})/);
  return m ? m[1] : "";
}

// ── Chrome / header line detector ────────────────────────────────────────────

function isChromeLine(line: string): boolean {
  return (
    /System Generated Email Attachment/i.test(line) ||
    /Terms & Conditions/i.test(line) ||
    /All rights reserved/i.test(line) ||
    /^Page \d+/i.test(line) ||
    /^\*+/.test(line) ||
    /^Account (Name|Number|Type|Currency)/i.test(line) ||
    /^Statement (Period|Date)/i.test(line) ||
    /^(Tran Date|Value Date|Ref No|Withdrawals?|Deposits?|Balance|Narration|Description|Transaction Narrative)/i.test(
      line
    ) ||
    /^Total\b/i.test(line) ||
    /Balance as of|Cleared Balance|Unclear Balance|Lien Amount|Effective Avail/i.test(
      line
    ) ||
    /^Opening Balance|^Closing Balance/i.test(line) ||
    /^-- \d+ of \d+ --$/i.test(line)
  );
}

// ────────────────────────────────────────────────────────────────────────────
// I&M Bank PAYGO-LCY text parser.
//
// Each transaction produces one or two lines:
//   "DD-MM-YY [DD-MM-YY] [tx_amount] [balance] Cr|Dr  [narrative]"
//   "[continuation narrative]"
//
// Direction is determined from balance delta (debit = balance went down).
// Fee rows ("Charge ..." / "Excise Duty ...") are folded into their parent.
// ────────────────────────────────────────────────────────────────────────────

export function parseImText(lines: string[]): ParsedTransaction[] {
  // Matches a transaction line: at least one date at the start, then amounts.
  // e.g. "02-03-26 02-03-26 1,000.00 1,034.70 Cr 00204980506150/"
  const TX_LINE_RE =
    /^(\d{2}-\d{2}-\d{2})(?:\s+\d{2}-\d{2}-\d{2})?\s+([\d,.]+)\s+([\d,.]+)\s+(Cr|Dr)\s*(.*)/;

  // A line that has dates and amounts but the amounts and narrative might be split.
  // We also handle lines with a single amount (e.g. "01-03-26 34.70 Cr B/F").
  const TX_SINGLE_RE =
    /^(\d{2}-\d{2}-\d{2})(?:\s+\d{2}-\d{2}-\d{2})?\s+([\d,.]+)\s+(Cr|Dr)\s*(.*)/;

  interface ImRawTx {
    date: Date;
    amount: number;
    balance: number;
    direction: "credit" | "debit";
    narrative: string;
  }

  const rawTxs: ImRawTx[] = [];
  let prevBalance: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || isChromeLine(line)) continue;

    const firstToken = line.split(/\s+/)[0];
    if (!DATE_DMYY_RE.test(firstToken)) {
      // Continuation line — append to last transaction's narrative.
      if (rawTxs.length > 0) {
        rawTxs[rawTxs.length - 1].narrative += " " + line;
      }
      continue;
    }

    // Try two-amount format first (transaction amount + balance).
    const m2 = line.match(TX_LINE_RE);
    if (m2) {
      const date = parseDate(m2[1]);
      const amount = parseAmount(m2[2]);
      const balance = parseAmount(m2[3]);
      const narrative = m2[5].trim();

      if (/^B\/F$/i.test(narrative.trim())) {
        prevBalance = balance;
        continue;
      }

      // Direction from balance delta (debit = decrease).
      const direction: "credit" | "debit" =
        prevBalance === null || balance >= (prevBalance ?? 0)
          ? "credit"
          : "debit";
      prevBalance = balance;
      rawTxs.push({ date, amount, balance, direction, narrative });
      continue;
    }

    // Single-amount format (opening balance row or edge case).
    const m1 = line.match(TX_SINGLE_RE);
    if (m1) {
      const date = parseDate(m1[1]);
      const balance = parseAmount(m1[2]);
      const narrative = m1[4].trim();
      if (/^B\/F$/i.test(narrative)) {
        prevBalance = balance;
      }
      // Other single-amount lines are skipped (summary rows, etc.)
      continue;
    }
  }

  // Build intermediate shape that carries narrative for fee-folding.
  interface ImTxWithNarr {
    date: Date;
    amount: number;
    direction: "credit" | "debit";
    counterparty: string;
    reference: string;
    balance: number | null;
    rawText: string;
    currency: string;
    fees?: { charge: number; excise: number };
    _narrative: string;
    _origNarrative: string;
  }

  const txsWithNarr: ImTxWithNarr[] = rawTxs.map((r) => {
    const narrative = r.narrative.replace(/\s+/g, " ").trim();
    return {
      date: r.date,
      amount: r.amount,
      direction: r.direction,
      counterparty: normaliseBankCounterparty(narrative),
      reference: extractReference(narrative),
      balance: r.balance,
      rawText: narrative,
      currency: "KES",
      _narrative: narrative,
      _origNarrative: narrative,
    };
  });

  // Fold charge / excise rows into their parent debit.
  function isFeeNarr(s: string): boolean {
    return /(^|\s|\/)charge(\s|$|\/)/i.test(s) || /excise duty/i.test(s);
  }
  function sameDateUTC(a: Date, b: Date): boolean {
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    );
  }

  const out: ImTxWithNarr[] = [];
  for (const tx of txsWithNarr) {
    const narr = tx._narrative;
    const isCharge = /(^|\s|\/)charge(\s|$|\/)/i.test(narr);
    const isExcise = /excise duty/i.test(narr);

    if (!isCharge && !isExcise) {
      out.push(tx);
      continue;
    }

    const id = tx.reference;
    const sameDay = out.filter(
      (p) =>
        p.direction === "debit" &&
        sameDateUTC(p.date, tx.date) &&
        !isFeeNarr(p._origNarrative) &&
        (id ? p._origNarrative.includes(id) : true)
    );
    const parent = sameDay[sameDay.length - 1];
    if (parent) {
      if (!parent.fees) parent.fees = { charge: 0, excise: 0 };
      if (isCharge) parent.fees.charge += tx.amount;
      if (isExcise) parent.fees.excise += tx.amount;
      parent.amount = round2(parent.amount + tx.amount);
      parent.rawText = `${parent.rawText} | ${isCharge ? "Charge" : "Excise"} ${tx.amount}`;
    } else {
      out.push(tx);
    }
  }

  // Strip internal fields and return.
  return out.map(({ _narrative, _origNarrative, ...rest }) => rest);
}

// ────────────────────────────────────────────────────────────────────────────
// Generic Kenyan bank text parser — Equity, KCB, Co-op, and unknown formats.
//
// Most Kenyan bank PDFs share a similar tabular layout when flattened to text:
//   "DD/MM/YYYY  [ref]  [description]  [debit]  [credit]  [balance]"
// or
//   "DD/MM/YYYY  [description]  [debit]  [credit]  [balance]"
//
// Strategy:
//   1. Identify lines that start with a date token.
//   2. Extract all amounts from the line (comma-formatted numbers).
//   3. The rightmost amount is the running balance.
//   4. Use balance delta vs previous row to determine debit vs credit.
//   5. Collect non-date, non-amount text as the narrative.
// ────────────────────────────────────────────────────────────────────────────

export function parseGenericText(lines: string[]): ParsedTransaction[] {
  interface GenRow {
    date: Date;
    amounts: number[];
    rest: string; // non-amount tokens
  }

  const rows: GenRow[] = [];
  let currentRow: GenRow | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || isChromeLine(line)) {
      currentRow = null;
      continue;
    }

    const tokens = line.split(/\s+/);
    const firstToken = tokens[0];

    if (isDateLike(firstToken)) {
      // New transaction row.
      const date = parseDate(firstToken);
      if (isNaN(date.getTime())) { currentRow = null; continue; }

      // Collect amounts and text from the rest of the tokens.
      const amounts: number[] = [];
      const textParts: string[] = [];
      for (const tok of tokens.slice(1)) {
        // Skip secondary date tokens (value date column).
        if (isDateLike(tok)) continue;
        const clean = tok.replace(/,/g, "");
        if (/^\d+\.\d{2}$/.test(clean)) {
          amounts.push(parseFloat(clean));
        } else {
          textParts.push(tok);
        }
      }
      currentRow = { date, amounts, rest: textParts.join(" ") };
      rows.push(currentRow);
    } else if (currentRow) {
      // Continuation line — append text to current row's rest.
      // Also pick up any amounts that appear on continuation lines.
      const contAmounts = line.match(NUM_RE) || [];
      const uniqueAmts = Array.from(
        new Set(contAmounts.map((a) => parseAmount(a)))
      );
      for (const v of uniqueAmts) {
        if (!currentRow.amounts.includes(v)) currentRow.amounts.push(v);
      }
      const stripped = line.replace(NUM_RE, "").replace(/\s+/g, " ").trim();
      if (stripped) currentRow.rest += " " + stripped;
    }
  }

  const txs: ParsedTransaction[] = [];
  let prevBalance: number | null = null;

  for (const row of rows) {
    if (row.amounts.length === 0) continue;

    // The rightmost / largest amount is the running balance in most layouts.
    const balance = row.amounts[row.amounts.length - 1];
    let txAmount = 0;

    if (row.amounts.length === 1) {
      // Only balance present — can't determine amount, skip.
      prevBalance = balance;
      continue;
    } else if (row.amounts.length === 2) {
      // Two amounts: [transaction, balance].
      txAmount = row.amounts[0];
    } else {
      // Three or more: layouts vary (debit | credit | balance or ref | tx | balance).
      // Two innermost amounts before the balance are debit/credit columns.
      // At least one will be 0; pick the non-zero one.
      const inner = row.amounts.slice(row.amounts.length - 3, row.amounts.length - 1);
      txAmount = inner.find((v) => v > 0) ?? 0;
    }

    if (txAmount === 0) { prevBalance = balance; continue; }

    // Direction from balance delta.
    const direction: "credit" | "debit" =
      prevBalance === null || balance > prevBalance ? "credit" : "debit";
    prevBalance = balance;

    const narrative = row.rest.replace(/\s+/g, " ").trim();
    if (!narrative) continue;

    txs.push({
      date: row.date,
      amount: txAmount,
      direction,
      counterparty: normaliseBankCounterparty(narrative),
      reference: extractReference(narrative),
      balance,
      rawText: narrative,
      currency: "KES",
    });
  }

  return txs;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function parseBankPdf(buffer: Buffer, sourceName = "bank statement"): Promise<ParsedTransaction[]> {
  // extractPdfText handles empty-file and non-PDF checks, and normalises
  // lines the same way the M-Pesa PDF parser uses them.
  const { full: text, lines } = await extractPdfText(buffer, sourceName);

  const bankKind = detectBank(text);

  const txs = bankKind === "im"
    ? parseImText(lines)
    : parseGenericText(lines); // Equity, KCB, Co-op, and unknown

  if (txs.length === 0) {
    throw new SourceParseError(
      sourceName,
      "pdf",
      "no transactions could be read from this bank statement. " +
        "The format may not be supported yet — please contact support."
    );
  }

  return txs;
}
