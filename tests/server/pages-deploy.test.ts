// Публикация гостевого клиента в gh-pages (scripts/pages-deploy.sh) на временном bare-репозитории.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'pages-deploy.sh');
let tmp: string;
let remote: string;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function dist(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'dist-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
function deploy(distDir: string, version: string) {
  return spawnSync('bash', [SCRIPT, remote, distDir, version], { encoding: 'utf8' });
}
/** Содержимое ветки gh-pages: список файлов и число коммитов. */
function published(): { files: string[]; commits: number; read: (f: string) => string } {
  const dir = fs.mkdtempSync(path.join(tmp, 'check-'));
  git(tmp, 'clone', '-q', '--branch', 'gh-pages', remote, dir);
  return {
    files: git(dir, 'ls-files').split('\n').filter(Boolean).sort(),
    commits: Number(git(dir, 'rev-list', '--count', 'HEAD')),
    read: f => fs.readFileSync(path.join(dir, f), 'utf8'),
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  remote = path.join(tmp, 'remote.git');
  git(tmp, 'init', '-q', '--bare', remote);
});

describe.skipIf(process.platform === 'win32')('scripts/pages-deploy.sh', () => {
  it('первая публикация создаёт gh-pages: v/<версия>/, страница в корне, .nojekyll', () => {
    const r = deploy(dist({ 'index.html': 'v1', 'assets/app.js': 'js1' }), '1.0.0');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('опубликован v1.0.0');
    const site = published();
    expect(site.files).toEqual(['.nojekyll', 'index.html', 'v/1.0.0/assets/app.js', 'v/1.0.0/index.html']);
    expect(site.read('v/1.0.0/index.html')).toBe('v1');
    expect(site.read('index.html')).toContain('откройте ссылку, которую прислал автор');
  });

  it('новая версия добавляется, прежние остаются', () => {
    deploy(dist({ 'index.html': 'v1' }), '1.0.0');
    deploy(dist({ 'index.html': 'v2' }), '1.1.0');
    const site = published();
    expect(site.files).toContain('v/1.0.0/index.html');
    expect(site.read('v/1.1.0/index.html')).toBe('v2');
    expect(site.commits).toBe(2);
  });

  it('повтор той же версии: без изменений — без коммита; с изменениями — устаревшие файлы удаляются', () => {
    const d = dist({ 'index.html': 'v1', 'assets/old.js': 'old' });
    deploy(d, '1.0.0');
    const again = deploy(d, '1.0.0');
    expect(again.stdout).toContain('без изменений');
    expect(published().commits).toBe(1);

    deploy(dist({ 'index.html': 'v1-fix', 'assets/new.js': 'new' }), '1.0.0');
    const site = published();
    expect(site.files).toEqual(['.nojekyll', 'index.html', 'v/1.0.0/assets/new.js', 'v/1.0.0/index.html']);
    expect(site.commits).toBe(2);
  });

  it('неверная версия и отсутствие сборки — отказ без публикации', () => {
    const d = dist({ 'index.html': 'x' });
    for (const bad of ['../../etc', '1.0', 'v1.0.0', '1.0.0/..']) {
      const r = deploy(d, bad);
      expect(r.status, bad).not.toBe(0);
      expect(r.stderr).toContain('Неверная версия');
    }
    const empty = deploy(dist({ 'other.txt': '' }), '1.0.0');
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain('Нет сборки');
    expect(git(tmp, 'ls-remote', '--heads', remote)).toBe('');
  });
});
