// M-Pesa CSV parser.
// Handles the CSV export from the Safaricom self-care portal.
// Column names vary between export versions so we detect columns by name.

import { parse } from "csv-parse/sync";
import type { ParsedTransaction } from "./types";
import { SourceParseError } from "./types";
import { parseAmount, parseDate } from "./utils";

export function parseMpesaCsv(
  buffer: Buffer,
  sourceName: string = "M-Pesa statement"
): ParsedTransaction[] {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/);

  // Skip any preamble: find the row that contains "date" and either
  // "amount" or a "paid in"/"withdrawn" column, or a "receipt" column.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (
      (lower.includes("date") && lower.includes("amount")) ||
      lower.includes("receipt no") ||
      (lower.includes("paid in") && lower.includes("withdrawn"))
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const dataLines = lines.slice(headerIdx).join("\n");

  let records: string[][];
  try {
    records = parse(dataLines, {
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as string[][];
  } catch {
    throw new SourceParseError(
      sourceName,
      "csv",
      "we couldn't parse the CSV. Please re-export it from the Safaricom portal."
    );
  }

  if (records.length < 2) {
    throw new SourceParseError(
      sourceName,
      "csv",
      "the file didn't contain any transactions."
    );
  }

  const headers = records[0].map((h) => h.toLowerCase().trim());

  const findCol = (...names: string[]) => {
    for (const n of names) {
      const idx = headers.findIndex((h) => h.includes(n));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const dateCol = findCol("completion time", "date", "time");
  const amountCol = findCol("amount");
  const paidInCol = findCol("paid in", "credit", "money in");
  const withdrawnCol = findCol("withdrawn", "debit", "money out", "paid out");
  const counterpartyCol = findCol(
    "details",
    "description",
    "counterparty",
    "name",
    "recipient"
  );
  const refCol = findCol("receipt", "ref", "transaction id");
  const balanceCol = findCol("balance");
  const costCol = findCol("transaction cost", "cost");

  const transactions: ParsedTransaction[] = [];

  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    if (!row || row.length < 2) continue;

    const rawText = row.join(",");

    const dateVal = dateCol >= 0 ? parseDate(row[dateCol]) : null;
    if (!dateVal) continue;

    let amount = 0;
    let direction: "credit" | "debit" = "debit";

    if (paidInCol >= 0 && withdrawnCol >= 0) {
      const paidIn = parseAmount(row[paidInCol]);
      const withdrawn = parseAmount(row[withdrawnCol]);
      if (paidIn > 0) {
        amount = paidIn;
        direction = "credit";
      } else if (withdrawn !== 0) {
        amount = Math.abs(withdrawn);
        direction = "debit";
      } else {
        continue;
      }
    } else if (amountCol >= 0) {
      const parsed = parseAmount(row[amountCol]);
      if (parsed === 0) continue;
      amount = Math.abs(parsed);
      direction = parsed > 0 ? "credit" : "debit";
    } else {
      continue;
    }

    const counterparty =
      counterpartyCol >= 0 ? (row[counterpartyCol] || "").trim() || "Unknown" : "Unknown";
    const reference = refCol >= 0 ? (row[refCol] || "").trim() : "";
    const balance =
      balanceCol >= 0 ? (parseAmount(row[balanceCol]) || null) : null;
    const transactionCost =
      costCol >= 0 ? (parseAmount(row[costCol]) || null) : null;

    transactions.push({
      date: dateVal,
      amount,
      direction,
      counterparty,
      counterpartyPhone: null,
      reference,
      balance,
      transactionCost,
      currency: "KES",
      rawText,
      sourceType: "csv",
    });
  }

  if (transactions.length === 0) {
    throw new SourceParseError(
      sourceName,
      "csv",
      "no valid transactions could be extracted from the file."
    );
  }

  return transactions;
}
