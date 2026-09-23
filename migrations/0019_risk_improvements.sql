-- Department corrective-action workflow. Apply manually after 0018_risk_assessment_items.sql.
CREATE UNIQUE INDEX idx_risk_assessment_items_id_company ON risk_assessment_items(id, company_id);

CREATE TABLE risk_improvement_requests (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  risk_assessment_item_id TEXT NOT NULL UNIQUE,
  department_id TEXT NOT NULL,
  department_name_snapshot TEXT NOT NULL,
  request_text TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','SUBMITTED','REVISION_REQUIRED','APPROVED')),
  action_text TEXT NOT NULL DEFAULT '',
  requested_by_user_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  submitted_by_user_id TEXT,
  submitted_at TEXT,
  after_likelihood INTEGER CHECK (after_likelihood IS NULL OR after_likelihood BETWEEN 1 AND 5),
  after_severity INTEGER CHECK (after_severity IS NULL OR after_severity BETWEEN 1 AND 4),
  after_risk_score INTEGER CHECK (after_risk_score IS NULL OR after_risk_score = after_likelihood * after_severity),
  approved_by_user_id TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (risk_assessment_item_id, company_id) REFERENCES risk_assessment_items(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES company_departments(id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_risk_improvement_requests_id_company ON risk_improvement_requests(id, company_id);
CREATE INDEX idx_risk_improvement_requests_department ON risk_improvement_requests(company_id, department_id, status, due_date);
CREATE INDEX idx_risk_improvement_requests_status ON risk_improvement_requests(company_id, status, updated_at DESC);

CREATE TABLE risk_improvement_events (
  id TEXT PRIMARY KEY NOT NULL,
  improvement_request_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  event_order INTEGER NOT NULL CHECK (event_order > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('REQUESTED','SUBMITTED','REVISION_REQUIRED','APPROVED')),
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('REQUESTED','SUBMITTED','REVISION_REQUIRED','APPROVED')),
  note TEXT NOT NULL DEFAULT '',
  after_likelihood INTEGER,
  after_severity INTEGER,
  after_risk_score INTEGER,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (improvement_request_id, company_id) REFERENCES risk_improvement_requests(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (after_risk_score IS NULL OR after_risk_score = after_likelihood * after_severity)
);
CREATE UNIQUE INDEX idx_risk_improvement_events_request_order ON risk_improvement_events(improvement_request_id, event_order);

CREATE TABLE risk_improvement_photos (
  id TEXT PRIMARY KEY NOT NULL,
  improvement_request_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  photo_kind TEXT NOT NULL CHECK (photo_kind IN ('BEFORE','AFTER')),
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (improvement_request_id, company_id) REFERENCES risk_improvement_requests(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_risk_improvement_photos_request ON risk_improvement_photos(improvement_request_id, photo_kind, uploaded_at, id);
