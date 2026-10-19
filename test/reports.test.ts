import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { AUTH_HEADERS, buildTestApp } from './helpers/testApp.js';

describe('reports route', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let authCookie: string;

  async function createEvent(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload,
    });
    return res.json();
  }

  beforeEach(async () => {
    ({ app, pool, authCookie } = await buildTestApp({ today: () => '2026-10-15' }));
  });

  afterEach(async () => {
    await app.close();
    await pool.end();
  });

  it('totals revenue, collected, expenses, profit, and outstanding for a month', async () => {
    const e1 = await createEvent({
      customerName: 'A',
      eventDate: '2026-10-01',
      eventType: 'Wedding',
      decorStyle: 'indian_traditional',
      jobType: 'service',
      priceCents: 50000,
      depositCents: 20000,
      depositPaidOn: '2026-09-01',
    });
    await app.inject({
      method: 'POST',
      url: `/api/events/${e1.id}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 3000, note: 'flowers', spentOn: '2026-09-15' },
    });
    await createEvent({
      customerName: 'B',
      eventDate: '2026-10-31',
      eventType: 'Birthday',
      decorStyle: 'balloon',
      jobType: 'rental',
      priceCents: 20000,
      depositCents: 20000,
      depositPaidOn: '2026-10-01',
    });
    // out of range: should not appear in the October report
    await createEvent({
      customerName: 'C',
      eventDate: '2026-11-01',
      eventType: 'Birthday',
      decorStyle: 'balloon',
      jobType: 'rental',
      priceCents: 10000,
    });

    const res = await app.inject({ method: 'GET', url: '/api/reports?month=2026-10', headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.events).toHaveLength(2);
    expect(body.totals.revenueCents).toBe(70000);
    expect(body.totals.collectedCents).toBe(40000);
    expect(body.totals.expensesCents).toBe(3000);
    expect(body.totals.profitCents).toBe(40000 - 3000);
    expect(body.totals.outstandingCents).toBe(30000);

    expect(body.byJobType.service.revenueCents).toBe(50000);
    expect(body.byJobType.rental.revenueCents).toBe(20000);

    expect(body.byEventType.Wedding.revenueCents).toBe(50000);
    expect(body.byEventType.Birthday.revenueCents).toBe(20000);
  });

  it('a custom range spanning two months totals the same as summing the two months', async () => {
    await createEvent({
      customerName: 'A',
      eventDate: '2026-10-31',
      eventType: 'Wedding',
      decorStyle: 'indian_traditional',
      jobType: 'service',
      priceCents: 10000,
    });
    await createEvent({
      customerName: 'B',
      eventDate: '2026-11-01',
      eventType: 'Birthday',
      decorStyle: 'balloon',
      jobType: 'rental',
      priceCents: 5000,
    });

    const oct = await app.inject({ method: 'GET', url: '/api/reports?month=2026-10', headers: { cookie: authCookie } });
    const nov = await app.inject({ method: 'GET', url: '/api/reports?month=2026-11', headers: { cookie: authCookie } });
    const range = await app.inject({ method: 'GET', url: '/api/reports?from=2026-10-01&to=2026-11-30', headers: { cookie: authCookie } });

    expect(range.json().totals.revenueCents).toBe(oct.json().totals.revenueCents + nov.json().totals.revenueCents);
  });

  it('rejects a request with neither month nor from/to', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports', headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(400);
  });
});
