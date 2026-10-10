import { Redis } from 'ioredis';

export function createRedisClient(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
}
