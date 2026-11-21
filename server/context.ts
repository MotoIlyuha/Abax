import type { Db } from './db';
import type { Project } from '../src/types';
import type { AssetStorageBackend } from './asset-storage';
import type { Mailer } from './mailer';

/** Настройки сервера после разбора. */
export interface ResolvedOptions {
  /** Секрет подписи сессий (HS256). */
  jwtSecret: string;
  /** Токен бота для проверки Telegram Login; нет — вход через Telegram отключён. */
  telegramBotToken: string | null;
  /** Лимиты тарифов действуют (ABAX_ENFORCE_LIMITS). */
  enforceLimits: boolean;
  /** Dev-провайдеры входа (ABAX_DEV_AUTH): только для разработки. */
  devAuth: boolean;
  /** Реквизиты ЮKassa остаются только на сервере. */
  yookassaShopId: string | null;
  yookassaSecretKey: string | null;
  /** Вход через Google (OAuth): нет client id — выключен (или dev-заглушка при devAuth). */
  googleClientId: string | null;
  /** Вход через Telegram (OpenID Connect): Client ID (ID бота) и Client Secret из @BotFather → Login Widget. */
  telegramClientId: string | null;
  telegramClientSecret: string | null;
  googleClientSecret: string | null;
  /** Адрес самого сервера для ссылок входа (redirect_uri Google); нет — из запроса. */
  publicApiUrl: string;
  /** Куда ещё можно возвращать пользователя после входа (origin), кроме publicWebUrl и publicApiUrl. */
  allowedOrigins: string[];
  /** Адрес веб-клиента для ссылок-приглашений. */
  publicWebUrl: string;
  /** Каталог собранного клиента (dist) для раздачи; нет — только API. */
  staticDir: string | null;
  /** Чистые ссылки /j/<токен или адрес> на publicWebUrl (клиента раздаёт этот сервер); по умолчанию — если задан staticDir. */
  prettyLinks: boolean;
  /** Доверять X-Forwarded-For (за nginx/Caddy). */
  trustProxy: boolean;
  /** Помечать cookie сессии как Secure. */
  secureCookies: boolean;
  adminOrigin: URL | null;
  adminAccounts: ReadonlyMap<string, string>;
  /** Сколько новых анонимов с одного адреса в окне. */
  anonRateMax: number;
  anonRateWindowMs: number;
  /** Пауза перед записью состояния облачной комнаты в базу. */
  roomSaveMs: number;
  /** Через сколько после ухода последнего участника комната выгружается из памяти. */
  roomIdleMs: number;
}

/**
 * Изменение доступа к проекту: удалён, приглашение отозвано или изменено (роль, копирование) —
 * облачная комната отключает участников или пересчитывает их права.
 */
/** token — настоящий токен строки invites (вошедшие по именному адресу закрываются вместе с ним). */
export interface AccessEvent { projectId: string; kind: 'deleted' | 'invite-revoked' | 'invite-updated'; token?: string }

/** Общее состояние сервера, которое получают все обработчики. */
export interface AppContext {
  db: Db;
  opts: ResolvedOptions;
  assets: AssetStorageBackend;
  /** Почта для кодов входа; null — вход по почте выключен (кроме dev-провайдеров). */
  mailer: Mailer | null;
  /** HTTP-запросы к провайдерам (Google token endpoint); подменяется в тестах. */
  fetch: typeof fetch;
  now(): number;
  log(msg: string): void;
  /** true — запрос в пределах лимита (и засчитан). */
  rateLimit(key: string, max: number, windowMs: number): boolean;
  /** Подписка на изменения проекта через REST (Cloud Room обновляет своё состояние). */
  onProjectChanged(fn: (id: string, project: Project) => void): void;
  /** Сообщить, что проект изменён через REST. */
  notifyProjectChanged(id: string, project: Project): void;
  /** Подписка на удаление проекта и отзыв приглашений (комната отключает участников). */
  onAccessChanged(fn: (event: AccessEvent) => void): void;
  notifyAccessChanged(event: AccessEvent): void;
}
