CREATE TABLE board_posts (
  id TEXT PRIMARY KEY NOT NULL,
  board_type TEXT NOT NULL CHECK (board_type IN ('notice', 'free')),
  author_user_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_board_posts_type_created ON board_posts(board_type, created_at DESC);
