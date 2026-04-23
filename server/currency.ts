// Currency normalisation.
// Every transaction we feed into the Accountant is in KSh. When a source
// reports a different currency (e.g. a bank statement column in USD), we
// convert here at parse time and preserve the original amount + currency
// on the transaction so we can show the user the raw figure if they ask.
//
// TODO(rates): replace this hardcoded fallback table with a live FX feed
// (e.g. the Central Bank of Kenya daily indicative rate). Until then we
// use sane round-number fallbacks and clearly tag converted amounts.

export const KSH_PER_UNIT_FALLBACK: Record<string, number> = {
  KES: 1,
  KSH: 1,
  USD: 130, // ~Apr 2026 indicative
  EUR: 145,
  GBP: 170,
  ZAR: 7,
  UGX: 0.035,
  TZS: 0.05,
};

export interface NormalisedAmount {
  amount: number; // KSh
  currency: "KES";
  originalAmount: number;
  originalCurrency: string;
  fxRate: number;
}

// Normalise an amount to KSh. Unknown currencies fall back to 1:1 with a
// console warning rather than throwing — we'd rather show a slightly off
// figure than fail the whole pipeline.
export function normaliseToKsh(
  amount: number,
  currency: string | undefined | null
): NormalisedAmount {
  const code = (currency || "KES").trim().toUpperCase();
  const rate = KSH_PER_UNIT_FALLBACK[code];
  if (rate === undefined) {
    console.warn(
      `Unknown currency "${code}" — falling back to 1:1 with KSh. ` +
        `Add it to KSH_PER_UNIT_FALLBACK in server/currency.ts.`
    );
    return {
      amount,
      currency: "KES",
      originalAmount: amount,
      originalCurrency: code,
      fxRate: 1,
    };
  }
  return {
    amount: Math.round(amount * rate * 100) / 100,
    currency: "KES",
    originalAmount: amount,
    originalCurrency: code,
    fxRate: rate,
  };
}
