import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; relayUrl?: string; apiUrl?: string };

// облачный сервер: apiUrl из package.json, DOSKA_API_URL перекрывает (пустая строка — облако выключено)
const apiUrl = (process.env.DOSKA_API_URL ?? (pkg.apiUrl || '')).trim();
let apiOrigin = '';
try { apiOrigin = apiUrl ? new URL(apiUrl).origin : ''; } catch { /* неверный адрес — облако выключено на клиенте */ }

export default defineConfig({
  plugins: [{
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
