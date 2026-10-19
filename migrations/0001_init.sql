CREATE TABLE events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name      text NOT NULL CHECK (char_length(btrim(customer_name)) BETWEEN 1 AND 100),
  customer_phone     text CHECK (customer_phone IS NULL OR char_length(btrim(customer_phone)) <= 30),
  event_date         date NOT NULL,
  event_type         text NOT NULL CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 60),
  decor_style        text NOT NULL CHECK (decor_style IN ('indian_traditional', 'balloon', 'both')),
  job_type           text NOT NULL CHECK (job_type IN ('rental', 'service')),
  price_cents        integer NOT NULL CHECK (price_cents BETWEEN 0 AND 1000000000),
  deposit_cents      integer NOT NULL DEFAULT 0 CHECK (deposit_cents BETWEEN 0 AND 1000000000),
  deposit_paid_on    date,
  rest_cents         integer NOT NULL DEFAULT 0 CHECK (rest_cents BETWEEN 0 AND 1000000000),
  rest_paid_on       date,
  status             text NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding', 'done')),
  status_is_manual   boolean NOT NULL DEFAULT false,
  notes              text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (deposit_cents = 0 OR deposit_paid_on IS NOT NULL),
  CHECK (rest_cents = 0 OR rest_paid_on IS NOT NULL)
);
CREATE INDEX events_event_date_idx ON events (event_date DESC);
CREATE INDEX events_status_idx ON events (status);

CREATE TABLE events_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  amount_cents  integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000000),
  note          text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
  spent_on      date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_expenses_event_idx ON events_expenses (event_id);
CREATE INDEX events_expenses_spent_on_idx ON events_expenses (spent_on DESC);
