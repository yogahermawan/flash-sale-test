export const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: { code: { type: 'string' }, message: { type: 'string' } },
} as const;

export const saleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'status', 'stockRemaining', 'startsAt', 'endsAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    status: { type: 'string', enum: ['upcoming', 'active', 'ended'] },
    stockRemaining: { type: 'integer', minimum: 0 },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const userIdSchema = { type: 'string', minLength: 1, maxLength: 254, pattern: '.*\\S.*' } as const;
