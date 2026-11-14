# TASKS.md — Очередь задач на Ночной Запуск #2

Выполняй строго по порядку. После каждой задачи: `npm run typecheck && npm run typecheck:tests && npm test` — зелёные. Решения — в `Locked Decisions` в `SPEC_NIGHT2.md`.

- [x] **TASK-01: Реакции и живые поля при Undo/Redo (`src/comments.ts`, `src/state.ts`)**
  - `preserveElementReactions`, `preserveLiveFields` (attempts, studentDraft); вызов в `undo()`/`redo()`.
  - Тесты `tests/unit/comments.test.ts`, `tests/unit/state.test.ts`.

- [x] **TASK-02: Роутер, режимы просмотра, клонирование (`src/main.ts`, `src/app.ts`, `src/router.ts`)**
  - `state.linkMode`, `canEditBoard()` с учётом просмотра, плашка и «Клонировать проект», наведение на объекты, ссылки в меню экспорта и `#quick-menu`.

- [x] **TASK-03: Дельта-патчи, браузерный хост, `room.cjs` (`src/collab.ts`, `src/relay-host.ts`, `electron/room.cjs`)**
  - Патчи в `collab.ts` без сброса Undo; local transport; браузерный хост с `createRoomHub`; `room.cjs` понимает patch/caps.

- [ ] **TASK-04: Учитель ↔ ученик по `TaskEl` (`src/room-host.ts`, `electron/room.cjs`, `src/collab.ts`)**
  - Сообщения `task-draft`, `task-submit`; защита полей хоста; маскировка ответов.

- [ ] **TASK-05: DOM-оверлей заданий и создание заданий (`src/task-overlay.ts`, `src/app.ts`)**

- [ ] **TASK-06: Реакции и комментарии: рендер и UI (`src/renderer.ts`, `src/comments-ui.ts`, `src/app.ts`)**
  - Сообщения `react`/`comment` в хабах.

- [ ] **TASK-07: Лимиты тарифов в UI, починка `canvas-edges`, E2E `night2-features`**
  - Playwright: canvas-edges, night2-features и затронутые спеки — зелёные.
