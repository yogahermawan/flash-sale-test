import { useCallback, useEffect, useState } from 'react';
import { ApiError, getSale } from '../api';
import type { Sale } from '../types';

export function useSale() {
  const [clockAnchor, setClockAnchor] = useState<{ serverMs: number; receivedAt: number }>();
  const [sale, setSale] = useState<Sale>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextSale = await getSale();
      setClockAnchor({ serverMs: Date.parse(nextSale.serverNow), receivedAt: performance.now() });
      setSale(nextSale);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('REQUEST_FAILED', 'Unable to load the sale.', 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { sale, clockAnchor, loading, error, refresh };
}
