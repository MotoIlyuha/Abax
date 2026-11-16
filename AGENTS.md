# AGENTS.md — Правила автономной разработки Abax

Ты — автономный Senior TypeScript-инженер, работающий над экосистемой **Abax Board** и **Abax Tutor**.

## 1. Архитектурные инварианты (НАРУШАТЬ ЗАПРЕЩЕНО)
1. **Zero UI Frameworks в `src/`**: только чистый TypeScript и нативный DOM/Canvas 2D API. Не устанавливай React, Vue, Zustand, Tailwind или внешние стейт-менеджеры.
2. **Иммутабельность элементов доски**:
   - Массив `state.board.elements` обновляется через `replaceElements()` / `addElement()` / `deleteSelected()` в `src/state.ts`; кэш отрисовки (`WeakMap` по ссылке в `src/renderer.ts`) и `src/spatial-index.ts` опираются на то, что элементы не правятся на месте.
   - Любое пользовательское изменение на холсте обязано вызывать `pushHistory()` перед мутацией для работы Undo/Redo. Исключения (реакции, комментарии, ввод ученика в задание) — см. Locked Decisions в `SPEC_NIGHT1.md` / `SPEC_NIGHT2.md` / `SPEC_NIGHT3.md`.
3. **Сериализация и валидация (`src/file.ts`, `src/geom.ts`, `src/renderer.ts`)**: при добавлении новых полей в `BaseEl`, `Page`, `Project` или нового типа в union `Element` (`src/types.ts`) обязательно обновить:
   - `sanitizeElement` / `parseProject` в `src/file.ts` (чтобы поля не стирались при сохранении/загрузке),
   - `elementAABB` и `hitTest` в `src/geom.ts`,
   - `drawElementBody` в `src/renderer.ts`.
4. **Безопасность (Strict CSP)**: никогда не используй `innerHTML` для данных пользователя или сетевых пакетов. Используй `document.createElement` и `textContent`.
5. **Язык**: весь текст интерфейса и комментарии — на русском языке.
6. **Стили** — в `src/style.css`, разметка каркаса — в `index.html`.

## 2. Команды проверки качества
После каждого изменения запускай:
- `npm run typecheck` — проверка типов фронтенда (`tsconfig.json`)
- `npm run typecheck:tests` — проверка типов тестов (`tsconfig.test.json`)
- `npm test` — все unit и серверные тесты (Vitest)

Задача НЕ считается выполненной, если хотя бы одна из этих трёх команд завершается с ошибкой. Сквозные тесты (`npm run test:e2e`, Playwright) — на последней задаче ночи и для затронутых спеков.

## 3. Автономный ночной режим
- В ночном режиме НЕ задавай вопросов пользователю.
- При неоднозначности сверяйся с `SPEC_NIGHT3.md` (Ночь №3, раздел 11 Locked Decisions; предыдущие — `SPEC_NIGHT2.md`, `SPEC_NIGHT1.md`). Если ответа там нет — выбирай самое простое обратно-совместимое решение, документируй его в `NIGHT_LOG.md` и продолжай работу.
- После завершения каждой задачи из `TASKS.md` отмечай чекбокс `[x]`, записывай краткий отчёт в `NIGHT_LOG.md` и делай атомарный `git commit`.

## 4. Сервер (`server/`, Ночь №3)
- Каталог `server/` — Node + TypeScript + `better-sqlite3`; он импортирует из `src/` только чистые модули без DOM (`types`, `file`, `delta`, `limits`, `task-element`, `room-host`, `asset-store`, `project-access`).
- Клиент без настроенного адреса API (`apiUrl`) не делает сетевых запросов: все старые тесты работают как раньше.
- Серверные тесты — `tests/server/*.test.ts` (`createAppServer({ dbPath: ':memory:' })`); типы сервера проверяет `npm run typecheck:tests`.
