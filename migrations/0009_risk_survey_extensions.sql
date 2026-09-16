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
