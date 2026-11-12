#!/usr/bin/env node
/** Hits the readiness probe. Used by container healthchecks and CI smoke tests. */
const url = process.env.HEALTHCHECK_URL || `http://127.0.0.1:${process.env.PORT || 12000}/readyz`;

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const body = await res.text();
  if (!res.ok) {
    console.error(`healthcheck failed: ${res.status} ${body}`);
    process.exit(1);
  }
  console.log(`healthcheck ok: ${url} -> ${res.status}`);
  process.exit(0);
} catch (err) {
  console.error(`healthcheck error: ${err.message}`);
  process.exit(1);
}
