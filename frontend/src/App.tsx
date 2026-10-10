import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { SaleCard } from './components/SaleCard';
import { PurchaseOutcome } from './components/PurchaseOutcome';
import { usePurchase } from './hooks/usePurchase';
import { useSale } from './hooks/useSale';
import type { SaleStatus } from './types';

function currentStatus(startsAt: string, endsAt: string, now: number): SaleStatus {
  if (now < new Date(startsAt).getTime()) return 'upcoming';
  if (now >= new Date(endsAt).getTime()) return 'ended';
  return 'active';
}

function userIdIsValid(value: string): boolean {
  return value.trim().length > 0 && value.trim().length <= 254;
}

export default function App() {
  const { sale, loading, error: saleError, refresh } = useSale();
  const purchase = usePurchase();
  const [userId, setUserId] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const status = useMemo(() => sale ? currentStatus(sale.startsAt, sale.endsAt, now) : undefined, [sale, now]);
  const canBuy = Boolean(sale && status === 'active' && sale.stockRemaining > 0 && userIdIsValid(userId) && !purchase.pending);

  const submitPurchase = async () => {
    if (!canBuy) return;
    const response = await purchase.submit(userId.trim());
    if (response) void refresh();
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void submitPurchase(); };

  if (loading && !sale) return <main className="page page-centered"><p className="loading">Loading the drop<span className="loading-dots" /></p></main>;
  if (saleError && !sale) return <main className="page page-centered"><section className="service-error"><p className="eyebrow">Service unavailable</p><h1>We couldn’t load this drop.</h1><p>{saleError.message}</p><button type="button" onClick={() => void refresh()}>Try again</button></section></main>;
  if (!sale || !status) return null;

  return <main className="page">
    <nav className="topbar" aria-label="Bookipi Flash Drop"><a className="brand" href="/">bookipi<span>／</span>flash drop</a><button className="refresh" type="button" onClick={() => void refresh()} disabled={loading}>Refresh status</button></nav>
    <div className="hero-line" aria-hidden="true" />
    <SaleCard sale={sale} status={status} />
    <section className="checkout" aria-labelledby="checkout-title">
      <div className="checkout-intro"><p className="eyebrow">Secure your item</p><h2 id="checkout-title">Ready when you are.</h2><p>Enter the ID you use for this demo. The server makes the final decision on availability.</p></div>
      <form onSubmit={submit} noValidate>
        <label htmlFor="userId">Your user ID</label>
        <input id="userId" name="userId" autoComplete="username" placeholder="you@example.com" value={userId} onChange={(event) => { setUserId(event.target.value); purchase.clearResult(); }} aria-describedby="userId-help" />
        <p id="userId-help" className="field-help">One item per user. Your ID is checked securely by the sale service.</p>
        <button className="buy-button" type="submit" disabled={!canBuy}>
          {purchase.pending ? 'Securing your item…' : status === 'upcoming' ? 'Sale opens soon' : status === 'ended' ? 'Sale ended' : sale.stockRemaining === 0 ? 'Sold out' : 'Buy now'}
        </button>
      </form>
      <PurchaseOutcome result={purchase.result} error={purchase.error} onRetry={() => void submitPurchase()} />
    </section>
    {saleError && <p className="refresh-error" role="status">Status refresh failed: {saleError.message}</p>}
    <footer><span>Server-authoritative inventory</span><span>One item per user</span><span>Retry-safe checkout</span></footer>
  </main>;
}
