CREATE TABLE event_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  filename    text NOT NULL,
  mime_type   text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/gif')),
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_photos_event_idx ON event_photos (event_id);
