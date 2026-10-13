import type { Pool, PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { getPublicSale } from './services/sale-service.js';
import { AppError } from './errors.js';
import { findAttempt, publicAttempt } from './services/attempt-service.js';

export class OrderEvents {
  private listeners = new Map<string, Set<() => void>>();
  private saleSockets = new Set<WebSocket>();
  private saleRefreshing = false;
  private saleDirty = false;
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
      if (event.channel === 'sale_status') this.refreshSale();
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
      await client.query('LISTEN sale_status');
      this.refreshSale();
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

  subscribeSale(socket: WebSocket) {
    this.saleSockets.add(socket);
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
    socket.once('close', () => {
      clearInterval(heartbeat);
      this.saleSockets.delete(socket);
    });
    // Register before the initial read. Serialize/coalesce reads so an older
    // snapshot cannot arrive after a newer one; one query serves all clients.
    this.refreshSale();
  }
  private refreshSale() {
    if (this.closed || !this.saleSockets.size) return;
    this.saleDirty = true;
    if (this.saleRefreshing) return;
    this.saleRefreshing = true;
    void (async () => {
      try {
        while (this.saleDirty && !this.closed && this.saleSockets.size) {
          this.saleDirty = false;
          const sale = await getPublicSale(this.db);
          const message = JSON.stringify({ type: 'sale', sale });
          for (const socket of this.saleSockets) {
            if (socket.readyState === 1) socket.send(message);
          }
        }
      } catch (error) {
        this.app.log.error(error);
        for (const socket of this.saleSockets)
          socket.close(1013, 'Sale temporarily unavailable');
      } finally {
        this.saleRefreshing = false;
      }
    })();
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
