# SPEC_NIGHT3.md — Спецификация Ночи №3: Бэкенд, облачная синхронизация и Cloud Rooms

> Ветка: `night/3` (от актуального `main`, в который целиком входит `night/2`).
> Зависимости: модули Ночи №1 (`src/file.ts`, `src/limits.ts`, `src/router.ts`, `src/delta.ts`, `src/room-host.ts`, `src/asset-store.ts`, `src/comments.ts`, `src/task-element.ts`) и Ночи №2 (`src/plan.ts`, `src/link-view.ts`, `src/link-view-ui.ts`, `src/relay-host.ts`, `src/browser-host.ts`, `src/task-overlay.ts`).
> Базовая линия: 755 unit/server тестов (Vitest), 273 E2E (Playwright).
> Принятые решения предполётного согласования — в разделе 11 (Locked Decisions); при расхождении текста разделов 1–10 с ними приоритет у раздела 11.

---

## 1. Цель Ночи №3

После Ночей №1 и №2 готов клиентский движок, но нет сервера:

1. Просмотр по ссылке (`view-project`, `view-page`, `?focus=…`) работает только для проектов из `localStorage` этого же браузера.
2. Инвайт-ссылки `/j/:token` показывают заглушку «Ссылка не поддерживается».
3. Тариф читается из `localStorage` (`doska.plan`), а не с сервера.
4. Контент-адресуемое хранилище `src/asset-store.ts` (`asset://<64hex>`) не подключено к сохранению и серверу.
5. Комнаты совместной работы живут, только пока открыта вкладка автора.

**Цель** — лёгкий бэкенд `server/` (Node + TypeScript + SQLite `better-sqlite3`): облачная синхронизация проектов и ассетов, серверная авторизация (анонимный токен устройства + проверка Telegram Login), кросс-девайсные ссылки (включая `/j/:token`) и серверные комнаты **Cloud Rooms** на базе `src/room-host.ts`.

---

## 2. Обязательные исправления долгов Ночи №2

1. **Гигиена `.gitignore`**: `.check-deps/`, `.claude/`, `.codex/` уже есть; добавить `.data/` (данные сервера).
2. **`projectPlan(project)`** (в `src/state.ts`; Решение 11 Ночи №1): возвращает строго `planOf(project)`, то есть `project.ownerPlan ?? 'free'`. Тариф пользователя на старые проекты без `ownerPlan` не распространяется.
3. **Источник тарифа пользователя**: сервер (`GET /api/me`). Локальный `localStorage['doska.plan']` и выбор тарифа в «Экспериментальных» действуют только под dev-флагом (`import.meta.env.DEV` или `localStorage['doska.devMode'] === '1'`).
4. **Keepalive в `src/relay-host.ts`**: каждые 25 с `{t:'ping'}` на ретранслятор; ретранслятор отвечает `{t:'pong'}`.

---

## 3. Архитектура `server/` и схема БД

### 3.1. Стек
- Каталог `server/` в корне. Среда: Node 22 + TypeScript. Сервер напрямую импортирует чистые модули из `src/` (без DOM).
- HTTP: нативный `node:http` + уже установленный `ws` + небольшой собственный роутер. Без Fastify/Hono.
- БД: `better-sqlite3`, `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`.
- Фабрика для тестов: `createAppServer({ dbPath: ':memory:', assetsDir, staticDir?, jwtSecret, ... })` → `{ server, db, listen(), close(), url }`.

