import websocket from '@fastify/websocket';
import { OrderEvents } from './order-events.js';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import ScalarApiReference from '@scalar/fastify-api-reference';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerPurchaseRoutes } from './routes/purchases.js';
import { registerSaleRoutes } from './routes/sale.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    config: AppConfig;
    orderEvents: OrderEvents;
  }
}

export interface BuildAppDependencies {
  config: AppConfig;
  db: Pool;
  redis?: Redis;
}

export async function buildApp({
  config,
  db,
  redis,
}: BuildAppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.nodeEnv !== 'test' });
  app.decorate('db', db);
  app.decorate('config', config);
  const events = new OrderEvents(db, app);
  app.decorate('orderEvents', events);
  app.addHook('onClose', async () => events.close());
  await app.register(websocket, { options: { maxPayload: 1024 } });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Bookipi Flash Sale API',
        description:
          'Concurrency-safe limited-stock purchase API. The server is authoritative for inventory and sale-window decisions.',
        version: '0.1.0',
      },
      servers: [{ url: '/', description: 'Current local server' }],
      tags: [
        { name: 'Sale', description: 'Public sale status.' },
        {
          name: 'Purchases',
          description: 'Public purchase and lookup operations.',
        },
        {
          name: 'Internal',
          description: 'Development/test-only reset and invariant metrics.',
        },
      ],
      components: {
        securitySchemes: {
          InternalApiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-internal-api-key',
          },
        },
      },
    },
  });
  await app.register(rateLimit, {
    global: false,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    ...(redis
      ? { redis: redis as never, skipOnError: config.redisRateLimitFailOpen }
      : {}),
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError)
      return reply
        .status(error.statusCode)
        .send({ code: error.code, message: error.message });
    const fastifyError = error as {
      validation?: unknown;
      statusCode?: number;
      message?: string;
    };
    if (fastifyError.validation) {
      return reply
        .status(400)
        .send({
          code: 'VALIDATION_ERROR',
          message: fastifyError.message ?? 'Invalid request.',
        });
    }
    if (fastifyError.statusCode === 429) {
      return reply
        .status(429)
        .send({ code: 'RATE_LIMITED', message: 'Too many purchase attempts.' });
    }
    const databaseError = error as { code?: string; message?: string };
    if (
      [
        '55P03',
        '57014',
        '53300',
        '57P01',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
      ].includes(databaseError.code ?? '') ||
      databaseError.message?.includes('timeout exceeded when trying to connect')
    ) {
      request.log.error(error);
      return reply
        .header('Retry-After', '1')
        .status(503)
        .send({
          code: 'PURCHASE_UNAVAILABLE',
          message:
            'Purchase service is temporarily unavailable. Retry with the same Idempotency-Key.',
        });
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({
        code: 'PURCHASE_UNAVAILABLE',
        message: 'Purchase service is temporarily unavailable.',
      });
  });
  await registerSaleRoutes(app);
  await registerPurchaseRoutes(app);
  await registerInternalRoutes(app);
  if (config.nodeEnv !== 'production') {
    await app.register(ScalarApiReference, {
      routePrefix: '/docs',
      configuration: {
        title: 'Bookipi Flash Sale API',
        theme: 'purple',
        layout: 'modern',
        defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
      },
    });
  }
  return app;
}
