// I&M Bank PAYGO-LCY PDF parser.
//
// Reads the I&M Bank monthly statement PDF, reconstructs each transaction row
// (date, withdrawal/deposit, balance, multi-line narrative), and folds
// "Charge" / "Excise Duty" rows into the parent transaction's `fees` object.
//
// We use pdfjs-dist to extract positioned text items, then rebuild the table
// from x/y coordinates — bank PDFs do not contain a real text stream we can
// parse linearly.

import type { ParsedTransaction } from "./parser";
import { normaliseBankCounterparty } from "./counterparty-normaliser";

// pdfjs-dist exposes its node-friendly entry under the "legacy" build.
// We import it dynamically because it ships as ESM-only and we only need it
// when a PDF is actually uploaded.
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Disable the web worker — in Node.js there is no worker thread needed
  // and mismatched worker binaries cause a version-mismatch error at runtime.
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  return pdfjs;
}

interface RawItem {
  page: number;
  x: number;
  y: number;
  s: string;
}

interface Row {
  page: number;
  y: number;
  cells: RawItem[]; // sorted by x ascending
}

const TRAN_DATE_RE = /^\d{2}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^[\d,]+(?:\.\d+)?$/;

// Column boundaries observed in the I&M PAYGO-LCY layout (page width ≈ 612).
// Withdrawals fall in the 200–300 band, Deposits in 300–360, Balance in 380+,
// Narrative starts at 440+.
const COL_DATE_MAX = 60;
const COL_VALUE_MAX = 110;
const COL_REF_MAX = 200;
const COL_WITHDRAW_MAX = 300;
const COL_DEPOSIT_MAX = 380;
const COL_BALANCE_MAX = 445;
const COL_NARRATIVE_MIN = 445;

export async function parseBankPdf(buffer: Buffer): Promise<ParsedTransaction[]> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;

  const items: RawItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as any[]) {
      const s = (it.str || "").trim();
      if (!s) continue;
      items.push({ page: p, x: it.transform[4], y: it.transform[5], s });
    }
  }

  // Group items into rows per page. Rows are clustered by y within a small
  // vertical tolerance (text on the same printed line shares a y baseline).
  const rows = clusterRows(items);

  // Statement period (used as a fallback if individual row dates ever lose
  // their year — they're printed as 2-digit DD-MM-YY in the body).
  const period = extractStatementPeriod(items);

  return assembleTransactions(rows, period);
}

function clusterRows(items: RawItem[]): Row[] {
  const byPage = new Map<number, RawItem[]>();
  for (const it of items) {
    if (!byPage.has(it.page)) byPage.set(it.page, []);
    byPage.get(it.page)!.push(it);
  }

  const rows: Row[] = [];
  byPage.forEach((pageItems: RawItem[], page: number) => {
    pageItems.sort((a, b) => b.y - a.y);
    let current: Row | null = null;
    for (const it of pageItems) {
      if (!current || Math.abs(current.y - it.y) > 2.5) {
        current = { page, y: it.y, cells: [it] };
        rows.push(current);
      } else {
        current.cells.push(it);
      }
    }
    for (const r of rows) r.cells.sort((a, b) => a.x - b.x);
  });
  return rows;
}

function extractStatementPeriod(items: RawItem[]): { from: Date; to: Date } | null {
  // Look for "Statement Period   DD-MM-YYYY  To  DD-MM-YYYY"
  const text = items.map((it) => it.s).join(" ");
  const m = text.match(/Statement Period\s+(\d{2}-\d{2}-\d{4})\s+To\s+(\d{2}-\d{2}-\d{4})/);
  if (!m) return null;
  return { from: parseDmy(m[1]), to: parseDmy(m[2]) };
}

