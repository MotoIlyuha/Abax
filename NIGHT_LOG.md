# NIGHT_LOG.md — журнал ночного запуска #6

Журналы предыдущих ночей — `NIGHT_LOG_NIGHT1.md` … `NIGHT_LOG_NIGHT5.md`.

## Старт
- `git fetch origin`: `origin/main` = `d24fa24` (merge PR #47), содержит `2c58e43` (`night/5`); локальный `main` (`c019685`) — предок `origin/main`, передвинут без checkout (`git branch -f main origin/main`). Ветка `night/6` от `main` (`d24fa24`); подготовленные `SPEC_NIGHT6.md`, `TASKS.md`, `AGENTS.md` перенесены (деревья совпадают). `NIGHT_LOG.md` → `NIGHT_LOG_NIGHT5.md`.
- Базовая линия (фактическая, Решение 0.2): `npm run typecheck`, `npm run typecheck:tests` — чисто; `npm test` — **1327** unit/server тестов в 91 файле, все зелёные; E2E — **314** тестов в 33 файлах (`npx playwright test --list`).

## TASK-01: Чистая модель доступа — готово
- Новый `src/access.ts` (без DOM, разрешён серверу): `AccessRole`/`StoredRole`, `normalizeRole` (`edit` → редактор, `view` → комментатор, `legacy: true`), `legacyRoleOf`, `roleLabel`; `effectivePageAccess` — порядок правил §2.2 (владелец → личное → скрыта → старая роль: право страницы или роль → «только просмотр» → роль); `ParticipantCaps`, `participantCaps`, `copyAllowedBy`, `OWNER_CAPS`; `TOKEN_RE`/`ALIAS_RE`/`RESERVED_ALIASES`, `isTokenShaped`, `isAliasShaped`, `aliasProblem` (подсказки для поля адреса); `PRINCIPAL_RE`/`isPrincipal` (автор элемента).
- `src/types.ts`: `BaseEl.by`, `ProjectPermissions.protectElements`/`linkView`/`summon`. `src/file.ts`: `by` в `COMMON_OPTIONAL` (проверка `isPrincipal`, неверное значение отбрасывается), новые поля прав в `sanitizePermissions`. `src/limits.ts`: `PlanLimits.canSetAlias` (free — нет), `MAX_ALIASES_PER_OWNER = 20`; `sanitizePermissionsForPlan` сохраняет `protectElements: true`, `linkView: false`, `summon: 'editors'` на всех тарифах (значения по умолчанию в поле не пишутся).
- `src/project-access.ts`: `invitePageRight` — через `effectivePageAccess` (личное право = `invite.pageRights`); старые приглашения `edit`/`view` дают те же права, что и раньше (старые тесты без правок).
- **Заметка (уточнение §3.4 спеки):** `sanitizeElement` оставляет неизвестные поля элемента, поэтому старые версии Abax при сохранении `by` **не** теряют; присланное клиентом `by` всё равно перезаписывает хаб (TASK-04).
- `AGENTS.md`: список модулей для сервера обновлён при подготовке ночи, сверен с импортами `server/` (`board-url`, `comments`, `collab-transport` уже использовались).
- Тесты: новый `tests/unit/access.test.ts` (26: синонимы ролей, все примеры таблицы §2.2, `invitePageRight` для старых и новых ролей, возможности по ролям, формы токена и адреса и их непересечение, подсказки, тариф, новые поля переживают сохранение/загрузку, мусор отбрасывается, `by` не влияет на `elementAABB`/`hitTest`). Всего **1353** (было 1327), typecheck чисто.
