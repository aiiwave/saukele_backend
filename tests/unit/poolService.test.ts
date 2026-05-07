/**
 * Unit tests for pool service business logic.
 * Mocks Prisma to test pure logic without a real database.
 */

import { calculateProRataRefunds } from '../../src/utils/currency';
import { validateContributionAmount } from '../../src/utils/currency';

describe('calculateProRataRefunds', () => {
  it('distributes refund proportionally', () => {
    const contributions = [
      { id: 'c1', amountKzt: 50000 },  // 50% of 100,000
      { id: 'c2', amountKzt: 30000 },  // 30%
      { id: 'c3', amountKzt: 20000 },  // 20%
    ];
    const refundableTotal = 90000; // e.g. 10% platform fee kept

    const result = calculateProRataRefunds(contributions, refundableTotal);

    expect(result).toHaveLength(3);
    expect(result[0].refundAmountKzt).toBe(45000); // 50% of 90,000
    expect(result[1].refundAmountKzt).toBe(27000); // 30% of 90,000
    // Last item gets remainder to avoid rounding loss
    const total = result.reduce((s, r) => s + r.refundAmountKzt, 0);
    expect(total).toBe(refundableTotal);
  });

  it('returns 0 for all when refundableTotal is 0', () => {
    const contributions = [
      { id: 'c1', amountKzt: 10000 },
      { id: 'c2', amountKzt: 20000 },
    ];
    const result = calculateProRataRefunds(contributions, 0);
    expect(result.every((r) => r.refundAmountKzt === 0)).toBe(true);
  });

  it('handles single contributor', () => {
    const contributions = [{ id: 'c1', amountKzt: 100000 }];
    const result = calculateProRataRefunds(contributions, 95000);
    expect(result[0].refundAmountKzt).toBe(95000);
  });
});

describe('validateContributionAmount', () => {
  it('accepts valid positive integer', () => {
    expect(() => validateContributionAmount(50000)).not.toThrow();
  });

  it('rejects zero', () => {
    expect(() => validateContributionAmount(0)).toThrow('Amount must be positive');
  });

  it('rejects negative', () => {
    expect(() => validateContributionAmount(-100)).toThrow('Amount must be positive');
  });

  it('rejects non-integer', () => {
    expect(() => validateContributionAmount(100.5)).toThrow('Amount must be an integer');
  });

  it('rejects amounts over 1 billion KZT', () => {
    expect(() => validateContributionAmount(1_000_000_001_00)).toThrow('maximum');
  });
});
