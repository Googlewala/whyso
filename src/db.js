import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

export const DB_PATH = config.dbPath;

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// Wait rather than fail when another writer holds the lock (matters once more
// than one request can write concurrently).
db.exec('PRAGMA busy_timeout = 5000');

/*
 * Migrations are append-only. Each entry runs once, in order, inside a
 * transaction, and its id is recorded so a restart never replays it.
 * Never edit a shipped migration — add a new one.
 */
const MIGRATIONS = [
  {
    id: '001_initial',
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          vpa TEXT UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          icon TEXT NOT NULL DEFAULT '💸',
          color TEXT NOT NULL DEFAULT '#6366f1',
          keywords TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'bank',
          vpa TEXT,
          opening_balance REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '👥',
          kind TEXT NOT NULL DEFAULT 'trip',
          owner_id INTEGER NOT NULL REFERENCES users(id),
          currency TEXT NOT NULL DEFAULT 'INR',
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS group_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          role TEXT NOT NULL DEFAULT 'member',
          UNIQUE (group_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS occasions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          title TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'festival',
          date TEXT NOT NULL,
          budget REAL NOT NULL DEFAULT 0,
          color TEXT NOT NULL DEFAULT '#f59e0b',
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'planning',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          account_id INTEGER REFERENCES accounts(id),
          group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
          occasion_id INTEGER REFERENCES occasions(id) ON DELETE SET NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'INR',
          direction TEXT NOT NULL DEFAULT 'debit',
          merchant TEXT NOT NULL DEFAULT 'Unknown',
          vpa TEXT,
          category_id INTEGER REFERENCES categories(id),
          note TEXT,
          txn_ref TEXT,
          method TEXT NOT NULL DEFAULT 'manual',
          status TEXT NOT NULL DEFAULT 'success',
          occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
          source TEXT NOT NULL DEFAULT 'manual',
          raw TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
        CREATE INDEX IF NOT EXISTS idx_expenses_occasion ON expenses(occasion_id);

        CREATE TABLE IF NOT EXISTS group_expense_shares (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          share REAL NOT NULL,
          weight REAL NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS settlements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          from_user INTEGER NOT NULL REFERENCES users(id),
          to_user INTEGER NOT NULL REFERENCES users(id),
          amount REAL NOT NULL,
          method TEXT NOT NULL DEFAULT 'upi',
          txn_ref TEXT,
          note TEXT,
          settled_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS budgets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          period TEXT NOT NULL DEFAULT 'monthly',
          amount REAL NOT NULL,
          UNIQUE (user_id, category_id, period)
        );

        CREATE TABLE IF NOT EXISTS recurring (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          merchant TEXT NOT NULL,
          vpa TEXT,
          amount REAL NOT NULL,
          category_id INTEGER REFERENCES categories(id),
          frequency TEXT NOT NULL DEFAULT 'monthly',
          next_due TEXT,
          active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        CREATE TABLE IF NOT EXISTS scans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id),
          raw TEXT NOT NULL,
          kind TEXT NOT NULL,
          parsed TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    id: '002_auth_and_billing',
    up: (d) => {
      d.exec(`
        ALTER TABLE users ADD COLUMN email TEXT;
        ALTER TABLE users ADD COLUMN password_hash TEXT;
        ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
        ALTER TABLE users ADD COLUMN plan_status TEXT NOT NULL DEFAULT 'inactive';
        ALTER TABLE users ADD COLUMN plan_renews_at TEXT;
        ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
        ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
        ALTER TABLE users ADD COLUMN last_login_at TEXT;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token_hash TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          user_agent TEXT,
          ip TEXT,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

        CREATE TABLE IF NOT EXISTS usage_counters (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          metric TEXT NOT NULL,
          period TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, metric, period)
        );

        CREATE TABLE IF NOT EXISTS billing_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL DEFAULT 'stripe',
          event_id TEXT UNIQUE,
          type TEXT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          payload TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
];

const LATEST_VERSION = MIGRATIONS.length;

function ensureVersionTable(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    value INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  d.exec(`INSERT OR IGNORE INTO schema_version (id, value) VALUES (1, 0)`);
}

export function schemaVersion() {
  ensureVersionTable(db);
  return Number(db.prepare(`SELECT value FROM schema_version WHERE id = 1`).get().value);
}

/** Applies any pending migrations up to `target`. Safe to call on every boot. */
export function migrate({ target = LATEST_VERSION, quiet = false } = {}) {
  ensureVersionTable(db);
  let version = schemaVersion();
  const applied = [];

  MIGRATIONS.forEach((migration, i) => {
    const index = i + 1;
    if (index <= version || index > target) return;
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare(`UPDATE schema_version SET value = ?, updated_at = datetime('now') WHERE id = 1`).run(index);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.id} failed: ${err.message}`);
    }
    applied.push(migration.id);
    version = index;
  });

  if (applied.length && !quiet) logger.info('migrations applied', { applied, version });
  return { version, applied, latest: LATEST_VERSION };
}

/** Back-compat shim: brings the database to the latest schema. */
export function initSchema() {
  return migrate();
}

export function get(sql, params = {}) {
  return db.prepare(sql).get(params);
}

export function all(sql, params = {}) {
  return db.prepare(sql).all(params);
}

export function run(sql, params = {}) {
  return db.prepare(sql).run(params);
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function closeDb() {
  try { db.close(); } catch { /* already closed */ }
}
