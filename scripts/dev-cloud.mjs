// Dev-сервер с облачным бэкендом: Vite + сервер Abax в одном процессе (см. abaxDevServer в vite.config.ts).
// Клиент смотрит на сам dev-сервер, поэтому ничего настраивать вручную не нужно: `npm run dev:cloud`.
// Нужные переменные можно задать снаружи: ABAX_ENFORCE_LIMITS=1, TELEGRAM_BOT_TOKEN=…, GOOGLE_CLIENT_ID=…, DATA_DIR=…

import { existsSync } from 'node:fs';

// локальные ключи (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TELEGRAM_CLIENT_SECRET, TELEGRAM_CLIENT_ID, …) — из .env.local, если он есть;
// переменные, заданные в терминале, важнее (loadEnvFile их не перезаписывает)
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

process.env.DOSKA_API_URL ??= 'http://localhost:5173';
process.env.ABAX_DEV_SERVER ??= '1';
// dev-провайдеры входа (код почты в ответе и в консоли, мгновенный вход тестовыми Telegram/Google), если настоящих
// ключей Telegram (TELEGRAM_CLIENT_SECRET) и Google (GOOGLE_CLIENT_ID) нет; провайдер с настоящим ключом работает по-настоящему. ABAX_DEV_AUTH=0 — выключить.
if (!(process.env.TELEGRAM_CLIENT_SECRET && process.env.GOOGLE_CLIENT_ID)) process.env.ABAX_DEV_AUTH ??= '1';

const { createServer } = await import('vite');
const server = await createServer();
await server.listen();
server.printUrls();
