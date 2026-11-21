import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Секрет сессий: из окружения; в разработке — файл в каталоге данных (создаётся); в проде без него не стартуем. */
export function loadJwtSecret(env: NodeJS.ProcessEnv, dataDir: string): string {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (env.NODE_ENV === 'production') throw new Error('JWT_SECRET обязателен в продакшене');
  const file = join(dataDir, 'jwt-secret');
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const truthy = (v: string | undefined): boolean => v === '1' || v?.toLowerCase() === 'true';

/** Список адресов через запятую (ALLOWED_ORIGINS). */
export const listEnv = (v: string | undefined): string[] => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** Назначения панели в env: стабильный ID и отдельно согласованная почта. */
export function adminAccountEntries(value: string | undefined): [string, string][] {
  return listEnv(value).flatMap(entry => {
    const separator = entry.indexOf('=');
    return separator > 0 ? [[entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()]] : [];
  });
}

/** Панель принимает только точный HTTPS-origin или локальный HTTP при разработке. */
export function adminOrigin(value: string | undefined, secure: boolean): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password) return null;
    if (url.protocol === 'https:' || (!secure && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return url;
  } catch { /* при неверной настройке панель закрыта */ }
  return null;
}
