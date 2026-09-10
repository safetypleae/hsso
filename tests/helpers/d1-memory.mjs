import { DatabaseSync } from 'node:sqlite';

// Disposable in-memory D1 adapter. No files, Cloudflare connection, or Production writes.
export function createTestDB() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      name TEXT NOT NULL, company_name TEXT NOT NULL, department_name TEXT NOT NULL, position TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  const calls = [];
  return {
    sqlite, calls, fail: false,
    prepare(sql) {
      if (this.fail) throw new Error('D1 internal SQL secret: simulated failure');
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            async first() { return statement.get(...args) || null; },
            async all() { return { success: true, results: statement.all(...args) }; },
            async run() {
              const result = statement.run(...args);
              return { success: true, meta: { changes: Number(result.changes) } };
            }
          };
        }
      };
    },
    close() { sqlite.close(); }
  };
}
