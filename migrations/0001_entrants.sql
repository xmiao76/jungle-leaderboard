-- Migration number: 0001 — the Arena catalog: one row per admitted entrant.
-- The .wasm bytes live in R2 under "<sha256>.wasm"; this table is the catalog index.
-- The Arena lists only rows with status 'listed'.

CREATE TABLE entrants (
  sha256         TEXT PRIMARY KEY CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size           INTEGER NOT NULL CHECK (size > 0 AND size <= 25165824),
  title          TEXT NOT NULL CHECK (length(title) > 0),
  game_version   TEXT NOT NULL CHECK (length(game_version) > 0),
  model          TEXT NOT NULL,
  code_agent     TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  runtime        TEXT NOT NULL,
  rules_id       TEXT NOT NULL,
  rules_digest   TEXT NOT NULL,
  -- JSON {language, source, toolchain}, or NULL.
  provenance     TEXT,
  credits        TEXT,
  -- JSON: what was checked before admission, and where.
  report         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'listed' CHECK (status IN ('listed', 'hidden')),
  is_reference   INTEGER NOT NULL DEFAULT 0 CHECK (is_reference IN (0, 1)),
  -- Salted hash of the uploader's address, for quotas and abuse review; NULL for seed entries.
  uploader       TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX entrants_listing ON entrants (status, title, created_at);

-- At most one reference opponent (the program every upload test plays against).
CREATE UNIQUE INDEX entrants_one_reference ON entrants (is_reference) WHERE is_reference = 1;
