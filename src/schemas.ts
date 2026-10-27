import { z } from 'zod';

export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const dateStr = z
  .string({ error: 'Choose a date.' })
  .refine(isRealDate, { error: 'Date must be a real calendar date (YYYY-MM-DD).' });

export const uuid = z.uuid({ error: 'Invalid id.' });

const MAX_CENTS = 1_000_000_000;

const money = (label: string) =>
  z
    .number({ error: `${label} must be a whole number of cents.` })
    .int(`${label} must be a whole number of cents.`)
    .min(0, `${label} cannot be negative.`)
    .max(MAX_CENTS, `${label} is too large.`);

const eventFields = {
  customerName: z
    .string({ error: 'Customer name is required.' })
    .trim()
    .min(1, 'Customer name is required.')
    .max(100, 'Customer name must be 100 characters or fewer.'),
  customerPhone: z.string().trim().max(30, 'Phone must be 30 characters or fewer.').nullable().optional(),
  eventDate: dateStr,
  eventType: z
    .string({ error: 'Event type is required.' })
    .trim()
    .min(1, 'Event type is required.')
    .max(60, 'Event type must be 60 characters or fewer.'),
  decorStyle: z.enum(['indian_traditional', 'balloon', 'both'], { error: 'Pick a decor style.' }),
  jobType: z.enum(['rental', 'service'], { error: 'Pick a job type.' }),
  priceCents: money('Price'),
  depositCents: money('Deposit').default(0),
  depositPaidOn: dateStr.nullable().optional(),
  restCents: money('Rest payment').default(0),
  duePaidOn: dateStr.nullable().optional(),
  status: z.enum(['outstanding', 'done']).optional(),
  notes: z.string().trim().max(2000, 'Notes must be 2000 characters or fewer.').default(''),
  address: z.string().trim().max(500, 'Address must be 500 characters or fewer.').nullable().optional(),
  timings: z.string().trim().max(200, 'Timings must be 200 characters or fewer.').nullable().optional(),
};

function requirePaidOnWhenPositive(v: { depositCents?: number; depositPaidOn?: string | null; restCents?: number; duePaidOn?: string | null }, ctx: z.RefinementCtx) {
  if ((v.depositCents ?? 0) > 0 && !v.depositPaidOn) {
    ctx.addIssue({ code: 'custom', path: ['depositPaidOn'], message: 'Deposit paid date is required when a deposit amount is set.' });
  }
  if ((v.restCents ?? 0) > 0 && !v.duePaidOn) {
    ctx.addIssue({ code: 'custom', path: ['duePaidOn'], message: 'Due paid date is required when a rest amount is set.' });
  }
}

export const eventCreateBody = z.object(eventFields).superRefine(requirePaidOnWhenPositive);

export const eventUpdateBody = z
  .object({
    customerName: eventFields.customerName.optional(),
    customerPhone: eventFields.customerPhone,
    eventDate: eventFields.eventDate.optional(),
    eventType: eventFields.eventType.optional(),
    decorStyle: eventFields.decorStyle.optional(),
    jobType: eventFields.jobType.optional(),
    priceCents: eventFields.priceCents.optional(),
    depositCents: money('Deposit').optional(),
    depositPaidOn: eventFields.depositPaidOn,
    restCents: money('Rest payment').optional(),
    duePaidOn: eventFields.duePaidOn,
    status: eventFields.status,
    resetStatusToAutomatic: z.boolean().optional(),
    notes: z.string().trim().max(2000, 'Notes must be 2000 characters or fewer.').optional(),
    address: eventFields.address,
    timings: eventFields.timings,
  })
  .superRefine((v, ctx) => {
    if (v.depositCents !== undefined && v.depositCents > 0 && !v.depositPaidOn) {
      ctx.addIssue({ code: 'custom', path: ['depositPaidOn'], message: 'Deposit paid date is required when a deposit amount is set.' });
    }
    if (v.restCents !== undefined && v.restCents > 0 && !v.duePaidOn) {
      ctx.addIssue({ code: 'custom', path: ['duePaidOn'], message: 'Due paid date is required when a rest amount is set.' });
    }
  });

export const eventListQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  status: z.enum(['outstanding', 'done']).optional(),
  jobType: z.enum(['rental', 'service']).optional(),
  decorStyle: z.enum(['indian_traditional', 'balloon', 'both']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const expenseBody = z.object({
  amountCents: z
    .number({ error: 'Amount must be greater than zero.' })
    .int('Amount must be a whole number of cents.')
    .min(1, 'Amount must be greater than zero.')
    .max(MAX_CENTS, 'Amount is too large.'),
  note: z.string().trim().max(200, 'Note must be 200 characters or fewer.').default(''),
  spentOn: dateStr,
});

export const GLOBAL_EXPENSE_CATEGORIES = ['transport', 'materials', 'labour', 'utilities', 'marketing', 'other'] as const;

export const globalExpenseBody = z.object({
  amountCents: z
    .number({ error: 'Amount must be greater than zero.' })
    .int('Amount must be a whole number of cents.')
    .min(1, 'Amount must be greater than zero.')
    .max(MAX_CENTS, 'Amount is too large.'),
  category: z.enum(GLOBAL_EXPENSE_CATEGORIES, { error: 'Pick a category.' }),
  note: z.string().trim().max(200, 'Note must be 200 characters or fewer.').default(''),
  spentOn: dateStr,
});

export const reportQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')
      .optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.month) return;
    if (!v.from || !v.to) {
      ctx.addIssue({ code: 'custom', message: 'Provide either "month" or both "from" and "to".' });
      return;
    }
    if (v.from > v.to) ctx.addIssue({ code: 'custom', message: '"from" must not be after "to".' });
  });
