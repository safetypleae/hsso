-- Additive only. Apply manually after backup; never alters existing survey/response columns.
CREATE TABLE risk_survey_metadata (
  survey_id TEXT PRIMARY KEY REFERENCES risk_surveys(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL DEFAULT '',
  departments_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)
);
CREATE TABLE risk_survey_versions (
  survey_id TEXT NOT NULL REFERENCES risk_surveys(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  PRIMARY KEY(survey_id, revision)
);
CREATE TABLE risk_response_photos (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES risk_surveys(id) ON DELETE CASCADE,
  response_id TEXT NOT NULL REFERENCES risk_responses(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_risk_photos_response ON risk_response_photos(response_id);
-- No FK: cleanup must survive survey deletion and failed R2 requests.
CREATE TABLE risk_photo_deletions (
  object_key TEXT PRIMARY KEY,
  ready_after TEXT NOT NULL
);
