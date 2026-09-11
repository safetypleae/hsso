CREATE TABLE inquiry_posts (
  id TEXT PRIMARY KEY NOT NULL,
  author_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'answered')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_inquiry_posts_author_created ON inquiry_posts(author_user_id, created_at DESC);
