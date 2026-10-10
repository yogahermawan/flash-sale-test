import { useCallback, useEffect, useState } from 'react';
import { ApiError, getSale } from '../api';
import type { Sale } from '../types';

export function useSale() {
  const [sale, setSale] = useState<Sale>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSale(await getSale());
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError('REQUEST_FAILED', 'Unable to load the sale.', 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { sale, loading, error, refresh };
}
