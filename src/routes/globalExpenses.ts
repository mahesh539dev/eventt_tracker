import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { globalExpenseBody, uuid } from '../schemas.js';
import { HttpError } from '../errors.js';

interface GlobalExpenseRow {
  id: string;
  amount_cents: number;
  category: string;
  note: string;
  spent_on: string;
  created_at: string;
}

function toResponse(row: GlobalExpenseRow) {
  return { id: row.id, amountCents: row.amount_cents, category: row.category, note: row.note, spentOn: row.spent_on, createdAt: row.created_at };
}

export function globalExpenseRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/api/global-expenses', async (req) => {
    const q = req.query as { from?: string; to?: string };
    let sql = 'SELECT * FROM global_expenses';
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (q.from) { params.push(q.from); conditions.push(`spent_on >= $${params.length}`); }
    if (q.to) { params.push(q.to); conditions.push(`spent_on <= $${params.length}`); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY spent_on DESC, created_at DESC';
    const res = await pool.query<GlobalExpenseRow>(sql, params);
    return res.rows.map(toResponse);
  });

  app.post('/api/global-expenses', async (req, reply) => {
    const body = globalExpenseBody.parse(req.body);
    const res = await pool.query<GlobalExpenseRow>(
      `INSERT INTO global_expenses (amount_cents, category, note, spent_on) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.amountCents, body.category, body.note, body.spentOn],
    );
    return reply.code(201).send(toResponse(res.rows[0]));
  });

  app.patch('/api/global-expenses/:id', async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const body = globalExpenseBody.parse(req.body);
    const res = await pool.query<GlobalExpenseRow>(
      `UPDATE global_expenses SET amount_cents=$1, category=$2, note=$3, spent_on=$4 WHERE id=$5 RETURNING *`,
      [body.amountCents, body.category, body.note, body.spentOn, id],
    );
    if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Expense not found.');
    return toResponse(res.rows[0]);
  });

  app.delete('/api/global-expenses/:id', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const res = await pool.query('DELETE FROM global_expenses WHERE id = $1', [id]);
    if (res.rowCount === 0) throw new HttpError(404, 'not_found', 'Expense not found.');
    return reply.code(204).send();
  });
}
