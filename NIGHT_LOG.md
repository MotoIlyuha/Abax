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
