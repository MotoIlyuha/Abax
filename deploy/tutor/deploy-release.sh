#!/usr/bin/env bash
set -euo pipefail

version=${1:-}
archive=${2:-}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'invalid version' >&2; exit 2; }
[[ "$archive" == "/var/lib/abax-tutor-deploy/incoming/release-$version.tar.gz" ]] || { echo 'invalid archive path' >&2; exit 2; }
[[ -f "$archive" && ! -L "$archive" ]] || { echo 'release archive is missing' >&2; exit 2; }

old_release=$(readlink -f /opt/abax/current)
modules=$(readlink -f /opt/abax/current/node_modules)
[[ -d "$old_release" && -d "$modules" ]] || { echo 'current release is incomplete' >&2; exit 2; }
[[ -f /etc/abax/abax.env && -d /var/lib/abax/assets ]] || { echo 'Abax server paths are missing' >&2; exit 2; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
release="/opt/abax/releases/${stamp}-v${version}"
backup="/var/backups/abax/pre-release-v${version}-${stamp}"
[[ ! -e "$release" ]] || { echo 'release directory already exists' >&2; exit 2; }
systemctl is-active --quiet abax.service || { echo 'Abax service is not active before deployment' >&2; exit 2; }
staging=$(mktemp -d /var/tmp/abax-tutor-release.XXXXXX)
archive_copy=$(mktemp --suffix=.tar.gz /var/tmp/abax-tutor-archive.XXXXXX)
switched=0
cleanup() {
  rc=$?
  if [[ "$rc" -ne 0 && "$switched" -eq 1 ]]; then
    rollback_link="/opt/abax/current.rollback.$$"
    ln -s "$old_release" "$rollback_link"
    mv -Tf "$rollback_link" /opt/abax/current
    systemctl restart abax.service || true
  fi
  [[ -z "$staging" ]] || rm -rf -- "$staging"
  rm -f -- "$archive_copy"
  exit "$rc"
}
trap cleanup EXIT
chmod 600 "$archive_copy"
cp -- "$archive" "$archive_copy"

python3 - "$archive_copy" <<'PY'
import pathlib
import sys
import tarfile

allowed = {"dist", "dist-server", "RELEASE"}
required = {"dist/index.html", "dist-server/index.mjs", "RELEASE"}
seen = set()
total = 0
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for item in archive.getmembers():
        path = pathlib.PurePosixPath(item.name)
        if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in allowed:
            raise SystemExit("release archive contains an unexpected path")
        if item.issym() or item.islnk() or item.isdev() or item.isfifo():
            raise SystemExit("release archive contains a special file")
        total += item.size
        if total > 100 * 1024 * 1024:
            raise SystemExit("release archive is too large")
        if item.isfile():
            seen.add(path.as_posix())
if not required.issubset(seen):
    raise SystemExit("release archive is incomplete")
PY

install -d -m 700 "$backup"
cp -a /etc/abax/abax.env "$backup/abax.env"
cp -a /etc/nginx/sites-available/abax-board "$backup/nginx-abax-board"
cp -a /etc/nginx/sites-available/abax-tutor "$backup/nginx-abax-tutor"
readlink /opt/abax/current > "$backup/current-link"
tar -czf "$backup/assets.tar.gz" -C /var/lib/abax assets
node - "$backup/abax.db" <<'NODE'
const Database = require('/opt/abax/current/node_modules/better-sqlite3');
const target = process.argv[2];
const live = new Database('/var/lib/abax/abax.db', { readonly: true });
live.backup(target).then(() => {
  live.close();
  const copy = new Database(target, { readonly: true });
  const result = copy.pragma('quick_check');
  copy.close();
  if (result[0].quick_check !== 'ok') throw new Error('database backup failed integrity check');
}).catch((error) => { console.error(error); process.exit(1); });
NODE
chmod 600 "$backup/abax.db"

tar --no-same-owner --no-same-permissions -xzf "$archive_copy" -C "$staging"
[[ -s "$staging/dist/index.html" && -s "$staging/dist-server/index.mjs" ]]
tr -d '\r' < "$staging/RELEASE" | grep -Fxq "version=$version"
tr -d '\r' < "$staging/RELEASE" | grep -Eq '^commit=[0-9a-f]{40}$'
expected_asset=$(grep -oE 'assets/(index|board)-[A-Za-z0-9_-]+\.js' "$staging/dist/index.html" | head -n 1)
[[ -n "$expected_asset" ]]
ln -s "$modules" "$staging/node_modules"
find "$staging" -type d -exec chmod 755 {} +
find "$staging" -type f -exec chmod 644 {} +
chown -R root:root "$staging"
runuser -u abax -- test -r "$staging/dist/index.html"
runuser -u abax -- test -r "$staging/dist-server/index.mjs"
nginx -t
mv "$staging" "$release"
staging=''

next_link="/opt/abax/current.next.$$"
ln -s "$release" "$next_link"
mv -Tf "$next_link" /opt/abax/current
switched=1
systemctl restart abax.service

ready=0
for attempt in $(seq 1 30); do
  page=$(curl --fail --silent --max-time 3 -H 'Host: tutor.abaxboard.ru' http://127.0.0.1:8787/ 2>/dev/null || true)
  if printf '%s' "$page" | grep -Fq "$expected_asset"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" -eq 1 ]]
systemctl is-active --quiet abax.service
api_status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 http://127.0.0.1:8787/api/tutor/snapshot)
[[ "$api_status" == 401 ]]
switched=0
trap - EXIT
rm -f -- "$archive_copy"
printf 'release=%s\nasset=%s\nbackup=%s\napi_status=%s\n' "$release" "$expected_asset" "$backup" "$api_status"
