import type { FastifyInstance } from 'fastify';
import { errorSchema, userIdSchema } from '../schemas/common.js';
import { lookupPurchase } from '../services/purchase-service.js';

import {
  enqueuePurchase,
  findAttempt,
  publicAttempt,
} from '../services/attempt-service.js';

const purchaseResponse = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'attemptId'],
      properties: {
        outcome: { const: 'processing' },
        attemptId: { type: 'string', format: 'uuid' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'orderId'],
      properties: {
        outcome: { type: 'string', enum: ['confirmed', 'already_purchased'] },
        orderId: { type: 'string', format: 'uuid' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['outcome'],
      properties: {
        outcome: { type: 'string', enum: ['upcoming', 'ended', 'sold_out'] },
      },
    },
  ],
} as const;

export async function registerPurchaseRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{
    Body: { userId: string };
    Headers: { 'idempotency-key': string };
  }>(
    '/api/purchases',
    {
      config: {
        rateLimit: {
          max: app.config.rateLimitMax,
          timeWindow: app.config.rateLimitWindowMs,
        },
      },
      schema: {
        tags: ['Purchases'],
        summary: 'Attempt to secure one item',
        description:
          'Use a new UUID Idempotency-Key for a new logical attempt. Reuse the same key only to retry an uncertain network/server failure.',
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['userId'],
          properties: {
            userId: {
              ...userIdSchema,
              description:
                'Assessment user identity; production would derive this from authentication. Example: yoga@example.com.',
            },
          },
        },
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: {
            'idempotency-key': {
              type: 'string',
              format: 'uuid',
              description:
                'UUID used to safely retry this logical purchase attempt. Example: f47ac10b-58cc-4372-a567-0e02b2c3d479.',
            },
          },
        },
        response: {
          200: purchaseResponse,
          202: purchaseResponse,
          400: errorSchema,
          409: errorSchema,
          429: errorSchema,
          500: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await enqueuePurchase(
        app.db,
        request.body.userId.trim(),
        request.headers['idempotency-key'],
      );
      return reply
        .status(result.outcome === 'processing' ? 202 : 200)
        .send(result);
    },
  );

  const attemptSchema = {
    params: {
      type: 'object',
      required: ['attemptId'],
      properties: { attemptId: { type: 'string', format: 'uuid' } },
    },
    querystring: {
      type: 'object',
      required: ['userId'],
      properties: { userId: userIdSchema },
    },
  } as const;
  app.get<{ Params: { attemptId: string }; Querystring: { userId: string } }>(
    '/api/purchases/:attemptId',
    { schema: attemptSchema },
    async (request) =>
      publicAttempt(
        await findAttempt(
          app.db,
          request.params.attemptId,
          request.query.userId.trim(),
        ),
      ),
  );
  app.get<{ Params: { attemptId: string }; Querystring: { userId: string } }>(
    '/api/purchases/:attemptId/events',
    {
      websocket: true,
      schema: attemptSchema,
      config: {
        rateLimit: {
          max: app.config.rateLimitMax,
          timeWindow: app.config.rateLimitWindowMs,
        },
      },
      preValidation: async (request) => {
        await findAttempt(
          app.db,
          request.params.attemptId,
          request.query.userId.trim(),
        );
      },
    },
    (socket, request) => {
      void app.orderEvents.subscribe(
        socket,
        request.params.attemptId,
        request.query.userId.trim(),
      );
    },
  );

  app.get<{ Querystring: { userId: string } }>(
    '/api/purchases/me',
    {
      schema: {
        tags: ['Purchases'],
        summary: 'Check whether a user secured an item',
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['userId'],
          properties: {
            userId: {
              ...userIdSchema,
              description: 'Example: yoga@example.com.',
            },
          },
        },
        response: {
          200: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['purchased', 'orderId'],
                properties: {
                  purchased: { const: true },
                  orderId: { type: 'string', format: 'uuid' },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['purchased'],
                properties: {
                  purchased: { const: false },
                  attemptId: { type: 'string', format: 'uuid' },
                },
              },
            ],
          },
          400: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request) => lookupPurchase(app.db, request.query.userId.trim()),
  );
}
