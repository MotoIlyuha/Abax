# NIGHT_LOG.md — журнал ночного запуска #2

Журнал первой ночи — в `NIGHT_LOG_NIGHT1.md`.

## Старт
- Ветка night/2 от night/1. AGENTS.md обновлён (реальные имена, SPEC_NIGHT2), в SPEC_NIGHT2.md записаны 66 решений, TASKS.md переписан на 7 задач.
- Базовая линия: typecheck, typecheck:tests, 632 теста — зелёные.

## TASK-01 — реакции и живые поля при Undo/Redo (готово)
- `comments.ts`: `preserveElementReactions` (переносит актуальные реакции, в т. ч. их отсутствие, на снимок), `preserveLiveFields` (+ `attempts` и `studentDraft` у `TaskEl`). Нетронутые элементы остаются теми же объектами, без изменений — тот же массив.
- `state.ts`: `undo()`/`redo()` применяют снимок через `preserveLiveFields`.
- Решение (33→32): при совместной работе Undo/Redo остаются откатом по снимку; слияние чужой истории не делается (по просьбе владельца, чтобы не раздувать скоуп).
- Тесты: +4 в `tests/unit/comments.test.ts`. Всего 636.

## TASK-02 — роутер, просмотр по ссылке, клонирование (готово)
- Новые модули: `src/plan.ts` (`userPlan`, `limitsEnforced` — localStorage `doska.plan`, `doska.enforceLimits`), `src/link-view.ts` (чистая логика: `linkBaseUrl`, `boardLinkFor`, `resolveViewProject`, `cloneProjectForViewer`, `PUBLIC_WEB_URL`), `src/link-view-ui.ts` (плашка `#link-banner`, `enterLinkView`, `startLinkViewCamera`, `copyBoardLink`, `cloneViewedProject`).
- `main.ts`: `parseBoardUrl` на запуске; `/j/:token` → уведомление «Ссылка не поддерживается»; из просмотра в просмотр по `popstate`/`hashchange` — без перезагрузки, во всё остальное (в том числе в просмотр со своей доски и обратно) — `location.reload()`. Разбор `?room`/`#relay` не менялся.
- `app.ts`: `canEditBoard()` и `canEditPages()` учитывают `linkMode`; защита в импорте, drop, переименовании, удалении и перестановке страниц; `saveNow`, `saveCamera`, `restoreCamera`, `doska.last` в просмотре не работают; пункты «Ссылка на проект/страницу» в меню экспорта; кнопка «Ссылка на выделенные объекты» в `#quick-menu`.
- `controller.ts`: нажатие на холст, Delete, Ctrl+Z/Y/G/A, двойной клик проверяют `canEditBoard()`; в просмотре активен инструмент «Панорама».
- Решения мелкие: в просмотре скрыта кнопка «Домой» и в `view-project` (чтобы не выйти из режима случайно; выход — «Клонировать проект»); скрыты также кнопки сетки и переименование страницы/иконки.
- Клон не проходит через `netStorage`: просмотр и совместная работа не совмещаются.
- Тесты: `tests/unit/link-view.test.ts` (10), e2e `night2-features.spec.ts` (6). Всего 646 unit. Затронутые старые e2e (collab, hotkeys, selection, pages-projects, ui, guides-pages, drafts) — зелёные; «Отошёл» флапнул один раз под нагрузкой, в одиночку проходит.
