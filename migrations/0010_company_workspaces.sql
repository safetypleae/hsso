-- Additive company workspace foundation. Apply manually after review.
CREATE TABLE companies (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  initial_admin_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (initial_admin_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE company_departments (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (company_id, name_key)
);
CREATE INDEX idx_company_departments_company ON company_departments(company_id, status, name);

CREATE TABLE company_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('company_admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  primary_department_id TEXT,
  position_title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (primary_department_id) REFERENCES company_departments(id) ON DELETE SET NULL,
  UNIQUE (company_id, user_id)
);
CREATE INDEX idx_company_memberships_user ON company_memberships(user_id, status);

CREATE TABLE company_admin_applications (
  id TEXT PRIMARY KEY NOT NULL,
  applicant_user_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_name_key TEXT NOT NULL,
  department_name TEXT NOT NULL,
  department_name_key TEXT NOT NULL,
  position_title TEXT NOT NULL,
  reason TEXT NOT NULL,
  additional_info TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_company_id TEXT,
  reviewed_by_user_id TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (applicant_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_company_admin_applications_pending
  ON company_admin_applications(applicant_user_id, company_name_key)
  WHERE status = 'pending';
CREATE INDEX idx_company_admin_applications_status ON company_admin_applications(status, created_at DESC);

CREATE TABLE company_permission_events (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  department_id TEXT,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('company_admin_approved')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES company_departments(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_company_permission_events_company ON company_permission_events(company_id, created_at DESC);
