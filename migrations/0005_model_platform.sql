-- Migration number: 0005 — the metadata contract gained an optional `model-platform`
-- (the service/provider the model was run through; authors write "official" for the
-- maker's own service). Existing rows predate it and get the empty string, which every
-- display treats as "none declared"; the seed refresh fills the sample's in.

ALTER TABLE entrants ADD COLUMN model_platform TEXT NOT NULL DEFAULT '';
