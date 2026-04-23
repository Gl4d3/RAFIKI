// M-Pesa SMS parser.
// Accepts one or many messages, separated by blank lines (or simply
// concatenated — we also try to segment on receipt codes).
//
// Supported shapes (case-insensitive):
//   "QIH1A2B3CD Confirmed. Ksh500.00 sent to JOHN DOE 0712345678 on
//    15/1/24 at 4:30 PM. New M-PESA balance is Ksh2,345.67.
//    Transaction cost, Ksh.13.00."
//   "QIH1A2B3CD Confirmed. You have received Ksh1,000.00 from JANE
//    SMITH 0722123456 on 14/1/24 at 9:15 AM. New M-PESA balance is
//    Ksh3,345.67."
//   "QIH1A2B3CD Confirmed. Ksh200.00 sent to KPLC PREPAID for account
//    12345678 on 15/1/24 at 2:15 PM ..."
//   "QIH1A2B3CD Confirmed. Ksh150.00 paid to NAIVAS SUPERMARKET on
//    15/1/24 at 2:00 PM ..."
//   "QIH1A2B3CD Confirmed. on 15/1/24 at 3:00 PM Withdraw Ksh500.00
//    from 123456 - ABC AGENT. New M-PESA balance is Ksh0.00 ..."

import type { ParsedTransaction } from "./types";
import { SourceParseError } from "./types";
import { parseAmount, parseSmsTime } from "./utils";

const RECEIPT_RE = /\b([A-Z0-9]{10})\b(?=\s+Confirmed\.|\s+confirmed\.)/g;

// Segment a big blob into individual messages. We split on blank lines
// first; if that gives us a single chunk, we fall back to splitting at
// each "<receipt code> Confirmed." boundary.
function segment(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const byBlankLines = trimmed
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (byBlankLines.length > 1) return byBlankLines;

  // Single chunk — try to split by receipt-code boundaries.
  const flat = trimmed.replace(/\s+/g, " ");
  const boundaries: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(RECEIPT_RE.source, "g");
  while ((m = re.exec(flat)) !== null) {
    boundaries.push(m.index);
  }
  if (boundaries.length <= 1) return [flat];

  const out: string[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : flat.length;
    out.push(flat.slice(start, end).trim());
  }
  return out;
}

interface SmsMatch {
  direction: "credit" | "debit";
  amount: number;
  counterparty: string;
  counterpartyPhone: string | null;
}

function parseSmsBody(body: string): SmsMatch | null {
  // Credit: "You have received Ksh<amt> from <NAME> [<phone>]"
  const credit = body.match(
    /you have received\s+ksh\.?\s*([\d,]+(?:\.\d{1,2})?)\s+from\s+(.+?)(?=\s+on\s|\s+at\s|\.\s+new m-?pesa)/i
  );
  if (credit) {
    const [, amt, who] = credit;
    const { name, phone } = splitNamePhone(who);
    return {
      direction: "credit",
      amount: parseAmount(amt),
      counterparty: name,
      counterpartyPhone: phone,
    };
  }

  // Withdrawal from agent: "Withdraw Ksh<amt> from <agent>"
  const withdraw = body.match(
    /withdraw\s+ksh\.?\s*([\d,]+(?:\.\d{1,2})?)\s+from\s+(.+?)(?=\.\s*new m-?pesa|\s+new m-?pesa)/i
  );
  if (withdraw) {
    const [, amt, who] = withdraw;
    return {
      direction: "debit",
      amount: parseAmount(amt),
      counterparty: who.trim(),
      counterpartyPhone: null,
    };
  }

  // Debit — sent/paid to:
  //   "Ksh<amt> sent to <NAME> [<phone>] [for account <acct>]"
  //   "Ksh<amt> paid to <MERCHANT>"
  const debit = body.match(
    /ksh\.?\s*([\d,]+(?:\.\d{1,2})?)\s+(?:sent to|paid to)\s+(.+?)(?=\s+on\s|\.\s*new m-?pesa|\s+new m-?pesa|\s+for account\s)/i
  );
  if (debit) {
    const [, amt, who] = debit;
    const { name, phone } = splitNamePhone(who);
    // Capture "for account XYZ" if present — append to counterparty.
    const acctMatch = body.match(/for account\s+([A-Z0-9_\-\.\/]+)/i);
    const counterparty = acctMatch ? `${name} (acct ${acctMatch[1]})` : name;
    return {
      direction: "debit",
      amount: parseAmount(amt),
      counterparty,
      counterpartyPhone: phone,
    };
  }

  return null;
}

function splitNamePhone(s: string): { name: string; phone: string | null } {
  const cleaned = s.replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  const phoneMatch = cleaned.match(/(\+?254\d{9}|0[17]\d{8})/);
  if (phoneMatch) {
    const phone = phoneMatch[1];
    const name = cleaned.replace(phone, "").trim();
    return { name: name || cleaned, phone };
  }
  return { name: cleaned, phone: null };
}

function parseDateTime(body: string): Date | null {
  // "on D/M/YY at H:MM AM/PM" or "on DD/MM/YYYY at HH:MM"
  const m = body.match(
    /on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i
  );
  if (!m) return null;
  const [, dstr, tstr] = m;
  const dm = dstr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!dm) return null;
  const [, d, mo, y] = dm;
  const year = y.length === 2 ? 2000 + +y : +y;
  const time = parseSmsTime(tstr);
  if (!time) return null;
  return new Date(Date.UTC(year, +mo - 1, +d, time.h, time.m, 0));
}

export function parseMpesaSms(
  text: string,
  sourceName: string = "M-Pesa SMS"
): ParsedTransaction[] {
  if (!text || !text.trim()) {
    throw new SourceParseError(
      sourceName,
      "sms",
      "no SMS text was provided."
    );
  }

  const messages = segment(text);
  const transactions: ParsedTransaction[] = [];
  const errors: string[] = [];

  for (const msg of messages) {
    const receiptMatch = msg.match(/\b([A-Z0-9]{10})\b\s+Confirmed\./i);
    if (!receiptMatch) {
      errors.push(
        `skipped a message without a transaction code: "${msg.slice(0, 60)}..."`
      );
      continue;
    }
    const receipt = receiptMatch[1];

    const body = parseSmsBody(msg);
    if (!body) {
      errors.push(
        `couldn't understand the shape of message ${receipt}.`
      );
      continue;
    }

    const date = parseDateTime(msg);
    if (!date) {
      errors.push(`couldn't find a date in message ${receipt}.`);
      continue;
    }

    const balMatch = msg.match(
      /new m-?pesa balance is\s+ksh\.?\s*([\d,]+(?:\.\d{1,2})?)/i
    );
    const balance = balMatch ? parseAmount(balMatch[1]) : null;

    const costMatch = msg.match(
      /transaction cost,?\s+ksh\.?\s*([\d,]+(?:\.\d{1,2})?)/i
    );
    const transactionCost = costMatch ? parseAmount(costMatch[1]) : null;

    transactions.push({
      date,
      amount: body.amount,
      direction: body.direction,
      counterparty: body.counterparty || "Unknown",
      counterpartyPhone: body.counterpartyPhone,
      reference: receipt,
      balance,
      transactionCost,
      currency: "KES",
      rawText: msg,
      sourceType: "sms",
    });
  }

  if (transactions.length === 0) {
    const hint = errors.length ? ` (${errors[0]})` : "";
    throw new SourceParseError(
      sourceName,
      "sms",
      `no M-Pesa messages could be parsed${hint}.`
    );
  }

  return transactions;
}
