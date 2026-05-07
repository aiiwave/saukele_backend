/**
 * Currency utilities for Saukele.
 * All monetary values are stored as integers in tiyn (1 KZT = 100 tiyn).
 * This avoids floating-point precision errors in financial calculations.
 */

/** Convert KZT (float) to tiyn (int storage unit) */
export function kztToTiyn(kzt: number): number {
  return Math.round(kzt * 100);
}

/** Convert tiyn (int) back to KZT display value */
export function tiynToKzt(tiyn: number): number {
  return tiyn / 100;
}

/** Format tiyn as a human-readable KZT string */
export function formatKzt(tiyn: number): string {
  return new Intl.NumberFormat('kk-KZ', {
    style: 'currency',
    currency: 'KZT',
    minimumFractionDigits: 0,
  }).format(tiynToKzt(tiyn));
}

/**
 * Convert a foreign currency amount to KZT tiyn using a locked exchange rate.
 * @param foreignAmount - Amount in the foreign currency's smallest unit (e.g. cents for USD)
 * @param rate - Exchange rate: how many KZT per 1 foreign unit
 * @returns Amount in KZT tiyn
 */
export function convertToKztTiyn(foreignAmount: number, rate: number): number {
  // foreignAmount is in foreign "tiyn" (cents for USD/EUR)
  // rate is KZT per 1 foreign major unit (e.g. 1 USD = 460 KZT)
  return Math.round((foreignAmount / 100) * rate * 100);
}

/**
 * Calculate pro-rata refund amounts for pool contributions.
 * Returns the per-contributor refund as tiyn, distributing any rounding remainder
 * to the first contributor.
 */
export function calculateProRataRefunds(
  contributions: Array<{ id: string; amountKzt: number }>,
  refundableTotal: number,
): Array<{ id: string; refundAmountKzt: number }> {
  const totalContributed = contributions.reduce((sum, c) => sum + c.amountKzt, 0);
  if (totalContributed === 0) return contributions.map((c) => ({ id: c.id, refundAmountKzt: 0 }));

  let remainingRefund = refundableTotal;
  const result = contributions.map((c, i) => {
    const share = c.amountKzt / totalContributed;
    const refundAmountKzt =
      i === contributions.length - 1
        ? remainingRefund // last one gets the remainder to avoid rounding loss
        : Math.floor(refundableTotal * share);
    remainingRefund -= refundAmountKzt;
    return { id: c.id, refundAmountKzt };
  });

  return result;
}

/** Validate that a contribution amount is positive and within reasonable bounds */
export function validateContributionAmount(tiyn: number): void {
  if (!Number.isInteger(tiyn)) throw new Error('Amount must be an integer (tiyn)');
  if (tiyn <= 0) throw new Error('Amount must be positive');
  if (tiyn > 1_000_000_000_00) throw new Error('Amount exceeds maximum allowed value'); // 1B KZT
}
