export interface EventMoney {
  priceCents: number;
  depositCents: number;
  restCents: number;
}

export function amountPaidCents(m: EventMoney): number {
  return m.depositCents + m.restCents;
}

export function dueCents(m: EventMoney): number {
  return m.priceCents - amountPaidCents(m);
}

export function totalExpensesCents(expenses: { amountCents: number }[]): number {
  return expenses.reduce((sum, e) => sum + e.amountCents, 0);
}

export function finalAmountCents(m: EventMoney, expenses: { amountCents: number }[]): number {
  return amountPaidCents(m) - totalExpensesCents(expenses);
}

export type EventStatus = 'outstanding' | 'done';

export function resolveAutoStatus(eventDate: string, due: number, today: string): EventStatus {
  return eventDate < today && due <= 0 ? 'done' : 'outstanding';
}

export function resolveStatus(input: {
  eventDate: string;
  dueCents: number;
  today: string;
  storedStatus: EventStatus;
  statusIsManual: boolean;
}): EventStatus {
  if (input.statusIsManual) return input.storedStatus;
  return resolveAutoStatus(input.eventDate, input.dueCents, input.today);
}
