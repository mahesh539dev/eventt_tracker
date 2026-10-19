import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { expenseBody, uuid } from '../schemas.js';
import { HttpError } from '../errors.js';

interface ExpenseRow {
  id: string;
  event_id: string;
  amount_cents: number;
  note: string;
  spent_on: string;
  created_at: string;
}

export function toExpenseResponse(row: ExpenseRow) {
  return { id: row.id, amountCents: row.amount_cents, note: row.note, spentOn: row.spent_on, createdAt: row.created_at };
}

async function ensureEventExists(pool: pg.Pool, eventId: string): Promise<void> {
  const res = await pool.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
  if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Event not found.');
}

export function expenseRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/api/events/:id/expenses', async (req, reply) => {
    const eventId = uuid.parse((req.params as { id: string }).id);
    await ensureEventExists(pool, eventId);
    const body = expenseBody.parse(req.body);
    const res = await pool.query<ExpenseRow>(
      `INSERT INTO events_expenses (event_id, amount_cents, note, spent_on) VALUES ($1,$2,$3,$4) RETURNING *`,
      [eventId, body.amountCents, body.note, body.spentOn],
    );
    return reply.code(201).send(toExpenseResponse(res.rows[0]));
  });

  app.patch('/api/events/:id/expenses/:expenseId', async (req) => {
    const eventId = uuid.parse((req.params as { id: string }).id);
    const expenseId = uuid.parse((req.params as { expenseId: string }).expenseId);
    await ensureEventExists(pool, eventId);
    const body = expenseBody.parse(req.body);
    const res = await pool.query<ExpenseRow>(
      `UPDATE events_expenses SET amount_cents=$1, note=$2, spent_on=$3 WHERE id=$4 AND event_id=$5 RETURNING *`,
      [body.amountCents, body.note, body.spentOn, expenseId, eventId],
    );
    if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Expense not found.');
    return toExpenseResponse(res.rows[0]);
  });

  app.delete('/api/events/:id/expenses/:expenseId', async (req, reply) => {
    const eventId = uuid.parse((req.params as { id: string }).id);
    const expenseId = uuid.parse((req.params as { expenseId: string }).expenseId);
    await ensureEventExists(pool, eventId);
    await pool.query('DELETE FROM events_expenses WHERE id = $1 AND event_id = $2', [expenseId, eventId]);
    return reply.code(204).send();
  });
}
