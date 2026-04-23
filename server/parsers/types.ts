// Shared parser types.
// ParsedTransaction is the normalised shape every parser emits,
// regardless of whether the source was CSV, PDF, or pasted SMS text.

export type TransactionDirection = "credit" | "debit";
export type ParserSourceKind = "csv" | "pdf" | "sms" | "bank-pdf";
// Which "account" the transaction came from. M-Pesa wallet vs bank account.
// Used by Stage B's cross-source dedup pass to recognise internal
// transfers (e.g. bank debit → M-Pesa credit on the same day).
export type AccountKind = "mpesa" | "bank";

export interface ParsedTransaction {
  date: Date;
  amount: number; // always in KSh after currency normalisation
  direction: TransactionDirection;
  counterparty: string;
  counterpartyPhone?: string | null;
  reference: string;
  balance: number | null;
  transactionCost?: number | null;
  currency: string; // post-normalisation currency, always "KES"
  rawText: string;
  sourceType?: ParserSourceKind;
  // Bank-statement extras (set by the bank-PDF parser only).
  fees?: { charge: number; excise: number };
  // Filled in by the Accountant after cross-source analysis OR by the
  // Stage B mark_internal_transfer tool call.
  isInternalTransfer?: boolean;
  // Channel — distinguishes M-Pesa entries from bank entries downstream.
  // Defaults to "mpesa" when omitted. (Older code referred to this as
  // "accountKind"; both names mean the same thing.)
  source?: AccountKind;
  // Preserved when a non-KSh source is normalised to KSh.
  originalAmount?: number | null;
  originalCurrency?: string | null;
  fxRate?: number | null;
  // Friendly label of the upload this transaction came from
  // (e.g. "M-Pesa statement (April.csv)").
  sourceName?: string | null;
}

// Input accepted by the source dispatcher.
// Exactly one of `buffer` / `text` is needed depending on kind.
export type ParseSourceInput =
  | {
      kind: "csv";
      buffer: Buffer;
      fileName?: string | null;
      sourceName?: string;
    }
  | {
      kind: "pdf";
      buffer: Buffer;
      fileName?: string | null;
      sourceName?: string;
    }
  | {
      kind: "sms";
      text: string;
      sourceName?: string;
    }
  | {
      kind: "auto";
      buffer?: Buffer;
      text?: string;
      fileName?: string | null;
      sourceName?: string;
    }
  | {
      // Bank statement PDF (e.g. I&M Bank). Routed to the bank-PDF parser
      // and tagged with `source: "bank"` so downstream stages can
      // distinguish bank entries from M-Pesa entries.
      kind: "bank";
      buffer: Buffer;
      fileName?: string | null;
      sourceName?: string;
    };

// Error raised when a specific source can't be parsed.
// `sourceName` lets the UI surface something like
// "Couldn't read your M-Pesa statement: ...".
export class SourceParseError extends Error {
  readonly sourceName: string;
  readonly kind: ParserSourceKind | "unknown";

  constructor(sourceName: string, kind: ParserSourceKind | "unknown", message: string) {
    super(`Couldn't read your ${sourceName}: ${message}`);
    this.name = "SourceParseError";
    this.sourceName = sourceName;
    this.kind = kind;
  }
}
