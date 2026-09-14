-- Separate from users. All times are Unix milliseconds; no raw codes, tokens or IPs.
CREATE TABLE email_verifications (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  ip_mac TEXT NOT NULL,
  code_mac TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resend_available_at INTEGER NOT NULL,
  delivered_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  verified_at INTEGER,
  proof_hash TEXT UNIQUE,
  proof_expires_at INTEGER,
  consumed_at INTEGER
);
CREATE INDEX email_verifications_email_created ON email_verifications(email, created_at);
CREATE INDEX email_verifications_email_sequence ON email_verifications(email, sequence);
CREATE INDEX email_verifications_ip_created ON email_verifications(ip_mac, created_at);
CREATE INDEX email_verifications_created ON email_verifications(created_at);
