import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; relayUrl?: string; apiUrl?: string };

// облачный сервер: apiUrl из package.json, DOSKA_API_URL перекрывает (пустая строка — облако выключено)
const apiUrl = (process.env.DOSKA_API_URL ?? (pkg.apiUrl || '')).trim();
let apiOrigin = '';
try { apiOrigin = apiUrl ? new URL(apiUrl).origin : ''; } catch { /* неверный адрес — облако выключено на клиенте */ }

/**
 * Сервер Abax внутри dev-сервера Vite (`npm run dev:cloud`): API по /api/…, ссылки-приглашения /j/…, WebSocket комнат
 * /ws/room/… — на том же адресе, второй терминал не нужен. Данные — в .data/. Включается, если облако в сборке смотрит
 * на сам dev-сервер (DOSKA_API_URL=http://localhost:5173) или задано ABAX_DEV_SERVER=1. Код сервера грузится
 * средствами Vite (TypeScript, импорты из src/ без расширений), в обычную сборку он не попадает.
 */
function abaxDevServer(): Plugin {
  const own = process.env.ABAX_DEV_SERVER === '1' || /^https?:\/\/(localhost|127\.0\.0\.1):5173\/?$/.test(apiUrl);
  return {
    name: 'abax-dev-server',
    apply: 'serve',
    configureServer(server) {
      if (!own) return;
      // сервер поднимается при первом обращении: к моменту запуска dev-сервера загрузчик модулей Vite ещё не готов
      let started: Promise<{ handler: (req: unknown, res: unknown) => void; handleUpgrade: (req: unknown, socket: unknown, head: unknown) => boolean; close: () => Promise<void> }> | null = null;
      const start = () => (started ??= (async () => {
        const { createAppServer } = await server.ssrLoadModule('/server/app.ts') as { createAppServer: (o: Record<string, unknown>) => any };
        const { loadJwtSecret, truthy, listEnv } = await server.ssrLoadModule('/server/config.ts') as { loadJwtSecret: (e: NodeJS.ProcessEnv, d: string) => string; truthy: (v?: string) => boolean; listEnv: (v?: string) => string[] };
        const { mailerFromEnv, consoleMailer } = await server.ssrLoadModule('/server/mailer.ts') as { mailerFromEnv: (e: NodeJS.ProcessEnv) => unknown; consoleMailer: (log: (m: string) => void) => unknown };
        const log = (m: string) => server.config.logger.info(`[abax] ${m}`);
        const devAuth = truthy(process.env.ABAX_DEV_AUTH);
        const dataDir = resolve(process.env.DATA_DIR || '.data');
        const srv = createAppServer({
          dbPath: join(dataDir, 'abax.db'),
          assetsDir: join(dataDir, 'assets'),
          jwtSecret: loadJwtSecret(process.env, dataDir),
          telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
          enforceLimits: truthy(process.env.ABAX_ENFORCE_LIMITS),
          publicWebUrl: process.env.PUBLIC_WEB_URL || 'http://localhost:5173',
          // dev-провайдеры входа (npm run dev:cloud включает их, если нет настоящих ключей Telegram/Google)
          devAuth,
          mailer: mailerFromEnv(process.env) ?? (devAuth ? consoleMailer(log) : null),
          googleClientId: process.env.GOOGLE_CLIENT_ID,
          telegramClientId: process.env.TELEGRAM_CLIENT_ID,
          telegramClientSecret: process.env.TELEGRAM_CLIENT_SECRET,
          googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
          publicApiUrl: process.env.PUBLIC_API_URL || '',
          allowedOrigins: listEnv(process.env.ALLOWED_ORIGINS),
          log,
        });
        server.config.logger.info(`[abax] сервер Abax подключён к dev-серверу, данные: ${dataDir}`);
        return srv;
      })());
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!(url.startsWith('/api/') || (url.startsWith('/j/') && String(req.headers.accept ?? '').includes('application/json')))) { next(); return; }
        start().then(srv => srv.handler(req, res), next);
      });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!(req.url ?? '').startsWith('/ws/room/')) return;
        start().then(srv => { if (!srv.handleUpgrade(req, socket, head)) socket.destroy(); }, () => socket.destroy());
      });
      server.httpServer?.once('close', () => { void started?.then(srv => srv.close()); });
    },
  };
}

export default defineConfig({
  plugins: [abaxDevServer(), {
    // сервер на другом адресе должен быть разрешён в CSP страницы (connect-src)
    name: 'abax-csp-api',
    transformIndexHtml: html => (apiOrigin ? html.replace("connect-src 'self'", `connect-src 'self' ${apiOrigin}`) : html),
  }],
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  server: { port: 5173, strictPort: true },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEFAULT_API_URL__: JSON.stringify(apiUrl),
    // ретранслятор по умолчанию для автора в браузере — как в electron/main.cjs: relayUrl из package.json,
    // DOSKA_RELAY_URL перекрывает (пустая строка — без адреса по умолчанию)
    __DEFAULT_RELAY_URL__: JSON.stringify(process.env.DOSKA_RELAY_URL ?? (pkg.relayUrl || '')),
  },
});
