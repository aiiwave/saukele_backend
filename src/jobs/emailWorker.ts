/**
 * Email worker process. Run separately from the API:
 *   npm run worker
 *
 * Consumes jobs from the `email` queue (Redis) and sends them via nodemailer.
 * In EMAIL_DEV_MODE, emails are logged to console instead of being sent.
 */

import { getEmailQueue, closeEmailQueue } from './emailQueue';
import { sendEmail } from '../services/emailService';
import { connectRedis, disconnectRedis } from '../config/redis';
import { logger } from '../utils/logger';

async function main(): Promise<void> {
  await connectRedis();

  const queue = getEmailQueue();

  // Process up to 5 jobs concurrently
  queue.process(5, async (job) => {
    logger.info('Processing email job', { id: job.id, type: job.data.type });
    await sendEmail(job.data);
    return { ok: true };
  });

  logger.info('📬 Email worker started — listening on queue: email');
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down email worker`);
  await closeEmailQueue();
  await disconnectRedis();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  logger.error('Email worker failed to start', { err });
  process.exit(1);
});
