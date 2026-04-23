// Backwards-compatible façade.
// All real parsing logic now lives under `server/parsers/*`. This module
// re-exports the types and the synchronous CSV parser, plus the demo
// generator, so existing imports keep working.

export type { ParsedTransaction } from "./parsers/types";
export { SourceParseError } from "./parsers/types";
export { parseSource } from "./parsers/index";
export { parseMpesaCsv } from "./parsers/mpesa-csv";
export { parseMpesaPdf } from "./parsers/mpesa-pdf";
export { parseMpesaSms } from "./parsers/mpesa-sms";

import type { ParsedTransaction } from "./parsers/types";

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
      counterpartyPhone: null,
      reference,
      balance: null,
      transactionCost: null,
      currency: "KES",
      rawText: `${counterparty},${direction === "credit" ? "+" : "-"}${amount}`,
      sourceType: "csv",
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
