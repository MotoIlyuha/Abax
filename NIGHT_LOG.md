# NIGHT_LOG.md — журнал ночного запуска #5

Журналы предыдущих ночей — `NIGHT_LOG_NIGHT1.md` … `NIGHT_LOG_NIGHT4.md`.

## Старт
- Ветка `night/5` от `main` (c019685, 2.9.0).
- Базовая линия (фактическая, Решение 0.2): `npm run typecheck`, `npm run typecheck:tests` — чисто; `npm test` — **1125** unit/server тестов в 77 файлах (в спеке по старому журналу было 1096 — после Ночи №4 добавлялись тесты в main); E2E — **304** теста в 29 файлах (`playwright test --list`).

## TASK-01: Чистые модели — готово
- `src/types.ts`, `src/file.ts`: `ProjectPermissions.maxGuests?: number | null` (целое 0..50 или null, мусор отбрасывается при загрузке).
- `src/limits.ts`: `MAX_GUESTS_LIMIT = 50`, в `PlanLimits` — `canSetMaxGuests`, `canFollowHost` (free — нет, pro/tutor — да); `sanitizePermissionsForPlan` оставляет `maxGuests` только на pro/tutor и только 1..50; `effectiveMaxGuests(plan, perms)` = min(лимит тарифа, лимит автора).
- `src/sync-state.ts`: метка заглушки `doska.starter` (`markStarter`/`clearStarter`/`starterId`), `isPristineStarterProject` («Проект 1», одна «Страница 1», пусто, без комментариев, прав, иконки, закрепления, фона, подписей осей и не квадратной сетки); `SyncStatus`, `syncStatusOf` (комната автора главнее отправок, лимит главнее сети), `SYNC_STATUS_TEXT`; `doska.syncBase.<id>`.
- `src/sync-conflict.ts` (разрешён серверу): `contentSignature` — cyrb53 канонического JSON (ключи по порядку) содержимого автора **после `parseProject`** (обе стороны сравнивают проект в виде, в котором его хранит сервер); без реакций, попыток и черновиков учеников, комментариев, меток времени, тарифа и прав.
- `src/edge-pointer.ts`: `computeEdgePointer(sx, sy, w, h, insets)` — пересечение луча из центра безопасной области с её рамкой и угол.
- `src/presence.ts`: `getParticipantInitials`, `pageAvatars` (до 3 + «+N», без меня и скрытых), `nearestAvailablePage` (следующая, иначе предыдущая).
- **Развилка:** чистые правила чата вынесены не в `src/collab-chat.ts`, а в отдельный `src/room-chat.ts` (`normalizeChatText`, `createRateLimiter` 5/3 с, `tokenizeChat` только `https://`, константы 500/100): его импортирует хаб `src/room-host.ts`, а хаб — сервер; `collab-chat.ts` останется модулем интерфейса. `room-chat` добавлен в список модулей для сервера в `AGENTS.md`.
- **Заметка для TASK-07:** `parseProject({ id, pages: [] })` подставляет одну пустую страницу — проект без страниц у гостя нельзя пропускать через `parseProject`.
- Тесты: `sync-state.test.ts` (11), `sync-conflict.test.ts` (7), `edge-pointer.test.ts` (6), `presence.test.ts` (6), `room-chat.test.ts` (5), `limits.test.ts` (+4). Всего **1164** (было 1125), typecheck чисто.
