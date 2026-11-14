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

## TASK-02 — защита от копирования и клонирования (готово)
- `state.ts`: поля `collabRole`, `linkMode`; `canCopyCurrentBoard()`, `canCloneCurrentProject()` (права через `effectivePermissions`, т.е. на free запреты не действуют); `duplicateSelected` теперь возвращает boolean и проверяет запрет.
- `clipboard.ts`: защита в `copySelection`; новые `cutSelection`, `duplicateSelection`; `app.duplicateSelection` делегирует ему.
- `collab.ts` выставляет `state.collabRole` (connectCollab/stopCollab). `linkMode` выставит роутер/UI позже.
- Заблокированы также: Ctrl+Shift+C (картинкой), экспорт PNG, экспорт проекта в JSON, дублирование Alt-перетаскиванием и копирование при переносе на другую страницу.
- Ограничение: защита — сдерживание, не криптозащита (в памяти гостя весь проект).
- Тесты: `tests/unit/copy-protection.test.ts` (10). Всего 505.

## TASK-03 — URL-роутер (готово)
- `src/router.ts`: `parseBoardUrl`, `buildBoardUrl` (по умолчанию `?route=…`, `{style:'path'}` — `/p/…`, `/j/…`), `computeFocusCamera`, `focusElementsOnBoard`, а также `linkModeOf`, `pagesVisibleForRoute`, `routeAllowsCloneButton`, `routeShowsPagesDock`.
- `?room=CODE` (локальная сеть) и `#relay=…` разбираются как `collab`; ключ шифрования всегда в `#k=`, в `/j/:token` не попадает. Права по страницам в ссылке не передаются.
- `Flash.ms?` — длительность подсветки; `renderer.ts` её учитывает (по умолчанию 1400 мс), фокус подсвечивает 2000 мс.
- Загрузка проекта по `projectId` не делалась (бэкенда нет); к UI роутер не подключён (`state.linkMode` пока выставляется только вручную).
- Тесты: `tests/unit/router.test.ts` (21). Всего 526.

## TASK-04 — дельта-синхронизация (готово)
- `src/delta.ts`: `ElementOp`, `BoardPatch` (вместо несуществующих `background`/`gridSize` — `grid`, `backgroundColor | null`), `diffElements`, `applyBoardPatch`, `isBoardPatch` (проверка формы пакета из сети), `MAX_PATCH_OPS`.
- `diffElements`: del → put → order; `order` только если без него порядок получателя (оставшиеся на местах, новые сверху, с учётом `layerPin`) не совпал бы с `next`. Сравнение: по ссылке, затем по значению.
- `applyBoardPatch`: иммутабельно, операции по порядку, `put` через `sanitizeElement`, равные по значению элементы остаются прежними объектами (кэш рендера), `layerPin` пересортировывается; если ничего не изменилось — тот же массив `elements`. `rev` не используется (решение 32).
- Тесты: `tests/unit/delta.test.ts` (17). Всего 543.

## TASK-05 — браузерный Room Host (готово)
- `src/room-host.ts`: порт `electron/room.cjs` (`createRoomHub`, `Room`, `RoomSocket`, `normalizeName`); сокет принимает `string | Uint8Array | ArrayBuffer`, ни Node, ни ws.
- Лимиты по тарифу: `plan` из опций или `ownerPlan` проекта (нет — free); `maxGuests` (free 1, pro/tutor ∞), `maxEditors` (free 4, pro/tutor ∞); считаются только открытые сокеты. Лишний гость получает `{t:'denied', reason:'free-limit-reached'}` и закрытие кодом 4402 (`CLOSE_FREE_LIMIT` в `collab-transport.ts`, текст в `collab.ts`).
- `allowCopy` (из прав проекта с поправкой на тариф или опции) — в `init` и `rights`. Начальные права гостя — из `permissions.pageRights`. Скрытые (`hidden`) страницы не попадают гостю ни в проекте, ни в патчах.
- Патчи: валидный `t:'patch'` от участника с `edit` на странице применяется через `applyBoardPatch`, `rev` ведёт хаб, рассылка — тем, у кого страница не скрыта; участникам без поддержки патчей (флаг `patches` при подключении или сообщение `caps`) уходит полный проект. `pushPatch` — патч от автора.
- Гость не может менять `ownerPlan`/`permissions`/id проекта и на free не может добавлять страницы сверх лимита (`canCreatePage`).
- `electron/room.cjs` и `share.cjs` не менялись (решение 41); к UI/транспорту хост пока не подключён.
- В TASK-08 нужно доработать: проекция `TaskEl` для гостя (`projectFor`, `patch`) и слияние гостевых правок заданий.
- Тесты: `tests/unit/room-host.test.ts` (30). Всего 573.

