import Bull, { Job, Queue } from 'bull';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Email job payloads. Each `type` corresponds to a template rendered in the worker.
 */
export type EmailJobData =
  | {
      type: 'EMAIL_VERIFICATION';
      to: string;
      payload: { verifyUrl: string; expiresInHours: number };
    }
  | {
      type: 'PASSWORD_RESET';
      to: string;
      payload: { resetUrl: string; expiresInMinutes: number };
    }
  | {
      type: 'REGISTRY_CREATED';
      to: string;
      payload: { registryTitle: string; registryUrl: string };
    }
  | {
      type: 'CONTRIBUTION_RECEIVED';
      to: string;
      payload: { giftTitle: string; amountKzt: number; contributorEmail?: string };
    }
  | {
      type: 'PAYMENT_CONFIRMATION';
      to: string;
      payload: { giftTitle: string; amountKzt: number; transactionId: string };
    };

let emailQueue: Queue<EmailJobData> | null = null;

/**
 * Lazily build/return the singleton email queue.
 * Bull connects to Redis using the same REDIS_URL the rest of the app uses.
 */
export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    emailQueue = new Bull<EmailJobData>('email', env.REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });

    emailQueue.on('error', (err) => logger.error('Email queue error', { err: err.message }));
    emailQueue.on('failed', (job: Job<EmailJobData>, err) =>
      logger.warn('Email job failed', { id: job.id, type: job.data.type, err: err.message }),
    );
  }
  return emailQueue;
}

/** Enqueue an email job. Returns once the job is persisted in Redis. */
export async function enqueueEmail(data: EmailJobData): Promise<void> {
  const queue = getEmailQueue();
  await queue.add(data);
  logger.info('Email job enqueued', { type: data.type, to: data.to });
}

export async function closeEmailQueue(): Promise<void> {
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
}
