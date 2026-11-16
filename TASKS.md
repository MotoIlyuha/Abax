# TASKS.md — План задач Ночи №3 (`night/3`)

> **Правило выполнения для агента:**
> 1. Задачи выполняются строго по порядку (`TASK-01` → `TASK-08`). Решения — в разделе 11 (Locked Decisions) `SPEC_NIGHT3.md`.
> 2. На каждую задачу: реализация → тесты → `npm run typecheck && npm run typecheck:tests && npm test` → отметка `[x]` → запись в `NIGHT_LOG.md` → атомарный коммит в ветку `night/3`.
> 3. Вопросов не задавать. Мелкие развилки решать в пользу надёжности и безопасности и записывать в `NIGHT_LOG.md`.
> 4. Базовая линия: 755 unit/server тестов, 273 E2E.

---

- [x] **TASK-01: Гигиена, долги Ночи №2, пакеты сервера**
  - **Файлы**: `.gitignore`, `src/state.ts` (`projectPlan`), `src/plan.ts`, `src/experimental.ts`, `src/relay-host.ts`, `relay/server.cjs`, `package.json`, `tsconfig.test.json`.
  - `.gitignore`: добавить `.data/`.
  - `projectPlan` = `planOf`; тариф пользователя — dev-переопределение → серверный кэш → `free` (Решения 7–9); `limitsEnforced()` учитывает значение сервера (10).
  - Keepalive `ping`/`pong` в `relay-host.ts` и ответ в `relay/server.cjs` (11); очистка таймера при `stop`.
  - Установить `better-sqlite3`, `@types/better-sqlite3` (devDependencies); добавить `server` в `tsconfig.test.json`; скрипты `dev:cloud`, `server`, `server:build`, `server:plan` (заготовки).
  - **Тесты**: `tests/unit/plan-limits.test.ts` (правка), новый `tests/unit/relay-host.test.ts`, дополнение `tests/server/relay.test.ts`; E2E «переключатель лимитов» — через `doska.devMode`.

- [x] **TASK-02: Ядро `server/`, схема SQLite, авторизация**
  - **Файлы**: `server/db.ts`, `server/auth.ts`, `server/app.ts`, `server/index.ts`, `server/http.ts`, `src/api-client.ts`, `src/plan.ts`, `src/project-access.ts` (заготовка).
  - Миграции пяти таблиц, JWT HS256, `POST /api/auth/anon|telegram|logout`, `GET /api/me`, слияние аккаунтов, истечение `plan_expires_at`, rate limit анонимов, CORS.
  - Клиент: `src/api-client.ts` (адрес API, `fetch` внедряется, без адреса — нет запросов) и синхронизация тарифа в `src/plan.ts`.
  - **Тесты**: `tests/server/auth.test.ts`.

- [x] **TASK-03: Хранилище ассетов**
  - **Файлы**: `server/asset-storage.ts`, `server/assets.ts`, `server/app.ts`, `src/asset-store.ts`.
  - `LocalFsAssetBackend`, `S3AssetBackend` (SigV4), `POST/GET /api/assets`, `uploadMissingAssets`, `fetchMissingAssets`.
  - **Тесты**: `tests/server/assets.test.ts`, `tests/unit/asset-store.test.ts` (дополнение).

- [x] **TASK-04: REST проектов, ревизии, клонирование**
  - **Файлы**: `server/projects.ts`, `server/app.ts`, `src/project-access.ts`, `src/link-view.ts`.
  - `GET/PUT/DELETE /api/projects[/:id]`, `POST …/patch`, `POST …/clone`, лимиты, `409 id-taken`, `409 missing-assets`, маскировка ответов.
  - **Тесты**: `tests/server/projects.test.ts` (в т. ч. отсутствие `answer` для не-владельца и в клоне).

- [x] **TASK-05: Инвайты и кросс-девайсный просмотр**
  - **Файлы**: `server/invites.ts`, `server/app.ts`, `src/link-view.ts`, `src/link-view-ui.ts`, `src/main.ts`, `src/router.ts`.
  - `POST/GET/DELETE /api/invites`, `GET /j/:token` (JSON); просмотр по ссылке — сначала сервер, потом `storage.load`; клонирование через сервер.
  - **Тесты**: `tests/server/invites.test.ts`, `tests/unit/link-view-cloud.test.ts`.

- [x] **TASK-06: Клиентская облачная синхронизация**
  - **Файлы**: `src/cloud-sync.ts`, `src/storage.ts`, `src/main.ts`, `src/app.ts`.
  - Обёртка над `storage`: PUT с дебаунсом, вынос ассетов, `lastSyncedRev`, начальная синхронизация, объединённый список проектов, `DELETE`.
  - **Тесты**: `tests/unit/cloud-sync.test.ts`.

- [x] **TASK-07: Cloud Rooms**
  - **Файлы**: `server/cloud-room-manager.ts`, `server/app.ts`, `src/room-host.ts`, `src/collab.ts`, `src/browser-host.ts`, `src/main.ts`, `src/app.ts`.
  - WS `/ws/room/:projectId`, автосохранение, комната без автора на pro/tutor, кнопка «Ссылка-приглашение», маскировка заданий.
  - **Тесты**: `tests/server/cloud-room.test.ts`.

- [x] **TASK-08: E2E и финальная проверка**
  - **Файлы**: `e2e/night3-cloud.spec.ts`, `vite.config.ts` (dev-плагин), `package.json`.
  - Сценарии 1–3 из `SPEC_NIGHT3.md` в изолированных контекстах с собственным `createAppServer`.
  - Финал: `npm run typecheck && npm run typecheck:tests && npm test && npx playwright test` (дважды), `npm run build`, `npm run server:build`.
