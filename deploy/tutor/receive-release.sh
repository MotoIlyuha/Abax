#!/bin/sh
set -eu

version=${SSH_ORIGINAL_COMMAND:-}
case "$version" in
  ''|*[!0-9.]* ) echo 'expected a semantic version' >&2; exit 2 ;;
esac
dots=$(printf '%s' "$version" | tr -cd '.' | wc -c | tr -d ' ')
[ "$dots" = 2 ] || { echo 'expected a semantic version' >&2; exit 2; }

incoming=/var/lib/abax-tutor-deploy/incoming
archive="$incoming/release-$version.tar.gz"
umask 077
tmp=$(mktemp "$incoming/.upload.XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM
cat > "$tmp"
size=$(wc -c < "$tmp" | tr -d ' ')
[ "$size" -gt 0 ] && [ "$size" -le 104857600 ] || { echo 'invalid release archive size' >&2; exit 2; }
mv -f "$tmp" "$archive"
trap - EXIT HUP INT TERM
sudo -n /usr/local/sbin/abax-tutor-deploy-release "$version" "$archive"
rm -f "$archive"
