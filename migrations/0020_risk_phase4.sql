-- Phase 4: company-owned source workbooks, annual lineage and improvement numbering.
-- Additive only. Apply manually after 0019_risk_improvements.sql.
CREATE TABLE risk_workbooks (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  reference_year INTEGER NOT NULL CHECK (reference_year BETWEEN 2000 AND 2100),
  assessment_sheet_name TEXT NOT NULL DEFAULT '3. 평가표 작성',
  improvement_sheet_name TEXT NOT NULL DEFAULT '4. 개선조치',
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_risk_workbooks_company_hash_year
  ON risk_workbooks(company_id, sha256, reference_year);
CREATE INDEX idx_risk_workbooks_company_uploaded
  ON risk_workbooks(company_id, uploaded_at DESC, id DESC);

ALTER TABLE risk_assessment_items ADD COLUMN evaluation_year INTEGER NOT NULL DEFAULT 0 CHECK (evaluation_year = 0 OR evaluation_year BETWEEN 2000 AND 2100);
ALTER TABLE risk_assessment_items ADD COLUMN phase4_source_type TEXT NOT NULL DEFAULT 'CURRENT_YEAR' CHECK (phase4_source_type IN ('EXCEL_IMPORT','CARRIED_FORWARD','CURRENT_YEAR'));
ALTER TABLE risk_assessment_items ADD COLUMN source_workbook_id TEXT REFERENCES risk_workbooks(id) ON DELETE RESTRICT;
ALTER TABLE risk_assessment_items ADD COLUMN source_sheet_name TEXT;
ALTER TABLE risk_assessment_items ADD COLUMN source_row_number INTEGER CHECK (source_row_number IS NULL OR source_row_number > 0);
ALTER TABLE risk_assessment_items ADD COLUMN imported_at TEXT;
ALTER TABLE risk_assessment_items ADD COLUMN carried_from_item_id TEXT REFERENCES risk_assessment_items(id) ON DELETE RESTRICT;
ALTER TABLE risk_assessment_items ADD COLUMN work_number TEXT NOT NULL DEFAULT '';
ALTER TABLE risk_assessment_items ADD COLUMN after_likelihood INTEGER CHECK (after_likelihood IS NULL OR after_likelihood BETWEEN 1 AND 5);
ALTER TABLE risk_assessment_items ADD COLUMN after_severity INTEGER CHECK (after_severity IS NULL OR after_severity BETWEEN 1 AND 4);
ALTER TABLE risk_assessment_items ADD COLUMN after_risk_score INTEGER CHECK (after_risk_score IS NULL OR after_risk_score = after_likelihood * after_severity);
ALTER TABLE risk_assessment_items ADD COLUMN planned_completion_date TEXT;
ALTER TABLE risk_assessment_items ADD COLUMN actual_completion_date TEXT;
ALTER TABLE risk_assessment_items ADD COLUMN responsible_person TEXT NOT NULL DEFAULT '';
ALTER TABLE risk_assessment_items ADD COLUMN legacy_improvement_number TEXT NOT NULL DEFAULT '';
ALTER TABLE risk_assessment_items ADD COLUMN legal_basis TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_risk_items_excel_lineage
  ON risk_assessment_items(company_id, source_workbook_id, source_sheet_name, source_row_number)
  WHERE source_workbook_id IS NOT NULL;
CREATE UNIQUE INDEX idx_risk_items_carry_lineage
  ON risk_assessment_items(company_id, evaluation_year, carried_from_item_id)
  WHERE carried_from_item_id IS NOT NULL;
CREATE INDEX idx_risk_items_company_year
  ON risk_assessment_items(company_id, evaluation_year, updated_at DESC, id DESC);

ALTER TABLE risk_improvement_requests ADD COLUMN improvement_number TEXT;
ALTER TABLE risk_improvement_requests ADD COLUMN improvement_number_kind TEXT CHECK (improvement_number_kind IS NULL OR improvement_number_kind IN ('LEGACY','HSSO'));
ALTER TABLE risk_improvement_requests ADD COLUMN improvement_year INTEGER CHECK (improvement_year IS NULL OR improvement_year BETWEEN 2000 AND 2100);
CREATE UNIQUE INDEX idx_risk_improvements_company_year_number
  ON risk_improvement_requests(company_id, improvement_year, improvement_number)
  WHERE improvement_number IS NOT NULL;

-- Existing Phase 2/3 inserts stay untouched. These triggers add the current
-- annual metadata and a collision-resistant HSSO number after those inserts.
CREATE TRIGGER trg_risk_item_phase4_year
AFTER INSERT ON risk_assessment_items
WHEN NEW.evaluation_year = 0
BEGIN
  UPDATE risk_assessment_items
  SET evaluation_year = CAST(strftime('%Y','now','+9 hours') AS INTEGER)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_risk_improvement_phase4_number
AFTER INSERT ON risk_improvement_requests
WHEN NEW.improvement_number IS NULL
BEGIN
  UPDATE risk_improvement_requests
  SET improvement_year = COALESCE((SELECT NULLIF(evaluation_year,0) FROM risk_assessment_items WHERE id=NEW.risk_assessment_item_id), CAST(strftime('%Y','now','+9 hours') AS INTEGER)),
      improvement_number_kind = CASE WHEN COALESCE((SELECT legacy_improvement_number FROM risk_assessment_items WHERE id=NEW.risk_assessment_item_id),'') <> '' THEN 'LEGACY' ELSE 'HSSO' END,
      improvement_number = CASE
        WHEN COALESCE((SELECT legacy_improvement_number FROM risk_assessment_items WHERE id=NEW.risk_assessment_item_id),'') <> ''
          THEN (SELECT legacy_improvement_number FROM risk_assessment_items WHERE id=NEW.risk_assessment_item_id)
        ELSE 'HSSO-' || COALESCE((SELECT NULLIF(evaluation_year,0) FROM risk_assessment_items WHERE id=NEW.risk_assessment_item_id), CAST(strftime('%Y','now','+9 hours') AS INTEGER)) || '-' || upper(substr(replace(NEW.id,'-',''),1,8))
      END
  WHERE id = NEW.id;
END;
