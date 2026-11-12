import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

const REDACT = /(password|token|secret|authorization|cookie|api[_-]?key|card|cvv)/i;

function scrub(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function emit(level, message, fields) {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(fields ? scrub(fields) : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error' || level === 'warn') process.stderr.write(`${text}\n`);
  else process.stdout.write(`${text}\n`);
}

export const logger = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
  child: (bindings) => ({
    debug: (msg, fields) => emit('debug', msg, { ...bindings, ...fields }),
    info: (msg, fields) => emit('info', msg, { ...bindings, ...fields }),
    warn: (msg, fields) => emit('warn', msg, { ...bindings, ...fields }),
    error: (msg, fields) => emit('error', msg, { ...bindings, ...fields }),
    child: (more) => logger.child({ ...bindings, ...more }),
  }),
};
