# NIGHT_LOG.md — журнал ночного запуска #3

Журналы предыдущих ночей — `NIGHT_LOG_NIGHT1.md`, `NIGHT_LOG_NIGHT2.md`.

## Старт
- Ветка `night/3` от `main` (в нём целиком `night/2`). Базовая линия: typecheck чисто, 755 unit/server тестов зелёные, 273 E2E в списке.
- Разметка `SPEC_NIGHT3.md` починена, принятые ответы — раздел 11 (Locked Decisions, 62 пункта). `TASKS.md` приведён к реальным именам. `AGENTS.md` ссылается на `SPEC_NIGHT3.md`. `NIGHT_LOG.md` Ночи №2 переименован в `NIGHT_LOG_NIGHT2.md`. Временный `playwright.tmp-laser.config.ts` удалён.

## TASK-01 — гигиена, долги Ночи №2, пакеты сервера (готово)
- `.gitignore`: `.data/` (остальные записи уже были).
- `state.ts`: `projectPlan` — обёртка над `planOf()`: проект без `ownerPlan` — free (тариф пользователя на старые проекты не переносится).
- `plan.ts`: `userPlan()` = dev-переопределение (`import.meta.env.DEV` или `doska.devMode=1` + `doska.plan`) → тариф с сервера (`applyServerPlan`, кэш `doska.serverPlan`) → free. `limitsEnforced()` = локальный тумблер ИЛИ признак с сервера. Новые: `devModeEnabled`, `applyServerPlan`, `clearServerPlan`.
- `experimental.ts`: выбор тарифа показывается только в dev-режиме. Е2E `night2-features` ставит `doska.devMode`.
- Keepalive: `relay-host.ts` шлёт `{t:'ping'}` каждые 25 с (`pingMs`); два пинга без ответа подряд после хотя бы одного `pong` — закрыть и переподключиться; любое сообщение ретранслятора считается признаком жизни; таймер чистится в `stop`/`fail`/`onclose`. `relay/server.cjs` отвечает `{t:'pong'}` (документировано в `protocol.cjs`); старые ретрансляторы не отвечают — тогда соединение не рвётся.
- Пакеты: `better-sqlite3`, `@types/better-sqlite3` (devDependencies); `server` добавлен в `include` файла `tsconfig.test.json`.
- Тесты: `plan-limits.test.ts` (правка по Решению 5 + 5 новых), новый `relay-host.test.ts` (5), +1 в `tests/server/relay.test.ts`. Всего 766.
- Окружение: в песочнице заданы `HTTP_PROXY`/`HTTPS_PROXY`, из-за чего проверка `webServer` Playwright получает 503. Playwright запускаю как `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx playwright test`.

## TASK-02 — ядро `server/`, схема SQLite, авторизация (готово)
- Модули: `server/router.ts` (роутер, `HttpError`, лимит тела), `context.ts`, `db.ts` (пять таблиц, миграции по `PRAGMA user_version`, WAL, внешние ключи), `users.ts` (эффективный тариф, `limitsFor`, `meResponse`, `mergeUsers`, `setUserPlanRow`), `auth.ts` (JWT HS256 на `node:crypto`, `verifyTelegramLogin`, маршруты `/api/auth/anon|telegram|logout`, `/api/me`), `app.ts` (`createAppServer`: CORS `*`, `nosniff`, раздача `staticDir`, хуки `onUpgrade`/`onClose`/`handleUpgrade` для комнат и dev-сервера Vite), `config.ts`, `index.ts`, `plan-cli.ts`, `asset-storage.ts` (пока только `LocalFsAssetBackend`), `static.ts`, `rate-limit.ts`, `.env.example`.
- Решения мелкие: аноним, впервые входящий через новый Telegram-аккаунт, становится им на месте (тот же `id`, проекты не двигаются); если Telegram-аккаунт уже есть — `mergeUsers` одной транзакцией (проекты, приглашения, ассеты, авторство ревизий), анонимная запись удаляется, привязка устройства переходит к Telegram-аккаунту, если у того своей нет. Вход из другой Telegram-сессии ничего не сливает.
- Лимит анонимов считается только на создание нового пользователя (знакомое устройство входит всегда). IP — `remoteAddress`, `X-Forwarded-For` только при `TRUST_PROXY=1`.
- Сборка сервера: `npm run server:build` → `dist-server/` (не `build/`: там лежат ресурсы electron-builder; `dist-server/` в `.gitignore`), `--packages=external`; `esbuild` добавлен в devDependencies той же версии, что у Vite. Проверено вручную: запуск, анонимный вход, `server:plan` и `/api/me` с тарифом pro.
- Клиент: `src/api-client.ts` (адрес из `doska.apiUrl` или сборки `__DEFAULT_API_URL__`; Bearer; вход по токену устройства; один повтор при 401; без адреса — никаких запросов), `syncPlanFromServer()` вызывается из `main.ts`. `vite.config.ts`: `define __DEFAULT_API_URL__` (`apiUrl` в `package.json` пуст) и плагин, добавляющий домен API в CSP `connect-src`.
- Тесты: `tests/server/auth.test.ts` (26), `tests/unit/api-client.test.ts` (11), хелперы `tests/server/helpers.ts`. Всего 803.

## TASK-03 — хранилище ассетов (готово)
- `server/asset-storage.ts`: `LocalFsAssetBackend` (`<dir>/<hash[0:2]>/<hash>` + `<hash>.mime`, запись через временный файл и `rename`), `S3AssetBackend` (путь «адрес/бакет/aa/хэш», подпись `signS3Request` — AWS SigV4 на `node:crypto` + `fetch`). Подпись сверена с тремя официальными примерами AWS (GET с Range, PUT с «$», список с параметрами) — все совпали. `index.ts` выбирает S3 при `S3_ENDPOINT` и `S3_BUCKET`.
- `server/assets.ts`: `POST /api/assets` (нужна сессия; `{dataUrl}`; хэш — SHA-256 от всей строки, совпадает с `computeAssetHash`; дедупликация; потерянный файл при известной записи дозаписывается; 413 при >15 МБ байтов; 415 не-картинка; 400 мусор), `GET /api/assets/:hash` (`Cache-Control: public, max-age=31536000, immutable`, `ETag`, `nosniff`, `CSP default-src 'none'; sandbox`; inline только png/jpeg/webp/gif/avif, остальное — octet-stream + attachment; `?format=dataUrl` отдаёт исходную строку).
- Решение: в хранилище лежит исходная строка data URL (а не декодированные байты), чтобы клиент мог проверить хэш бит-в-бит; сервер декодирует её при отдаче байтов. Накладные расходы +33%, взамен нет расхождений хэша из-за вариантов записи base64.
- Новая запись в БД — 201, повтор — 200 `deduplicated: true`.
- Клиент `src/asset-store.ts`: `uploadMissingAssets(assets, api)` (по 3 параллельно, запоминает отправленное в сессии), `fetchMissingAssets(project, store, api)` (проверяет хэш скачанного, подмену не кладёт в хранилище, возвращает хэши, которые получить не удалось), `collectAssetHashes`, `markAssetsUploaded`, `resetUploadedAssets`. В `api-client.ts` — параметр `text` для ответов-строк.
- Тесты: `tests/server/assets.test.ts` (22). Всего 825.
