import type { ApiFailure, PurchaseResponse, Sale } from './types';

export class ApiError extends Error implements ApiFailure {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      'We could not reach the sale service. Check your connection and try again.',
      0,
    );
  }
  const body = (await response.json().catch(() => ({}))) as Partial<ApiFailure>;
  if (!response.ok) {
    throw new ApiError(
      body.code ?? 'REQUEST_FAILED',
      body.message ?? 'The request could not be completed.',
      response.status,
    );
  }
  return body as T;
}

export const getSale = () => request<Sale>('/api/sale');
export const getMyPurchase = (userId: string) =>
  request<{ purchased: boolean; orderId?: string; attemptId?: string }>(
    `/api/purchases/me?userId=${encodeURIComponent(userId)}`,
  );
export const createPurchase = (userId: string, idempotencyKey: string) =>
  request<PurchaseResponse | { outcome: 'processing'; attemptId: string }>(
    '/api/purchases',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ userId }),
    },
  );
