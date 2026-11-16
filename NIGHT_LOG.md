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
