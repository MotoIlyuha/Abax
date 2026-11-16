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
