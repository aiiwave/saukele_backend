import cron from 'node-cron';
import { registryRepository } from '../repositories/registryRepository';
import { registryService } from '../services/registryService';
import { logger } from '../utils/logger';

/**
 * Daily cron: mark registries as expired if weddingDate was 90+ days ago.
 * Runs at 00:05 UTC every day.
 */
export function startRegistryExpiryCron(): void {
  cron.schedule('5 0 * * *', async () => {
    logger.info('Running registry expiry cron job');
    try {
      const expiring = await registryRepository.findExpiring();
      logger.info(`Found ${expiring.length} registries to expire`);

      const SYSTEM_ACTOR_ID = 'system'; // placeholder — use a real admin ID in production

      for (const registry of expiring) {
        try {
          await registryService.expire(registry.id, SYSTEM_ACTOR_ID);
          logger.info(`Expired registry ${registry.id}`);
        } catch (err) {
          logger.error(`Failed to expire registry ${registry.id}`, { err });
        }
      }
    } catch (err) {
      logger.error('Registry expiry cron failed', { err });
    }
  });

  logger.info('Registry expiry cron scheduled (daily at 00:05 UTC)');
}
