#!/bin/sh
set -eu
# Запуск root после копирования каталога deploy/downloads и открытого ключа в /tmp/abax-download-setup.
SOURCE=/tmp/abax-download-setup
id abax-downloads >/dev/null 2>&1 || useradd --system --home-dir /var/lib/abax-download-publisher --shell /bin/sh abax-downloads
install -d -o root -g root -m 755 /var/lib/abax-download-publisher
install -d -o root -g root -m 755 /var/lib/abax-download-publisher/.ssh
{ printf 'restrict,command="/usr/bin/python3 /usr/local/lib/abax-download-receive.py" '; cat "$SOURCE/publisher.pub"; } > /var/lib/abax-download-publisher/.ssh/authorized_keys
chown root:root /var/lib/abax-download-publisher/.ssh/authorized_keys
chmod 644 /var/lib/abax-download-publisher/.ssh/authorized_keys
install -o root -g root -m 755 "$SOURCE/receive.py" /usr/local/lib/abax-download-receive.py
install -d -o abax-downloads -g abax-downloads -m 755 /var/www/abax-downloads
for name in index.html style.css downloads.js not-found.html; do install -o root -g root -m 644 "$SOURCE/$name" "/var/www/abax-downloads/$name"; done
test -e /etc/nginx/sites-available/abax.before-downloads || cp -a /etc/nginx/sites-available/abax /etc/nginx/sites-available/abax.before-downloads
python3 - <<'PY'
from pathlib import Path
p = Path('/etc/nginx/sites-available/abax')
s = p.read_text()
marker = '    location /.well-known/acme-challenge/'
if 'location /downloads/' not in s:
    block = '''    location = /downloads { return 301 /downloads/; }
    location ~ ^/downloads/\\. { deny all; }
    location = /downloads/latest.json {
        alias /var/www/abax-downloads/latest.json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
    location /downloads/ {
        alias /var/www/abax-downloads/;
        index index.html;
        autoindex off;
        disable_symlinks on;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
        error_page 404 /downloads/not-found.html;
    }
'''
    s = s.replace(marker, block + marker, 1)
    p.write_text(s)
PY
if nginx -t; then systemctl reload nginx; else cp -a /etc/nginx/sites-available/abax.before-downloads /etc/nginx/sites-available/abax; exit 1; fi

