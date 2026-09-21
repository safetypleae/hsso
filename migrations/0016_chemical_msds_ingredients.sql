-- Reviewed MSDS composition rows belong to an immutable MSDS version, not the product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chemical_msds_versions_scope
  ON chemical_msds_versions(id, company_id, product_id);

CREATE TABLE chemical_msds_ingredients (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  chemical_name TEXT NOT NULL,
  synonym TEXT,
  cas_value TEXT,
  cas_status TEXT NOT NULL CHECK (cas_status IN ('KNOWN', 'ABSENT', 'TRADE_SECRET')),
  amount_raw TEXT NOT NULL,
  trade_secret INTEGER NOT NULL DEFAULT 0 CHECK (trade_secret IN (0, 1)),
  parser_confidence TEXT CHECK (parser_confidence IS NULL OR parser_confidence IN ('high', 'medium', 'low')),
  review_status TEXT NOT NULL CHECK (review_status IN ('AUTO_EXTRACTED', 'REVIEWED', 'MANUALLY_ADDED')),
  source_type TEXT NOT NULL CHECK (source_type IN ('AUTO', 'MANUAL')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id, company_id) REFERENCES chemical_products(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, company_id, product_id)
    REFERENCES chemical_msds_versions(id, company_id, product_id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (version_id, sort_order)
);

CREATE INDEX idx_chemical_msds_ingredients_product_version
  ON chemical_msds_ingredients(company_id, product_id, version_id, sort_order);
CREATE INDEX idx_chemical_msds_ingredients_version
  ON chemical_msds_ingredients(company_id, version_id, sort_order);
CREATE INDEX idx_chemical_msds_ingredients_cas
  ON chemical_msds_ingredients(company_id, cas_value);
