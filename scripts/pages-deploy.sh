#!/usr/bin/env bash
# Публикация гостевого клиента совместной работы (сборка dist/) в ветку gh-pages:
# папка v/<версия>/, прежние версии остаются — у автора со старой версией приложения
# ссылка ведёт на клиент его версии. Без изменений ничего не коммитит.
#
# Использование: scripts/pages-deploy.sh <git-remote> [каталог-сборки] [версия]
# По умолчанию — dist/ и версия из package.json. Запускает .github/workflows/pages.yml.
set -euo pipefail

remote="${1:?укажите git-remote}"
dist="$(cd "${2:-dist}" && pwd)"
root="$(cd "$(dirname "$0")/.." && pwd)"
version="${3:-$(node -p "require('$root/package.json').version")}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Неверная версия: $version" >&2
  exit 1
fi
[ -f "$dist/index.html" ] || { echo "Нет сборки: $dist/index.html" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
site="$work/site"
if git ls-remote --exit-code --heads "$remote" gh-pages > /dev/null 2>&1; then
  git clone -q --depth 1 --branch gh-pages "$remote" "$site"
else
  git init -q -b gh-pages "$site"
  git -C "$site" remote add origin "$remote"
fi

rm -rf "$site/v/$version"
mkdir -p "$site/v/$version"
cp -R "$dist/." "$site/v/$version/"
cp "$root/scripts/pages-index.html" "$site/index.html"
touch "$site/.nojekyll" # без Jekyll: файлы отдаются как есть

cd "$site"
git add -A
if git diff --cached --quiet; then
  echo "gh-pages: без изменений (v$version)"
  exit 0
fi
git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -q -m "Гостевой клиент $version"
git push -q origin gh-pages
echo "gh-pages: опубликован v$version"
