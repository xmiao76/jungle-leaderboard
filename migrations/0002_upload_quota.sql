-- Migration number: 0002 — per-uploader daily upload quota (server/catalog-upload.ts).
-- One row per uploader per UTC day; the uploader is a salted hash of the client address,
-- never the address itself. Rows are tiny and keyed by day, so old days can be pruned anytime.

CREATE TABLE upload_quota (
  -- '<salted uploader hash>|<YYYY-MM-DD>' in UTC.
  bucket TEXT PRIMARY KEY,
  count  INTEGER NOT NULL CHECK (count > 0)
);
