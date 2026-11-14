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

## TASK-03 — дельта-патчи, браузерный хост, room.cjs (готово)
- `collab.ts`: хаб объявляет `patches: true` в `init`, клиент отвечает `caps`; содержимое страниц (элементы, `grid`, `backgroundColor`) идёт патчами не чаще раза в 100 мс (`onChange` → `flushPatches`, база — последний отправленный снимок по странице); полный `project` — только при смене состава (названия, список страниц, права, комментарии) или слишком большом патче. Входящий `patch` применяется на месте (страница меняется как в `state.ts`), `openProject` не вызывается: история отмены, выделение и камера целы; хост-автор после чужого патча делает `touchProject()` (сохранит). Чужие патчи ждут окончания жеста (`src/gesture.ts`: зонды контроллера и редактора текста).
- `electron/room.cjs`: `patches` в `init`, `caps`, `patch` (проверка формы, право edit, `rev` по странице, рассылка патчем тем, кто объявил поддержку, остальным — `project`, скрытые страницы пропускаются), `pushPatch`. Элементы в патче проверяются минимально (id, type) — как и в полном проекте; `sanitizeElement` в CJS нет.
- Новые модули: `local-transport.ts` (`memoryChannel`, `listenLocalGuests`/`localGuestTransport` на BroadcastChannel, `?room=local:КОД`), `relay-host.ts` (порт хостовой части `cloud-link.cjs`: кадры, hello, шифрование на WebCrypto, переподключение), `browser-host.ts` (хаб во вкладке, автор подключён через память, облако, статус), `gesture.ts`.
- UI: кнопка «Поделиться» теперь есть и во вкладке браузера (адаптер `browserShareApi` в `app.ts`: тот же диалог, без ссылки локальной сети и тестового окна; гости — «Пригласить через интернет»). В Android-приложении кнопка скрыта. На ширине ≤850px во вкладке браузера кнопка скрыта (иначе не хватает места в шапке; e2e `ui.spec` про узкий экран).
- Тариф хаба: `planOf(state.project)`; пока лимиты выключены (`limitsEnforced()` ложно) — `maxGuests`/`maxEditors` бесконечны, чтобы не менять поведение; с флагом на free — один гость (отказ `denied` + 4402).
- Порядок отказа: в `relay-host` `kick` ставится в очередь после уже поставленных сообщений — иначе `denied` не доходил до гостя.
- `relay-host` не следит за «мёртвым» соединением (в браузере нет ping): обрыв ловит `onclose`.
- Тесты: +8 `collab.test.ts` (патчи), +5 `tests/server/room.test.ts`, `tests/unit/browser-host.test.ts` (14); e2e: 2 (браузерный хост, лимит free), обновлён `ui.spec` (кнопка «Поделиться» есть в браузере). Всего 674.
- Решение 32 (Undo/Redo остаются откатом по снимку): записано в TASK-01; чужие правки при откате могут вернуться к снимку — известное ограничение.

## TASK-04 — учитель ↔ ученик по `TaskEl` (готово)
- `room-host.ts` и `electron/room.cjs`: сообщения `{t:'task-draft', pageId, elId, draft}` и `{t:'task-submit', pageId, elId, value}` принимаются от любого участника с доступом к странице (право `view` достаточно; скрытые страницы, чужие id, не-задания и не-строки отклоняются молча). Хаб сам вызывает `updateStudentDraft` / `submitTaskAttempt` по настоящему ответу и рассылает правку задания патчем с `by: -1` (её получают все, включая отправителя; ученику — без ответа и закрытого решения; клиентам без патчей — проект).
- После `task-submit` черновик очищается (отправленное в черновике уже не нужно) — мелкое решение ночи.
- `mergeHostTask` (новая чистая функция в `task-element.ts`): правка карточки автором (патч или полный проект) не затирает ввод ученика — `attempts` и `studentDraft` остаются хабовыми.
- `electron/room.cjs` теперь тоже маскирует ответы ученику (раньше уходили как есть!): `init`, `project`, `rights`, `pushProject`, патчи; ввод гостя с edit проходит через `mergeGuestTask`. Логика заданий для CJS — `electron/room-tasks.cjs` (зеркало `task-element.ts`); параритет проверяет `tests/server/room-tasks.test.ts` на общем наборе случаев.
- `pushProject` в `room.cjs` теперь не отдаёт гостям скрытые страницы (раньше слал проект целиком).
- `collab.ts`: `taskInputOnline()`, `sendTaskDraft` (не чаще раза в 300 мс, последнее значение не теряется), `sendTaskSubmit` (отменяет отложенный черновик); вне комнаты или у хаба без патчей возвращают `false` — вызывающий применяет ввод у себя.
- Тесты: +6 `room-host.test.ts`, +4 `room.test.ts`, `room-tasks.test.ts` (4), +2 `collab.test.ts`. Всего 692.
