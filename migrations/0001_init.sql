-- Index of every cat photo in the R2 bucket. Replaces manifest.json.
CREATE TABLE IF NOT EXISTS cats (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT    NOT NULL UNIQUE,          -- R2 object key once live (pending objects live at pending/<key>)
  status        TEXT    NOT NULL DEFAULT 'pending', -- 'live' | 'pending'
  pos           INTEGER,                          -- dense 0..N-1 ordering for live cats, NULL while pending
  legacy_hash   TEXT,                             -- short hash used by old /p/ share links
  source        TEXT    NOT NULL DEFAULT 'seed',  -- seed | upload | sync
  original_name TEXT,
  size          INTEGER,
  width         INTEGER,
  height        INTEGER,
  confidence    REAL,                             -- cat probability from the classifier (0..1)
  detection     TEXT,                             -- raw classifier output (JSON)
  uploaded_at   INTEGER NOT NULL DEFAULT 0,       -- unix ms
  approved_at   INTEGER,
  caption       TEXT,                             -- Turkish one-line description (Workers AI), used for SEO pages
  captioned_at  INTEGER
);
CREATE INDEX IF NOT EXISTS cats_pos_idx    ON cats(pos);
CREATE INDEX IF NOT EXISTS cats_status_idx ON cats(status, id);
CREATE INDEX IF NOT EXISTS cats_legacy_idx ON cats(legacy_hash);
