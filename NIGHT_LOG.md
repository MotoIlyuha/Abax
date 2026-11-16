# NIGHT_LOG.md — журнал ночного запуска #4

Журналы предыдущих ночей — `NIGHT_LOG_NIGHT1.md`, `NIGHT_LOG_NIGHT2.md`, `NIGHT_LOG_NIGHT3.md`.

## Старт
- Ветка `night/4` от `main` (Ночь №3 + релиз 2.8.0 и PR #40–#44). Базовая линия: typecheck чисто, **988** unit/server тестов зелёные, **286** E2E в списке.
- `SPEC_NIGHT4.md` со спецификацией и Locked Decisions (39 пунктов, с уточнениями Б.1/Б.2, Б.5, В.8, Д.4, Д.5), `TASKS.md` (TASK-01…08), `AGENTS.md` ссылается на `SPEC_NIGHT4.md` и разрешает серверу импортировать `src/cursors.ts`. Журнал Ночи №3 переименован в `NIGHT_LOG_NIGHT3.md`.

## TASK-01 — каталог курсоров, профиль, смешные имена (готово)
- `src/cursors.ts` (без DOM): 6 бесплатных пресетов («Классика», «Графит», «Мята», «Коралл», «Лаванда», «Янтарь») и 8 Pro («Геометрия», «Космос», «Неон», «Голограмма», «Пиксель», «Золото», «Пламя», «Аврора»). У пресета: заливка/контур/узор стрелки, `selectionColor`, `badgeBg`/`badgeText`, эффект (`glow` вшит в SVG широким полупрозрачным контуром; `trail`/`sparkle` — частицы на слое эффектов). `cursorSvg` строит разметку только из констант, id узоров с префиксом `abc-<id>-`; `cursorCss` — data URL 32×32 с горячей точкой 3 2 и запасной `default`. `cleanCursorId(raw, allowPro)`, `canUseCursor`, `contrastRatio`.
- Решение: бейдж классического курсора — `#2160dd` (фирменный `--accent-strong`), потому что белый текст на `#3273f5` даёт контраст 4.28 < 4.5; рамка выделения остаётся `#3273f5`. У «Янтаря» выделение `#cc6a00` (у `#e67700` контраст к белому ровно 3.0).
- `src/profile.ts`: `doska.profile` (имя через `normalizeName` — до 40 символов, курсор по белому списку, `onboarded`), подписка `onProfileChange`, `notifyProfileChanged`, `cursorEntitled()` (тариф не free или dev-режим), `myCursorId()` (Pro без права → `default`, выбор сохраняется), `mySelectionColor()`.
- `src/funny-names.ts` — 42 имени (все обязательные из Решения 35), `randomFunnyName(rand)`. `src/onboarding-logic.ts` — `tabFill`, `resolveName`, состояние выбора курсора (`initialChoice`, `pickCursor`, `previewLocked`, `revertChoice`) для «примерки» Pro-курсора (Решение 23).
- Тесты: `tests/unit/cursors.test.ts` (8), `tests/unit/profile.test.ts` (11, вместе с логикой поля имени и именами). Всего 1008.
