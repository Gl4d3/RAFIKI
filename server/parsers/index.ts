// Source dispatcher — inspects an input and routes it to the right parser.
// This is the single call site used by the analysis pipeline.

import { parseMpesaCsv } from "./mpesa-csv";
import { parseMpesaPdf } from "./mpesa-pdf";
import { parseMpesaSms } from "./mpesa-sms";
import { parseBankPdf } from "../bank-pdf-parser";
import type { ParseSourceInput, ParsedTransaction } from "./types";
import { SourceParseError } from "./types";

function tagMpesa(txs: ParsedTransaction[]): ParsedTransaction[] {
  return txs.map((t) => ({ ...t, source: "mpesa" as const }));
}

async function runBankPdf(
  buffer: Buffer,
  sourceName: string
): Promise<ParsedTransaction[]> {
  try {
    const txs = await parseBankPdf(buffer);
    // Bank parser returns the legacy ParsedTransaction shape; coerce
    // missing optional fields and tag the channel.
    return txs.map((t: any) => ({
      currency: "KES",
      ...t,
      source: "bank" as const,
      sourceType: "bank-pdf" as const,
    })) as ParsedTransaction[];
  } catch (err: any) {
    throw new SourceParseError(sourceName, "pdf", err?.message ?? String(err));
  }
}

export { SourceParseError } from "./types";
export type { ParsedTransaction, ParseSourceInput } from "./types";

function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.slice(0, 4).toString("ascii") === "%PDF";
}

function looksLikeCsv(buffer: Buffer): boolean {
  // Heuristic: printable ASCII with at least one comma in the first 2 KB.
  const sample = buffer.slice(0, 2048).toString("utf-8");
  return sample.includes(",") && /[A-Za-z]/.test(sample);
}

export async function parseSource(
  input: ParseSourceInput
): Promise<ParsedTransaction[]> {
  const sourceName = input.sourceName || defaultSourceName(input);

  if (input.kind === "csv") {
    return tagMpesa(parseMpesaCsv(input.buffer, sourceName));
  }
  if (input.kind === "pdf") {
    return tagMpesa(await parseMpesaPdf(input.buffer, sourceName));
  }
  if (input.kind === "sms") {
    return tagMpesa(parseMpesaSms(input.text, sourceName));
  }
  if (input.kind === "bank") {
    return runBankPdf(input.buffer, sourceName);
  }

  // Auto-detect (M-Pesa only — bank statements must be uploaded with kind:"bank").
  if (input.buffer && input.buffer.length > 0) {
    const fname = (input.fileName || "").toLowerCase();
    if (looksLikePdf(input.buffer) || fname.endsWith(".pdf")) {
      return tagMpesa(await parseMpesaPdf(input.buffer, sourceName));
    }
    if (looksLikeCsv(input.buffer) || fname.endsWith(".csv")) {
      return tagMpesa(parseMpesaCsv(input.buffer, sourceName));
    }
    throw new SourceParseError(
      sourceName,
      "unknown",
      "we couldn't tell whether this file is a CSV or PDF. Please re-upload it."
    );
  }

  if (input.text && input.text.trim()) {
    return tagMpesa(parseMpesaSms(input.text, sourceName));
  }

  throw new SourceParseError(
    sourceName,
    "unknown",
    "no file or SMS text was provided."
  );
}

function defaultSourceName(input: ParseSourceInput): string {
  if (input.kind === "sms" || (input.kind === "auto" && input.text)) {
    return "M-Pesa SMS";
  }
  return "M-Pesa statement";
}
