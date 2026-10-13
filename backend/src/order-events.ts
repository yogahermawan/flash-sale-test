import type { Pool, PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { AppError } from './errors.js';
import { findAttempt, publicAttempt } from './services/attempt-service.js';

export class OrderEvents {
  private listeners = new Map<string, Set<() => void>>();
  private client?: PoolClient;
  private closed = false;
  private reconnect?: ReturnType<typeof setTimeout>;
  constructor(
    private db: Pool,
    private app: FastifyInstance,
  ) {}
  async start() {
    if (this.closed) return;
    const client = await this.db.connect();
    if (this.closed) {
      client.release();
      return;
    }
    this.client = client;
    client.on('notification', (event) => {
      if (event.channel === 'order_status' && event.payload)
        for (const fn of this.listeners.get(event.payload) ?? []) fn();
    });
    client.on('error', (error) => {
      this.app.log.error(error);
      this.recover(client);
    });
    client.on('end', () => this.recover(client));
    try {
      await client.query('LISTEN order_status');
      // A reconnect may have missed notifications; replay durable state.
      for (const group of this.listeners.values()) for (const fn of group) fn();
    } catch (error) {
      this.recover(client);
      throw error;
    }
  }
  private recover(client: PoolClient) {
    if (this.client !== client || this.closed) return;
    this.client = undefined;
    client.release(true);
    this.scheduleReconnect();
  }
  private scheduleReconnect() {
    clearTimeout(this.reconnect);
    this.reconnect = setTimeout(
      () =>
        void this.start().catch((error) => {
          this.app.log.error(error);
          if (!this.closed && !this.client) this.scheduleReconnect();
        }),
      1000,
    );
  }

  async subscribe(socket: WebSocket, id: string, userId: string) {
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 30_000);
    heartbeat.unref();
    socket.once('close', () => clearInterval(heartbeat));
    const refresh = () =>
      void findAttempt(this.db, id, userId)
        .then((attempt) => {
          if (socket.readyState === 1)
            socket.send(JSON.stringify(publicAttempt(attempt)));
        })
        .catch((error) => {
          if (socket.readyState === 1)
            socket.close(
              error instanceof AppError && error.statusCode === 404
                ? 1008
                : 1013,
              'Attempt temporarily unavailable',
            );
        });
    const group = this.listeners.get(id) ?? new Set();
    group.add(refresh);
    this.listeners.set(id, group);
    socket.once('close', () => {
      group.delete(refresh);
      if (!group.size) this.listeners.delete(id);
    });
    // Register before reading snapshot to close the subscription race.
    refresh();
  }
  async close() {
    this.closed = true;
    clearTimeout(this.reconnect);
    if (this.client) {
      const client = this.client;
      this.client = undefined;
      await client.query('UNLISTEN *').catch(() => {});
      client.release();
    }
  }
}
