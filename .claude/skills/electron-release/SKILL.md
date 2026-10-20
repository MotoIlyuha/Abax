---
name: electron-release
description: Собирает релиз Doska под Windows (electron-builder, NSIS-установщик + portable) в папку release основного чекаута, поднимает версию и коммитит "chore: release X.Y.Z". Использовать при "/electron-release", "сделай electron сборку", "собери релиз", "собери exe", "сборка в release".
---

# Релизная Electron-сборка Doska

Результат: `Doska Setup X.Y.Z.exe` (+ `.blockmap`) и `Doska X.Y.Z.exe` в папке `release` **основного** чекаута, коммит `chore: release X.Y.Z` в текущей ветке.

## 1. Где лежит release

Сессия часто идёт в worktree (`.claude/worktrees/...`), а `directories.output: release` в `electron-builder.yml` указывает на папку внутри worktree. Собирать нужно в release основного чекаута:

```bash
ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
RELEASE="$ROOT/release"
ls "$RELEASE"
```

## 2. Версия

- Текущая версия: `version` в `package.json`.
- Изменения с прошлого релиза: `git log --oneline --no-merges $(git log -1 --format=%h --grep='^chore: release')..HEAD`.
- **Нельзя перезаписывать уже собранную версию.** Если в `$RELEASE` уже есть `Doska X.Y.Z.exe` для текущей версии, а после её релизного коммита есть новые изменения, подними версию:
  - есть `feat:` или заметные новые возможности → minor (1.1.0 → 1.2.0);
  - только исправления → patch (1.2.0 → 1.2.1).
- Если пользователь назвал версию сам, используй её.

```bash
npm version X.Y.Z --no-git-tag-version
```

Эта команда обновляет `package.json` и `package-lock.json`, git-тег не создаёт.

## 3. Проверки до сборки

В CI (`.github/workflows/tests.yml`) идут typecheck, unit-тесты и e2e. Прогони хотя бы быстрые проверки локально, чтобы не узнать о падении уже из PR:

```bash
[ -d node_modules ] || npm ci
npm run typecheck && npm run typecheck:tests && npx vitest run
```

Если тест упал, разберись в причине. Тест может ловить настоящий баг в `src/`, а не быть просто нестабильным: так было с `hiddenAt = 0` в `src/tooltip.ts`. Исправь причину отдельным коммитом `fix: ...`, а не тест.

Тесты зависят от времени (`performance.now()`, таймеры), поэтому могут проходить локально и падать на быстром CI. Если тест трогает задержки, перечитай логику граничных значений.

## 4. Сборка

```bash
npm run build
npx electron-builder --win nsis portable "--config.directories.output=$RELEASE"
```

Это то же самое, что `npm run dist`, но с выводом в release основного чекаута. Предупреждения про размер чанка, отсутствие `author`, иконку по умолчанию и пропущенную подпись (signtool) — нормальные.

Проверь результат:

```bash
ls -la "$RELEASE" | grep X.Y.Z
```

Должны появиться три файла: `Doska Setup X.Y.Z.exe`, `.blockmap` и `Doska X.Y.Z.exe` (около 99 МБ каждый). Папка `win-unpacked` при этом перезаписывается — это нормально.

## 5. Коммит

Тело коммита — по образцу прошлых релизов: одной-двумя строками перечисли главное, что вошло с прошлой версии.

```bash
git add package.json package-lock.json
git commit -F - <<'EOF'
chore: release X.Y.Z

<краткий список изменений с прошлого релиза>

Co-Authored-By: ...
EOF
```

Если после сборки пришлось исправлять код (например, из-за упавшего CI), **пересобери** ту же версию шагом 4, чтобы exe в release совпадал с кодом в ветке.

## 6. Дальше

Пуш и PR в `main` — только с согласия пользователя. После открытия PR CI запускает `tests.yml`. Если он упал, смотри лог: `gh run view <id> --repo MotoIlyuha/Doska --log-failed`.

## Мелочи окружения (Windows, Git Bash)

- `git diff` может падать с `cannot spawn ... external diff died`, тогда используй `git --no-pager diff --no-ext-diff`.
- Предупреждения `LF will be replaced by CRLF` безвредны.
- Собранные exe не запускаются автоматически; если пользователь хочет проверить, пусть запустит portable `Doska X.Y.Z.exe` сам.
