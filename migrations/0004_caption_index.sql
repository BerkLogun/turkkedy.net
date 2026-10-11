-- The caption job selects live cats without a caption; without this partial index every batch scanned the whole table.
CREATE INDEX IF NOT EXISTS cats_uncaptioned_idx ON cats(pos) WHERE status = 'live' AND caption IS NULL;
