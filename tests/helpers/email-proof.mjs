import { hashVerificationProof } from '../../server/email-verification.js';

// Explicit fixture for tests of unrelated features. Real verification is tested separately.
export async function seedEmailProof(db, email) {
  const proof = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  db.sqlite.prepare(`INSERT INTO email_verifications
    (id, email, ip_mac, code_mac, created_at, expires_at, resend_available_at, delivered_at, verified_at, proof_hash, proof_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), email.trim().toLowerCase(), 'fixture-ip', 'fixture-mac', now, now + 600000, now + 60000, now, now, await hashVerificationProof(proof), now + 600000);
  return proof;
}
