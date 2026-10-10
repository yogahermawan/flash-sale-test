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
    <nav className="topbar" aria-label="Booki Marketplace"><a className="brand" href="/"><span className="brand-mark">B</span><span className="brand-name">Booki</span><span className="brand-divider" />Marketplace</a><button className="refresh" type="button" onClick={() => void refresh()} disabled={loading}><span aria-hidden="true">↻</span> Refresh stock</button></nav>
    <div className="page-heading"><span>Limited-time event</span><span className="heading-dot" aria-hidden="true" /> Sale status &amp; stock</div>
    <SaleCard sale={sale} status={status} now={now} />
    <section className="checkout" aria-labelledby="checkout-title">
      <div className="checkout-intro"><div className="checkout-icon" aria-hidden="true">↗</div><p className="eyebrow">Quick checkout</p><h2 id="checkout-title">Make it yours.</h2><p>Enter your user ID to secure one item. Your order is confirmed as soon as the sale service accepts it.</p></div>
      <form onSubmit={submit} noValidate>
        <label htmlFor="userId">Your user ID</label>
        <input id="userId" name="userId" autoComplete="username" placeholder="you@example.com" value={userId} onChange={(event) => { setUserId(event.target.value); purchase.clearResult(); }} aria-describedby="userId-help" />
        <p id="userId-help" className="field-help">One item per demo user. This ID is not a sign-in or identity verification.</p>
        <button className="buy-button" type="submit" disabled={!canBuy}>
          {purchase.pending ? 'Securing your item…' : status === 'upcoming' ? 'Sale opens soon' : status === 'ended' ? 'Sale ended' : sale.stockRemaining === 0 ? 'Sold out' : 'Buy now'}
        </button>
      </form>
      <PurchaseOutcome pending={purchase.pending} result={purchase.result} error={purchase.error} onRetry={() => void submitPurchase()} />
    </section>
    {saleError && <p className="refresh-error" role="status">Status refresh failed: {saleError.message}</p>}
    <footer><span><i aria-hidden="true">✓</i> Stock refreshes after purchase</span><span><i aria-hidden="true">✓</i> One per demo user</span><span><i aria-hidden="true">✓</i> Retry-safe checkout</span></footer>
  </main>;
}
