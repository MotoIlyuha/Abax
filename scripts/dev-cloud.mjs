// Dev-сервер с облачным бэкендом: Vite + сервер Abax в одном процессе (см. abaxDevServer в vite.config.ts).
// Клиент смотрит на сам dev-сервер, поэтому ничего настраивать вручную не нужно: `npm run dev:cloud`.
// Нужные переменные можно задать снаружи: ABAX_ENFORCE_LIMITS=1, TELEGRAM_BOT_TOKEN=…, DATA_DIR=…

process.env.DOSKA_API_URL ??= 'http://localhost:5173';
process.env.ABAX_DEV_SERVER ??= '1';

const { createServer } = await import('vite');
const server = await createServer();
await server.listen();
server.printUrls();
