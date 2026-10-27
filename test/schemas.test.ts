import { describe, expect, it } from 'vitest';
import { eventCreateBody, eventUpdateBody, expenseBody, reportQuery } from '../src/schemas.js';

describe('eventCreateBody', () => {
  const valid = {
    customerName: 'Priya Rao',
    customerPhone: '555-1234',
    eventDate: '2026-11-01',
    eventType: 'Wedding',
    decorStyle: 'indian_traditional',
    jobType: 'service',
    priceCents: 50000,
    depositCents: 10000,
    depositPaidOn: '2026-10-01',
    restCents: 0,
    duePaidOn: null,
    notes: '',
  };

  it('accepts a fully valid payload', () => {
    expect(() => eventCreateBody.parse(valid)).not.toThrow();
  });

  it('requires customerName', () => {
    expect(() => eventCreateBody.parse({ ...valid, customerName: '' })).toThrow();
  });

  it('allows customerPhone to be omitted', () => {
    const { customerPhone, ...rest } = valid;
    expect(() => eventCreateBody.parse(rest)).not.toThrow();
  });

  it('rejects a deposit amount with no deposit paid-on date', () => {
    expect(() => eventCreateBody.parse({ ...valid, depositCents: 10000, depositPaidOn: null })).toThrow();
  });

  it('rejects a rest amount with no due paid-on date', () => {
    expect(() => eventCreateBody.parse({ ...valid, restCents: 5000, duePaidOn: null })).toThrow();
  });

  it('rejects an invalid decorStyle', () => {
    expect(() => eventCreateBody.parse({ ...valid, decorStyle: 'floral' })).toThrow();
  });

  it('rejects an invalid jobType', () => {
    expect(() => eventCreateBody.parse({ ...valid, jobType: 'lease' })).toThrow();
  });
});

describe('eventUpdateBody', () => {
  it('rejects raising depositCents without supplying depositPaidOn in the same update', () => {
    expect(() => eventUpdateBody.parse({ depositCents: 15000 })).toThrow();
  });

  it('accepts raising depositCents together with depositPaidOn', () => {
    expect(() => eventUpdateBody.parse({ depositCents: 15000, depositPaidOn: '2026-10-05' })).not.toThrow();
  });

  it('accepts a status-only update', () => {
    expect(() => eventUpdateBody.parse({ status: 'done' })).not.toThrow();
  });
});

describe('expenseBody', () => {
  it('accepts a valid expense', () => {
    expect(() => expenseBody.parse({ amountCents: 1200, note: 'balloons', spentOn: '2026-10-01' })).not.toThrow();
  });
  it('rejects zero amount', () => {
    expect(() => expenseBody.parse({ amountCents: 0, note: '', spentOn: '2026-10-01' })).toThrow();
  });
});

describe('reportQuery', () => {
  it('accepts a month', () => {
    expect(() => reportQuery.parse({ month: '2026-10' })).not.toThrow();
  });
  it('accepts a from/to range', () => {
    expect(() => reportQuery.parse({ from: '2026-10-01', to: '2026-10-31' })).not.toThrow();
  });
  it('rejects neither month nor from/to', () => {
    expect(() => reportQuery.parse({})).toThrow();
  });
  it('rejects from after to', () => {
    expect(() => reportQuery.parse({ from: '2026-10-31', to: '2026-10-01' })).toThrow();
  });
});
