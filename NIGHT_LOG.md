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
