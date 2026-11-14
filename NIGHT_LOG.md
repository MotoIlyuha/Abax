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
