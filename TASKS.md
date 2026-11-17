# TASKS.md — План задач Ночи №5 (`night/5`)

> **Правило выполнения для агента:**
> 1. Задачи выполняются строго по порядку (`TASK-01` → `TASK-08`). Решения — в разделе 11 (Locked Decisions) `SPEC_NIGHT5.md`.
> 2. На каждую задачу: реализация → тесты → `npm run typecheck && npm run typecheck:tests && npm test` → отметка `[x]` → запись в `NIGHT_LOG.md` → атомарный коммит в ветку `night/5`.
> 3. Вопросов не задавать. Мелкие развилки решать в пользу надёжности, UX и зелёных тестов и записывать в `NIGHT_LOG.md`.
> 4. Базовая линия: 1125 unit/server тестов, 304 E2E (фактическая, проверено первым прогоном — Решение 0.2).
> 5. Любое изменение протокола хаба — одновременно в `src/room-host.ts` и `electron/room.cjs`, с одинаковыми сценариями тестов.

---

- [x] **TASK-01: Чистые модели**
  - **Файлы**: `src/types.ts`, `src/limits.ts`, `src/file.ts`, `src/sync-state.ts`, `src/sync-conflict.ts`, `src/edge-pointer.ts`, `src/presence.ts`, `src/collab-chat.ts` (только чистые функции), `AGENTS.md` (список модулей для сервера).
  - `isPristineStarterProject`, метка `doska.starter`, `SyncStatus` + `syncStatusOf` (§2.1, §2.2); `contentSignature`, `doska.syncBase.*` (§2.4).
  - `ProjectPermissions.maxGuests` в `sanitizeElement`/`parseProject` и `sanitizePermissionsForPlan` (Free — отбрасывается, Pro/Tutor — 1..50); `effectiveMaxGuests(plan, perms)`; в `PlanLimits` — `canSetMaxGuests`, `canFollowHost` (§3.3).
  - `computeEdgePointer`, `getParticipantInitials`, `tokenizeChat`, `normalizeChatText`, ограничитель частоты 5/3 с (§6, §8).
  - **Тесты**: `tests/unit/sync-state.test.ts`, `sync-conflict.test.ts`, `edge-pointer.test.ts`, `presence.test.ts`, `collab-chat.test.ts` (чистая часть), дополнения `limits.test.ts` и `file.test.ts` (поле `maxGuests` переживает сохранение/загрузку).

- [x] **TASK-02: Протокол хабов**
  - **Файлы**: `src/room-host.ts`, `electron/room.cjs`, `src/collab-transport.ts`.
  - `chat` (буфер 100 в `init`, 1..500, флуд), `view` → `Client.view` в `users`, снимок `users` на получателя с маскировкой `hiddenPage` (§3.1), `summon`, `follow-host` (тариф), живые права страниц из `permissions.pageRights` (§3.2), `effectiveMaxGuests` и `{t:'denied', reason:'room-full', …}` + 4402/4430, опция `multiHost` (§2.3).
  - **Тесты**: дополнения `tests/server/room.test.ts`, `room-pointer.test.ts`; одинаковые сценарии для `electron/room.cjs`.

- [x] **TASK-03: Сервер**
  - **Файлы**: `server/db.ts`, `server/invites.ts`, `server/invite-routes.ts`, `server/projects.ts`, `server/cloud-room-manager.ts`, `server/auth-flows.ts`, `server/context.ts`, `server/app.ts`, `server/README.md`.
  - Миграция V3 (§4.1), `kind='link'` в существующих запросах, `google_email`.
  - Приглашения по почте: 5 эндпоинтов, письмо, лимиты (§4.2).
  - `PUT` с `baseSig` → `409 rev-conflict` (§2.4); `multiHost` и закрытие гостей Free после последнего хоста; `invite-updated` (§3.2, §4.3).
  - **Тесты**: `tests/server/email-invites.test.ts`, дополнения `cloud-room.test.ts` (два устройства владельца, лимит гостей, invite-updated), `projects.test.ts` (конфликт и прежнее слияние), `invites.test.ts`, `auth.test.ts` (список таблиц), миграция V3 поверх базы V2.

- [x] **TASK-04: Облако без швов на клиенте**
  - **Файлы**: `src/cloud-sync.ts`, `src/main.ts`, `src/state.ts`, `src/cloud-room.ts`, `src/app.ts`, `index.html`, `src/style.css`.
  - Заглушка не уходит в облако и заменяется облачным проектом (§2.1); `#sync-indicator` (§2.2); автоподключение владельца, вошедшего в аккаунт, + `visibilitychange`/`focus` (§2.3); `baseSig`, копия «(копия с устройства)» и тост «Открыть копию» (§2.4).
  - **Тесты**: дополнения `tests/unit/cloud-sync.test.ts`, `cloud-room.test.ts`.

- [x] **TASK-05: Activity Pills и чат**
  - **Файлы**: `src/activity-pills.ts`, `src/collab-chat.ts`, `src/collab.ts`, `src/app.ts`, `index.html`, `src/style.css`.
  - Пилюли из разницы `users`, соединение, `summon`, права (§5); чат: кнопка с бейджем, панель, превью, история из `init` (§6).
  - **Тесты**: `tests/unit/activity-pills.test.ts`, `collab-chat.test.ts` (DOM: нет `innerHTML`, ссылки с `rel`), дополнения `collab.test.ts`.

- [x] **TASK-06: Присутствие**
  - **Файлы**: `src/controller.ts`, `src/collab.ts`, `src/app.ts`, `src/style.css`.
  - `animateCameraTo`, отправка `view`, краевые курсоры, аватары у страниц и в списке участников, «Позвать всех сюда» с поповером для скрытой страницы, «Автопереход за мной» (§8).
  - **Тесты**: дополнения `collab.test.ts`, новые unit-тесты навигации за хостом и `animateCameraTo` (reduced motion — мгновенно).

- [x] **TASK-07: Приглашения в интерфейсе**
  - **Файлы**: `src/invite-ui.ts`, `src/link-view-ui.ts`, `src/collab.ts`, `src/controller.ts`, `src/cloud-room.ts`, `src/app.ts`, `src/main.ts`, `index.html`, `src/style.css`.
  - Права и `maxGuests` до создания ссылки; `cancelActiveInteraction`, уход со скрытой страницы, `#all-pages-hidden-banner`, проект без страниц у гостя; `#room-full-modal`; приглашения по почте у автора и «Приглашения для вас» у адресата (§7).
  - **Тесты**: дополнения `invite-ui`/`link-view` тестов, `collab.test.ts` (скрытие текущей и всех страниц), новый тест входящих приглашений.

- [ ] **TASK-08: E2E и финальная проверка**
  - `e2e/night5-sync.spec.ts` (заглушка заменяется при входе на втором «устройстве» — второй контекст браузера, индикатор, офлайн-конфликт), `e2e/night5-room.spec.ts` (пилюли и чат между двумя вкладками), `e2e/night5-invites.spec.ts` (скрытие страницы под гостем, все страницы скрыты, room-full → только чтение, приглашение по почте внутри приложения), `e2e/night5-presence.spec.ts` (краевой курсор и перелёт, «Позвать всех», автопереход с заходом хоста на скрытую страницу).
  - Два полных прогона Playwright подряд, `npm run build`, `npm run server:build`; итог в `NIGHT_LOG.md`.
