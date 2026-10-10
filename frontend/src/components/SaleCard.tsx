import type { Sale, SaleStatus } from '../types';

const labels: Record<SaleStatus, string> = { upcoming: 'Opens soon', active: 'Live now', ended: 'Drop closed' };

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function getTimeLabel(sale: Sale, status: SaleStatus, now: number): string {
  if (status === 'ended') return 'Sale ended';
  const target = new Date(status === 'upcoming' ? sale.startsAt : sale.endsAt).getTime();
  const seconds = Math.max(0, Math.floor((target - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const clock = [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':');
  return `${status === 'upcoming' ? 'Opens in' : 'Ends in'} ${clock}`;
}

export function SaleCard({ sale, status, now }: { sale: Sale; status: SaleStatus; now: number }) {
  return <section className="sale-card" aria-labelledby="sale-title">
    <div className="product-image-wrap">
      <span className="product-badge">✦ &nbsp;Flash sale</span>
      <img className="product-image" src="/nova-pro-headphones.png" alt="Ivory wireless over-ear headphones" />
    </div>
    <div className="product-copy">
      <p className="eyebrow">Booki Marketplace&nbsp; / &nbsp;Limited drop</p>
      <h1 id="sale-title">{sale.name}</h1>
      <p className="sale-description">A limited release of wireless headphones. One per person, while stock lasts.</p>
      <div className="product-highlights" aria-label="Product highlights">
        <span><i aria-hidden="true">✓</i> Limited release</span>
        <span><i aria-hidden="true">✓</i> One per customer</span>
      </div>
      <div className="sale-timing">
        <span className="status-pill" data-status={status}><i aria-hidden="true" />{labels[status]}</span>
        <strong role="timer">{getTimeLabel(sale, status, now)}</strong>
      </div>
      <p className="sale-dates" aria-label={`Sale window: ${formatDate(sale.startsAt)} to ${formatDate(sale.endsAt)}`}>
        {formatDate(sale.startsAt)} <span aria-hidden="true">→</span> {formatDate(sale.endsAt)}
      </p>
    </div>
    <aside className="inventory" aria-live="polite" aria-label="Available stock">
      <strong>{sale.stockRemaining}</strong>
      <span>items left</span>
    </aside>
  </section>;
}
