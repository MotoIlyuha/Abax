\# SPEC\_NIGHT1.md — Техническая спецификация: Ядро Abax 3.0



\## Контекст

Мы переводим Abax v2.6.0 на 100% онлайн-архитектуру с разделением на тарифы (`free`, `pro`, `tutor`), четырьмя типами ссылок, защитой от копирования/клонирования, дельта-синхронизацией, браузерным P2P-хостом, реакциями/комментариями и интерактивным виджетом заданий ОГЭ/ЕГЭ (`TaskEl`).



\---



\## Спецификация модулей



\### 1. Тарифы, Лимиты и Права доступа (`src/limits.ts` и `src/types.ts`)

Добавить в `src/types.ts`:

```ts

export type PlanTier = 'free' | 'pro' | 'tutor';

export type PageRight = 'edit' | 'view' | 'hidden';



export interface ProjectPermissions {

&#x20; /\*\* Запретить клонирование проекта по ссылке просмотра (доступно на Pro/Tutor) \*/

&#x20; forbidClone?: boolean;

&#x20; /\*\* Разрешить выделение и копирование элементов читателям (по умолчанию true) \*/

&#x20; allowCopy?: boolean;

&#x20; /\*\* Права по страницам для ссылки совместной работы (pageId -> PageRight) \*/

&#x20; pageRights?: Record<string, PageRight>;

}



В интерфейс Project (src/types.ts) добавить опциональные поля:



&#x20;   id?: string;

&#x20;   ownerPlan?: PlanTier;

&#x20;   permissions?: ProjectPermissions;



Создать модуль src/limits.ts:



&#x20;   Константы лимитов по тарифам:

&#x20;       free: maxProjects: 3, maxPagesPerProject: 3, maxP2PGuests: 1 (всего 2 участника: 1 хост + 1 гость), canProtectClone: false, canProtectCopy: false, cloudSync24x7: false.

&#x20;       pro: все лимиты Infinity, canProtectClone: true, canProtectCopy: true, cloudSync24x7: true, tutorFeatures: false.

&#x20;       tutor: все возможности pro + tutorFeatures: true.

&#x20;   Чистые функции проверки:

&#x20;       canCreateProject(plan: PlanTier, currentProjectCount: number): boolean

&#x20;       canCreatePage(plan: PlanTier, currentPageCount: number): boolean

&#x20;       canGuestJoinRoom(plan: PlanTier, currentGuestCount: number): boolean

&#x20;       sanitizePermissionsForPlan(plan: PlanTier, perms: ProjectPermissions): ProjectPermissions (для free принудительно ставит forbidClone: false, allowCopy: true).



2\. Защита от копирования и клонирования (src/clipboard.ts, src/controller.ts, src/file.ts)



&#x20;   В src/state.ts добавить в state реактивные геттеры/хелперы:

&#x20;       canCopyCurrentBoard(): boolean — возвращает false, если пользователь в гостевом режиме (collabRole === 'guest') или режиме просмотра по ссылке, и в state.project.permissions?.allowCopy === false или forbidClone === true.

&#x20;       canCloneCurrentProject(): boolean — возвращает false, если режим просмотра и state.project.permissions?.forbidClone === true.

&#x20;   В src/clipboard.ts:

&#x20;       В начале copySelection(), cutSelection() и duplicateSelection() проверять canCopyCurrentBoard(). Если false — ничего не копировать в буфер и возвращать false.

&#x20;   В src/file.ts:

&#x20;       Обновить parseProject / serializeProject, чтобы id, ownerPlan, permissions в Project корректно сохранялись и читались без потери обратной совместимости со старыми файлами v2.



3\. URL-Роутер и 4 типа ссылок (src/router.ts)



Создать модуль src/router.ts (без перезагрузки страницы, работает и с pathname /p/..., и с query/hash параметрами для совместимости с Electron/Capacitor):

Поддерживаемые маршруты (RouteMatch):



&#x20;   Ссылка на просмотр проекта: /p/:projectId (или ?route=project\&projectId=...)

&#x20;       mode: 'view-project', projectId: string.

&#x20;       Показывает все не-скрытые страницы, разрешает кнопку «Клонировать проект» (если canCloneCurrentProject() === true).

&#x20;   Ссылка на просмотр страницы: /p/:projectId/:pageId

&#x20;       mode: 'view-page', projectId: string, pageId: string.

&#x20;       Изолирует видимость только одной страницей pageId, всегда скрывает кнопку «Клонировать проект» и док переключения страниц.

&#x20;   Ссылка на конкретный объект / группу объектов: /p/:projectId/:pageId?focus=id1,id2

&#x20;       mode: 'view-page', projectId: string, pageId: string, focusIds: string\[].

&#x20;       Функция focusElementsOnBoard(ids: string\[], viewportW: number, viewportH: number):

&#x20;           Находит элементы по ids на активной странице.

&#x20;           Считает общий AABB через aabbUnion(els.map(elementAABB)) из src/geom.ts.

&#x20;           Вычисляет целевую Camera с отступом padding = 80px (ограничивая z в пределах 0.1 .. 4).

&#x20;           Добавляет элементы в state.flashes (или вызывает подсветку рамки на 2000 мс).

&#x20;   Ссылка на совместную работу (Collab): /j/:inviteToken или существующий #relay=...\&r=...\&k=...

&#x20;       mode: 'collab', параметры подключения и по-страничные права (edit | view | hidden).



Экспортировать чистые функции parseBoardUrl(urlStr: string): RouteMatch, buildBoardUrl(baseUrl: string, route: RouteMatch): string и computeFocusCamera(els: Element\[], viewportW: number, viewportH: number, padding?: number): Camera | null.

4\. Протокол дельта-синхронизации (src/delta.ts и src/state.ts)



Вместо пересылки всего Project целиком на каждый чих, создать модуль src/delta.ts:



&#x20;   Типы операций:



&#x20;   TypeScript



&#x20;   export type ElementOp =

&#x20;     | { op: 'put'; el: Element }

&#x20;     | { op: 'del'; id: string }

&#x20;     | { op: 'order'; ids: string\[] };



&#x20;   export interface BoardPatch {

&#x20;     t: 'patch';

&#x20;     pageId: string;

&#x20;     rev: number;

&#x20;     ops: ElementOp\[];

&#x20;     background?: Background;

&#x20;     gridSize?: number;

&#x20;   }



&#x20;   Функции:

&#x20;       diffElements(prev: readonly Element\[], next: readonly Element\[]): ElementOp\[] — вычисляет минимальный набор put (для новых или изменившихся по ссылке/значению элементов), del (для удаленных ID) и order (только если относительный порядок оставшихся/новых ID изменился).

&#x20;       applyBoardPatch(board: Board, patch: BoardPatch): Board — иммутабельно и детерминированно применяет ops к Board, возвращая новый Board (применяя sanitizeElement к входящим put).



5\. Браузерный P2P-хост комнаты (src/room-host.ts)



Портировать логику createRoomHub из electron/room.cjs на чистый TypeScript в src/room-host.ts (без зависимостей от Node.js Buffer или ws — использовать Uint8Array и абстрактный интерфейс транспорта):



&#x20;   Поддержка лимита гостей по тарифу: maxGuests: number (для free = 1, для pro/tutor = Infinity). Если в бесплатную комнату стучится 2-й гость — возвращать { t: 'denied', reason: 'free-limit-reached' }.

&#x20;   Поддержка по-страничных прав (edit | view | hidden) и флага allowCopy: boolean в welcome и rights пакетах.

&#x20;   Поддержка как полных снимков (t: 'project'), так и дельта-патчей (t: 'patch') из src/delta.ts — при получении валидного patch от редактора страницы с правом edit, хост применяет applyBoardPatch к своей странице и рассылает patch остальным участникам, имеющим доступ к этой странице.



6\. Дедупликация ассетов (src/asset-store.ts)



Создать модуль src/asset-store.ts для выноса тяжелых base64-картинок из JSON:



&#x20;   computeAssetHash(dataUrlOrBytes: string | Uint8Array): Promise<string> — SHA-256 хэш (через crypto.subtle.digest, с синхронным fallback FNV-1a/SHA-256 для сред без subtle).

&#x20;   Класс AssetStore:

&#x20;       In-memory Map<string, string> + опциональный IndexedDB бэкенд (abax-assets).

&#x20;       extractProjectAssets(project: Project): Promise<{ strippedProject: Project; assets: Record<string, string> }> — заменяет src: "data:image/..." в ImageEl на src: "asset://<sha256>" и возвращает словарь извлеченных блобов.

&#x20;       hydrateProjectAssets(project: Project): Promise<Project> — подставляет обратно data:image/... или URL из AssetStore для рендера.



7\. Реакции и привязанные комментарии (src/comments.ts, src/types.ts)



&#x20;   В BaseEl (src/types.ts) добавить:

&#x20;       reactions?: Record<string, string\[]>; — словарь emoji -> массив userId.

&#x20;   В Page (src/types.ts) добавить:

&#x20;       comments?: CommentThread\[];

&#x20;   Определить в src/types.ts:



&#x20;   TypeScript



&#x20;   export interface CommentMessage {

&#x20;     id: string;

&#x20;     authorId: string;

&#x20;     authorName: string;

&#x20;     text: string;

&#x20;     createdAt: number;

&#x20;   }

&#x20;   export interface CommentThread {

&#x20;     id: string;

&#x20;     x: number;

&#x20;     y: number;

&#x20;     /\*\* Если привязан к элементу доски — двигается вместе с ним \*/

&#x20;     targetElementId?: string;

&#x20;     resolved?: boolean;

&#x20;     messages: CommentMessage\[];

&#x20;   }



&#x20;   Создать src/comments.ts с чистыми функциями:

&#x20;       toggleElementReaction(el: Element, emoji: string, userId: string): Element

&#x20;       createCommentThread(page: Page, params: { x: number; y: number; targetElementId?: string; authorId: string; authorName: string; text: string }): Page

&#x20;       addCommentReply(page: Page, threadId: string, msg: Omit<CommentMessage, 'id' | 'createdAt'>): Page

&#x20;       resolveCommentThread(page: Page, threadId: string, resolved?: boolean): Page

&#x20;       syncCommentsWithMovedElements(page: Page, prevElements: readonly Element\[], nextElements: readonly Element\[]): Page — если элемент targetElementId сдвинулся на (dx, dy), автоматически сдвигает привязанный CommentThread на (dx, dy).



8\. Виджет задания Abax Tutor (TaskEl в src/types.ts, src/task-element.ts)



Добавить новый тип элемента доски TaskEl в src/types.ts и включить его в union Element:



TypeScript



export interface TaskAttempt {

&#x20; value: string;

&#x20; timestamp: number;

&#x20; isCorrect: boolean;

}



export interface TaskEl extends BaseEl {

&#x20; type: 'task';

&#x20; w: number;

&#x20; h: number;

&#x20; taskId: string;

&#x20; examType: 'oge' | 'ege\_base' | 'ege\_prof' | 'vpr' | 'custom';

&#x20; topic: string;

&#x20; statementMd: string;

&#x20; answer: string;

&#x20; solutionMd?: string;

&#x20; /\*\* Текущий ввод ученика в реальном времени \*/

&#x20; studentDraft?: string;

&#x20; /\*\* История попыток ученика \*/

&#x20; attempts?: TaskAttempt\[];

&#x20; /\*\* Помечено репетитором как сложное для повторения \*/

&#x20; markedHard?: boolean;

&#x20; /\*\* Показывать ли решение ученику \*/

&#x20; solutionVisibleToStudent?: boolean;

}



Создать модуль src/task-element.ts:



&#x20;   createTaskElement(params: Partial<TaskEl> \& { x: number; y: number; taskId: string; statementMd: string; answer: string }): TaskEl

&#x20;   submitTaskAttempt(el: TaskEl, rawInput: string, now?: number): { updated: TaskEl; isCorrect: boolean } — нормализует ответ (трим пробелов, замена запятой на точку в десятичных дробях "0,25" === "0.25"), добавляет запись в attempts и возвращает обновленный TaskEl.

&#x20;   updateStudentDraft(el: TaskEl, draft: string): TaskEl — обновляет черновик ввода ученика в реальном времени.

&#x20;   toggleTaskHardFlag(el: TaskEl): TaskEl — переключает markedHard.

&#x20;   projectTaskForRole(el: TaskEl, role: 'host' | 'guest'): TaskEl — КРИТИЧНО ДЛЯ ЗАЩИТЫ ОТ СПИСЫВАНИЯ: если role === 'guest' (ученик), скрывает поле answer (ставит "") и скрывает solutionMd, если !el.solutionVisibleToStudent.

&#x20;   Интегрировать type: 'task' в src/geom.ts (elementAABB, hitTestElement), src/file.ts (sanitizeElement), src/render.ts (отрисовка карточки задания на Canvas: плашка типа экзамена, текст условия с переносом строк, статус решено/не решено, бейдж «Сложное»)



## Соответствие имён реальному коду (v2.6.0)

Спецификация выше писалась без просмотра кода. Приоритет — реальные имена:

| В спецификации | В коде |
|---|---|
| `AGENTS.md` | `AGENTS.md` (переименован из `AGENT.md`) |
| `src/file.ts` | создаётся: `parseProject`, `serializeProject`, `sanitizeElement`; `storage.migrate` вызывает `parseProject` |
| `src/render.ts`, `drawElement` | `src/renderer.ts`, `drawElementBody` |
| `hitTestElement` | `hitTest` (`src/geom.ts`) |
| `aabbUnion(list)` | `list.map(elementAABB).reduce(aabbUnion)` |
| `Board`, `Background`, `gridSize` | `Page`, `grid: GridMode`, `backgroundColor` |
| `cutSelection()` | `copySelection(data, true)` + обёртка `cutSelection()` |
| `duplicateSelection()` | логика в `state.duplicateSelected`, обёртка в `app.ts` |
| `bumpSceneRev()` | не существует; кэш элементов — WeakMap по ссылке |
| `welcome` | пакет комнаты называется `init` |

## Locked Decisions

Общие
1. Новый `src/file.ts` (`parseProject`, `serializeProject`, `sanitizeElement`); `storage.migrate` использует `parseProject`.
2. `sanitizeElement` проверяет обязательные поля и типы известных полей; неизвестные поля сохраняются.
3. Неизвестный `type` или битый элемент отбрасывается (`console.warn`); проект отклоняется только без `id`/`pages`.
4. `sanitizeElement` подключён к `storage.load` и входящим патчам; `applyRemoteProject` не меняется.
5. Вводится `BaseEl { id; groupId?; reactions? }`, все типы элементов наследуют его; `layerPin` остаётся в пересечении `Element`.
6. Реальные имена (см. таблицу), расхождения — в `NIGHT_LOG.md`.
7. UI не добавляется: модули, типы, сериализация, отрисовка `TaskEl`.
8. Ветка `night/1`, коммит на каждую задачу.
9. `AGENT.md` → `AGENTS.md`.

TASK-01
10. `Project.id` остаётся обязательным; добавляются `ownerPlan?`, `permissions?`.
11. Нет `ownerPlan` → `free`.
12. Существующие проекты сверх лимитов не трогаем; лимиты запрещают только создание нового.
13. Черновики в лимит страниц не входят.
14. `canCreatePage`: `count < max`; `canGuestJoinRoom`: `guests < maxGuests` (хост не считается). У free `tutorFeatures: false`.
15. `sanitizePermissionsForPlan` для free оставляет `pageRights` (значения только edit/view/hidden), принудительно `forbidClone:false`, `allowCopy:true`.
16. Проверки копирования/клонирования всегда прогоняют права через `sanitizePermissionsForPlan(ownerPlan ?? 'free')`.

TASK-02
17. В `AppState`: `collabRole: 'host' | 'guest' | null` (выставляет `collab.ts`) и `linkMode: 'view-project' | 'view-page' | null`.
18. `forbidClone: true` блокирует и копирование элементов (как в SPEC).
19. Для гостя и зрителя блокируются: Ctrl+C/X/D, Ctrl+Shift+C, экспорт PNG/JSON, дублирование Alt-перетаскиванием. Вставка разрешена.
20. Дублирование у гостя с `edit` тоже блокируется.
21. `copySelection(data, cut)` + `cutSelection()`; дублирование защищено в `state.duplicateSelected`.
22. Защита — сдерживание, не криптозащита (в памяти гостя весь проект).

TASK-03
23. Парсер понимает `/p/…` и `?route=…`; `buildBoardUrl` по умолчанию строит `?route=…`, `/p/` — опцией.
24. Базовый путь определяется поиском сегмента `/p/` или `/j/`.
25. Ключ шифрования всегда в `#k=`; `/j/:token` — непрозрачный идентификатор; `?room=CODE` и `#relay=…` — тоже `collab`.
26. Права по страницам в URL не передаются.
27. `padding = 80` px экрана; `z = clamp(min((W−2p)/bw,(H−2p)/bh), 0.1, 4)`; нулевой AABB → z = 4; вьюпорт < 2p → без отступа.
28. Отсутствующие `focusIds` пропускаются; ни одного — `null`.
29. В `Flash` добавляется `ms?`, рендер учитывает.
30. Загрузка проекта по `projectId` не делается.

