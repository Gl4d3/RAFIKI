// Shared parsing helpers used by CSV / PDF / SMS parsers.

export function parseAmount(val: string | undefined | null): number {
  if (val === undefined || val === null) return 0;
  const s = String(val).trim();
  if (!s) return 0;
  // Strip common currency prefixes ("Ksh", "KSh", "KES") and thousand separators.
  const cleaned = s
    .replace(/(?:ksh|kes)\.?/gi, "")
    .replace(/[, ]/g, "")
    .trim();
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

// Parse dates used by M-Pesa exports:
//  - ISO-ish: "2024-01-15 14:30:22" or "2024-01-15T14:30:22"
//  - DD/MM/YYYY (HH:MM[:SS])
//  - DD-MM-YYYY
//  - DD MMM YYYY (or D/M/YY from SMS)
export function parseDate(val: string | undefined | null): Date | null {
  if (!val) return null;
  const trimmed = String(val).trim();
  if (!trimmed) return null;

  // ISO-ish "YYYY-MM-DD HH:MM:SS"
  const iso = trimmed.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (iso) {
    const [, y, m, d, h, min, s] = iso;
    return new Date(Date.UTC(+y, +m - 1, +d, +h, +min, s ? +s : 0));
  }

  // "YYYY-MM-DD"
  const isoDate = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDate) {
    const [, y, m, d] = isoDate;
    return new Date(Date.UTC(+y, +m - 1, +d));
  }

  // "DD/MM/YYYY HH:MM[:SS]" or "DD/MM/YY HH:MM"
  const slash = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (slash) {
    const [, d, m, y, h, min, s] = slash;
    const year = y.length === 2 ? 2000 + +y : +y;
    return new Date(Date.UTC(year, +m - 1, +d, h ? +h : 0, min ? +min : 0, s ? +s : 0));
  }

  // "DD-MM-YYYY"
  const dash = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dash) {
    const [, d, m, y] = dash;
    return new Date(Date.UTC(+y, +m - 1, +d));
  }

  // Fallback: native Date parser. It handles "15 Jan 2024" and similar.
  const native = new Date(trimmed);
  if (!isNaN(native.getTime())) return native;

  return null;
}

// Parse M-Pesa SMS time like "4:30 PM" (12h) or "16:30" (24h).
export function parseSmsTime(raw: string): { h: number; m: number } | null {
  const t = raw.trim();
  const m12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = +m12[1] % 12;
    if (/pm/i.test(m12[3])) h += 12;
    return { h, m: +m12[2] };
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return { h: +m24[1], m: +m24[2] };
  return null;
}
