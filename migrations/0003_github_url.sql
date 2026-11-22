-- Migration number: 0003 — the metadata contract gained a required `github-url`
-- (the game's public GitHub repository). Existing rows predate it and get the empty
-- string; the seed refresh fills the sample's in, and new uploads always carry one
-- (the loader rejects an upload whose info() does not).

ALTER TABLE entrants ADD COLUMN github_url TEXT NOT NULL DEFAULT '';
