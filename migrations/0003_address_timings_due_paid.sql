ALTER TABLE events
  ADD COLUMN address text CHECK (address IS NULL OR char_length(btrim(address)) <= 500),
  ADD COLUMN timings text CHECK (timings IS NULL OR char_length(btrim(timings)) <= 200),
  RENAME COLUMN rest_paid_on TO due_paid_on;
