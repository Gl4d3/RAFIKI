// Thin wrapper around pdf-parse that turns a PDF buffer into an ordered
// list of text lines. Column structure for table-style statements is
// approximately preserved because pdf-parse lays text out line-by-line.

import { SourceParseError } from "./types";

export interface PdfText {
  lines: string[];
  full: string;
}

export async function extractPdfText(
  buffer: Buffer,
  sourceName: string
): Promise<PdfText> {
  if (!buffer || buffer.length === 0) {
    throw new SourceParseError(sourceName, "pdf", "the file was empty.");
  }
  const header = buffer.slice(0, 4).toString("ascii");
  if (header !== "%PDF") {
    throw new SourceParseError(
      sourceName,
      "pdf",
      "this doesn't look like a PDF file."
    );
  }

  let text: string;
  try {
    // pdf-parse v2 exposes a PDFParse class. Feed it a Uint8Array copy
    // (pdfjs takes ownership of the buffer).
    const mod: any = await import("pdf-parse");
    const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
    if (!PDFParse) {
      throw new Error("pdf-parse module missing PDFParse export");
    }
    const data = new Uint8Array(buffer);
    const parser = new PDFParse({ data });
    const result = await parser.getText();
    text = (result && (result.text as string)) || "";
  } catch (err: any) {
    throw new SourceParseError(
      sourceName,
      "pdf",
      `we couldn't read the PDF (${err?.message || "unknown error"}).`
    );
  }

  if (!text.trim()) {
    throw new SourceParseError(
      sourceName,
      "pdf",
      "the PDF had no extractable text (it may be a scanned image)."
    );
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/g, "").replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0);

  return { lines, full: text };
}
