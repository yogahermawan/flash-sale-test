import type { Sale, SaleStatus } from '../types';

const labels: Record<SaleStatus, string> = { upcoming: 'Opens soon', active: 'Live now', ended: 'Drop closed' };

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function SaleCard({ sale, status }: { sale: Sale; status: SaleStatus }) {
  return <section className="sale-card" aria-labelledby="sale-title">
    <div className="product-mark" aria-hidden="true"><span>BK</span></div>
    <div className="product-copy">
      <p className="eyebrow">One-time release</p>
      <h1 id="sale-title">{sale.name}</h1>
      <p className="sale-description">A small, high-demand drop. One item per person, confirmed safely by the sale service.</p>
      <div className="window" aria-label={`Sale window: ${formatDate(sale.startsAt)} to ${formatDate(sale.endsAt)}`}>
        <span>Opens {formatDate(sale.startsAt)}</span>
        <span>Closes {formatDate(sale.endsAt)}</span>
      </div>
    </div>
    <aside className="inventory" aria-live="polite">
      <span className={`status-pill status-${status}`}>{labels[status]}</span>
      <strong>{sale.stockRemaining}</strong>
      <span>items remaining</span>
    </aside>
  </section>;
}
