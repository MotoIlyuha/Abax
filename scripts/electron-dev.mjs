import { spawn } from 'node:child_process';

const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { stdio: 'inherit', shell: true });

async function waitOn(url) {
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* сервер ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 250));
  }
}

await waitOn('http://localhost:5173');
const electron = spawn('npx', ['electron', '.'], { stdio: 'inherit', shell: true });
electron.on('exit', () => {
  vite.kill();
  process.exit(0);
});
process.on('SIGINT', () => {
  vite.kill();
  electron.kill();
  process.exit(0);
});
