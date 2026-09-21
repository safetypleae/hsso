-- SHA-256 of the persisted PDF bytes for future integrity and duplicate checks.
ALTER TABLE chemical_msds_versions ADD COLUMN checksum_sha256 TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_chemical_msds_checksum ON chemical_msds_versions(company_id,checksum_sha256);
