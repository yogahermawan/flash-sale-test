import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getSale } from '../api';
import type { Sale } from '../types';

export function useSale() {
  const [clockAnchor, setClockAnchor] = useState<{
    serverMs: number;
    receivedAt: number;
  }>();
  const [sale, setSale] = useState<Sale>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError>();

  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true);
    try {
      const nextSale = await getSale();
      if (current !== revision.current) return;
      setClockAnchor({
        serverMs: Date.parse(nextSale.serverNow),
        receivedAt: performance.now(),
      });
      setSale(nextSale);
      setError(undefined);
    } catch (caught) {
      if (current !== revision.current) return;
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError('REQUEST_FAILED', 'Unable to load the sale.', 0),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const connect = () => {
      if (stopped) return;
      const url = new URL('/api/sale/events', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const connection = new WebSocket(url);
      socket = connection;
      connection.onmessage = (event) => {
        if (stopped) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'sale' || !data.sale) return;
          const nextSale: Sale = data.sale;
          ++revision.current;
          failures = 0;
          setSale(nextSale);
          setClockAnchor({
            serverMs: Date.parse(nextSale.serverNow),
            receivedAt: performance.now(),
          });
          setLoading(false);
          setError(undefined);
        } catch {
          connection.close();
        }
      };
      connection.onclose = () => {
        if (!stopped)
          retry = setTimeout(
            connect,
            Math.min(5000, 250 * 2 ** Math.min(failures++, 5)),
          );
      };
      connection.onerror = () => connection.close();
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
  return { sale, clockAnchor, loading, error, refresh };
}
