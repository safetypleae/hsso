CREATE TABLE risk_surveys (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  target TEXT,
  start_date TEXT,
  end_date TEXT,
  guidance TEXT,
  settings_json TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE risk_responses (
  id TEXT PRIMARY KEY NOT NULL,
  survey_id TEXT NOT NULL,
  respondent_name TEXT,
  department TEXT,
  employee_id TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  has_hazard INTEGER NOT NULL CHECK (has_hazard IN (0, 1)),
  hazard_types_json TEXT,
  hazard_description TEXT,
  location TEXT,
  pre_likelihood INTEGER,
  pre_severity INTEGER,
  pre_risk_score INTEGER,
  improvement_suggestion TEXT,
  post_likelihood INTEGER,
  post_severity INTEGER,
  post_risk_score INTEGER,
  safe_reason TEXT,
  response_data TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (survey_id) REFERENCES risk_surveys(id) ON DELETE CASCADE
);

CREATE INDEX idx_risk_surveys_owner_created ON risk_surveys(owner_user_id, created_at DESC);
CREATE INDEX idx_risk_responses_survey_submitted ON risk_responses(survey_id, submitted_at DESC);
CREATE INDEX idx_risk_responses_survey_employee ON risk_responses(survey_id, employee_id);
