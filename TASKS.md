# TASKS.md — План задач Ночи №4 (`night/4`)

> **Правило выполнения для агента:**
> 1. Задачи выполняются строго по порядку (`TASK-01` → `TASK-08`). Решения — в разделе 11 (Locked Decisions) `SPEC_NIGHT4.md`.
> 2. На каждую задачу: реализация → тесты → `npm run typecheck && npm run typecheck:tests && npm test` → отметка `[x]` → запись в `NIGHT_LOG.md` → атомарный коммит в ветку `night/4`.
> 3. Вопросов не задавать. Мелкие развилки решать в пользу надёжности, UX и зелёных тестов и записывать в `NIGHT_LOG.md`.
> 4. Базовая линия: 988 unit/server тестов, 286 E2E.

---

- [x] **TASK-01: Каталог курсоров, профиль, смешные имена**
  - **Файлы**: `src/cursors.ts`, `src/profile.ts`, `src/funny-names.ts`, `src/onboarding-logic.ts`.
  - Пресеты (6 free + 8 Pro), `cursorSvg`, `cursorCss`, `cleanCursorId`, `canUseCursor`, `contrastRatio` (SPEC §3).
  - Профиль в `doska.profile`, подписка на изменения, `myCursorId`, `mySelectionColor`, `cursorEntitled` (§2.1).
  - ≥ 40 имён (§2.2, Решение 35), `tabFill`, `resolveName` (§2.3, Решение 34).
  - **Тесты**: `tests/unit/cursors.test.ts` (белый список, контраст, SVG без чужих данных, право по тарифу), `tests/unit/profile.test.ts` (вместе с логикой поля имени и смешными именами).

- [x] **TASK-02: Курсор, выделение и иконка у себя; слой эффектов**
  - **Файлы**: `src/controller.ts`, `src/renderer.ts`, `src/toolbar.ts`, `src/app.ts`, `src/cursor-fx.ts`, `src/style.css`, `index.html`.
  - Курсор `select` над холстом; `mySelectionColor()` в рамках, ручках и рамке выделения области; динамическая иконка `select` и перестройка панели при смене профиля; `cursor-fx` (лимит частиц, `no-motion`, reduced motion) (§4).
  - **Тесты**: `tests/unit/cursor-fx.test.ts` (слой эффектов и иконка `select`).

- [x] **TASK-03: Курсоры в совместной работе**
  - **Файлы**: `src/room-host.ts`, `electron/room.cjs`, `electron/share.cjs`, `electron/cloud-link.cjs`, `src/collab.ts`, `src/collab-transport.ts`, `src/relay-host.ts`, `src/local-transport.ts`, `src/browser-host.ts`, `src/cloud-room.ts`, `src/main.ts`, `src/app.ts`, `server/cloud-room-manager.ts`.
  - `cursorId` при подключении по всем путям, белый список в хабах, `{t:'profile'}`, проверка тарифа в Cloud Room, имена из профиля, постоянные DOM-курсоры с бейджем и эффектами, цвета чужих выделений (§5).
  - **Тесты**: дополнения `collab.test.ts`, `room.test.ts`, `room-pointer.test.ts` (паритет белого списка), `cloud-room.test.ts`.

- [x] **TASK-04: Сервер — профиль, миграция V2**
  - **Файлы**: `server/db.ts`, `server/users.ts`, `server/auth.ts`, `server/app.ts`, `src/api-client.ts`, `src/profile-sync.ts`.
  - Миграция V2, `PATCH /api/me`, `userInfo` с профилем и способами входа, имя провайдера не затирает пользовательское, синхронизация профиля на клиенте (§6, §8).
  - **Тесты**: `tests/server/profile.test.ts`, `tests/unit/profile-sync.test.ts`.

- [x] **TASK-05: Способы входа: почта, Telegram, Google, dev-провайдеры**
  - **Файлы**: `server/mailer.ts`, `server/identity.ts`, `server/auth-flows.ts`, `server/auth.ts`, `server/app.ts`, `server/index.ts`, `server/config.ts`, `vite.config.ts`, `scripts/dev-cloud.mjs`, `server/.env.example`, `server/README.md`, `src/auth.ts`, `src/api-client.ts`.
  - `resolveIdentity`, `GET /api/auth/providers`, код по почте, потоки перехода (Google PKCE, Telegram OAuth, dev), `flow/complete`, разрешённые `returnTo`, клиент `src/auth.ts` (§7).
  - **Тесты**: `tests/server/mailer.test.ts` (поддельный SMTP), `tests/server/auth-email.test.ts`, `tests/server/auth-flows.test.ts`, `tests/unit/auth.test.ts`.

- [x] **TASK-06: Визард первого входа**
  - **Файлы**: `src/onboarding.ts`, `src/cursor-picker.ts`, `src/main.ts`, `src/style.css`, `e2e/fixtures.ts`, `e2e/collab.spec.ts`, `e2e/collab-cloud.spec.ts`, `e2e/electron-api.spec.ts`.
  - Два шага со «слайдом», сообщения без API, форма почты, Tab/Продолжить, сетка и превью, Pro-плашка, блок привязки, возврат после перехода, ✕/Esc (§9).
  - Подготовка E2E: профиль в `addInitScript`.
  - **Тесты**: `tests/unit/onboarding.test.ts`.

- [x] **TASK-07: Настройки → «Профиль», кнопка профиля**
  - **Файлы**: `src/app.ts`, `src/profile-settings.ts`, `src/style.css`.
  - Имя, сетка курсоров, вход/привязка/выход, кнопка профиля на домашнем экране (§10).
  - **Тесты**: `tests/unit/profile-settings.test.ts`.

- [ ] **TASK-08: E2E и финальная проверка**
  - `e2e/night4-onboarding.spec.ts`, `e2e/night4-cursors.spec.ts`, `e2e/night4-cloud-auth.spec.ts`.
  - Два полных прогона Playwright подряд, `npm run build`, `npm run server:build`; итог в `NIGHT_LOG.md`.
