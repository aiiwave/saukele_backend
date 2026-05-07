import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { EmailJobData } from '../jobs/emailQueue';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  // Dev mode: log emails to console instead of sending. Lets the project run
  // out-of-the-box for local dev / defense without configuring SMTP credentials.
  if (env.EMAIL_DEV_MODE) return null;

  if (!transporter) {
    if (!env.SMTP_HOST || !env.SMTP_PORT) {
      logger.warn('SMTP not configured — falling back to dev-mode console logging');
      return null;
    }

    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      ...(env.SMTP_USER && env.SMTP_PASS
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    });
  }
  return transporter;
}

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function renderTemplate(data: EmailJobData): RenderedEmail {
  switch (data.type) {
    case 'EMAIL_VERIFICATION':
      return {
        subject: 'Verify your Saukele account',
        text: `Welcome to Saukele!\n\nPlease verify your email by visiting:\n${data.payload.verifyUrl}\n\nThis link expires in ${data.payload.expiresInHours} hours.`,
        html: `<h2>Welcome to Saukele!</h2><p>Please verify your email by clicking the link below:</p><p><a href="${data.payload.verifyUrl}">Verify my email</a></p><p>This link expires in <strong>${data.payload.expiresInHours} hours</strong>.</p>`,
      };

    case 'PASSWORD_RESET':
      return {
        subject: 'Reset your Saukele password',
        text: `A password reset was requested for your Saukele account.\n\nReset your password here:\n${data.payload.resetUrl}\n\nThis link expires in ${data.payload.expiresInMinutes} minutes. If you did not request this, you can safely ignore this email.`,
        html: `<h2>Password reset requested</h2><p>Click the link below to reset your password:</p><p><a href="${data.payload.resetUrl}">Reset password</a></p><p>This link expires in <strong>${data.payload.expiresInMinutes} minutes</strong>.</p><p>If you did not request this, you can safely ignore this email.</p>`,
      };

    case 'REGISTRY_CREATED':
      return {
        subject: `Your registry "${data.payload.registryTitle}" is live`,
        text: `Congratulations! Your wedding registry "${data.payload.registryTitle}" has been created.\n\nView it here: ${data.payload.registryUrl}`,
        html: `<h2>Your registry is live 🎉</h2><p>Your wedding registry <strong>${data.payload.registryTitle}</strong> is ready to share with guests.</p><p><a href="${data.payload.registryUrl}">View registry</a></p>`,
      };

    case 'CONTRIBUTION_RECEIVED': {
      const kzt = (data.payload.amountKzt / 100).toLocaleString('en-US');
      return {
        subject: `New contribution toward "${data.payload.giftTitle}"`,
        text: `Someone just contributed ${kzt} KZT toward "${data.payload.giftTitle}" on your registry.`,
        html: `<h2>New contribution received 🎁</h2><p>A guest contributed <strong>${kzt} KZT</strong> toward <strong>${data.payload.giftTitle}</strong>.</p>`,
      };
    }

    case 'PAYMENT_CONFIRMATION': {
      const kzt = (data.payload.amountKzt / 100).toLocaleString('en-US');
      return {
        subject: 'Payment confirmation',
        text: `Your payment of ${kzt} KZT toward "${data.payload.giftTitle}" was successful.\nTransaction: ${data.payload.transactionId}`,
        html: `<h2>Payment confirmed ✅</h2><p>Your payment of <strong>${kzt} KZT</strong> toward <strong>${data.payload.giftTitle}</strong> was successful.</p><p><small>Transaction: ${data.payload.transactionId}</small></p>`,
      };
    }
  }
}

/**
 * Send an email. Called by the email worker process.
 * In dev mode emails are logged to console instead of sent.
 */
export async function sendEmail(data: EmailJobData): Promise<void> {
  const rendered = renderTemplate(data);
  const tx = getTransporter();

  if (!tx) {
    // Dev mode — log instead of sending
    logger.info('📧 [DEV MODE] Email would be sent', {
      to: data.to,
      type: data.type,
      subject: rendered.subject,
      preview: rendered.text.slice(0, 200),
    });
    return;
  }

  await tx.sendMail({
    from: env.SMTP_FROM ?? 'Saukele <noreply@saukele.kz>',
    to: data.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });

  logger.info('Email sent', { to: data.to, type: data.type });
}
