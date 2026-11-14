# NIGHT_LOG.md — журнал ночного запуска #1

## Старт
- Ветка night/1, AGENT.md → AGENTS.md. SPEC дополнен таблицей соответствия имён и Locked Decisions; TASKS.md переписан.
- Базовая линия: typecheck, typecheck:tests, 483 теста — зелёные.

## TASK-01 — тарифы, лимиты, права (готово)
- `src/types.ts`: `BaseEl` (id, groupId, reactions), `PlanTier`, `PageRight`, `ProjectPermissions`, `Project.ownerPlan/permissions`, заготовки `CommentThread`/`Page.comments`.
- `src/limits.ts`: `PLAN_LIMITS` (+ `maxEditors`: free 4, pro/tutor ∞), `canCreateProject/Page`, `canGuestJoinRoom`, `sanitizePermissionsForPlan`, `planOf`, `effectivePermissions`.
- `src/file.ts` (новый): `parseProject`, `serializeProject`, `sanitizeElement`, `sanitizePermissions`, `sanitizeReactions`; `storage.ts` использует `parseProject` вместо `migrate`.
- Решение: `parseProject` хранит права как есть, поправка на тариф — в местах применения (`effectivePermissions`).
- Решение: проект без страниц получает пустую страницу вместо падения при открытии.
- Тесты: `tests/unit/limits.test.ts` (12). Всего 495.

## TASK-02 — защита от копирования и клонирования (готово)
- `state.ts`: поля `collabRole`, `linkMode`; `canCopyCurrentBoard()`, `canCloneCurrentProject()` (права через `effectivePermissions`, т.е. на free запреты не действуют); `duplicateSelected` теперь возвращает boolean и проверяет запрет.
- `clipboard.ts`: защита в `copySelection`; новые `cutSelection`, `duplicateSelection`; `app.duplicateSelection` делегирует ему.
- `collab.ts` выставляет `state.collabRole` (connectCollab/stopCollab). `linkMode` выставит роутер/UI позже.
- Заблокированы также: Ctrl+Shift+C (картинкой), экспорт PNG, экспорт проекта в JSON, дублирование Alt-перетаскиванием и копирование при переносе на другую страницу.
- Ограничение: защита — сдерживание, не криптозащита (в памяти гостя весь проект).
- Тесты: `tests/unit/copy-protection.test.ts` (10). Всего 505.

## TASK-03 — URL-роутер (готово)
- `src/router.ts`: `parseBoardUrl`, `buildBoardUrl` (по умолчанию `?route=…`, `{style:'path'}` — `/p/…`, `/j/…`), `computeFocusCamera`, `focusElementsOnBoard`, а также `linkModeOf`, `pagesVisibleForRoute`, `routeAllowsCloneButton`, `routeShowsPagesDock`.
- `?room=CODE` (локальная сеть) и `#relay=…` разбираются как `collab`; ключ шифрования всегда в `#k=`, в `/j/:token` не попадает. Права по страницам в ссылке не передаются.
- `Flash.ms?` — длительность подсветки; `renderer.ts` её учитывает (по умолчанию 1400 мс), фокус подсвечивает 2000 мс.
- Загрузка проекта по `projectId` не делалась (бэкенда нет); к UI роутер не подключён (`state.linkMode` пока выставляется только вручную).
- Тесты: `tests/unit/router.test.ts` (21). Всего 526.

## TASK-04 — дельта-синхронизация (готово)
- `src/delta.ts`: `ElementOp`, `BoardPatch` (вместо несуществующих `background`/`gridSize` — `grid`, `backgroundColor | null`), `diffElements`, `applyBoardPatch`, `isBoardPatch` (проверка формы пакета из сети), `MAX_PATCH_OPS`.
- `diffElements`: del → put → order; `order` только если без него порядок получателя (оставшиеся на местах, новые сверху, с учётом `layerPin`) не совпал бы с `next`. Сравнение: по ссылке, затем по значению.
- `applyBoardPatch`: иммутабельно, операции по порядку, `put` через `sanitizeElement`, равные по значению элементы остаются прежними объектами (кэш рендера), `layerPin` пересортировывается; если ничего не изменилось — тот же массив `elements`. `rev` не используется (решение 32).
- Тесты: `tests/unit/delta.test.ts` (17). Всего 543.

## TASK-05 — браузерный Room Host (готово)
- `src/room-host.ts`: порт `electron/room.cjs` (`createRoomHub`, `Room`, `RoomSocket`, `normalizeName`); сокет принимает `string | Uint8Array | ArrayBuffer`, ни Node, ни ws.
- Лимиты по тарифу: `plan` из опций или `ownerPlan` проекта (нет — free); `maxGuests` (free 1, pro/tutor ∞), `maxEditors` (free 4, pro/tutor ∞); считаются только открытые сокеты. Лишний гость получает `{t:'denied', reason:'free-limit-reached'}` и закрытие кодом 4402 (`CLOSE_FREE_LIMIT` в `collab-transport.ts`, текст в `collab.ts`).
- `allowCopy` (из прав проекта с поправкой на тариф или опции) — в `init` и `rights`. Начальные права гостя — из `permissions.pageRights`. Скрытые (`hidden`) страницы не попадают гостю ни в проекте, ни в патчах.
- Патчи: валидный `t:'patch'` от участника с `edit` на странице применяется через `applyBoardPatch`, `rev` ведёт хаб, рассылка — тем, у кого страница не скрыта; участникам без поддержки патчей (флаг `patches` при подключении или сообщение `caps`) уходит полный проект. `pushPatch` — патч от автора.
- Гость не может менять `ownerPlan`/`permissions`/id проекта и на free не может добавлять страницы сверх лимита (`canCreatePage`).
- `electron/room.cjs` и `share.cjs` не менялись (решение 41); к UI/транспорту хост пока не подключён.
- В TASK-08 нужно доработать: проекция `TaskEl` для гостя (`projectFor`, `patch`) и слияние гостевых правок заданий.
- Тесты: `tests/unit/room-host.test.ts` (30). Всего 573.
