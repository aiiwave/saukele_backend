import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { startRegistryExpiryCron } from './jobs/registryExpiry';

import authRoutes from './routes/auth.routes';
import registryRoutes from './routes/registry.routes';
import giftRoutes from './routes/gift.routes';
import contributionRoutes from './routes/contribution.routes';
import kinshipRoutes from './routes/kinship.routes';
import adminRoutes from './routes/admin.routes';
import webhookRoutes from './routes/webhook.routes';

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// No wildcard (*) in production — spec requirement
app.use(
  cors({
    origin: env.NODE_ENV === 'production'
      ? env.CORS_ORIGIN.split(',')
      : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  }),
);

// ─── Webhook routes MUST use raw body for HMAC verification ──────────────────
app.use('/v1/webhooks', (req, _res, next) => {
  express.raw({ type: 'application/json' })(req, _res, (err) => {
    if (!err) {
      // Attach rawBody for HMAC verification middleware
      (req as express.Request & { rawBody?: Buffer }).rawBody = req.body as Buffer;
    }
    next(err);
  });
}, webhookRoutes);

// ─── JSON body parser for all other routes ───────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Swagger UI ───────────────────────────────────────────────────────────────
const openapiPath = path.join(__dirname, '../docs/openapi.yaml');
if (fs.existsSync(openapiPath)) {
  const swaggerDocument = YAML.parse(fs.readFileSync(openapiPath, 'utf8')) as object;
  const swaggerOpts = { customSiteTitle: 'Saukele API Docs' };
  // Mount under three paths so any common URL works
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOpts));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOpts));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOpts));
  // Raw OpenAPI YAML for tooling (e.g., Postman import)
  app.get('/openapi.yaml', (_req, res) => {
    res.type('text/yaml').send(fs.readFileSync(openapiPath, 'utf8'));
  });
  logger.info('Swagger UI available at /docs, /api-docs, and /api/docs');
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'saukele-backend', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const v1 = express.Router();

v1.use('/auth', authRoutes);
v1.use('/registries', registryRoutes);
v1.use('/registries/:registryId/gifts', giftRoutes);
v1.use('/registries/:registryId/kinship', kinshipRoutes);
v1.use('/contributions', contributionRoutes);
v1.use('/admin', adminRoutes);

app.use('/v1', v1);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ─── Centralized error handler (must be last) ─────────────────────────────────
app.use(errorHandler);

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await connectRedis();
    startRegistryExpiryCron();

    app.listen(env.PORT, () => {
      logger.info(`🚀 Saukele API running on port ${env.PORT} (${env.NODE_ENV})`);
      logger.info(`📄 Swagger UI: http://localhost:${env.PORT}/api/docs`);
    });
  } catch (err) {
    logger.error('Failed to start server', { err });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  const { disconnectDatabase } = await import('./config/database');
  const { disconnectRedis } = await import('./config/redis');
  await disconnectDatabase();
  await disconnectRedis();
  process.exit(0);
});

bootstrap();

export default app;
