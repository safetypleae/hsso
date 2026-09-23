-- Additive survey review inbox. Apply manually after 0010_company_workspaces.sql.
-- Worker responses remain immutable; review decisions are stored separately.
CREATE TABLE risk_survey_company_scopes (
  survey_id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  linked_by_user_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  FOREIGN KEY (survey_id) REFERENCES risk_surveys(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_risk_survey_company_scopes_company
  ON risk_survey_company_scopes(company_id, linked_at DESC);

CREATE TABLE risk_response_reviews (
  response_id TEXT PRIMARY KEY NOT NULL,
  survey_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('ACCEPTED', 'HOLD', 'REJECTED')),
  rejection_reason TEXT CHECK (rejection_reason IS NULL OR rejection_reason IN (
    'ALREADY_REFLECTED', 'IMPROVEMENT_COMPLETED', 'DUPLICATE', 'NOT_A_HAZARD', 'OTHER'
  )),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by_user_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  FOREIGN KEY (response_id) REFERENCES risk_responses(id) ON DELETE CASCADE,
  FOREIGN KEY (survey_id) REFERENCES risk_surveys(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (
    (review_status = 'REJECTED' AND rejection_reason IS NOT NULL) OR
    (review_status <> 'REJECTED' AND rejection_reason IS NULL)
  )
);
CREATE INDEX idx_risk_response_reviews_survey_status
  ON risk_response_reviews(survey_id, review_status, reviewed_at DESC);
CREATE INDEX idx_risk_response_reviews_company_status
  ON risk_response_reviews(company_id, review_status, reviewed_at DESC);
