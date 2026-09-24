-- Backfill Phase 2/3 rows that existed before 0020 added annual metadata.
-- The item creation timestamp is the authoritative year for these immutable
-- legacy rows; invalid/missing timestamps deliberately remain unassigned.
UPDATE risk_assessment_items
SET evaluation_year = CAST(strftime('%Y', created_at, '+9 hours') AS INTEGER)
WHERE evaluation_year = 0
  AND CAST(strftime('%Y', created_at, '+9 hours') AS INTEGER) BETWEEN 2000 AND 2100;

-- Existing Phase 3 requests predate the 0020 numbering trigger. Preserve a
-- company legacy number when present; otherwise assign the same deterministic
-- HSSO format used by the 0020 trigger and retain the original item relation.
UPDATE risk_improvement_requests
SET improvement_year = (
  SELECT NULLIF(i.evaluation_year, 0)
  FROM risk_assessment_items i
  WHERE i.id = risk_improvement_requests.risk_assessment_item_id
    AND i.company_id = risk_improvement_requests.company_id
)
WHERE improvement_year IS NULL
  AND EXISTS (
    SELECT 1 FROM risk_assessment_items i
    WHERE i.id = risk_improvement_requests.risk_assessment_item_id
      AND i.company_id = risk_improvement_requests.company_id
      AND i.evaluation_year BETWEEN 2000 AND 2100
  );

UPDATE risk_improvement_requests
SET improvement_number_kind = CASE
      WHEN COALESCE((
        SELECT i.legacy_improvement_number
        FROM risk_assessment_items i
        WHERE i.id = risk_improvement_requests.risk_assessment_item_id
          AND i.company_id = risk_improvement_requests.company_id
      ), '') <> '' THEN 'LEGACY'
      ELSE 'HSSO'
    END
WHERE improvement_number_kind IS NULL
  AND improvement_year BETWEEN 2000 AND 2100;

UPDATE risk_improvement_requests
SET improvement_number = CASE
      WHEN improvement_number_kind = 'LEGACY' THEN (
        SELECT i.legacy_improvement_number
        FROM risk_assessment_items i
        WHERE i.id = risk_improvement_requests.risk_assessment_item_id
          AND i.company_id = risk_improvement_requests.company_id
      )
      ELSE 'HSSO-' || improvement_year || '-' || upper(substr(replace(id, '-', ''), 1, 8))
    END
WHERE improvement_number IS NULL
  AND improvement_year BETWEEN 2000 AND 2100
  AND improvement_number_kind IN ('LEGACY', 'HSSO');
