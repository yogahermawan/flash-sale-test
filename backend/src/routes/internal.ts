import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { inTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { errorSchema, saleSchema } from '../schemas/common.js';
import { getMetrics } from '../services/metrics-service.js';
import { resetSale } from '../services/sale-service.js';

function digest(value: string): Buffer { return createHash('sha256').update(value).digest(); }

const internalKeyHeaderSchema = {
  type: 'object',
  required: ['x-internal-api-key'],
  properties: {
    'x-internal-api-key': {
      type: 'string',
      minLength: 1,
      description: 'Development-only internal API key. Enter the raw INTERNAL_API_KEY value from .env.',
    },
  },
} as const;

function requireInternalKey(request: FastifyRequest, expected: string): void {
  const supplied = request.headers['x-internal-api-key'];
  const suppliedValue = typeof supplied === 'string' ? supplied : '';
  if (!timingSafeEqual(digest(suppliedValue), digest(expected))) {
    throw new AppError(404, 'NOT_FOUND', 'Route not found.');
  }
}

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  if (app.config.nodeEnv === 'production') return;
  const protectedRoute = async (request: FastifyRequest) => requireInternalKey(request, app.config.internalApiKey);

  app.post<{ Body: { initialStock: number; startsAt: string; endsAt: string; productName?: string } }>('/api/internal/sales/reset', {
    // Run before schema validation so an unauthenticated caller cannot probe this route.
    onRequest: protectedRoute,
    schema: {
      tags: ['Internal'],
      summary: 'Reset the active sale for local development or testing',
      security: [{ InternalApiKey: [] }],
      headers: internalKeyHeaderSchema,
      body: {
        type: 'object', additionalProperties: false, required: ['initialStock', 'startsAt', 'endsAt'],
        properties: {
          initialStock: { type: 'integer', minimum: 0, description: 'Example: 100.' },
          startsAt: { type: 'string', format: 'date-time', description: 'Example: 2026-10-10T00:00:00.000Z.' },
          endsAt: { type: 'string', format: 'date-time', description: 'Example: 2026-10-11T00:00:00.000Z.' },
          productName: { type: 'string', minLength: 1, maxLength: 200, description: 'Example: Limited Edition Bookipi Headphones.' },
        },
      },
      response: { 200: saleSchema, 400: errorSchema, 404: errorSchema },
    },
  }, async (request) => {
    const startsAt = new Date(request.body.startsAt);
    const endsAt = new Date(request.body.endsAt);
    if (endsAt <= startsAt) throw new AppError(400, 'VALIDATION_ERROR', 'endsAt must be after startsAt.');
    return inTransaction(app.db, (client) => resetSale(client, {
      initialStock: request.body.initialStock,
      startsAt,
      endsAt,
      productName: request.body.productName?.trim() || 'Limited Edition Bookipi Headphones',
    }));
  });

  app.get('/api/internal/metrics', {
    onRequest: protectedRoute,
    schema: {
      tags: ['Internal'],
      summary: 'Inspect stock/order invariants',
      security: [{ InternalApiKey: [] }],
      headers: internalKeyHeaderSchema,
      response: { 200: { type: 'object', additionalProperties: true }, 404: errorSchema, 503: errorSchema },
    },
  }, async () => getMetrics(app.db));
}
