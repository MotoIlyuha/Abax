#!/bin/sh
# Шифрование выполняется публичным ключом; закрытый ключ хранится вне VPS.
set -eu
if [ "$#" -ne 3 ]; then
  echo 'Использование: encrypt-backup.sh архив.tar.gz публичный-ключ.asc каталог-результата' >&2
  exit 2
fi
archive=$1
recipient=$2
destination=$3
[ -f "$archive" ] && [ -f "$recipient" ] && [ -d "$destination" ] || exit 1
umask 077
name=$(basename "$archive")
case "$name" in abax-*.tar.gz) ;; *) echo 'Неверное имя архива' >&2; exit 1 ;; esac
target=$destination/$name.gpg
[ ! -e "$target" ] || { echo 'Зашифрованная копия уже существует' >&2; exit 1; }
tmp=$(mktemp "$destination/.abax-encrypt.XXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT HUP INT TERM
gpg --batch --yes --trust-model always --recipient-file "$recipient" --output "$tmp" --encrypt "$archive"
[ -s "$tmp" ] || exit 1
ln "$tmp" "$target"
echo "Зашифрованный архив создан: $target"
