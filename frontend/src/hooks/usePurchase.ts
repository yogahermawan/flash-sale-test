import { useEffect, useRef, useState } from 'react';
import { ApiError, createPurchase } from '../api';
import { waitForPurchase } from '../order-events';
import type { PurchaseResponse } from '../types';

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function usePurchase() {
  const activeAttempt = useRef<{ id: string; userId: string }>();
  const subscription = useRef<AbortController>();
  useEffect(() => () => subscription.current?.abort(), []);
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
      const admitted =
        activeAttempt.current?.userId === userId
          ? {
              outcome: 'processing' as const,
              attemptId: activeAttempt.current.id,
            }
          : await createPurchase(userId, key);
      if (admitted.outcome === 'processing')
        activeAttempt.current = { id: admitted.attemptId, userId };
      subscription.current = new AbortController();
      const response =
        admitted.outcome === 'processing'
          ? await waitForPurchase(
              admitted.attemptId,
              userId,
              subscription.current.signal,
            )
          : admitted;
      setResult(response);
      setRetryKey(undefined);
      activeAttempt.current = undefined;
      return response;
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError('REQUEST_FAILED', 'Purchase failed.', 0);
      setError(apiError);
      if (apiError.code === 'NETWORK_ERROR' || apiError.status >= 500)
        setRetryKey(key);
      else setRetryKey(undefined);
      return undefined;
    } finally {
      setPending(false);
    }
  };

  const resume = async (userId: string, attemptId: string) => {
    activeAttempt.current = { id: attemptId, userId };
    return submit(userId);
  };
  const clearResult = () => {
    activeAttempt.current = undefined;
    setResult(undefined);
    setError(undefined);
    setRetryKey(undefined);
  };
  return {
    pending,
    result,
    error,
    canRetry: Boolean(retryKey),
    submit,
    resume,
    clearResult,
  };
}