### 3.2. Таблицы SQLite
1. **`users`**: `id TEXT PK`, `tg_id TEXT UNIQUE NULL`, `tg_username TEXT NULL`, `display_name TEXT NOT NULL DEFAULT 'Гость'`, `avatar_url TEXT NULL`, `device_token_hash TEXT UNIQUE NULL` (SHA-256 токена устройства), `plan TEXT NOT NULL DEFAULT 'free'` (`free|pro|tutor`), `plan_expires_at INTEGER NULL`, `created_at`, `updated_at`.
2. **`projects`**: `id TEXT PK` (= `Project.id`), `owner_id → users(id) ON DELETE CASCADE`, `title`, `rev INTEGER DEFAULT 1`, `data_json` (сериализованный `Project`, data-URL вынесены в `asset://`), `forbid_clone`, `allow_copy DEFAULT 1`, `page_rights_json DEFAULT '{}'` (производные копии `permissions`), `is_deleted DEFAULT 0`, `created_at`, `updated_at`.
3. **`project_revisions`**: `id AUTOINCREMENT`, `project_id → projects ON DELETE CASCADE`, `rev`, `page_id NULL`, `author_id NULL`, `patch_json`, `created_at`, `UNIQUE(project_id, rev)`. Хранятся последние `MAX_REVISIONS_PER_PROJECT = 200`.
4. **`invites`**: `token PK` (base64url, ≥16 символов), `project_id → projects`, `created_by → users`, `default_role` (`edit|view`), `allow_copy`, `page_rights_json`, `revoked`, `expires_at NULL`, `created_at`.
5. **`assets`**: `hash PK` (64 hex), `mime_type`, `size_bytes`, `storage_backend` (`local|s3`), `storage_key`, `uploaded_by → users ON DELETE SET NULL`, `created_at`.

---

## 4. Авторизация и тарифы

### 4.1. Анонимный вход
`POST /api/auth/anon` (`{ deviceToken }`, ≥32 случайных байт в base64url) создаёт или возвращает пользователя; ответ `{ token, user, limits }`, плюс cookie `abax_session` (`httpOnly; SameSite=Lax; Path=/`). Основной способ авторизации — `Authorization: Bearer <jwt>`. `GET /api/me` без сессии — 401 и пользователя не создаёт.

### 4.2. Telegram Login (`POST /api/auth/telegram`)
Payload `{ id, first_name, last_name?, username?, photo_url?, auth_date, hash }`. Проверка: `secret = SHA256(TELEGRAM_BOT_TOKEN)`, HMAC-SHA256 от `data_check_string` (поля по алфавиту, `key=value` через `\n`, без `hash`), сравнение `crypto.timingSafeEqual`, `auth_date` не старше 24 ч. **Слияние аккаунтов** в одной транзакции: проекты, инвайты, ассеты и ревизии анонимной сессии переходят к Telegram-пользователю.

### 4.3. `GET /api/me`
`{ user: { id, displayName, tgUsername, isAnonymous, plan }, plan, planExpiresAt, limitsEnforced, limits: { maxProjects, maxPagesPerProject, maxRoomGuests, canForbidClone, canDisableCopy } }`. `null` в лимитах — без ограничений. Если `plan_expires_at` в прошлом, эффективный тариф — `free`.

---

## 5. Проекты (`/api/projects/*`)

- `GET /api/projects` — проекты владельца (`id, title, rev, updatedAt, pageCount, ownerPlan`).
- `GET /api/projects/:id[?pageId=…][&invite=…]`:
  - владелец — полный проект, `role: 'host'`;
  - гость по инвайту — без `hidden`-страниц; задания через `projectTaskForRole(el,'guest')`;
  - публичный просмотр (по id) — то же, плюс `attempts`, `studentDraft`, `markedHard` и `comments` вырезаются; при `?pageId=X` — только страница X и `forbidClone: true`; `role: 'viewer'`, `canClone: !forbid_clone`.
- `PUT /api/projects/:id` — создание/сохранение (только владелец): `parseProject`, лимиты (`canCreateProject`, `canCreatePage`, `sanitizePermissionsForPlan`) → 403 `plan-limit-projects` / `plan-limit-pages`; `ownerPlan` проставляет сервер; при устаревшем `expectedRev` — LWW с `preserveLiveFields` + `mergeHostTask` + объединением комментариев; ответ `{ id, rev, ownerPlan, permissions, updatedAt }`.
- `POST /api/projects/:id/patch` — `BoardPatch`; владелец или гость с `edit` на странице.
- `POST /api/projects/:id/clone` — серверное клонирование (403 `clone-forbidden`, 403 `plan-limit-projects`).
- `DELETE /api/projects/:id` — мягкое удаление.

---

## 6. Ассеты (`/api/assets/*`)

