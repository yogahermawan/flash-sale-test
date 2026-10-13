import type { ApiError } from '../api';
import type { PurchaseResponse } from '../types';

const messages = {
  confirmed: {
    title: 'You’re in.',
    copy: 'Your item is secured. Keep this order reference for your records.',
  },
  already_purchased: {
    title: 'Already secured.',
    copy: 'This user has already secured an item in this drop.',
  },
  upcoming: {
    title: 'Not open yet.',
    copy: 'The sale has not started. Refresh at the opening time.',
  },
  ended: {
    title: 'This drop has ended.',
    copy: 'No more purchases can be made for this sale window.',
  },
  sold_out: {
    title: 'Sold out.',
    copy: 'Every item has been secured. Thanks for trying.',
  },
};

export function PurchaseOutcome({
  pending,
  result,
  error,
  onRetry,
}: {
  pending: boolean;
  result?: PurchaseResponse;
  error?: ApiError;
  onRetry: () => void;
}) {
  if (pending)
    return (
      <section
        className="outcome outcome-pending"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="processing-spinner" aria-hidden="true" />
        <div>
          <p className="outcome-kicker">One moment</p>
          <h2>Confirming your order…</h2>
          <p>
            Your request is queued. We will update this result over WebSocket.
          </p>
        </div>
      </section>
    );
  if (!result && !error)
    return (
      <p className="purchase-hint">
        Your confirmation is final once the worker confirms your order.
      </p>
    );
  if (error)
    return (
      <section className="outcome outcome-error" aria-live="assertive">
        <p className="outcome-kicker">
          {error.code === 'RATE_LIMITED'
            ? 'Please slow down'
            : 'Couldn’t complete purchase'}
        </p>
        <h2>{error.message}</h2>
        <button className="text-button" type="button" onClick={onRetry}>
          Try again
        </button>
      </section>
    );
  const message = messages[result!.outcome];
  const isSuccess =
    result!.outcome === 'confirmed' || result!.outcome === 'already_purchased';
  return (
    <section
      className={`outcome ${isSuccess ? 'outcome-success' : ''}`}
      aria-live="polite"
    >
      <p className="outcome-kicker">
        {isSuccess ? 'Purchase status' : 'Sale status'}
      </p>
      <h2>{message.title}</h2>
      <p>{message.copy}</p>
      {'orderId' in result! && (
        <>
          <p className="outcome-order-label">Order ID</p>
          <code>{result!.orderId}</code>
        </>
      )}
    </section>
  );
}
