import type { Db } from './db';
import type { Project } from '../src/types';
import type { AssetStorageBackend } from './asset-storage';

/** Настройки сервера после разбора. */
export interface ResolvedOptions {
  /** Секрет подписи сессий (HS256). */
  jwtSecret: string;
  /** Токен бота для проверки Telegram Login; нет — вход через Telegram отключён. */
  telegramBotToken: string | null;
  /** Лимиты тарифов действуют (ABAX_ENFORCE_LIMITS). */
  enforceLimits: boolean;
  /** Адрес веб-клиента для ссылок-приглашений. */
  publicWebUrl: string;
  /** Каталог собранного клиента (dist) для раздачи; нет — только API. */
  staticDir: string | null;
  /** Доверять X-Forwarded-For (за nginx/Caddy). */
  trustProxy: boolean;
  /** Помечать cookie сессии как Secure. */
  secureCookies: boolean;
  /** Сколько новых анонимов с одного адреса в окне. */
  anonRateMax: number;
  anonRateWindowMs: number;
  /** Пауза перед записью состояния облачной комнаты в базу. */
  roomSaveMs: number;
  /** Через сколько после ухода последнего участника комната выгружается из памяти. */
  roomIdleMs: number;
}

/** Общее состояние сервера, которое получают все обработчики. */
export interface AppContext {
  db: Db;
  opts: ResolvedOptions;
  assets: AssetStorageBackend;
  now(): number;
  log(msg: string): void;
  /** true — запрос в пределах лимита (и засчитан). */
  rateLimit(key: string, max: number, windowMs: number): boolean;
  /** Подписка на изменения проекта через REST (Cloud Room обновляет своё состояние). */
  onProjectChanged(fn: (id: string, project: Project) => void): void;
  /** Сообщить, что проект изменён через REST. */
  notifyProjectChanged(id: string, project: Project): void;
  /** Подписка на удаление проекта и отзыв приглашений (комната отключает участников). */
  onAccessChanged(fn: (event: { projectId: string; kind: 'deleted' | 'invite-revoked'; token?: string }) => void): void;
  notifyAccessChanged(event: { projectId: string; kind: 'deleted' | 'invite-revoked'; token?: string }): void;
}
