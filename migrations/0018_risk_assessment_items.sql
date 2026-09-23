-- Additive risk-assessment items. Apply manually after 0017_risk_response_reviews.sql.
-- Final assessment Excel and corrective-action workflow are intentionally out of scope.
CREATE TABLE risk_assessment_items (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  department_id TEXT,
  department_name TEXT NOT NULL DEFAULT '',
  source_response_id TEXT UNIQUE,
  source_survey_id TEXT,
  work_process TEXT NOT NULL,
  hazard_factor TEXT NOT NULL,
  hazard_situation TEXT NOT NULL,
  current_measures TEXT NOT NULL,
  likelihood INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4),
  risk_score INTEGER NOT NULL CHECK (risk_score = likelihood * severity),
  reduction_measures TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES company_departments(id) ON DELETE SET NULL,
  FOREIGN KEY (source_response_id) REFERENCES risk_response_reviews(response_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_survey_id) REFERENCES risk_surveys(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (
    (source_response_id IS NULL AND source_survey_id IS NULL) OR
    (source_response_id IS NOT NULL AND source_survey_id IS NOT NULL)
  )
);
CREATE INDEX idx_risk_assessment_items_company_updated
  ON risk_assessment_items(company_id, updated_at DESC, id DESC);
CREATE INDEX idx_risk_assessment_items_company_department
  ON risk_assessment_items(company_id, department_name, updated_at DESC);
