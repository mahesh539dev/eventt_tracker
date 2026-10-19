import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { AUTH_HEADERS, buildTestApp } from './helpers/testApp.js';

describe('events routes', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let authCookie: string;

  beforeEach(async () => {
    ({ app, pool, authCookie } = await buildTestApp({ today: () => '2026-06-15' }));
  });

  afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const validEvent = {
    customerName: 'Priya Rao',
    eventDate: '2026-07-01',
    eventType: 'Wedding',
    decorStyle: 'indian_traditional',
    jobType: 'service',
    priceCents: 50000,
  };

  it('creates an event and returns derived fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: validEvent,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.amountPaidCents).toBe(0);
    expect(body.dueCents).toBe(50000);
    expect(body.status).toBe('outstanding');
    expect(body.statusIsManual).toBe(false);
  });

  it('rejects creating an event with a deposit but no deposit paid-on date', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, depositCents: 10000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists created events sorted by event date', async () => {
    await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, customerName: 'Second Customer', eventDate: '2026-08-01' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/events', headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('gets a single event by id', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/api/events/${id}`, headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().customerName).toBe('Priya Rao');
  });

  it('returns 404 for a nonexistent event id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events/00000000-0000-0000-0000-000000000000', headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a PATCH that raises depositCents without supplying depositPaidOn', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    const id = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { depositCents: 10000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a PATCH that pays the deposit with its date and recomputes due', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    const id = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { depositCents: 10000, depositPaidOn: '2026-06-10' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().amountPaidCents).toBe(10000);
    expect(res.json().dueCents).toBe(40000);
  });

  it('auto-resolves status to done once the event date has passed and it is fully paid', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-04-01' },
    });
    expect(created.json().status).toBe('done');
  });

  it('keeps a manually-set status even when auto-resolution would disagree', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-04-01' },
    });
    const id = created.json().id;
    const manual = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { status: 'outstanding' },
    });
    expect(manual.json().status).toBe('outstanding');
    expect(manual.json().statusIsManual).toBe(true);

    const reread = await app.inject({ method: 'GET', url: `/api/events/${id}`, headers: { cookie: authCookie } });
    expect(reread.json().status).toBe('outstanding');
  });

  it('a PATCH that omits status does not mark it manual, even when other fields change', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-04-01' },
    });
    expect(created.json().status).toBe('done');
    expect(created.json().statusIsManual).toBe(false);
    const id = created.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { customerPhone: '555-1234', notes: 'updated phone number only, no status field sent' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().statusIsManual).toBe(false);
    expect(res.json().status).toBe('done');
  });

  it('resets to automatic status on request', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-04-01' },
    });
    const id = created.json().id;
    await app.inject({ method: 'PATCH', url: `/api/events/${id}`, headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: { status: 'outstanding' } });
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { resetStatusToAutomatic: true },
    });
    expect(reset.json().statusIsManual).toBe(false);
    expect(reset.json().status).toBe('done');
  });

  it('deletes an event', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    const id = created.json().id;
    const del = await app.inject({ method: 'DELETE', url: `/api/events/${id}`, headers: { ...AUTH_HEADERS, cookie: authCookie } });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/events/${id}`, headers: { cookie: authCookie } });
    expect(get.statusCode).toBe(404);
  });

  it('is outstanding when the event is dated exactly today, even if fully paid', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-06-15', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-06-01' },
    });
    expect(created.json().status).toBe('outstanding');
  });

  it('is outstanding when due is still positive, even though the event date has passed', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 5000, depositPaidOn: '2026-04-01' },
    });
    expect(created.json().status).toBe('outstanding');
  });

  it('is done when the event date is yesterday and due is exactly zero', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-06-14', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-06-01' },
    });
    expect(created.json().status).toBe('done');
  });
});
