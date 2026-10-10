import { useState } from 'react';
import { ApiError, createPurchase } from '../api';
import type { PurchaseResponse } from '../types';

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function usePurchase() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PurchaseResponse>();
  const [error, setError] = useState<ApiError>();
  const [retryKey, setRetryKey] = useState<string>();

  const submit = async (userId: string) => {
    const key = retryKey ?? newIdempotencyKey();
    setPending(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await createPurchase(userId, key);
      setResult(response);
      setRetryKey(undefined);
      return response;
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : new ApiError('REQUEST_FAILED', 'Purchase failed.', 0);
      setError(apiError);
      if (apiError.code === 'NETWORK_ERROR' || apiError.status >= 500) setRetryKey(key);
      else setRetryKey(undefined);
      return undefined;
    } finally {
      setPending(false);
    }
  };

  const clearResult = () => { setResult(undefined); setError(undefined); setRetryKey(undefined); };
  return { pending, result, error, canRetry: Boolean(retryKey), submit, clearResult };
}
