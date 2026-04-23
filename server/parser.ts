// M-Pesa statement parser — handles CSV format
// PDF parsing would require pdfplumber (Python) — for this Node.js environment
// we handle the exported CSV format that M-Pesa generates

import { parse } from "csv-parse/sync";

export interface ParsedTransaction {
  date: Date;
  amount: number;
  direction: "credit" | "debit";
  counterparty: string;
  reference: string;
  balance: number | null;
  rawText: string;
}

// Parse M-Pesa CSV statement
// M-Pesa CSV columns vary by export version — we handle both common formats
export function parseMpesaCsv(buffer: Buffer, fileName?: string | null): ParsedTransaction[] {
  // Honest detection: PDF parsing is not yet supported.
  // Magic bytes "%PDF" identify a PDF regardless of extension.
  const isPdfBytes = buffer.length >= 4 && buffer.slice(0, 4).toString("ascii") === "%PDF";
  const isPdfName = !!fileName && fileName.toLowerCase().endsWith(".pdf");
  if (isPdfBytes || isPdfName) {
    throw new Error(
      "PDF statement parsing isn't supported yet. Please export your M-Pesa statement as CSV from the Safaricom self-care portal."
    );
  }

  const text = buffer.toString("utf-8");

  // Try to find the data section (M-Pesa CSVs often have header metadata rows)
  const lines = text.split(/\r?\n/);

  // Find the header row (contains "Date" or "Receipt No" or similar)
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (
      (lower.includes("date") && lower.includes("amount")) ||
      lower.includes("receipt no") ||
      lower.includes("transaction")
    ) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    // Try parsing the whole file as CSV
    headerIdx = 0;
  }

  const dataLines = lines.slice(headerIdx).join("\n");

  let records: any[][];
  try {
    records = parse(dataLines, {
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch {
    throw new Error(
      "Could not parse CSV file. Please ensure it is an M-Pesa statement export."
    );
  }

  if (records.length < 2) {
    throw new Error("No transactions found in the uploaded file.");
  }

  const headers = records[0].map((h: string) => h.toLowerCase().trim());
  const transactions: ParsedTransaction[] = [];

  // Map known column patterns
  const findCol = (...names: string[]) => {
    for (const n of names) {
      const idx = headers.findIndex((h: string) => h.includes(n));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const dateCol = findCol("date", "time");
  const amountCol = findCol("amount", "paid in", "withdrawn");
  const paidInCol = findCol("paid in", "credit", "money in");
  const withdrawnCol = findCol("withdrawn", "debit", "money out", "paid out");
  const counterpartyCol = findCol("details", "description", "counterparty", "name", "recipient");
  const refCol = findCol("receipt", "ref", "transaction id");
  const balanceCol = findCol("balance");

  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    if (!row || row.length < 2) continue;

    const rawText = row.join(",");

    // Parse date
    let dateVal: Date | null = null;
    if (dateCol >= 0 && row[dateCol]) {
      dateVal = parseDate(row[dateCol]);
    }
    if (!dateVal) continue;

    // Parse amounts
    let amount = 0;
    let direction: "credit" | "debit" = "debit";

    if (paidInCol >= 0 && withdrawnCol >= 0) {
      const paidIn = parseAmount(row[paidInCol]);
      const withdrawn = parseAmount(row[withdrawnCol]);
      if (paidIn > 0) {
        amount = paidIn;
        direction = "credit";
      } else if (withdrawn > 0) {
        amount = withdrawn;
        direction = "debit";
      } else {
        continue;
      }
    } else if (amountCol >= 0) {
      const rawAmount = row[amountCol];
      const parsed = parseAmount(rawAmount);
      if (parsed === 0) continue;
      amount = Math.abs(parsed);
      direction = parsed > 0 ? "credit" : "debit";
    } else {
      continue;
    }

    const counterparty =
      counterpartyCol >= 0 ? row[counterpartyCol]?.trim() || "Unknown" : "Unknown";
    const reference = refCol >= 0 ? row[refCol]?.trim() || "" : "";
    const balance =
      balanceCol >= 0 ? parseAmount(row[balanceCol]) || null : null;

    transactions.push({
      date: dateVal,
      amount,
      direction,
      counterparty,
      reference,
      balance,
      rawText,
    });
  }

  if (transactions.length === 0) {
    throw new Error(
      "No valid transactions could be extracted. Please check the file format."
    );
  }

  return transactions;
}

function parseAmount(val: string | undefined): number {
  if (!val) return 0;
  // Remove currency symbols, commas, spaces
  const cleaned = val.replace(/[KSh,\s]/g, "").replace(/,/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDate(val: string): Date | null {
  if (!val) return null;
  const trimmed = val.trim();

  // Try various date formats common in Kenya M-Pesa exports
  const formats = [
    // DD/MM/YYYY HH:MM:SS
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
    // YYYY-MM-DD
    /^(\d{4})-(\d{2})-(\d{2})/,
    // DD-MM-YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})/,
    // DD MMM YYYY (e.g. 15 Jan 2024)
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/,
  ];

  // Try native Date parsing first
  const native = new Date(trimmed);
  if (!isNaN(native.getTime())) return native;

  // DD/MM/YYYY
  const ddmmyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }

  // DD-MM-YYYY
  const ddmmyyyy2 = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (ddmmyyyy2) {
    const [, d, m, y] = ddmmyyyy2;
    return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }

  return null;
}

// Generate synthetic demo transactions (used when no real file is uploaded for demo)
export function generateDemoTransactions(): ParsedTransaction[] {
  const now = new Date();
  const demo: ParsedTransaction[] = [];

  const addTransaction = (
    daysAgo: number,
    amount: number,
    direction: "credit" | "debit",
    counterparty: string,
    reference: string
  ) => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    demo.push({
      date,
      amount,
      direction,
      counterparty,
      reference,
      balance: null,
      rawText: `${counterparty},${direction === "credit" ? "+" : "-"}${amount}`,
    });
  };

  // Salary
  addTransaction(2, 85000, "credit", "EMPLOYER LTD PAYROLL", "SAL2024");
  addTransaction(32, 85000, "credit", "EMPLOYER LTD PAYROLL", "SAL2024");

  // Rent
  addTransaction(3, 22000, "debit", "LANDLORD KIAMBU RD", "RENT");
  addTransaction(33, 22000, "debit", "LANDLORD KIAMBU RD", "RENT");

  // KPLC
  addTransaction(5, 1200, "debit", "888880", "KPLC Token");
  addTransaction(35, 1100, "debit", "888880", "KPLC Token");

  // Zuku Internet
  addTransaction(8, 3500, "debit", "400222", "Zuku Internet");
  addTransaction(38, 3500, "debit", "400222", "Zuku Internet");

  // Transport / Uber
  addTransaction(2, 450, "debit", "Uber", "Ride");
  addTransaction(4, 320, "debit", "Uber", "Ride");
  addTransaction(6, 510, "debit", "Uber", "Ride");
  addTransaction(7, 280, "debit", "Bolt ride kenya", "Ride");
  addTransaction(9, 400, "debit", "Uber", "Ride");
  addTransaction(11, 350, "debit", "Uber", "Ride");
  addTransaction(14, 490, "debit", "Bolt ride kenya", "Ride");
  addTransaction(16, 360, "debit", "Uber", "Ride");

  // Naivas
  addTransaction(3, 4200, "debit", "Naivas Supermarket", "Groceries");
  addTransaction(10, 3800, "debit", "Naivas Supermarket", "Groceries");
  addTransaction(17, 4500, "debit", "Naivas Supermarket", "Groceries");
  addTransaction(24, 3600, "debit", "Naivas Supermarket", "Groceries");

  // Family
  addTransaction(5, 5000, "debit", "0722456789 MUM", "Family support");
  addTransaction(35, 5000, "debit", "0722456789 MUM", "Family support");

  // Chama
  addTransaction(10, 2000, "debit", "0712345678 CHAMA", "Monthly chama");
  addTransaction(40, 2000, "debit", "0712345678 CHAMA", "Monthly chama");

  // Unknown — Peter
  addTransaction(12, 2000, "debit", "0733123456 PETER", "Payment");
  addTransaction(42, 2000, "debit", "0733123456 PETER", "Payment");

  // Savings
  addTransaction(4, 5000, "debit", "M-Shwari", "Savings");

  // Entertainment
  addTransaction(6, 1100, "debit", "Netflix", "Subscription");
  addTransaction(36, 1100, "debit", "Netflix", "Subscription");

  // Unknown merchant
  addTransaction(7, 3200, "debit", "0798765432 GRACE", "Transfer");

  // NHIF
  addTransaction(15, 500, "debit", "NHIF", "Health Insurance");
  addTransaction(45, 500, "debit", "NHIF", "Health Insurance");

  return demo;
}
