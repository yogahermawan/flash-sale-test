import type { FastifyInstance } from 'fastify';
import { errorSchema, userIdSchema } from '../schemas/common.js';
import { lookupPurchase, purchase } from '../services/purchase-service.js';

const purchaseResponse = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['outcome', 'orderId'], properties: { outcome: { type: 'string', enum: ['confirmed', 'already_purchased'] }, orderId: { type: 'string', format: 'uuid' } } },
    { type: 'object', additionalProperties: false, required: ['outcome'], properties: { outcome: { type: 'string', enum: ['upcoming', 'ended', 'sold_out'] } } },
  ],
} as const;

export async function registerPurchaseRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { userId: string }; Headers: { 'idempotency-key': string } }>('/api/purchases', {
    config: { rateLimit: { max: app.config.rateLimitMax, timeWindow: app.config.rateLimitWindowMs } },
    schema: {
      tags: ['Purchases'],
      summary: 'Attempt to secure one item',
      description: 'Use a new UUID Idempotency-Key for a new logical attempt. Reuse the same key only to retry an uncertain network/server failure.',
      body: {
        type: 'object', additionalProperties: false, required: ['userId'],
        properties: { userId: { ...userIdSchema, description: 'Assessment user identity; production would derive this from authentication.', default: 'yoga@example.com' } },
      },
      headers: {
        type: 'object', required: ['idempotency-key'],
        properties: { 'idempotency-key': { type: 'string', format: 'uuid', description: 'UUID used to safely retry this logical purchase attempt.', default: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' } },
      },
      response: { 200: purchaseResponse, 400: errorSchema, 409: errorSchema, 429: errorSchema, 500: errorSchema, 503: errorSchema },
    },
  }, async (request) => purchase(app.db, request.body.userId.trim(), request.headers['idempotency-key']));

  app.get<{ Querystring: { userId: string } }>('/api/purchases/me', {
    schema: {
      tags: ['Purchases'],
      summary: 'Check whether a user secured an item',
      querystring: { type: 'object', additionalProperties: false, required: ['userId'], properties: { userId: { ...userIdSchema, default: 'yoga@example.com' } } },
      response: {
        200: { oneOf: [
          { type: 'object', additionalProperties: false, required: ['purchased', 'orderId'], properties: { purchased: { const: true }, orderId: { type: 'string', format: 'uuid' } } },
          { type: 'object', additionalProperties: false, required: ['purchased'], properties: { purchased: { const: false } } },
        ] },
        400: errorSchema, 503: errorSchema,
      },
    },
  }, async (request) => lookupPurchase(app.db, request.query.userId.trim()));
}