TASK-04
31. Вместо `background`/`gridSize`: `grid?: GridMode`, `backgroundColor?: string | null`.
32. `rev` `applyBoardPatch` не использует; счётчик ведёт хост.
33. «Изменился»: сначала по ссылке, затем глубокое сравнение.
34. `order` (полный список id) выпускается, только если порядок после `put`/`del` не совпадает с `next`; новые через `put` — наверх.
35. Неизвестные id в `order` игнорируются, пропущенные дописываются; затем сортировка по `layerPin` как в `replaceElements`.
36. Операции применяются строго по порядку; `put`, не прошедший `sanitizeElement`, отбрасывается; `put` с существующим id заменяет на месте.

TASK-05
37. Пакет `init` сохраняется, в `init`/`rights` добавляется `allowCopy`. Превышение лимита: `{t:'denied', reason:'free-limit-reached'}` + закрытие кодом 4402.
38. `PROTO` = 1; гость сообщает о поддержке `patch`, остальным — полный `project`.
39. API как у `createRoomHub`: `attach`, `refresh`, `setRights`, `pushProject`, `pushPatch`; сокет принимает `string | Uint8Array`.
40. `pageRights` — начальные права нового гостя; `setRights` меняет для конкретного.
41. `electron/room.cjs` и `share.cjs` не трогаем.
42. Число страниц на free ограничивается на хосте через `canCreatePage`.
43. `MAX_EDITORS = 4` только для free; для pro/tutor `maxEditors = Infinity` (переопределяется опциями `createRoomHub`). Считаются только сокеты с `readyState === 1`.