## TASK-06 — хранилище ассетов (готово)
- `src/asset-store.ts`: `computeAssetHash` (SHA-256 от UTF-8 всей строки data URL; `crypto.subtle`, без него — собственная `sha256Hex`, проверена на совпадение), `AssetStore` (память + необязательный IndexedDB `abax-assets`, при сбое — только память), `extractProjectAssets`, `hydrateProjectAssets(project, assets?)`, `assetRef`, `assetHashOf`.
- Решение: вместо FNV-1a — полноценный SHA-256 на чистом JS, чтобы id не зависели от окружения.
- Выносятся только `ImageEl.src` с `data:image/`; иконка проекта и ссылки на страницы не трогаются; неизвестный `asset://` остаётся ссылкой; нетронутые страницы — те же объекты.
- В сохранение и синхронизацию не подключено (решение 47).
- Тесты: `tests/unit/asset-store.test.ts` (11). Всего 584.

## TASK-07 — реакции и комментарии (готово)
- `src/types.ts`: `BaseEl.reactions` (с TASK-01), `Page.comments`, `CommentMessage`, `CommentThread`.
- `src/comments.ts`: `toggleElementReaction`, `createCommentThread`, `addCommentReply`, `resolveCommentThread`, `syncCommentsWithMovedElements` (+ необязательные `id`/`now` для тестов). Пустой текст отклоняется, эмодзи ≤ 16, комментарий ≤ 2000 (обрезается), отсутствующая цель — ветка без привязки; удаление цели ветку не удаляет; сдвиг = сдвиг левого верхнего угла рамки.
- `src/file.ts`: `sanitizeComments`, чистка `reactions` (ключи ≤ 16, пустые списки и дубли убираются), `Page.comments` читается и сохраняется.
- `src/state.ts`: `replaceElements`, `undo`, `redo` двигают привязанные комментарии (`followComments`).
- Исключение из правила pushHistory (решение 49): реакции и комментарии в историю не пишутся; Undo откатывает элементы к снимкам, поэтому реакции откатятся вместе с ними — отдельный UI-слой должен менять их без записи истории.
- Тесты: `tests/unit/comments.test.ts` (17). Всего 601.

## TASK-08 — интерактивное задание TaskEl (готово)
- `src/types.ts`: `TaskEl` (+ `subject`, `answerUnit`, `codeSnippet`), `TaskAttempt`, `TaskExamType`, `TaskSubject`; `TaskEl` добавлен в union `Element`.
- `src/task-element.ts`: `createTaskElement` (360×220, `subject: 'math'`), `submitTaskAttempt`, `updateStudentDraft`, `toggleTaskHardFlag`, `projectTaskForRole`, плюс `answersMatch`/`normalizeAnswer` (trim, без пробелов, регистр, `,`→`.`, разные минусы, ё→е, числа как числа, варианты через `|`, единицы `answerUnit` в конце ввода игнорируются), `mergeGuestTask`, `taskStatus`.
- `geom.ts`: `elementAABB`, `hitTest`, `elementHandles` (8 ручек, без поворота), `applyHandle` (мин. 220×140), `scaleElement`. `state.ts`: цвет/стиль к заданию не применяется. `controller.ts`: объектный ластик задание не стирает. `attachment.ts`: штрихи и стикеры можно привязывать к заданию.
- `file.ts`: `sanitizeElement` для `task` (неверные `examType`/`topic` восстанавливаются, а не отбрасывают задание; `attempts` ≤ 100, `studentDraft` ≤ 1000).
- `renderer.ts`: `drawTaskEl` — плашка экзамена, предмет, бейдж «Сложное», тема, условие с переносом, статус «Решено/Не решено/Нет ответа», ввод ученика; ответ и решение на холст не попадают.
- `room-host.ts`: ученику во всех пакетах (`init`, `project`, `rights`, `patch`) задание уходит через `projectTaskForRole`; правки ученика поверх заданий проходят `mergeGuestTask` (принимаются только черновик и новые попытки, `isCorrect` пересчитывает автор по своему ответу).
- Решения по мелочам: ответ ученика в рендере показывается как «Ответ: …», потому что это его собственный ввод; сетевое сообщение «ученик отвечает без права edit» не делалось (решение 55 — позже); при `answer === ''` попытка записывается как неверная до оценки автором.
- Тесты: `tests/unit/task-element.test.ts` (31). Всего 632.

## Итог ночи
- Все 8 задач закрыты, каждая — отдельный коммит в `night/1`; `npm run typecheck && npm run typecheck:tests && npm test` — зелёные (632 теста), `vite build` собирается.
- Не сделано намеренно (вне ТЗ): подключение роутера, хоста комнаты, хранилища ассетов и защиты копирования к UI/транспорту (`main.ts`, `app.ts`); e2e (Playwright) не запускались.
- Известные ограничения: защита от копирования — сдерживание, не криптозащита; реакции откатываются вместе с элементами при Undo; `applyRemoteProject` по-прежнему заменяет проект целиком и сбрасывает стек отмены.
