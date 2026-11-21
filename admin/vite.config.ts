import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const proxy = {
  '^/api/(admin(?:/|$)|auth/email/(start|verify)$)': {
    target: process.env.ABAX_ADMIN_API_TARGET || 'http://127.0.0.1:8787',
    changeOrigin: false,
  },
};

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { target: 'es2022', outDir: '../dist-admin', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5180, strictPort: true, hmr: false, proxy },
  preview: { host: '127.0.0.1', port: 5180, strictPort: true, proxy },
});
