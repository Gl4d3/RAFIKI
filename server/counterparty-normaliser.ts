// Counterparty normalisation for bank-statement narratives.
//
// Bank card-payment narratives bundle merchant + branch code + location code
// + reference tail. We strip the noise so repeated visits to the same
// supermarket chain aggregate to a single counterparty.
//
// Examples:
//   "CHANDARANA SUPER727393 AIROBI0327 203601PRCR5506" -> "Chandarana"
//   "CHANDARANA FOODPLUS CH NAIROB0330 183929PRCR5506" -> "Chandarana"
//   "CHANDARANA NGARA NAIROB0331 124316PRCR5506"       -> "Chandarana"
//   "Spotify    Stockh0326 023803PRCR5506"             -> "Spotify"
//   "Google CLOUD F4QzK3 Dublin0326 114255PRCR5506"    -> "Google Cloud"
//   "PesaPal*Century Cinema Nairob0326 193419PRCR5506" -> "PesaPal Century Cinema"
//   "MICROSOFT*STORE MSBILL0302 103419PRCR5506"        -> "Microsoft Store"
//   "254728125443/MPESA Payment to 254728125443"       -> "254728125443"
//   "01192274659800/Rent Payment"                      -> "01192274659800"
//   "CTS/EFT CR BO INDRA LIMITED"                      -> "INDRA LIMITED"
//   "00204980506150/"                                  -> "00204980506150"

// Known card-payment merchant chains. The first match wins, mapped to its
// canonical display name.
const CHAIN_PATTERNS: { pattern: RegExp; canonical: string }[] = [
  { pattern: /\bchandarana\b/i, canonical: "Chandarana" },
  { pattern: /\bnaivas\b/i, canonical: "Naivas" },
  { pattern: /\bcarrefour\b/i, canonical: "Carrefour" },
  { pattern: /\bquickmart\b/i, canonical: "Quickmart" },
  { pattern: /\btuskys\b/i, canonical: "Tuskys" },
  { pattern: /\bartcaffe\b|\bart caffe\b/i, canonical: "Artcaffe" },
  { pattern: /\bjava\s*house\b/i, canonical: "Java House" },
  { pattern: /\bnetflix\b/i, canonical: "Netflix" },
  { pattern: /\bspotify\b/i, canonical: "Spotify" },
  { pattern: /\bshowmax\b/i, canonical: "Showmax" },
  { pattern: /\bgoogle\b/i, canonical: "Google" },
  { pattern: /\bmicrosoft\b/i, canonical: "Microsoft" },
  { pattern: /\bpesapal\b/i, canonical: "PesaPal" },
  { pattern: /\buber\b/i, canonical: "Uber" },
  { pattern: /\bbolt\b/i, canonical: "Bolt" },
];

export function normaliseBankCounterparty(narrative: string): string {
  const text = narrative.trim();
  if (!text) return "Unknown";

  // 1) MPESA-via-bank: "<id>/MPESA Payment to <id>" — counterparty is the id.
  const mpesa = text.match(/^(\d{4,15})\/MPESA Payment\b/i);
  if (mpesa) return mpesa[1];

  // 2) Rent / utility paybill: "<paybill>/Rent Payment" or similar verb.
  const paybillNarr = text.match(/^(\d{6,15})\/([A-Za-z][A-Za-z ]+?)(?:\s|$)/);
  if (paybillNarr) return paybillNarr[1];

  // 3) EFT credits: "CTS/EFT CR BO <EMPLOYER>" or "RTGS/EFT CR ..." — the
  //    employer is the meaningful counterparty.
  const eft = text.match(/(?:CTS|RTGS|EFT)[\/ ]EFT(?:\s+CR)?\s+(?:BO\s+)?(.+?)(?:\s{2,}|$)/i);
  if (eft) return eft[1].trim();

  // 4) Bare "<account>/" deposit — internal/own-account ref.
  const bareAcct = text.match(/^(\d{6,20})\/\s*$/);
  if (bareAcct) return bareAcct[1];

  // 5) Card payment: try to match a known chain first.
  for (const { pattern, canonical } of CHAIN_PATTERNS) {
    if (pattern.test(text)) return canonical;
  }

  // 6) Fallback for card payments: take the head of the narrative before the
  //    location/date stamp pattern (e.g. "AIROBI0327"), then strip trailing
  //    digit-suffixes from words ("SUPER727393" -> "SUPER").
  let head = text.split(/\s+[A-Z][A-Za-z]{3,}\d{3,}/)[0]; // cut before "AIROBI0327"-style stamp
  head = head.replace(/\s+\d{4,}.*$/, ""); // drop trailing numeric tails
  head = head.replace(/[*_/]+/g, " "); // PesaPal*Century -> PesaPal Century
  head = head.replace(/\b([A-Z][A-Za-z]+?)\d{3,}\b/g, "$1"); // SUPER727393 -> SUPER
  head = head.replace(/\s+/g, " ").trim();
  if (!head) return text;

  return toTitleCaseIfShouting(head);
}

function toTitleCaseIfShouting(s: string): string {
  // Only re-case if the string is mostly uppercase — preserves brand casing
  // like "PesaPal" or "iHub".
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters) return s;
  const upper = letters.replace(/[^A-Z]/g, "");
  if (upper.length / letters.length < 0.7) return s;
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
