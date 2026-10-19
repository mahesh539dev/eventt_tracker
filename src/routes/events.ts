import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { amountPaidCents, dueCents, finalAmountCents, resolveStatus, totalExpensesCents } from '../compute.js';
import { eventCreateBody, eventListQuery, eventUpdateBody, uuid } from '../schemas.js';
import { HttpError } from '../errors.js';
import { toExpenseResponse } from './expenses.js';

interface EventRow {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  event_date: string;
  event_type: string;
  decor_style: 'indian_traditional' | 'balloon' | 'both';
  job_type: 'rental' | 'service';
  price_cents: number;
  deposit_cents: number;
  deposit_paid_on: string | null;
  rest_cents: number;
  rest_paid_on: string | null;
  status: 'outstanding' | 'done';
  status_is_manual: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toResponse(row: EventRow, today: string) {
  const money = { priceCents: row.price_cents, depositCents: row.deposit_cents, restCents: row.rest_cents };
  const due = dueCents(money);
  const status = resolveStatus({
    eventDate: row.event_date,
    dueCents: due,
    today,
    storedStatus: row.status,
    statusIsManual: row.status_is_manual,
  });
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    eventDate: row.event_date,
    eventType: row.event_type,
    decorStyle: row.decor_style,
    jobType: row.job_type,
    priceCents: row.price_cents,
    depositCents: row.deposit_cents,
    depositPaidOn: row.deposit_paid_on,
    restCents: row.rest_cents,
    restPaidOn: row.rest_paid_on,
    amountPaidCents: amountPaidCents(money),
    dueCents: due,
    status,
    statusIsManual: row.status_is_manual,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchEvent(pool: pg.Pool, id: string): Promise<EventRow> {
  const res = await pool.query<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
  if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Event not found.');
  return res.rows[0];
}

export function eventRoutes(app: FastifyInstance, pool: pg.Pool, today: () => string): void {
  app.get('/api/events', async (req) => {
    const q = eventListQuery.parse(req.query);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q.from) {
      params.push(q.from);
      conditions.push(`event_date >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      conditions.push(`event_date <= $${params.length}`);
    }
    if (q.jobType) {
      params.push(q.jobType);
      conditions.push(`job_type = $${params.length}`);
    }
    if (q.decorStyle) {
      params.push(q.decorStyle);
      conditions.push(`decor_style = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      conditions.push(`customer_name ILIKE $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await pool.query<EventRow>(`SELECT * FROM events ${where} ORDER BY event_date ASC`, params);
    const t = today();
    const rows = res.rows.map((r) => toResponse(r, t));
    return q.status ? rows.filter((r) => r.status === q.status) : rows;
  });

  app.post('/api/events', async (req, reply) => {
    const body = eventCreateBody.parse(req.body);
    const res = await pool.query<EventRow>(
      `INSERT INTO events
        (customer_name, customer_phone, event_date, event_type, decor_style, job_type,
         price_cents, deposit_cents, deposit_paid_on, rest_cents, rest_paid_on, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        body.customerName,
        body.customerPhone ?? null,
        body.eventDate,
        body.eventType,
        body.decorStyle,
        body.jobType,
        body.priceCents,
        body.depositCents,
        body.depositPaidOn ?? null,
        body.restCents,
        body.restPaidOn ?? null,
        body.notes,
      ],
    );
    return reply.code(201).send(toResponse(res.rows[0], today()));
  });

  app.get('/api/events/:id', async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const row = await fetchEvent(pool, id);
    const expensesRes = await pool.query(
      'SELECT * FROM events_expenses WHERE event_id = $1 ORDER BY spent_on DESC, created_at DESC',
      [id],
    );
    const expenses = expensesRes.rows.map(toExpenseResponse);
    const base = toResponse(row, today());
    return {
      ...base,
      expenses,
      totalExpensesCents: totalExpensesCents(expenses.map((e) => ({ amountCents: e.amountCents }))),
      finalAmountCents: finalAmountCents(
        { priceCents: row.price_cents, depositCents: row.deposit_cents, restCents: row.rest_cents },
        expenses.map((e) => ({ amountCents: e.amountCents })),
      ),
    };
  });

  app.patch('/api/events/:id', async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const body = eventUpdateBody.parse(req.body);
    const existing = await fetchEvent(pool, id);

    const next: Record<string, unknown> = {
      customer_name: body.customerName ?? existing.customer_name,
      customer_phone: body.customerPhone !== undefined ? body.customerPhone : existing.customer_phone,
      event_date: body.eventDate ?? existing.event_date,
      event_type: body.eventType ?? existing.event_type,
      decor_style: body.decorStyle ?? existing.decor_style,
      job_type: body.jobType ?? existing.job_type,
      price_cents: body.priceCents ?? existing.price_cents,
      deposit_cents: body.depositCents ?? existing.deposit_cents,
      deposit_paid_on: body.depositPaidOn !== undefined ? body.depositPaidOn : existing.deposit_paid_on,
      rest_cents: body.restCents ?? existing.rest_cents,
      rest_paid_on: body.restPaidOn !== undefined ? body.restPaidOn : existing.rest_paid_on,
      notes: body.notes ?? existing.notes,
      status: existing.status,
      status_is_manual: existing.status_is_manual,
    };

    if (body.resetStatusToAutomatic) {
      next.status_is_manual = false;
    } else if (body.status) {
      next.status = body.status;
      next.status_is_manual = true;
    }

    const res = await pool.query<EventRow>(
      `UPDATE events SET
        customer_name=$1, customer_phone=$2, event_date=$3, event_type=$4, decor_style=$5, job_type=$6,
        price_cents=$7, deposit_cents=$8, deposit_paid_on=$9, rest_cents=$10, rest_paid_on=$11,
        notes=$12, status=$13, status_is_manual=$14, updated_at=now()
       WHERE id=$15
       RETURNING *`,
      [
        next.customer_name,
        next.customer_phone,
        next.event_date,
        next.event_type,
        next.decor_style,
        next.job_type,
        next.price_cents,
        next.deposit_cents,
        next.deposit_paid_on,
        next.rest_cents,
        next.rest_paid_on,
        next.notes,
        next.status,
        next.status_is_manual,
        id,
      ],
    );
    return toResponse(res.rows[0], today());
  });

  app.delete('/api/events/:id', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    await fetchEvent(pool, id);
    await pool.query('DELETE FROM events WHERE id = $1', [id]);
    return reply.code(204).send();
  });
}
