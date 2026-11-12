#!/usr/bin/env node
/** Applies pending database migrations. Safe to run on every deploy. */
import { initSchema, schemaVersion, closeDb } from '../src/db.js';
import { config } from '../src/config.js';
import { logger } from '../src/logger.js';

try {
  const result = initSchema();
  logger.info('migrations complete', {
    db: config.dbPath,
    version: result.version,
    latest: result.latest,
    applied: result.applied,
  });
  if (result.applied.length === 0) logger.info('database already up to date', { version: schemaVersion() });
  closeDb();
  process.exit(0);
} catch (err) {
  logger.error('migration failed', { error: err.message, stack: err.stack });
  process.exit(1);
}
