-- Upload rate limiting without the paid WAF: counters per hashed IP (10-minute windows) and one global daily counter.
CREATE TABLE IF NOT EXISTS upload_rate (
  k   TEXT PRIMARY KEY,   -- "ip:<hash>" or "global"
  win INTEGER NOT NULL,   -- window number (floor(now / window length))
  n   INTEGER NOT NULL
);
