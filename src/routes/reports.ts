import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { amountPaidCents, dueCents, totalExpensesCents } from '../compute.js';
import { monthToRange } from '../periods.js';
import { reportQuery } from '../schemas.js';
import { toExpenseResponse } from './expenses.js';

interface Bucket {
  revenueCents: number;
  collectedCents: number;
  expensesCents: number;
  profitCents: number;
}

function emptyBucket(): Bucket {
  return { revenueCents: 0, collectedCents: 0, expensesCents: 0, profitCents: 0 };
}

function addToBucket(bucket: Bucket, revenue: number, collected: number, expenses: number): void {
  bucket.revenueCents += revenue;
  bucket.collectedCents += collected;
  bucket.expensesCents += expenses;
  bucket.profitCents += collected - expenses;
}

export function reportRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/api/reports', async (req) => {
    const q = reportQuery.parse(req.query);
    const { from, to } = q.month ? monthToRange(q.month) : { from: q.from!, to: q.to! };

    const eventsRes = await pool.query(
      `SELECT * FROM events WHERE event_date >= $1 AND event_date <= $2 ORDER BY event_date ASC`,
      [from, to],
    );
    const eventIds = eventsRes.rows.map((r) => r.id);
    const expensesByEvent = new Map<string, { amountCents: number }[]>();
    if (eventIds.length > 0) {
      const expensesRes = await pool.query(
        `SELECT * FROM events_expenses WHERE event_id = ANY($1::uuid[])`,
        [eventIds],
      );
      for (const row of expensesRes.rows) {
        const list = expensesByEvent.get(row.event_id) ?? [];
        list.push(toExpenseResponse(row));
        expensesByEvent.set(row.event_id, list);
      }
    }

    const totals = emptyBucket();
    let outstandingCents = 0;
    const byJobType: Record<string, Bucket> = {};
    const byEventType: Record<string, Bucket> = {};
    const eventSummaries = [];

    for (const row of eventsRes.rows) {
      const money = { priceCents: row.price_cents, depositCents: row.deposit_cents, restCents: row.rest_cents };
      const collected = amountPaidCents(money);
      const expenses = totalExpensesCents(expensesByEvent.get(row.id) ?? []);
      const due = dueCents(money);

      addToBucket(totals, row.price_cents, collected, expenses);
      if (due > 0) outstandingCents += due;

      byJobType[row.job_type] ??= emptyBucket();
      addToBucket(byJobType[row.job_type], row.price_cents, collected, expenses);

      byEventType[row.event_type] ??= emptyBucket();
      addToBucket(byEventType[row.event_type], row.price_cents, collected, expenses);

      eventSummaries.push({
        id: row.id,
        customerName: row.customer_name,
        eventDate: row.event_date,
        eventType: row.event_type,
        decorStyle: row.decor_style,
        jobType: row.job_type,
        priceCents: row.price_cents,
        amountPaidCents: collected,
        dueCents: due,
        status: row.status,
      });
    }

    return {
      period: { from, to },
      totals: { ...totals, outstandingCents },
      events: eventSummaries,
      byJobType,
      byEventType,
    };
  });
}
