// M-Pesa PDF statement parser.
// Typical statement layout:
//   Receipt No. | Completion Time | Details | Transaction Status | Paid In | Withdrawn | Balance
// After pdf-parse flattens the table we get a line per row that starts
// with the 10-char receipt code, followed by the completion time, a
// free-text description, the status, and 2-3 trailing money values.

import { extractPdfText } from "./pdf-text";
import type { ParsedTransaction } from "./types";
import { SourceParseError } from "./types";
import { parseDate } from "./utils";

// Receipt codes are 10 uppercase alphanumerics, e.g. "QIH1A2B3CD".
const RECEIPT_RE = /^([A-Z0-9]{10})\s+(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2})\s+(.*)$/;
const MONEY_TAIL_RE = /(-?\d{1,3}(?:,\d{3})*(?:\.\d{2}))/g;

// Heuristic classifier from the "Details" description when the Paid In /
// Withdrawn column disambiguation is ambiguous.
function directionFromDetails(details: string): "credit" | "debit" | null {
  const s = details.toLowerCase();
  if (
    /received from|funds received|business payment from|deposit of funds|reversal|loan disbursement|m-?shwari withdrawal|promotion payment/i.test(
      s
    )
  ) {
    return "credit";
  }
  if (
    /customer transfer to|pay bill|merchant payment|merchant charge|pay bill charge|customer transfer charge|withdraw|airtime purchase|m-?shwari deposit|loan repayment|od loan|charge/i.test(
      s
    )
  ) {
    return "debit";
  }
  return null;
}

function toNum(s: string): number {
  return parseFloat(s.replace(/,/g, ""));
}

export async function parseMpesaPdf(
  buffer: Buffer,
  sourceName: string = "M-Pesa statement"
): Promise<ParsedTransaction[]> {
  const { lines } = await extractPdfText(buffer, sourceName);

  // Verify this looks like an M-Pesa statement. Any of these markers is fine.
  const preamble = lines.slice(0, 40).join(" ").toLowerCase();
  const looksLikeMpesa =
    preamble.includes("m-pesa") ||
    preamble.includes("mpesa") ||
    preamble.includes("safaricom");
  if (!looksLikeMpesa) {
    throw new SourceParseError(
      sourceName,
      "pdf",
      "this PDF doesn't look like an M-Pesa statement."
    );
  }

  const transactions: ParsedTransaction[] = [];

  for (const line of lines) {
    const m = line.match(RECEIPT_RE);
    if (!m) continue;
    const [, receipt, completionTime, rest] = m;

    const date = parseDate(completionTime);
    if (!date) continue;

    // Find the trailing money values (2 or 3). Description is everything
    // before the first money token after the completion time.
    const moneyMatches: RegExpExecArray[] = [];
    const re = new RegExp(MONEY_TAIL_RE.source, "g");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(rest)) !== null) moneyMatches.push(mm);
    if (moneyMatches.length < 2) continue;

    const firstMoneyIdx = moneyMatches[0].index ?? rest.length;
    let detailsBlock = rest.slice(0, firstMoneyIdx).trim();

    // Strip trailing "Completed"/"Failed"/"Pending" status token from details.
    detailsBlock = detailsBlock
      .replace(/\s+(Completed|Failed|Pending|Reversed)\s*$/i, "")
      .trim();

    // Take the last 2-3 money tokens as (paidIn?, withdrawn?, balance).
    const nums = moneyMatches.map((mm) => toNum(mm[0]));
    const balance = nums[nums.length - 1];

    let paidIn = 0;
    let withdrawn = 0;
    if (nums.length >= 3) {
      paidIn = nums[nums.length - 3];
      withdrawn = nums[nums.length - 2];
    } else {
      // Only one non-balance money value — figure out which column it is.
      const single = nums[nums.length - 2];
      const dir = directionFromDetails(detailsBlock);
      if (dir === "credit") paidIn = single;
      else if (dir === "debit") withdrawn = Math.abs(single);
      else if (single < 0) withdrawn = Math.abs(single);
      else withdrawn = single; // default to debit — more common
    }

    let amount: number;
    let direction: "credit" | "debit";
    if (paidIn > 0 && withdrawn === 0) {
      amount = paidIn;
      direction = "credit";
    } else if (withdrawn !== 0 && paidIn === 0) {
      amount = Math.abs(withdrawn);
      direction = "debit";
    } else if (paidIn > 0) {
      amount = paidIn;
      direction = "credit";
    } else if (withdrawn !== 0) {
      amount = Math.abs(withdrawn);
      direction = "debit";
    } else {
      continue;
    }

    transactions.push({
      date,
      amount,
      direction,
      counterparty: detailsBlock || "Unknown",
      counterpartyPhone: extractPhone(detailsBlock),
      reference: receipt,
      balance: Number.isFinite(balance) ? balance : null,
      transactionCost: null,
      currency: "KES",
      rawText: line,
      sourceType: "pdf",
    });
  }

  if (transactions.length === 0) {
    throw new SourceParseError(
      sourceName,
      "pdf",
      "we couldn't find any transaction rows in the PDF. Is this the full M-Pesa statement?"
    );
  }

  // Sanity check: M-Pesa monthly statements are rarely fewer than a
  // handful of rows. A single accidental match should not pass.
  if (transactions.length < 2) {
    throw new SourceParseError(
      sourceName,
      "pdf",
      "we only found 1 transaction-looking row, which usually means the PDF layout didn't parse cleanly."
    );
  }

  return transactions;
}

function extractPhone(details: string): string | null {
  // Kenyan mobile numbers: 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, +2547XXXXXXXX
  const m = details.match(/(\+?254\d{9}|0[17]\d{8})/);
  return m ? m[1] : null;
}
