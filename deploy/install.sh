#!/usr/bin/env bash
# Установка сайта Карго 151 на чистый сервер Ubuntu 22.04/24.04.
# Запуск от root:  bash install.sh <git-url-репозитория> [домен]
# Пример:          bash install.sh https://github.com/user/cargo151.git cargo.cargo151.com
set -euo pipefail

REPO_URL="${1:?Укажите адрес репозитория}"
DOMAIN="${2:-}"
APP_DIR=/opt/cargo151
DATA_DIR=/var/lib/cargo151
ENV_FILE=/etc/cargo151.env

apt-get update
apt-get install -y curl git nginx rsync
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id cargo151 >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin cargo151
mkdir -p "$DATA_DIR" && chown cargo151:cargo151 "$DATA_DIR"

if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone "$REPO_URL" "$APP_DIR"; fi
(cd "$APP_DIR" && npm ci --omit=dev)

# Пароль админки и секрет сессий создаются один раз и не меняются при обновлении.
if [ ! -f "$ENV_FILE" ]; then
  ADMIN_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)
  ACCOUNTANT_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)
  cat > "$ENV_FILE" <<EOF
PORT=3000
DB_PATH=$DATA_DIR/cargo151.db
ADMIN_PASSWORD=$ADMIN_PASSWORD
ACCOUNTANT_PASSWORD=$ACCOUNTANT_PASSWORD
KEEPER_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)
SESSION_SECRET=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)
EOF
  chmod 600 "$ENV_FILE"
fi
# Пароль кладовщика появился позже: добавляем в старый файл, если его там нет.
grep -q '^KEEPER_PASSWORD=' "$ENV_FILE" || echo "KEEPER_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)" >> "$ENV_FILE"

# Резервная копия каждую ночь в 03:30 в /var/backups/cargo151 (14 дней).
echo "30 3 * * * root bash $APP_DIR/deploy/backup.sh" > /etc/cron.d/cargo151-backup

cat > /etc/systemd/system/cargo151.service <<EOF
[Unit]
Description=Cargo 151 site
After=network.target

[Service]
User=cargo151
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now cargo151
systemctl restart cargo151

cat > /etc/nginx/sites-available/cargo151 <<EOF
server {
  listen 80;
  server_name ${DOMAIN:-_};
  client_max_body_size 10m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF
ln -sf /etc/nginx/sites-available/cargo151 /etc/nginx/sites-enabled/cargo151
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [ -n "$DOMAIN" ]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "HTTPS не настроен: проверьте, что домен указывает на этот сервер, и запустите скрипт ещё раз."
fi

echo
echo "Готово. Сайт: http://${DOMAIN:-$(curl -s ifconfig.me)}"
echo "Админка: /admin"
echo "  пароль владельца:   $(grep '^ADMIN_PASSWORD' "$ENV_FILE" | cut -d= -f2)"
echo "  пароль бухгалтера:  $(grep '^ACCOUNTANT_PASSWORD' "$ENV_FILE" | cut -d= -f2)"
echo "  пароль кладовщика:  $(grep '^KEEPER_PASSWORD' "$ENV_FILE" | cut -d= -f2)"
