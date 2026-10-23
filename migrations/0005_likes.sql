-- Beğeni sistemi: bir cihaz (cookie tabanlı device hash) bir kedi için bir kez beğenebilir.
CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat_id INTEGER NOT NULL REFERENCES cats(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(cat_id, device_hash)
);

-- Hızlı like sayımı için indeks.
CREATE INDEX IF NOT EXISTS idx_likes_cat_id ON likes(cat_id);
CREATE INDEX IF NOT EXISTS idx_likes_device ON likes(device_hash);
