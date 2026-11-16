import { join, resolve } from 'node:path';
import { createAppServer } from './app';
import { loadJwtSecret, truthy } from './config';

// Запуск сервера из окружения. Переменные: PORT, HOST, DATA_DIR, JWT_SECRET, TELEGRAM_BOT_TOKEN,
// PUBLIC_WEB_URL, ABAX_ENFORCE_LIMITS, STATIC_DIR, TRUST_PROXY (подробнее — server/.env.example).

async function main(): Promise<void> {
  const env = process.env;
  const dataDir = resolve(env.DATA_DIR || '.data');
  const srv = createAppServer({
    dbPath: join(dataDir, 'abax.db'),
    assetsDir: join(dataDir, 'assets'),
    jwtSecret: loadJwtSecret(env, dataDir),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    enforceLimits: truthy(env.ABAX_ENFORCE_LIMITS),
    publicWebUrl: env.PUBLIC_WEB_URL || 'https://motoilyuha.github.io/Abax',
    staticDir: env.STATIC_DIR ? resolve(env.STATIC_DIR) : null,
    trustProxy: truthy(env.TRUST_PROXY),
    secureCookies: env.NODE_ENV === 'production',
    log: m => console.log(m),
  });
  const { url } = await srv.listen(Number(env.PORT) || 8787, env.HOST || '127.0.0.1');
  console.log(`Abax server: ${url} (данные: ${dataDir}, лимиты ${truthy(env.ABAX_ENFORCE_LIMITS) ? 'включены' : 'выключены'})`);
  const stop = () => { void srv.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
