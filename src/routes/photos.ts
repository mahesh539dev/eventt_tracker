import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { uuid } from '../schemas.js';
import { HttpError } from '../errors.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB decoded

const uploadBody = z.object({
  filename: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_TYPES, { error: 'Unsupported image type.' }),
  dataBase64: z.string().min(1, 'Image data is required.'),
});

async function ensureEventExists(pool: pg.Pool, eventId: string): Promise<void> {
  const res = await pool.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
  if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Event not found.');
}

export function photoRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/api/events/:id/photos', async (req) => {
    const eventId = uuid.parse((req.params as { id: string }).id);
    await ensureEventExists(pool, eventId);
    const res = await pool.query(
      `SELECT id, filename, mime_type, created_at FROM event_photos WHERE event_id = $1 ORDER BY created_at ASC`,
      [eventId],
    );
    return res.rows.map((r) => ({ id: r.id, filename: r.filename, mimeType: r.mime_type, createdAt: r.created_at }));
  });

  app.post('/api/events/:id/photos', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const eventId = uuid.parse((req.params as { id: string }).id);
    await ensureEventExists(pool, eventId);
    const body = uploadBody.parse(req.body);

    const buf = Buffer.from(body.dataBase64, 'base64');
    if (buf.length > MAX_BYTES) throw new HttpError(413, 'too_large', 'Image must be 5 MB or smaller.');

    const res = await pool.query(
      `INSERT INTO event_photos (event_id, filename, mime_type, data) VALUES ($1,$2,$3,$4) RETURNING id, filename, mime_type, created_at`,
      [eventId, body.filename, body.mimeType, buf],
    );
    const r = res.rows[0];
    return reply.code(201).send({ id: r.id, filename: r.filename, mimeType: r.mime_type, createdAt: r.created_at });
  });

  app.get('/api/photos/:id', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const res = await pool.query<{ mime_type: string; data: Buffer }>(
      `SELECT mime_type, data FROM event_photos WHERE id = $1`,
      [id],
    );
    if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Photo not found.');
    const { mime_type, data } = res.rows[0];
    return reply
      .header('Content-Type', mime_type)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(data);
  });

  app.delete('/api/photos/:id', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const res = await pool.query('DELETE FROM event_photos WHERE id = $1', [id]);
    if (res.rowCount === 0) throw new HttpError(404, 'not_found', 'Photo not found.');
    return reply.code(204).send();
  });
}
