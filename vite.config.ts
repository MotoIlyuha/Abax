import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; relayUrl?: string };

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  server: { port: 5173, strictPort: true },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // ретранслятор по умолчанию для автора в браузере — как в electron/main.cjs: relayUrl из package.json,
    // DOSKA_RELAY_URL перекрывает (пустая строка — без адреса по умолчанию)
    __DEFAULT_RELAY_URL__: JSON.stringify(process.env.DOSKA_RELAY_URL ?? (pkg.relayUrl || '')),
  },
});
