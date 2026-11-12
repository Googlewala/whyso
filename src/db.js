import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DB_PATH = process.env.WHYSO_DB || resolve(process.cwd(), 'data/whyso.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Tables are declared in dependency order (referenced tables first).
const SCHEMA = `
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
`;

export function initSchema() {
  db.exec(SCHEMA);
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
