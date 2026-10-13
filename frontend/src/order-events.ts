import { ApiError } from './api';
import type { PurchaseResponse } from './types';

export function waitForPurchase(
  attemptId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<PurchaseResponse> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let reconnects = 0;
    const finish = (result?: PurchaseResponse, error?: ApiError) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(retry);
      signal?.removeEventListener('abort', abort);
      socket?.close();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () =>
      finish(
        undefined,
        new ApiError(
          'NETWORK_ERROR',
          'Status subscription cancelled. Retry to check your existing attempt.',
          503,
        ),
      );
    const deadline = setTimeout(
      () =>
        finish(
          undefined,
          new ApiError(
            'STATUS_TIMEOUT',
            'Your purchase is still processing. Retry to reconnect to the same attempt.',
            503,
          ),
        ),
      30_000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    const connect = () => {
      if (finished) return;
      const url = new URL(`/api/purchases/${attemptId}/events`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('userId', userId);
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.attemptId !== attemptId) return;
          if (data.outcome === 'processing') return;
          if (data.outcome === 'failed')
            return finish(
              undefined,
              new ApiError(
                'ATTEMPT_FAILED',
                'This attempt could not be completed. Check your order before starting a new attempt.',
                409,
              ),
            );
          if (
            ['confirmed', 'already_purchased', 'sold_out'].includes(
              data.outcome,
            )
          )
            finish(data);
        } catch {
          finish(
            undefined,
            new ApiError('INVALID_RESPONSE', 'Invalid purchase status.', 503),
          );
        }
      };
      socket.onclose = (event) => {
        if (finished) return;
        if (event.code === 1008)
          return finish(
            undefined,
            new ApiError(
              'ATTEMPT_NOT_FOUND',
              'Purchase attempt is unavailable. Check your order.',
              404,
            ),
          );
        retry = setTimeout(
          connect,
          Math.min(3000, 250 * 2 ** Math.min(reconnects++, 4)),
        );
      };
      socket.onerror = () => socket?.close();
    };
    if (signal?.aborted) abort();
    else connect();
  });
}
