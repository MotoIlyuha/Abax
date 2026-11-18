import { join, resolve } from 'node:path';
import { createAppServer } from './app';
import { S3AssetBackend } from './asset-storage';
import { listEnv, loadJwtSecret, truthy } from './config';
import { consoleMailer, mailerFromEnv } from './mailer';

// Запуск сервера из окружения. Переменные: PORT, HOST, DATA_DIR, JWT_SECRET, TELEGRAM_BOT_TOKEN,
// PUBLIC_WEB_URL, PUBLIC_API_URL, ABAX_ENFORCE_LIMITS, ABAX_DEV_AUTH, GOOGLE_CLIENT_ID/SECRET, MAIL_WEBHOOK_URL, SMTP_*,
// ALLOWED_ORIGINS, STATIC_DIR, TRUST_PROXY (подробнее — server/.env.example).

async function main(): Promise<void> {
  const env = process.env;
  const dataDir = resolve(env.DATA_DIR || '.data');
  // S3-совместимое хранилище, если заданы адрес и бакет; иначе файлы в DATA_DIR/assets
  const assetBackend = env.S3_ENDPOINT && env.S3_BUCKET
    ? new S3AssetBackend({
      endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, region: env.S3_REGION || 'ru-central1',
      accessKeyId: env.S3_ACCESS_KEY_ID || '', secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    })
    : undefined;
  const srv = createAppServer({
    dbPath: join(dataDir, 'abax.db'),
    assetsDir: join(dataDir, 'assets'),
    jwtSecret: loadJwtSecret(env, dataDir),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    enforceLimits: truthy(env.ABAX_ENFORCE_LIMITS),
    // dev-провайдеры входа — только по явному флагу и никогда в продакшене
    devAuth: truthy(env.ABAX_DEV_AUTH) && env.NODE_ENV !== 'production',
    mailer: mailerFromEnv(env) ?? (truthy(env.ABAX_DEV_AUTH) && env.NODE_ENV !== 'production' ? consoleMailer(m => console.log(m)) : null),
    googleClientId: env.GOOGLE_CLIENT_ID,
    telegramClientId: env.TELEGRAM_CLIENT_ID,
    telegramClientSecret: env.TELEGRAM_CLIENT_SECRET,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    publicApiUrl: env.PUBLIC_API_URL || '',
    allowedOrigins: listEnv(env.ALLOWED_ORIGINS),
    publicWebUrl: env.PUBLIC_WEB_URL || 'https://motoilyuha.github.io/Abax',
    staticDir: env.STATIC_DIR ? resolve(env.STATIC_DIR) : null,
    // чистые ссылки /j/… (по умолчанию — когда сервер раздаёт клиента); ABAX_PRETTY_LINKS=0 — выключить
    ...(env.ABAX_PRETTY_LINKS !== undefined ? { prettyLinks: env.ABAX_PRETTY_LINKS === '1' } : {}),
    trustProxy: truthy(env.TRUST_PROXY),
    secureCookies: env.NODE_ENV === 'production',
    assetBackend,
    log: m => console.log(m),
  });
  const { url } = await srv.listen(Number(env.PORT) || 8787, env.HOST || '127.0.0.1');
  console.log(`Abax server: ${url} (данные: ${dataDir}, лимиты ${truthy(env.ABAX_ENFORCE_LIMITS) ? 'включены' : 'выключены'})`);
  const stop = () => { void srv.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
