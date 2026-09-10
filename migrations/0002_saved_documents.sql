CREATE TABLE saved_documents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('warning_label', 'process_guide')),
  title TEXT NOT NULL,
  search_text TEXT,
  document_data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_saved_documents_owner_created ON saved_documents(user_id, created_at DESC);
CREATE INDEX idx_saved_documents_owner_type_created ON saved_documents(user_id, document_type, created_at DESC);
CREATE INDEX idx_saved_documents_owner_expiry ON saved_documents(user_id, expires_at);
