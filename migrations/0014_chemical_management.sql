-- Company product master, department usage, and future persistent MSDS versions.
-- PDF version rows must only be inserted after a persistent object has been stored.
CREATE TABLE chemical_products (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_name_key TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  manufacturer_key TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  general_use TEXT NOT NULL DEFAULT '',
  product_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (product_status IN ('ACTIVE','ARCHIVED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (id,company_id)
);
CREATE INDEX idx_chemical_products_company ON chemical_products(company_id,product_status,updated_at DESC);
CREATE INDEX idx_chemical_products_name ON chemical_products(company_id,product_name_key,manufacturer_key);

CREATE UNIQUE INDEX idx_chemical_department_company ON company_departments(id,company_id);

CREATE TABLE chemical_usages (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  use_location TEXT NOT NULL,
  storage_location TEXT NOT NULL,
  stock_quantity REAL,
  stock_unit TEXT NOT NULL DEFAULT '',
  average_usage_quantity REAL,
  average_usage_period TEXT NOT NULL DEFAULT '',
  usage_unit TEXT NOT NULL DEFAULT '',
  reported_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id,company_id) REFERENCES chemical_products(id,company_id) ON DELETE CASCADE,
  FOREIGN KEY (department_id,company_id) REFERENCES company_departments(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_chemical_usages_product ON chemical_usages(company_id,product_id);
CREATE INDEX idx_chemical_usages_department ON chemical_usages(company_id,department_id,product_id);

CREATE TABLE chemical_msds_versions (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  issue_date TEXT,
  revision_date TEXT,
  submission_number TEXT NOT NULL DEFAULT '',
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'UNREVIEWED' CHECK (review_status IN ('UNREVIEWED','REVIEWED')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  FOREIGN KEY (product_id,company_id) REFERENCES chemical_products(id,company_id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (product_id,version_no),
  UNIQUE (storage_key)
);
CREATE UNIQUE INDEX idx_chemical_msds_current ON chemical_msds_versions(product_id) WHERE is_current=1;
CREATE INDEX idx_chemical_msds_product ON chemical_msds_versions(company_id,product_id,version_no DESC);
CREATE INDEX idx_chemical_msds_review ON chemical_msds_versions(company_id,is_current,review_status);
