import { Currency } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../config/database';
import { auditRepository } from '../repositories/auditRepository';
import { NotFoundError } from '../middleware/errorHandler';

export const CreateExchangeRateSchema = z.object({
  fromCurrency: z.nativeEnum(Currency),
  toCurrency: z.nativeEnum(Currency),
  rate: z.number().positive(),
  amountKzt: z.number().int().positive(),
  amountForeign: z.number().int().positive(),
});

export const currencyService = {
  /**
   * Create an immutable exchange rate snapshot.
   * NEVER update historical rows — each call creates a new record.
   * Columns: amount_kzt, amount_original, exchange_rate_at_time, locked_at_timestamp.
   */
  async lockRate(
    actorId: string,
    input: z.infer<typeof CreateExchangeRateSchema>,
  ) {
    // Immutability enforced: we only INSERT, never UPDATE
    const snapshot = await prisma.exchangeRateSnapshot.create({
      data: {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: input.rate,
        amountKzt: input.amountKzt,
        amountForeign: input.amountForeign,
        // lockedAt is set to now() by default — never changed after creation
      },
    });

    await auditRepository.create({
      actorId,
      action: 'EXCHANGE_RATE_SET',
      entityType: 'ExchangeRateSnapshot',
      entityId: snapshot.id,
      after: snapshot,
    });

    return snapshot;
  },

  /**
   * Get latest exchange rate for a currency pair.
   * Used to show users current rates before locking.
   */
  async getLatestRate(from: Currency, to: Currency) {
    const snapshot = await prisma.exchangeRateSnapshot.findFirst({
      where: { fromCurrency: from, toCurrency: to },
      orderBy: { lockedAt: 'desc' },
    });

    if (!snapshot) throw new NotFoundError(`Exchange rate for ${from}→${to}`);
    return snapshot;
  },

  async getSnapshotById(id: string) {
    const snapshot = await prisma.exchangeRateSnapshot.findUnique({ where: { id } });
    if (!snapshot) throw new NotFoundError('Exchange rate snapshot');
    return snapshot;
  },
};