- `AssetStorageBackend`: `put`, `get`, `exists`. `LocalFsAssetBackend` (`<dir>/<hash[0:2]>/<hash>`, запись через временный файл) и `S3AssetBackend` (SigV4 на `node:crypto` + `fetch`).
- `POST /api/assets` (`{ dataUrl }`, нужна сессия): хеш = SHA-256 от **всей строки** data URL (как `computeAssetHash`); дедупликация; лимит 15 МБ (413).
- `GET /api/assets/:hash`: байты с `Cache-Control: public, max-age=31536000, immutable`; `?format=dataUrl` — исходная строка.
- Клиент: `uploadMissingAssets`, `fetchMissingAssets` в `src/asset-store.ts`; `extractProjectAssets` / `hydrateProjectAssets` уже есть.

---

## 7. Ссылки совместной работы

- `POST /api/invites` (владелец), `DELETE /api/invites/:token`, `GET /api/invites/:token` (+ `GET /j/:token` при `Accept: application/json`) → `{ token, projectId, ownerPlan, role, allowCopy, pageRights, roomCode: 'cloud:<projectId>', project }` (проект отфильтрован и замаскирован).
- Клиент: `link-view.ts`/`link-view-ui.ts` сначала запрашивают сервер, при 404/ошибке сети — `storage.load`. Клонирование — через сервер с откатом на локальное.

---

## 8. Cloud Rooms

- Free: P2P/ретранслятор как раньше; серверная комната по `/j/:token` живёт, пока подключён автор, один гость.
- Pro/Tutor: серверный `createRoomHub` в процессе Node (`server/cloud-room-manager.ts`), комната `cloud:<projectId>`, живёт без автора, гость заходит по инвайту.
- Автосохранение: дебаунс ≤ 500 мс; немедленно — при `task-submit` и уходе последнего участника.
- Защита ответов: хаб держит полный `Project`; гостям — только `projectTaskForRole(el,'guest')`.

---

## 9. Инварианты безопасности

1. `TaskEl.answer` (и закрытое `solutionMd`) не попадают в сеть к не-владельцу (HTTP и WS).
2. Никакого `innerHTML` для пользовательских данных.
3. Любой JSON проекта/элемента на границе проходит `parseProject` / `sanitizeElement`.
4. Фоновая подгрузка ассетов и входящие патчи не сбрасывают стек Undo/Redo.

---

## 10. Вне скоупа Ночи №3

Платежи (Фаза 4), календарь репетитора и уведомления (Фаза 3), парсер заданий ФИПИ (Фаза 3), клиентский UI Telegram-входа, деплой сервера (Docker/Caddy).

---

## 11. Locked Decisions

Нумерация = номера вопросов предполётного согласования. Все ответы приняты «по умолчанию».

**А. Организация**
1. `night/3` — от текущего `main`.
2. Первый коммит: починена разметка спеки, Locked Decisions, обновлённые `TASKS.md` и `AGENTS.md`, удалён `playwright.tmp-laser.config.ts`.
3. `NIGHT_LOG.md` → `NIGHT_LOG_NIGHT2.md`; новый `NIGHT_LOG.md`.
4. Базовые числа: 755 unit/server и 273 E2E.
5. Точечно правятся тесты, фиксирующие старое поведение (`plan-limits.test.ts`, E2E «переключатель лимитов и тарифа»); запись в журнал.
6. TASK-05 разбирает инвайт и открывает проект с правами; подключение к комнате — в TASK-07.

**Б. TASK-01**
7. `projectPlan` остаётся экспортом `state.ts` и становится обёрткой над `planOf()`.
8. Приоритет тарифа пользователя: dev-переопределение (только при dev-флаге) → тариф с сервера (кэш в памяти и `doska.serverPlan`) → `'free'`.
9. Выбор тарифа в «Экспериментальных» скрыт без dev-флага; E2E с `doska.plan` ставят `doska.devMode='1'` через `addInitScript`.
10. Серверные лимиты включаются переменной `ABAX_ENFORCE_LIMITS` (в проде по умолчанию выключено до Фазы 4, в тестах включено). `/api/me` отдаёт `limitsEnforced`; на клиенте `limitsEnforced()` = локальный тумблер ИЛИ значение сервера.
11. Keepalive: relay-host раз в 25 с шлёт `{t:'ping'}`, ретранслятор отвечает `{t:'pong'}` (обратно совместимо). Два пинга подряд без ответа → закрыть и переподключиться, только если ретранслятор хоть раз ответил `pong`.
12. Тест keepalive — новый `tests/unit/relay-host.test.ts` с фейковыми таймерами.
13. Каталог данных `.data/` (`abax.db`, `assets/`, `jwt-secret`).

