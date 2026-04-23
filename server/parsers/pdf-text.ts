// PDF text extraction using pdf2json.
//
// pdf2json is a pure-JavaScript PDF parser with no browser globals, no
// worker threads, and no pdfjs-dist dependency. This replaces the previous
// pdfjs-dist approach which caused persistent "API version mismatch" or
// "fake worker failed" errors in the tsx / Node.js server context.

import PDFParser from "pdf2json";
import { SourceParseError } from "./types";

export interface PdfText {
  lines: string[];
  full: string;
}

interface Pdf2JsonPage {
  Texts: { x: number; y: number; R: { T: string }[] }[];
}

interface Pdf2JsonData {
  Pages: Pdf2JsonPage[];
}

function parsePdfBuffer(buffer: Buffer): Promise<Pdf2JsonData> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = new (PDFParser as any)(null, 1);
    parser.on("pdfParser_dataError", (e: { parserError: Error }) =>
      reject(e.parserError)
    );
    parser.on("pdfParser_dataReady", (data: Pdf2JsonData) => resolve(data));
    parser.parseBuffer(buffer);
  });
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

  let pdfData: Pdf2JsonData;
  try {
    pdfData = await parsePdfBuffer(buffer);
  } catch (err: unknown) {
    if (err instanceof SourceParseError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new SourceParseError(
      sourceName,
      "pdf",
      `we couldn't read the PDF (${msg}).`
    );
  }

  if (!pdfData.Pages || pdfData.Pages.length === 0) {
    throw new SourceParseError(
      sourceName,
      "pdf",
      "the PDF had no extractable text (it may be a scanned image)."
    );
  }

  const allLines: string[] = [];

  for (const page of pdfData.Pages) {
    if (!page.Texts || page.Texts.length === 0) continue;

    // Group text items by Y coordinate (rounded to nearest 0.1 units) so
    // items on the same visual row are joined into one line.
    const yBuckets = new Map<number, { x: number; str: string }[]>();

    for (const item of page.Texts) {
      const text = item.R.map((run) => {
        try {
          return decodeURIComponent(run.T);
        } catch {
          return run.T;
        }
      }).join("");

      if (!text.trim()) continue;

      // Round to nearest 0.1 to bucket same-row items together.
      const bucket = Math.round(item.y * 10) / 10;
      if (!yBuckets.has(bucket)) yBuckets.set(bucket, []);
      yBuckets.get(bucket)!.push({ x: item.x, str: text });
    }

    // pdf2json uses top-down Y (unlike pdfjs), so sort Y ascending for
    // top-of-page-first order. Sort X ascending within each row.
    const sortedYs = Array.from(yBuckets.keys()).sort((a, b) => a - b);
    for (const y of sortedYs) {
      const items = yBuckets.get(y)!.sort((a, b) => a.x - b.x);
      const lineText = items
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (lineText) allLines.push(lineText);
    }
  }

  if (allLines.length === 0) {
    throw new SourceParseError(
      sourceName,
      "pdf",
      "the PDF had no extractable text (it may be a scanned image)."
    );
  }

  const lines = allLines
    .map((l) => l.replace(/\s+$/g, "").replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0);

  return { lines, full: lines.join("\n") };
}
