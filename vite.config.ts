import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  server: { port: 5173, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
