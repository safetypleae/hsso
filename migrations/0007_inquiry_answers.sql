CREATE TABLE inquiry_answers (
  id TEXT PRIMARY KEY NOT NULL,
  inquiry_id TEXT NOT NULL UNIQUE,
  admin_user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (inquiry_id) REFERENCES inquiry_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_inquiry_answers_admin ON inquiry_answers(admin_user_id);
