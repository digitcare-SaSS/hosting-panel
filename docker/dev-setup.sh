#!/bin/bash
# Hot-reload mode: runs at boot when docker-compose bind-mounts the source tree
# (sada-mia-dev.service only starts if backend/app is a mount point).
set -e

PANEL_DIR=/opt/sada-mia-hosting-panel
cd "$PANEL_DIR/backend"

echo "==> Sada Mia dev mode: wiring hot reload"

# PHP: re-check changed files on every request instead of every 2s
printf 'opcache.validate_timestamps=1\nopcache.revalidate_freq=0\n' > /etc/php/8.4/fpm/conf.d/99-sada-mia-dev.ini

# Queue: queue:listen boots a fresh worker per job, so job code changes apply without restarts
mkdir -p /etc/systemd/system/sada-mia-queue.service.d
cat > /etc/systemd/system/sada-mia-queue.service.d/dev.conf <<EOF
[Service]
ExecStart=
ExecStart=/usr/bin/php $PANEL_DIR/backend/artisan queue:listen --timeout=11000 --tries=3
EOF

# Root helper: run the mounted repo copy directly so script edits apply immediately
# (a wrapper rather than a symlink, so it works even if the file lost its exec bit)
rm -f /usr/local/sbin/sada-mia-backup
printf '#!/bin/bash\nexec /bin/bash %s "$@"\n' "$PANEL_DIR/scripts/sada-mia-backup.sh" > /usr/local/sbin/sada-mia-backup
chmod 0755 /usr/local/sbin/sada-mia-backup
mkdir -p /var/backups/sada-mia/.staging /var/backups/sada-mia/migration
chown www-data:www-data /var/backups/sada-mia /var/backups/sada-mia/.staging /var/backups/sada-mia/migration
chmod 0750 /var/backups/sada-mia /var/backups/sada-mia/.staging /var/backups/sada-mia/migration
for sub in create restore-start; do
    grep -q "sada-mia-backup $sub" /etc/sudoers.d/sadamiapanel 2>/dev/null \
        || echo "www-data ALL=(root) NOPASSWD: /usr/local/sbin/sada-mia-backup $sub *" >> /etc/sudoers.d/sadamiapanel
done
grep -q "^DB_QUEUE_RETRY_AFTER=" .env || echo "DB_QUEUE_RETRY_AFTER=11000" >> .env

# Frontend: serve the panel UI on its normal port (8083) through the Vite dev server (hot reload),
# falling back to the last production build whenever the `frontend` container is not running
PANEL_VHOST=/etc/nginx/sites-available/sada-mia-panel
if [ -f "$PANEL_VHOST" ]; then
    python3 - "$PANEL_VHOST" <<'PY'
import sys
path = sys.argv[1]
conf = open(path).read()
static = "    location / {\n        try_files $uri $uri/ /index.html;\n    }\n"
dev = """    # sada-mia-dev: vite - UI comes from the Vite dev server (hot reload)
    location / {
        resolver 127.0.0.11 valid=10s ipv6=off;
        set $vite_upstream http://frontend:5173;
        proxy_pass $vite_upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # Vite only answers for localhost; the browser may use panel.localhost or an IP
        proxy_set_header Host localhost;
        proxy_read_timeout 1h;
        error_page 502 504 = @production_build;
    }

    location @production_build {
        # =404 makes /index.html a file lookup, not a redirect back through the Vite proxy
        try_files $uri $uri/ /index.html =404;
    }
"""
if static in conf:
    conf = conf.replace(static, dev, 1)
# Upgrade a block written by an earlier version of this script
conf = conf.replace(
    "    location @production_build {\n        try_files $uri $uri/ /index.html;\n    }\n",
    "    location @production_build {\n        try_files $uri $uri/ /index.html =404;\n    }\n",
)
open(path, "w").write(conf)
PY
fi
nginx -t 2>/dev/null && systemctl reload nginx

# Pick up new migrations and drop any cached config/routes
sudo -u www-data php artisan migrate --force
sudo -u www-data php artisan optimize:clear

systemctl daemon-reload
systemctl restart php8.4-fpm sada-mia-queue

echo "==> Dev mode ready: PHP, queue jobs and the helper script reload on save"