**В. Сборка**
14. `node:http` + `ws` + свой роутер.
15. `better-sqlite3` и `@types/better-sqlite3` — в `devDependencies`.
16. `server` добавляется в `include` файла `tsconfig.test.json`.
17. `npm run server:build` (esbuild → `build/server.mjs`, `better-sqlite3` внешний); `npm run server` запускает сборку.
18. Деплой (Docker/Caddy) вне скоупа: только `server/README.md` и `server/.env.example`.
19. Vite подгружает сервер динамическим `import()` внутри `configureServer`, только для dev (`npm run dev`).
20. Чистая логика без DOM — в новом `src/project-access.ts`; `link-view.ts` её реэкспортирует. Guard-функции комнаты экспортируются.

**Г. API и авторизация**
21. Адрес API: `apiUrl` в `package.json`, `DOSKA_API_URL`, `__DEFAULT_API_URL__`, переопределение `localStorage['doska.apiUrl']`; пустой адрес выключает облако. `apiUrl` по умолчанию пуст. Основная авторизация — Bearer; CORS `Allow-Origin: *` без credentials; домен API добавляется в CSP при сборке. **Дополнение:** в `package.json` есть скрипт `dev:cloud` (`DOSKA_API_URL=http://localhost:5173 vite`), чтобы облачный бэкенд в браузере работал из коробки.
22. Синхронизация независима от платформы, включается где задан адрес API; проверяется только веб.
23. JWT HS256 на `node:crypto`, срок 30 дней, тихое обновление по deviceToken; в проде `JWT_SECRET` обязателен, в dev — `.data/jwt-secret`.
24. deviceToken генерирует клиент (`doska.deviceToken`); пользователей создаёт только `POST /api/auth/anon` с лимитом 30/час по IP; `GET /api/me` без сессии — 401.
25. Слияние переносит `projects.owner_id`, `invites.created_by`, `assets.uploaded_by`, `project_revisions.author_id`; анонимная запись удаляется, deviceToken переходит к Telegram-аккаунту; Telegram-сессия — просто вход; лимиты при слиянии не проверяются; logout стирает сессию и deviceToken.
26. Клиентского UI Telegram-входа ночью нет.
27. `/api/me` возвращает `user`, `plan`, `limits` (+ `limitsEnforced`, `planExpiresAt`); `null` — без ограничений.
28. Выдача тарифа: `npm run server:plan -- <userId> <plan> [дней]`; в тестах — прямой доступ к `db`.

**Д. Проекты**
29. Источник истины — `data_json.permissions` после `sanitizePermissionsForPlan`; колонки — производные.
30. Серверные решения опираются на эффективный тариф владельца из `users`; `ownerPlan` в JSON перезаписывается при выдаче.
31. Чужой `id` → 409 `id-taken`; клиент выдаёт локальному проекту новый id и повторяет.
32. Лимит страниц: 403, только если `new > limit && new > old`.
33. PUT в мягко удалённый проект восстанавливает его (считается созданием); GET удалённого — 404.
34. Устаревший `expectedRev`: LWW + `preserveLiveFields` + объединение комментариев по id; потеря правок гостей — известное ограничение.
35. `POST /patch` идёт через `sanitizeElement` + `mergeGuestTask`/`mergeHostTask`; клиентский `rev` игнорируется; гость авторизуется через `?invite=`.
36. В `project_revisions` — метаданные PUT, patch, task-submit, comment; не `task-draft`, не реакции; обрезка до 200 в транзакции.
37. Публичному зрителю дополнительно вырезаются `attempts`, `studentDraft`, `markedHard`, `comments`.
38. Лимиты тел: PUT 10 МБ, patch 2 МБ, WS-сообщение 16 МБ, ассет 15 МБ.

