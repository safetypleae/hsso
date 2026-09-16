-- Additive company invitations and department-scoped work permissions.
-- Invitation tokens are stored only as SHA-256 hashes.
CREATE TABLE company_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('msds_manage')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL,
  accepted_by_user_id TEXT,
  acceptance_id TEXT UNIQUE,
  revocation_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES company_departments(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_company_invitations_pending
  ON company_invitations(company_id, department_id, invitee_email, permission)
  WHERE status = 'pending';
CREATE INDEX idx_company_invitations_company ON company_invitations(company_id, status, created_at DESC);

CREATE TABLE company_permission_grants (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('msds_manage')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  granted_by_user_id TEXT NOT NULL,
  revoked_by_user_id TEXT,
  revocation_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES company_departments(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (company_id, user_id, department_id, permission)
);
CREATE INDEX idx_company_permission_grants_user ON company_permission_grants(user_id, company_id, status);
CREATE INDEX idx_company_permission_grants_company ON company_permission_grants(company_id, department_id, status);

-- 0010's event action CHECK is intentionally preserved. New access events use
-- this additive table rather than rebuilding or rewriting the existing table.
CREATE TABLE company_access_events (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  department_id TEXT,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT,
  invitee_email TEXT NOT NULL DEFAULT '',
  permission TEXT CHECK (permission IS NULL OR permission IN ('msds_manage')),
  action TEXT NOT NULL CHECK (action IN ('invite_created', 'invite_accepted', 'invite_revoked', 'permission_granted', 'permission_revoked')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES company_departments(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_company_access_events_company ON company_access_events(company_id, created_at DESC);
