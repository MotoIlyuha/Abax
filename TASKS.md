# TASKS.md — Очередь задач на Ночной Запуск #1

Выполняй строго по порядку. После каждой задачи: `npm run typecheck && npm run typecheck:tests && npm test` — зелёные. Имена — по таблице соответствия и `Locked Decisions` в `SPEC_NIGHT1.md`.

- [x] **TASK-01: Тарифы, лимиты и права проекта (`src/limits.ts`, `src/types.ts`, `src/file.ts`)**
  - Типы `PlanTier`, `PageRight`, `ProjectPermissions`; поля `ownerPlan?`, `permissions?` в `Project`; `BaseEl`.
  - `src/limits.ts` по разделу 1 SPEC.
  - Новый `src/file.ts` (`parseProject`, `serializeProject`, `sanitizeElement`); `storage.migrate` использует его.
  - Тесты `tests/unit/limits.test.ts` (3x3 на free, 1 гость, сброс запретов на free, сериализация прав).

- [ ] **TASK-02: Защита от копирования и клонирования (`src/clipboard.ts`, `src/state.ts`)**
  - `canCopyCurrentBoard()`, `canCloneCurrentProject()`, поля `collabRole`, `linkMode` в `state.ts`.
  - Блокировка `copySelection`, `cutSelection`, `duplicateSelected` и обёрток в `app.ts`/`controller.ts`.
  - Тесты `tests/unit/copy-protection.test.ts`.

- [ ] **TASK-03: URL-роутер и авто-фокус (`src/router.ts`)**
  - `parseBoardUrl`, `buildBoardUrl`, `computeFocusCamera`, `focusElementsOnBoard`; `Flash.ms?`.
  - Тесты `tests/unit/router.test.ts`.

- [ ] **TASK-04: Дельта-синхронизация (`src/delta.ts`)**
  - `ElementOp`, `BoardPatch`, `diffElements`, `applyBoardPatch`.
  - Тесты `tests/unit/delta.test.ts`.

- [ ] **TASK-05: Браузерный Room Host (`src/room-host.ts`)**
  - Порт `electron/room.cjs` на TS: `maxGuests`, `maxEditors`, `allowCopy`, `patch`, `hidden`-страницы, `denied`.
  - Тесты `tests/unit/room-host.test.ts`.

- [ ] **TASK-06: Хранилище ассетов (`src/asset-store.ts`)**
  - `computeAssetHash`, `AssetStore`, `extractProjectAssets`, `hydrateProjectAssets`.
  - Тесты `tests/unit/asset-store.test.ts`.

- [ ] **TASK-07: Реакции и комментарии (`src/comments.ts`, `src/types.ts`, `src/file.ts`)**
  - `reactions` в `BaseEl`, `comments` в `Page`; функции `src/comments.ts`; обновить `file.ts`; синхронизация в `state.ts`.
  - Тесты `tests/unit/comments.test.ts`.

- [ ] **TASK-08: TaskEl (`src/types.ts`, `src/task-element.ts`, `src/geom.ts`, `src/file.ts`, `src/renderer.ts`)**
  - `TaskEl` (+ `subject`, `answerUnit`, `codeSnippet`), поддержка в geom/file/renderer.
  - `src/task-element.ts`: `createTaskElement`, `submitTaskAttempt`, `updateStudentDraft`, `toggleTaskHardFlag`, `projectTaskForRole`.
  - Тесты `tests/unit/task-element.test.ts`.