TASK-06
44. Хэш от всей строки data URL (UTF-8), формат `asset://<64 hex>`.
45. SHA-256: `crypto.subtle`, при его отсутствии — чистая JS-реализация.
46. Иконка проекта и `page`-ссылки не выносятся; выносятся только `src`, начинающиеся с `data:image/`.
47. Только модуль и тесты; IndexedDB — если доступен; отсутствующий ассет остаётся `asset://…`.

TASK-07
48. `userId` — строка, постоянный клиентский id.
49. Реакции и комментарии в историю отмены не попадают.
50. Сдвиг привязанного треда = сдвиг левого верхнего угла AABB.
51. При удалении цели тред остаётся на месте с сохранённым `targetElementId`.
52. `syncCommentsWithMovedElements` вызывается в `replaceElements`, `undo`, `redo`, если у страницы есть комментарии.
53. Пустой текст отклоняется; эмодзи ≤ 16 символов; комментарий ≤ 2000; пустые массивы реакций удаляются; нет цели на странице — тред без привязки.
54. Рисовать значки/метки не нужно.

TASK-08
55. Правильность ответа проверяет хост; `submitTaskAttempt` — для хоста.
56. При слиянии у гостя принимаются только `studentDraft` и новые `attempts`; остальное — у хоста.
57. `projectTaskForRole` применяется везде, где данные уходят гостю.
58. Ученик с правом `view` может отвечать.
59. Нормализация: trim, без пробелов, нижний регистр, `,`→`.`, `−/–`→`-`, `ё`→`е`; числа сравниваются как числа; несколько ответов через `|`.
60. Пустой ввод попытку не записывает.
61. Один `studentDraft` на задание.
62. Statement — обычный текст с переносами; статусы «Решено» / «Не решено» / «Нет ответа»; ответ на холсте не рисуется.
63. Размер по умолчанию 360×220; ресайз как у стикера; объектный ластик не стирает; штрихи/стикеры можно привязывать; цвета и толщины нет.
64. Инструмента на панели нет; `taskId` по умолчанию `uid()`.
65. Бейдж «Сложное» виден ученику.

Уточнения
- `maxEditors`: free = 4 (`MAX_EDITORS`), pro/tutor = `Infinity`; считаются открытые сокеты.
- `TaskEl` дополнительно: `subject?: 'math' | 'physics' | 'informatics' | 'other'` (по умолчанию `'math'`), `answerUnit?: string`, `codeSnippet?: { lang: 'python' | 'cpp' | 'text'; code: string }`. Поддерживаются в `createTaskElement` и `sanitizeElement`.
