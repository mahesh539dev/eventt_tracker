import { describe, expect, it } from 'vitest';
import { amountPaidCents, dueCents, finalAmountCents, resolveAutoStatus, resolveStatus, totalExpensesCents } from '../src/compute.js';

describe('amountPaidCents', () => {
  it('sums deposit and rest', () => {
    expect(amountPaidCents({ priceCents: 10000, depositCents: 2000, restCents: 3000 })).toBe(5000);
  });
});

describe('dueCents', () => {
  it('is price minus amount paid', () => {
    expect(dueCents({ priceCents: 10000, depositCents: 2000, restCents: 3000 })).toBe(5000);
  });
  it('can go negative if overpaid, left to the caller to interpret', () => {
    expect(dueCents({ priceCents: 1000, depositCents: 2000, restCents: 0 })).toBe(-1000);
  });
});

describe('totalExpensesCents / finalAmountCents', () => {
  it('sums expenses and subtracts from amount paid', () => {
    const money = { priceCents: 10000, depositCents: 4000, restCents: 6000 };
    const expenses = [{ amountCents: 1500 }, { amountCents: 500 }];
    expect(totalExpensesCents(expenses)).toBe(2000);
    expect(finalAmountCents(money, expenses)).toBe(8000);
  });
  it('returns 0 total for no expenses', () => {
    expect(totalExpensesCents([])).toBe(0);
  });
});

describe('resolveAutoStatus', () => {
  it('is outstanding when due > 0, even if the event date has passed', () => {
    expect(resolveAutoStatus('2026-01-01', 500, '2026-06-01')).toBe('outstanding');
  });
  it('is outstanding when the event date is today, even if fully paid', () => {
    expect(resolveAutoStatus('2026-06-01', 0, '2026-06-01')).toBe('outstanding');
  });
  it('is outstanding when the event date is in the future and fully paid', () => {
    expect(resolveAutoStatus('2026-07-01', 0, '2026-06-01')).toBe('outstanding');
  });
  it('is done when the event date is strictly before today and due <= 0', () => {
    expect(resolveAutoStatus('2026-05-31', 0, '2026-06-01')).toBe('done');
  });
  it('is done when overpaid (due negative) and the date has passed', () => {
    expect(resolveAutoStatus('2026-05-31', -100, '2026-06-01')).toBe('done');
  });
});

describe('resolveStatus', () => {
  it('uses the auto-resolved status when not manually overridden', () => {
    const result = resolveStatus({
      eventDate: '2026-05-31',
      dueCents: 0,
      today: '2026-06-01',
      storedStatus: 'outstanding',
      statusIsManual: false,
    });
    expect(result).toBe('done');
  });
  it('keeps the manually-set status even if auto-resolution would disagree', () => {
    const result = resolveStatus({
      eventDate: '2026-05-31',
      dueCents: 0,
      today: '2026-06-01',
      storedStatus: 'outstanding',
      statusIsManual: true,
    });
    expect(result).toBe('outstanding');
  });
});
