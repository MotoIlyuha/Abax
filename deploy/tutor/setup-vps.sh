#!/usr/bin/env bash
set -euo pipefail

public_key=${1:-}
source_dir=${2:-}
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+={0,2}(\ [A-Za-z0-9._-]+)?$ ]] || { echo 'expected an Ed25519 public key' >&2; exit 2; }
[[ -f "$source_dir/receive-release.sh" && -f "$source_dir/deploy-release.sh" ]] || { echo 'deployment scripts are missing' >&2; exit 2; }

install -d -o root -g root -m 755 /usr/local/lib /usr/local/sbin
install -o root -g root -m 755 "$source_dir/receive-release.sh" /usr/local/lib/abax-tutor-receive-release
install -o root -g root -m 755 "$source_dir/deploy-release.sh" /usr/local/sbin/abax-tutor-deploy-release

if ! id abax-tutor-deploy >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/abax-tutor-deploy --create-home --shell /bin/sh abax-tutor-deploy
fi
install -d -o abax-tutor-deploy -g abax-tutor-deploy -m 700 /var/lib/abax-tutor-deploy/.ssh
install -d -o abax-tutor-deploy -g abax-tutor-deploy -m 700 /var/lib/abax-tutor-deploy/incoming
chmod 750 /var/lib/abax-tutor-deploy
authorized_keys=/var/lib/abax-tutor-deploy/.ssh/authorized_keys
touch "$authorized_keys"
chown abax-tutor-deploy:abax-tutor-deploy "$authorized_keys"
chmod 600 "$authorized_keys"
key_line="restrict,command=\"/usr/local/lib/abax-tutor-receive-release\" $public_key"
grep -Fxq "$key_line" "$authorized_keys" || printf '%s\n' "$key_line" >> "$authorized_keys"

sudoers_tmp=$(mktemp)
printf 'abax-tutor-deploy ALL=(root) NOPASSWD: /usr/local/sbin/abax-tutor-deploy-release *\n' > "$sudoers_tmp"
visudo -cf "$sudoers_tmp"
install -o root -g root -m 440 "$sudoers_tmp" /etc/sudoers.d/abax-tutor-deploy
rm -f "$sudoers_tmp"
sshd -t
echo 'restricted Tutor deploy account configured'
