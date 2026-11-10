#!/usr/bin/env node
// Запуск ретранслятора: настройки из переменных окружения (см. README.md).
const { createRelay, DEFAULTS } = require('./server.cjs');

const env = process.env;

/** Целое неотрицательное из окружения; без значения — по умолчанию, мусор — ошибка запуска. */
function int(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`${name}: ожидается целое неотрицательное число, получено «${raw}»`);
    process.exit(2);
  }
  return n;
}

const options = {
  port: int('PORT', DEFAULTS.port),
  host: env.HOST || DEFAULTS.host,
  maxMessage: int('RELAY_MAX_MESSAGE', DEFAULTS.maxMessage),
  maxGuests: int('RELAY_MAX_GUESTS', DEFAULTS.maxGuests),
  maxRooms: int('RELAY_MAX_ROOMS', DEFAULTS.maxRooms),
  hostGraceMs: int('RELAY_HOST_GRACE_MS', DEFAULTS.hostGraceMs),
  pingMs: int('RELAY_PING_MS', DEFAULTS.pingMs),
  maxBuffer: int('RELAY_MAX_BUFFER', DEFAULTS.maxBuffer),
  trustProxy: env.RELAY_TRUST_PROXY === '1',
  allowedOrigins: (env.RELAY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  roomsPerMinute: int('RELAY_ROOMS_PER_MIN', DEFAULTS.roomsPerMinute),
  joinsPerMinute: int('RELAY_JOINS_PER_MIN', DEFAULTS.joinsPerMinute),
  maxConnPerIp: int('RELAY_MAX_CONN_PER_IP', DEFAULTS.maxConnPerIp),
  guestMsgsPerSec: int('RELAY_GUEST_MSGS_PER_SEC', DEFAULTS.guestMsgsPerSec),
  statsIntervalMs: int('RELAY_STATS_INTERVAL_MS', DEFAULTS.statsIntervalMs),
};

createRelay(options).then(relay => {
  DEFAULTS.log(`relay listening on ${options.host}:${relay.port}` +
    (options.trustProxy ? ' (trust X-Forwarded-For)' : '') +
    (options.allowedOrigins.length ? ` origins=${options.allowedOrigins.join(',')}` : ''));
  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    DEFAULTS.log(`${signal}: closing`);
    relay.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}, err => {
  console.error(`relay failed to start: ${err.message}`);
  process.exit(1);
});
