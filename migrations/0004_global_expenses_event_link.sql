ALTER TABLE global_expenses
  ADD COLUMN event_id uuid REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX global_expenses_event_idx ON global_expenses (event_id);
