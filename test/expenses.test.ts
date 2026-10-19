import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { AUTH_HEADERS, buildTestApp } from './helpers/testApp.js';

describe('expenses routes', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let authCookie: string;
  let eventId: string;

  beforeEach(async () => {
    ({ app, pool, authCookie } = await buildTestApp({ today: () => '2026-06-15' }));
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: {
        customerName: 'Priya Rao',
        eventDate: '2026-07-01',
        eventType: 'Wedding',
        decorStyle: 'balloon',
        jobType: 'rental',
        priceCents: 50000,
        depositCents: 20000,
        depositPaidOn: '2026-06-01',
      },
    });
    eventId = created.json().id;
  });

  afterEach(async () => {
    await app.close();
    await pool.end();
  });

  it('adds an expense and reflects it in the event totals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 1500, note: 'balloons at Party City', spentOn: '2026-06-20' },
    });
    expect(res.statusCode).toBe(201);

    const event = await app.inject({ method: 'GET', url: `/api/events/${eventId}`, headers: { cookie: authCookie } });
    const body = event.json();
    expect(body.expenses).toHaveLength(1);
    expect(body.totalExpensesCents).toBe(1500);
    expect(body.finalAmountCents).toBe(20000 - 1500);
  });

  it('updates an expense', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 1500, note: 'balloons', spentOn: '2026-06-20' },
    });
    const expenseId = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/expenses/${expenseId}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 2000, note: 'balloons and ribbon', spentOn: '2026-06-21' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().amountCents).toBe(2000);
  });

  it('deletes an expense', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 1500, note: 'balloons', spentOn: '2026-06-20' },
    });
    const expenseId = created.json().id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/events/${eventId}/expenses/${expenseId}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
    });
    expect(del.statusCode).toBe(204);
    const event = await app.inject({ method: 'GET', url: `/api/events/${eventId}`, headers: { cookie: authCookie } });
    expect(event.json().expenses).toHaveLength(0);
  });

  it('cascade-deletes expenses when the event is deleted', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 1500, note: 'balloons', spentOn: '2026-06-20' },
    });
    await app.inject({ method: 'DELETE', url: `/api/events/${eventId}`, headers: { ...AUTH_HEADERS, cookie: authCookie } });
    const remaining = await pool.query('SELECT * FROM events_expenses WHERE event_id = $1', [eventId]);
    expect(remaining.rows).toHaveLength(0);
  });
});
