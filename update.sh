#!/bin/bash
set -e

# Applies the code already in this directory (pull it first) to an installed panel without touching its data.
# Unlike re-running install.sh, this keeps backend/.env, the APP_KEY and the admin password.

echo "==================================================="
echo "    Sada Mia Hosting Panel - Updater Script        "
echo "==================================================="

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./update.sh [--force])"
  exit 1
fi

FORCE=false
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=true ;;
        *)
            echo "Usage: sudo ./update.sh [--force]"
            exit 1
            ;;
    esac
done

PANEL_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PANEL_DIR/backend"
cd "$PANEL_DIR"

if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo "backend/.env not found - the panel is not installed yet. Run ./install.sh instead."
    exit 1
fi

DB_FILE=$(grep -E '^DB_DATABASE=' "$BACKEND_DIR/.env" | cut -d= -f2- | tr -d '"' || true)
DB_FILE=${DB_FILE:-$BACKEND_DIR/database/database.sqlite}

# Restarting the queue worker kills running jobs (a server migration can take hours)
RUNNING_JOBS=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM jobs WHERE reserved_at IS NOT NULL;" 2>/dev/null || echo 0)
if [ "$RUNNING_JOBS" -gt 0 ] && [ "$FORCE" = false ]; then
    echo "$RUNNING_JOBS queue job(s) are running right now (for example a server migration or a deployment)."
    echo "Updating would restart the queue worker and kill them. Wait for them to finish, or re-run with --force."
    exit 1
fi

echo "==> 1. Backing up .env and the panel database"
BACKUP_DIR="/var/backups/sada-mia-update/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
cp "$BACKEND_DIR/.env" "$BACKUP_DIR/backend.env"
[ -f "$PANEL_DIR/.env" ] && cp "$PANEL_DIR/.env" "$BACKUP_DIR/panel.env"
# .backup gives a consistent copy even while the panel is writing to it
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/database.sqlite'"
echo "    Saved to $BACKUP_DIR"

echo "==> 2. Updating the backend"
cd "$BACKEND_DIR"
php artisan down || true
trap 'cd "$BACKEND_DIR" && php artisan up >/dev/null 2>&1 || true' EXIT

export COMPOSER_ALLOW_SUPERUSER=1
composer install --no-interaction --optimize-autoloader
# Long jobs (migrations run up to 3h) must not be re-reserved by the database queue after the default 90s
grep -q "^DB_QUEUE_RETRY_AFTER=" .env || echo "DB_QUEUE_RETRY_AFTER=11000" >> .env
php artisan migrate --force
php artisan optimize:clear

# artisan ran as root: hand logs, caches and any SQLite journal files back to www-data
chown -R www-data:www-data storage bootstrap/cache
chown www-data:www-data database "$DB_FILE"*

echo "==> 3. Building the frontend"
cd "$PANEL_DIR/frontend"
npm install --no-audit --no-fund
npm run build
chown -R www-data:www-data dist
chmod -R 755 dist

echo "==> 4. Refreshing system packages and the migration helper"
for pkg in pigz openssl sqlite3; do
    if ! dpkg -s $pkg >/dev/null 2>&1; then
        apt-get install -y $pkg
    fi
done

sed "s|@PANEL_DIR@|$PANEL_DIR|" "$PANEL_DIR/scripts/sada-mia-backup.sh" > /usr/local/sbin/sada-mia-backup
chown root:root /usr/local/sbin/sada-mia-backup
chmod 0755 /usr/local/sbin/sada-mia-backup
mkdir -p /var/backups/sada-mia/.staging /var/backups/sada-mia/migration
chown www-data:www-data /var/backups/sada-mia /var/backups/sada-mia/.staging /var/backups/sada-mia/migration
chmod 0750 /var/backups/sada-mia /var/backups/sada-mia/.staging /var/backups/sada-mia/migration

# Add sudoers rules introduced since install; validate before replacing so a bad file can't lock out sudo
SUDOERS=/etc/sudoers.d/sadamiapanel
SUDOERS_TMP=$(mktemp)
cp "$SUDOERS" "$SUDOERS_TMP" 2>/dev/null || true
for sub in create restore-start; do
    grep -q "sada-mia-backup $sub" "$SUDOERS_TMP" \
        || echo "www-data ALL=(root) NOPASSWD: /usr/local/sbin/sada-mia-backup $sub *" >> "$SUDOERS_TMP"
done
if visudo -cf "$SUDOERS_TMP" >/dev/null; then
    install -m 0440 -o root -g root "$SUDOERS_TMP" "$SUDOERS"
else
    echo "    WARNING: generated sudoers rules are invalid, keeping the existing $SUDOERS"
fi
rm -f "$SUDOERS_TMP"

echo "==> 5. Restarting panel services"
systemctl daemon-reload
systemctl restart php8.4-fpm sada-mia-queue

cd "$BACKEND_DIR"
php artisan up
trap - EXIT

echo "==================================================="
echo "  Update Complete!"
echo "  Backup:    $BACKUP_DIR"
echo "==================================================="