function parseDmy(s: string): Date {
  const [d, m, y] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function parseDmyShort(s: string, periodYear: number): Date {
  // "DD-MM-YY" — assume 21st century year.
  const [d, m, y] = s.split("-").map((n) => parseInt(n, 10));
  const fullY = y < 70 ? 2000 + y : 1900 + y;
  return new Date(Date.UTC(fullY, m - 1, d));
}

function parseAmount(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

interface Block {
  txRow: Row;
  txDate: Date;
  withdrawal: number;
  deposit: number;
  balance: number;
  narrativeRows: Row[]; // includes the txRow's own narrative cells too
}

function assembleTransactions(
  rows: Row[],
  period: { from: Date; to: Date } | null
): ParsedTransaction[] {
  const periodYear = period?.from.getUTCFullYear() ?? new Date().getUTCFullYear();

  // First pass: identify "transaction rows" vs "narrative-only rows".
  // A transaction row begins with a 2-digit DD-MM-YY tran date in column 0
  // AND contains a withdrawal or deposit number in the amount columns.
  const blocks: Block[] = [];
  const narrativeOnly: Row[] = [];

  for (const row of rows) {
    const first = row.cells[0];
    if (first && first.x < COL_DATE_MAX && TRAN_DATE_RE.test(first.s)) {
      const block = readTxRow(row, periodYear);
      if (block) {
        blocks.push(block);
        continue;
      }
    }
    // Narrative-only row: only useful if it has text in the narrative column.
    const narrCells = row.cells.filter((c) => c.x >= COL_NARRATIVE_MIN);
    if (narrCells.length > 0 && !isPageChrome(row)) {
      narrativeOnly.push(row);
    }
  }

  // Assign each narrative-only row to the nearest tx block on the same page.
  for (const nrow of narrativeOnly) {
    let best: Block | null = null;
    let bestDist = Infinity;
    for (const b of blocks) {
      if (b.txRow.page !== nrow.page) continue;
      const d = Math.abs(b.txRow.y - nrow.y);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    // Only attach if reasonably close (within ~13 px ≈ a row height).
    if (best && bestDist <= 13) {
      best.narrativeRows.push(nrow);
    }
  }

  // Build narrative strings and convert blocks to ParsedTransaction.
  const txs: (ParsedTransaction & { _narrative: string })[] = [];
  for (const b of blocks) {
    const narrative = buildNarrative(b);
    if (narrative === "B/F" || /^B\/F$/i.test(narrative)) continue; // brought-forward balance
    if (b.withdrawal === 0 && b.deposit === 0) continue;

    const direction: "credit" | "debit" = b.deposit > 0 ? "credit" : "debit";
    const amount = direction === "credit" ? b.deposit : b.withdrawal;
    const counterparty = normaliseBankCounterparty(narrative);

    txs.push({
      date: b.txDate,
      amount,
      direction,
      counterparty,
      reference: extractReference(narrative),
      balance: b.balance || null,
      rawText: narrative,
      _narrative: narrative,
    } as any);
  }

  // Fold Charge / Excise Duty rows into their parent transaction.
  return foldFees(txs);
}

function readTxRow(row: Row, periodYear: number): Block | null {
  const first = row.cells[0];
  if (!first) return null;
  const txDate = parseDmyShort(first.s, periodYear);

  let withdrawal = 0;
  let deposit = 0;
  let balance = 0;

  for (const c of row.cells) {
    if (!AMOUNT_RE.test(c.s)) continue;
    const v = parseAmount(c.s);
    if (v === 0) continue;
    if (c.x > COL_VALUE_MAX && c.x <= COL_WITHDRAW_MAX) withdrawal = v;
    else if (c.x > COL_WITHDRAW_MAX && c.x <= COL_DEPOSIT_MAX) deposit = v;
    else if (c.x > COL_DEPOSIT_MAX && c.x <= COL_BALANCE_MAX) balance = v;
  }

  return { txRow: row, txDate, withdrawal, deposit, balance, narrativeRows: [row] };
}

function buildNarrative(b: Block): string {
  // Order narrative rows top-to-bottom (descending y) so multi-line text
  // reads in print order.
  const rows = [...b.narrativeRows].sort((a, b2) => b2.y - a.y);
  const parts: string[] = [];
  for (const r of rows) {
    for (const c of r.cells) {
      if (c.x >= COL_NARRATIVE_MIN) parts.push(c.s);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function isPageChrome(row: Row): boolean {
  const text = row.cells.map((c) => c.s).join(" ");
  return (
    /System Generated Email Attachment/i.test(text) ||
    /Terms & Conditions/i.test(text) ||
    /All rights reserved/i.test(text) ||
    /Page \d+ Of \d+/i.test(text) ||
    /^Account (Name|Number|Type|Currency|Statement)/i.test(text) ||
    /^Statement Period/i.test(text) ||
    /^Tran Date/i.test(text) ||
    /^Total\b/i.test(text) ||
    /Balance as of|Cleared Balance|Unclear Balance|Lien Amount|Effective Avail/i.test(text)
  );
}

function extractReference(narrative: string): string {
  // Pull a useful identifier (paybill, phone, or first slash-prefixed token).
  const m =
    narrative.match(/^(\d{6,15})\//) ||
    narrative.match(/(254\d{9})/) ||
    narrative.match(/(\d{4,15})/);
  return m ? m[1] : "";
}

// Charge / Excise Duty rows belong to the most recent same-day transaction
// whose narrative shares the fee-row's identifier. We mutate the parent
// transaction in place and drop the fee row from the output.
function foldFees(
  txs: (ParsedTransaction & { _narrative: string })[]
): ParsedTransaction[] {
  // We tag each pushed parent with its ORIGINAL narrative so a later fee row
  // doesn't see "Charge 66" we appended and mistake it for a fee row.
  type Pushed = ParsedTransaction & {
    fees?: { charge: number; excise: number };
    _origNarrative: string;
  };
  const out: Pushed[] = [];
  for (const tx of txs) {
    const narr = tx._narrative;
    const isCharge = /(^|\s|\/)charge(\s|$|\/)/i.test(narr);
    const isExcise = /excise duty/i.test(narr);
    if (!isCharge && !isExcise) {
      out.push({ ...stripInternal(tx), _origNarrative: narr } as Pushed);
      continue;
    }

    // Find parent: most recent prior debit on same date whose ORIGINAL
    // narrative contains the fee row's primary identifier (paybill/phone)
    // AND is not itself a fee row.
    const id = tx.reference;
    const sameDay = out.filter(
      (p) =>
        p.direction === "debit" &&
        sameDate(p.date, tx.date) &&
        !isFeeNarrative(p._origNarrative) &&
        (id ? p._origNarrative.includes(id) : true)
    );
    const parent = sameDay[sameDay.length - 1];

    if (parent) {
      if (!parent.fees) parent.fees = { charge: 0, excise: 0 };
      if (isCharge) parent.fees.charge += tx.amount;
      if (isExcise) parent.fees.excise += tx.amount;
      // Add fees into the principal so total spend reflects real money out.
      parent.amount = round2(parent.amount + tx.amount);
      parent.rawText = `${parent.rawText} | ${isCharge ? "Charge" : "Excise"} ${tx.amount}`;
    } else {
      // Orphan fee — keep it as a real debit so we don't lose money.
      out.push({ ...stripInternal(tx), _origNarrative: narr } as Pushed);
    }
  }
  // Drop the internal `_origNarrative` field before returning.
  return out.map(({ _origNarrative, ...rest }) => rest);
}

function isFeeNarrative(s: string): boolean {
  return /(^|\s|\/)charge(\s|$|\/)/i.test(s) || /excise duty/i.test(s);
}

function sameDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stripInternal(tx: ParsedTransaction & { _narrative?: string }): ParsedTransaction {
  const { _narrative, ...rest } = tx as any;
  return rest;
}
