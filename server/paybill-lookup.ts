// Hardcoded lookup table of known Kenyan paybill numbers and merchants
// Maps normalized counterparty strings to category and tier

export interface KnownEntity {
  category: string;
  tier: string;
  label: string;
}

export const KNOWN_PAYBILLS: Record<string, KnownEntity> = {
  // Utilities - Tier 1
  "888880": { category: "utilities", tier: "1", label: "KPLC Prepaid" },
  "888888": { category: "utilities", tier: "1", label: "KPLC Postpaid" },
  "888882": { category: "utilities", tier: "1", label: "KPLC Token" },
  "207799": { category: "utilities", tier: "1", label: "Nairobi Water" },
  "200222": { category: "utilities", tier: "1", label: "Nairobi City Water" },
  "623423": { category: "utilities", tier: "1", label: "KPLC" },
  // Internet / Communications - Tier 1
  "522522": { category: "utilities", tier: "1", label: "Safaricom Postpaid" },
  "400222": { category: "utilities", tier: "1", label: "Zuku" },
  "290290": { category: "utilities", tier: "1", label: "Safaricom Fiber" },
  // Transport - Tier 1
  "898630": { category: "transport", tier: "1", label: "Uber" },
  "898631": { category: "transport", tier: "1", label: "Bolt" },
  "5057000": { category: "transport", tier: "1", label: "Little Cab" },
  // Food / Groceries - Tier 1
  "200000": { category: "food", tier: "1", label: "Naivas Supermarket" },
  "4069": { category: "food", tier: "1", label: "Carrefour" },
  "290600": { category: "food", tier: "1", label: "Quickmart" },
  "220220": { category: "food", tier: "1", label: "Tuskys" },
  // Healthcare - Tier 1
  "321321": { category: "healthcare", tier: "1", label: "NHIF" },
  "200999": { category: "healthcare", tier: "1", label: "Kenyatta Hospital" },
  // Savings / Financial - Tier 3
  "400200": { category: "savings", tier: "3", label: "M-Shwari" },
  "401400": { category: "savings", tier: "3", label: "KCB M-Pesa" },
  "811811": { category: "savings", tier: "3", label: "Fuliza Repayment" },
  "333222": { category: "savings", tier: "3", label: "Equity Bank" },
  "125125": { category: "savings", tier: "3", label: "Co-op Bank" },
  "109109": { category: "savings", tier: "3", label: "NCBA" },
};

// Known merchant name patterns (partial match on counterparty string)
export const KNOWN_MERCHANT_PATTERNS: {
  pattern: RegExp;
  entity: KnownEntity;
}[] = [
  // Rent / Housing
  {
    pattern: /rent|landlord|bedsitter|apartment|house\s*pay|housing/i,
    entity: { category: "rent", tier: "1", label: "Rent" },
  },
  // Utilities
  {
    pattern: /kplc|kenya power/i,
    entity: { category: "utilities", tier: "1", label: "KPLC" },
  },
  {
    pattern: /nairobi water/i,
    entity: { category: "utilities", tier: "1", label: "Nairobi Water" },
  },
  {
    pattern: /zuku/i,
    entity: { category: "utilities", tier: "1", label: "Zuku" },
  },
  {
    pattern: /safaricom\s*(postpaid|fiber|home|broadband)/i,
    entity: { category: "utilities", tier: "1", label: "Safaricom Postpaid" },
  },
  {
    pattern: /airtel\s*(data|bundle|postpaid)/i,
    entity: { category: "utilities", tier: "1", label: "Airtel" },
  },
  // Transport
  {
    pattern: /uber/i,
    entity: { category: "transport", tier: "1", label: "Uber" },
  },
  {
    pattern: /bolt\s*(ride|kenya)/i,
    entity: { category: "transport", tier: "1", label: "Bolt" },
  },
  {
    pattern: /little\s*cab/i,
    entity: { category: "transport", tier: "1", label: "Little Cab" },
  },
  {
    pattern: /fuel|petrol|shell|total energies|kenol/i,
    entity: { category: "transport", tier: "1", label: "Fuel" },
  },
  // Food / Groceries
  {
    pattern: /naivas/i,
    entity: { category: "food", tier: "1", label: "Naivas" },
  },
  {
    pattern: /carrefour/i,
    entity: { category: "food", tier: "1", label: "Carrefour" },
  },
  {
    pattern: /quickmart/i,
    entity: { category: "food", tier: "1", label: "Quickmart" },
  },
  {
    pattern: /tuskys/i,
    entity: { category: "food", tier: "1", label: "Tuskys" },
  },
  {
    pattern: /java\s*house/i,
    entity: { category: "entertainment", tier: "4", label: "Java House" },
  },
  {
    pattern: /artcaffe|art caffe/i,
    entity: { category: "entertainment", tier: "4", label: "Artcaffe" },
  },
  {
    pattern: /kfc|burger\s*king|pizza\s*(inn|hut)|subway/i,
    entity: { category: "food", tier: "4", label: "Fast Food" },
  },
  {
    pattern: /glovo|jumia\s*food|uber\s*eats/i,
    entity: { category: "food", tier: "4", label: "Food Delivery" },
  },
  // Healthcare
  {
    pattern: /nhif/i,
    entity: { category: "healthcare", tier: "1", label: "NHIF" },
  },
  {
    pattern: /pharmacy|chemist|dawa/i,
    entity: { category: "healthcare", tier: "1", label: "Pharmacy" },
  },
  // Savings / Financial
  {
    pattern: /m.?shwari/i,
    entity: { category: "savings", tier: "3", label: "M-Shwari" },
  },
  {
    pattern: /kcb\s*m.?pesa/i,
    entity: { category: "savings", tier: "3", label: "KCB M-Pesa" },
  },
  {
    pattern: /fuliza/i,
    entity: { category: "savings", tier: "3", label: "Fuliza Repayment" },
  },
  // Entertainment
  {
    pattern: /netflix/i,
    entity: { category: "entertainment", tier: "4", label: "Netflix" },
  },
  {
    pattern: /showmax/i,
    entity: { category: "entertainment", tier: "4", label: "Showmax" },
  },
  {
    pattern: /dstv|gotv/i,
    entity: { category: "entertainment", tier: "4", label: "DStv/GOtv" },
  },
  {
    pattern: /spotify/i,
    entity: { category: "entertainment", tier: "4", label: "Spotify" },
  },
  // Education
  {
    pattern: /school\s*fees?|tuition|college|university/i,
    entity: { category: "education", tier: "2", label: "School Fees" },
  },
  // Income patterns
  {
    pattern: /salary|payroll|payslip/i,
    entity: { category: "income", tier: "1", label: "Salary" },
  },
];

export function resolveCounterparty(
  counterparty: string
): KnownEntity | null {
  // Check paybill lookup first (exact match on numeric)
  const trimmed = counterparty.trim().replace(/\s+/g, "");
  if (KNOWN_PAYBILLS[trimmed]) {
    return KNOWN_PAYBILLS[trimmed];
  }

  // Check pattern matching
  for (const { pattern, entity } of KNOWN_MERCHANT_PATTERNS) {
    if (pattern.test(counterparty)) {
      return entity;
    }
  }

  return null;
}
