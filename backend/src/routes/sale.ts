import type { FastifyInstance } from 'fastify';
import { errorSchema, saleSchema } from '../schemas/common.js';
import { getPublicSale } from '../services/sale-service.js';

export async function registerSaleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sale/events', { websocket: true }, (socket) => {
    app.orderEvents.subscribeSale(socket);
  });
  app.get(
    '/api/sale',
    {
      schema: {
        tags: ['Sale'],
        summary: 'Get the current public sale state',
        response: { 200: saleSchema, 503: errorSchema },
      },
    },
    async () => getPublicSale(app.db),
  );
}