**Е. Ассеты**
39. Принимается только `{dataUrl}`; хранится исходная строка; `GET` по умолчанию отдаёт байты, `?format=dataUrl` — строку.
40. Inline только png/jpeg/webp/gif/avif; остальное — `octet-stream` + `attachment`; всегда `nosniff` и `CSP: default-src 'none'; sandbox`; `POST` требует сессию.
41. Неизвестный `asset://` в PUT → 409 `missing-assets` со списком; клиент догружает один раз. `Project.icon` не выносится.
42. При открытии с сервера гидрация до `openProject`; входящие данные комнаты гидрируются в `collab.ts` до применения; рендерер не создаёт `Image` для `asset://`.
43. `S3AssetBackend` проверяется только unit-тестом подписи (тестовые векторы AWS SigV4).

**Ж. Клиентская синхронизация**
44. `lastSyncedRev` у проекта; серверная версия новее и локальных правок нет — берём серверную; иначе PUT по правилам №34.
45. Главный экран показывает объединение локальных и серверных проектов; открытие скачивает; локальное удаление шлёт `DELETE`.
46. Облако получает изменения только через PUT (дебаунс ≈ 2 с после `saveNow` и при `visibilitychange`); `/patch` реализован и тестируется на сервере, cloud-sync его не использует.
47. Начальная синхронизация — в фоне, по одному проекту; 403 по лимиту — проект остаётся локальным (один тост); черновики и проекты-просмотры не синхронизируются.
48. Пока автор подключён к Cloud Room проекта, PUT не отправляется.
49. Основной `webServer` Playwright — без API; `night3-cloud.spec.ts` поднимает свой `createAppServer({ dbPath: ':memory:', staticDir: 'dist' })`; Vite-плагин — только для `npm run dev`.
50. Без настроенного адреса API клиент не делает запросов; `fetch` внедряется параметром.

**З. Ссылки и инвайты**
51. Ссылка-приглашение: `buildBoardUrl(base, {mode:'collab', token})` → `?route=collab&token=…`; режим `collab` не переименовывается.
52. Серверный хаб для всех тарифов: free — комната живёт, пока подключён автор, один гость; без автора — только просмотр и «Автор не в сети». Pro/Tutor — без автора и без лимита гостей. Ссылки `#relay=` не меняются.
53. Право страницы = `invite.pageRights[p] ?? project.pageRights[p] ?? invite.defaultRole`; `allowCopy` = инвайт И проект. Один активный инвайт на проект: `POST` обновляет права, сохраняя токен; новый токен — после отзыва; отзыв закрывает соединения гостей кодом 4403.
54. UI: кнопка «Ссылка-приглашение» в диалоге «Совместная работа», когда облако доступно и проект синхронизирован.
55. Просмотр: сначала сервер; при 404 или ошибке сети — `storage.load`. Тексты уведомлений не меняются.
56. Клон — через сервер, затем сохранение локально; без API — локальный клон. 403 по лимиту показывает `LIMIT_PROJECTS_TEXT`.

**И. Cloud Rooms**
57. WS `/ws/room/:projectId`; первое сообщение `{t:'hello', proto, name, invite?|session?}`; без сквозного шифрования.
58. В `RoomHubOptions` — необязательный `onChange(project, kind)`, в `AttachOptions` — `rights`; экспортируются guard-функции; обратно совместимо.
59. В облачной комнате автор принимает `init` с сервера и дальше шлёт только патчи, полный проект не отправляет.
60. Автор подключается к Cloud Room автоматически при открытии своего pro/tutor-проекта с активным инвайтом; браузерный хост через ретранслятор для него не запускается.
61. Всё, что пишется в БД, проходит `parseProject`; комната выгружается через 60 с после ухода последнего участника; один процесс Node; base64-картинки из патчей выносятся в хранилище.
62. Имя участника — из `hello`; у Telegram-пользователей — `display_name`.
