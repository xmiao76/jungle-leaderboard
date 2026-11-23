-- Migration number: 0004 — Elo ratings and the results of rated matches (server/match-report.ts).

-- Every published program starts at 1000. `rating_seq` counts rating changes and never goes
-- down; a writer claims (sha256, rating_seq + 1) in rating_changes, so two writers that read the
-- same rating collide on that key and the later batch rolls back and retries.
ALTER TABLE entrants ADD COLUMN rating REAL NOT NULL DEFAULT 1000;
ALTER TABLE entrants ADD COLUMN rating_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entrants ADD COLUMN rated_matches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entrants ADD COLUMN game_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entrants ADD COLUMN game_losses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entrants ADD COLUMN game_draws INTEGER NOT NULL DEFAULT 0;

-- One row per reported two-game match: which two programs played, each game's result, and the
-- wins, losses and draws. `counted` matches changed ratings; `unrated` ones are kept for the
-- record only (a forfeit, or both programs from one uploader); `voided` ones were withdrawn by a
-- maintainer after an audit and are ignored by a recompute.
CREATE TABLE matches (
  id                  INTEGER PRIMARY KEY,
  left_sha            TEXT NOT NULL REFERENCES entrants (sha256),
  right_sha           TEXT NOT NULL REFERENCES entrants (sha256),
  -- The pair sorted, for the one-report-per-match key below.
  sha_lo              TEXT NOT NULL,
  sha_hi              TEXT NOT NULL,
  left_side           TEXT NOT NULL CHECK (left_side IN ('red', 'blue')),
  first_side          TEXT NOT NULL CHECK (first_side IN ('red', 'blue')),
  seed                INTEGER NOT NULL,
  difficulty          TEXT NOT NULL,
  node_budget         INTEGER NOT NULL,
  think_ms            INTEGER NOT NULL,
  game1_result        TEXT NOT NULL CHECK (game1_result IN ('left', 'right', 'draw')),
  game1_reason        TEXT NOT NULL,
  game1_plies         INTEGER NOT NULL,
  game2_result        TEXT NOT NULL CHECK (game2_result IN ('left', 'right', 'draw')),
  game2_reason        TEXT NOT NULL,
  game2_plies         INTEGER NOT NULL,
  left_wins           INTEGER NOT NULL,
  right_wins          INTEGER NOT NULL,
  draws               INTEGER NOT NULL,
  -- NULL for unrated matches.
  left_rating_before  REAL,
  left_rating_after   REAL,
  right_rating_before REAL,
  right_rating_after  REAL,
  -- JSON: both games' moves by colour, so a maintainer can re-run and audit the match.
  moves               TEXT NOT NULL,
  -- Salted hash of the reporter's address; never the address.
  reporter            TEXT,
  status              TEXT NOT NULL CHECK (status IN ('counted', 'unrated', 'voided')),
  unrated_reason      TEXT,
  created_at          TEXT NOT NULL
);

-- The same pair, seed and first side always produce the same two games (in some seat order), so
-- such a match is recorded once; a voided forgery does not block the genuine report.
CREATE UNIQUE INDEX matches_once ON matches (sha_lo, sha_hi, seed, first_side) WHERE status <> 'voided';
CREATE INDEX matches_by_left ON matches (left_sha);
CREATE INDEX matches_by_right ON matches (right_sha);

CREATE TABLE rating_changes (
  sha256        TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  match_id      INTEGER,
  rating_before REAL NOT NULL,
  rating_after  REAL NOT NULL,
  PRIMARY KEY (sha256, seq)
);

-- Per-reporter daily allowance of match reports, like upload_quota.
CREATE TABLE report_quota (
  bucket TEXT PRIMARY KEY,
  count  INTEGER NOT NULL CHECK (count > 0)
);
