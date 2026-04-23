// Source dispatcher — inspects an input and routes it to the right parser.
// This is the single call site used by the analysis pipeline.

import { parseMpesaCsv } from "./mpesa-csv";
import { parseMpesaPdf } from "./mpesa-pdf";
import { parseMpesaSms } from "./mpesa-sms";
import type { ParseSourceInput, ParsedTransaction } from "./types";
import { SourceParseError } from "./types";

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
    return parseMpesaCsv(input.buffer, sourceName);
  }
  if (input.kind === "pdf") {
    return parseMpesaPdf(input.buffer, sourceName);
  }
  if (input.kind === "sms") {
    return parseMpesaSms(input.text, sourceName);
  }

  // Auto-detect.
  if (input.buffer && input.buffer.length > 0) {
    const fname = (input.fileName || "").toLowerCase();
    if (looksLikePdf(input.buffer) || fname.endsWith(".pdf")) {
      return parseMpesaPdf(input.buffer, sourceName);
    }
    if (looksLikeCsv(input.buffer) || fname.endsWith(".csv")) {
      return parseMpesaCsv(input.buffer, sourceName);
    }
    throw new SourceParseError(
      sourceName,
      "unknown",
      "we couldn't tell whether this file is a CSV or PDF. Please re-upload it."
    );
  }

  if (input.text && input.text.trim()) {
    return parseMpesaSms(input.text, sourceName);
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
