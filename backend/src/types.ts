export type SaleStatus = 'upcoming' | 'active' | 'ended';
export type PurchaseOutcome = 'confirmed' | 'already_purchased' | 'upcoming' | 'ended' | 'sold_out';

export interface SaleRow {
  id: string;
  product_name: string;
  starts_at: Date;
  ends_at: Date;
  initial_stock: number;
  stock_remaining: number;
  active: boolean;
  server_now?: Date;
}

export interface PublicSale {
  id: string;
  name: string;
  status: SaleStatus;
  stockRemaining: number;
  serverNow: string;
  startsAt: string;
  endsAt: string;
}

export type PurchaseResult =
  | { outcome: 'confirmed'; orderId: string }
  | { outcome: 'already_purchased'; orderId: string }
  | { outcome: 'upcoming' | 'ended' | 'sold_out' };
