export type SaleStatus = 'upcoming' | 'active' | 'ended';
export type PurchaseOutcome = 'confirmed' | 'already_purchased' | 'upcoming' | 'ended' | 'sold_out';

export interface Sale {
  id: string;
  name: string;
  status: SaleStatus;
  stockRemaining: number;
  serverNow: string;
  startsAt: string;
  endsAt: string;
}

export type PurchaseResponse =
  | { outcome: 'confirmed'; orderId: string }
  | { outcome: 'already_purchased'; orderId: string }
  | { outcome: 'upcoming' | 'ended' | 'sold_out' };

export interface ApiFailure {
  code: string;
  message: string;
  status: number;
}
