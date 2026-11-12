#!/usr/bin/env node
/**
 * Seeds reference data (categories) and, when WHYSO_DEMO=1, the demo workspace.
 * Idempotent: existing data is never duplicated.
 */
import { initSchema, closeDb, get } from '../src/db.js';
import { seedReferenceData, seedIfEmpty } from '../src/seed.js';
import { logger } from '../src/logger.js';

try {
  initSchema();
  const ref = seedReferenceData();
  let demo = { seeded: false };
  if (process.env.WHYSO_DEMO === '1' || process.env.WHYSO_DEMO === 'true') {
    demo = seedIfEmpty();
  }
  logger.info('seed complete', {
    categories: ref.categories,
    demoSeeded: demo.seeded,
    backfilled: demo.backfilled ?? 0,
    users: get(`SELECT COUNT(*) c FROM users`).c,
  });
  closeDb();
  process.exit(0);
} catch (err) {
  logger.error('seed failed', { error: err.message, stack: err.stack });
  process.exit(1);
}
