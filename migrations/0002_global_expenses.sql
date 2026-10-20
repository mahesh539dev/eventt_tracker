CREATE TABLE global_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_cents  integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000000),
  category      text NOT NULL CHECK (category IN ('transport','materials','labour','utilities','marketing','other')),
  note          text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
  spent_on      date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX global_expenses_spent_on_idx ON global_expenses (spent_on DESC);
