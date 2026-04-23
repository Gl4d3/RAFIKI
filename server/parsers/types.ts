// Shared parser types.
// ParsedTransaction is the normalised shape every parser emits,
// regardless of whether the source was CSV, PDF, or pasted SMS text.

export type TransactionDirection = "credit" | "debit";
export type ParserSourceKind = "csv" | "pdf" | "sms";

export interface ParsedTransaction {
  date: Date;
  amount: number;
  direction: TransactionDirection;
  counterparty: string;
  counterpartyPhone?: string | null;
  reference: string;
  balance: number | null;
  transactionCost?: number | null;
  currency: string;
  rawText: string;
  sourceType?: ParserSourceKind;
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
