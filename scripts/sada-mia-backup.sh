#!/bin/bash
#
# Sada Mia Panel - root helper for panel-to-panel migration.
# Installed by install.sh to /usr/local/sbin/sada-mia-backup (root:root 0755).
#
#   create        <export_id> <panel_db_copy>
#                 Source panel (www-data via sudo): pack the whole server. Encryption passphrase on stdin.
#   restore-start <archive_name> <new_ip>
#                 Target panel (www-data via sudo): start a detached restore of
#                 /var/backups/sada-mia/migration/<archive_name>. Passphrase on stdin.
#   restore       <archive> [--new-ip IP] [--sha256 HASH] [--passphrase-file FILE] [--yes]
#                 Root CLI restore (also what restore-start runs).
#   reip          [--old IP] [--new IP]
#                 Rewrite the server IP everywhere.
#
set -euo pipefail

PANEL_DIR="@PANEL_DIR@"
# Fall back to the repository layout when run straight from a checkout
if [[ "$PANEL_DIR" == @*@ ]]; then
    PANEL_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
fi

BACKUP_DIR=/var/backups/sada-mia            # www-data: finished exports
STAGING_DIR="$BACKUP_DIR/.staging"          # www-data: panel DB snapshot handed to `create`
MIGRATION_DIR="$BACKUP_DIR/migration"       # www-data: archive downloaded from the source panel
ROOT_STATE_DIR=/var/lib/sada-mia            # root only: nothing www-data can redirect
WORK_ROOT="$ROOT_STATE_DIR/work"
STATUS_DIR="$ROOT_STATE_DIR/restore"        # root:www-data 0750 - restore status/log the panel reads
PASS_FILE="$WORK_ROOT/restore.pass"
RESTORE_UNIT=sada-mia-restore
PM2_HOME_DIR=/var/www/.pm2
FORMAT_VERSION=2
PBKDF2_ITER=200000

# Server paths captured in the archive (relative to /). svc-* units are added at runtime.
ROOTFS_PATHS=(
    var/www/hosting-apps
    var/www/.pm2/dump.pm2
    etc/nginx/sites-available
    etc/nginx/sites-enabled
    etc/letsencrypt
    etc/bind/zones
    etc/bind/named.conf.local
    etc/postfix/virtual_mailbox_domains
    etc/postfix/virtual_mailbox_maps
    etc/postfix/virtual_alias_maps
    etc/dovecot/users
    etc/opendkim
    var/mail/vhosts
)
SVC_UNIT_RE='^etc/systemd/system/svc-[A-Za-z0-9_.@-]+\.service$'

# The panel's own vhosts are written by install.sh on the target and must not be overwritten
RESTORE_EXCLUDES=(
    --exclude=etc/nginx/sites-available/sada-mia-panel
    --exclude=etc/nginx/sites-enabled/sada-mia-panel
    --exclude=etc/nginx/sites-available/00-default
    --exclude=etc/nginx/sites-enabled/00-default
)

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { echo "==> $*"; }
warn() { echo "[WARN] $*"; }
die()  { echo "[ERROR] $*" >&2; exit 1; }

require_root() {
    [ "$EUID" -eq 0 ] || die "must be run as root"
}

as_postgres() { (cd /tmp && sudo -u postgres "$@"); }
as_www()      { (cd /tmp && sudo -u www-data "$@"); }
pm2_www()     { as_www env PM2_HOME="$PM2_HOME_DIR" pm2 "$@"; }
artisan()     { (cd "$PANEL_DIR/backend" && sudo -u www-data php artisan "$@"); }

root_workdir() {
    mkdir -p "$WORK_ROOT"
    chown root:root "$ROOT_STATE_DIR" "$WORK_ROOT"
    chmod 755 "$ROOT_STATE_DIR"
    chmod 700 "$WORK_ROOT"
    mktemp -d "$WORK_ROOT/$1.XXXXXX"
}

env_get() {
    grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/' || true
}

env_set() {
    local file="$1" key="$2" value="$3"
    local escaped="${value//\\/\\\\}"
    escaped="${escaped//&/\\&}"
    escaped="${escaped//|/\\|}"
    if grep -qE "^$key=" "$file"; then
        sed -i "s|^$key=.*|$key=$escaped|" "$file"
    else
        echo "$key=$value" >> "$file"
    fi
}

detect_public_ip() {
    local ip
    # Compute Engine knows its external IP (the VM itself only sees its internal one)
    ip=$(curl -fs -m 2 -H 'Metadata-Flavor: Google' \
        http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || true)
    [ -n "$ip" ] || ip=$(curl -fs -m 5 ifconfig.me 2>/dev/null || true)
    echo "$ip"
}

valid_ipv4() {
    [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]
}

manifest_get() {
    php -r '$m = json_decode(file_get_contents($argv[1]), true) ?: [];
            $v = $m[$argv[2]] ?? "";
            echo is_array($v) ? implode(" ", $v) : $v;' "$1" "$2"
}

restart_services() {
    log "Reloading services"
    nginx -t && systemctl reload nginx || warn "nginx config test failed - check 'nginx -t'"
    systemctl restart named 2>/dev/null || systemctl restart bind9 2>/dev/null || warn "could not restart BIND9"
    local svc
    for svc in postfix dovecot opendkim; do
        systemctl restart "$svc" 2>/dev/null || warn "could not restart $svc"
    done
    for svc in /lib/systemd/system/php*-fpm.service; do
        [ -e "$svc" ] && systemctl restart "$(basename "$svc")" 2>/dev/null || true
    done
    systemctl restart sada-mia-queue 2>/dev/null || warn "could not restart sada-mia-queue"
}

# ── create ───────────────────────────────────────────────────────────────────

write_manifest() {
    local id="$1" encrypted="$2" out="$3"
    MF_ID="$id" \
    MF_ENCRYPTED="$encrypted" \
    MF_HOST="$(hostname -f 2>/dev/null || hostname)" \
    MF_IP="$(env_get "$PANEL_DIR/backend/.env" SERVER_IP)" \
    MF_PORT="$(env_get "$PANEL_DIR/.env" PANEL_PORT)" \
    MF_PANEL_DIR="$PANEL_DIR" \
    MF_COMMIT="$(git -c safe.directory='*' -C "$PANEL_DIR" rev-parse HEAD 2>/dev/null || true)" \
    MF_PHP="$(ls /etc/php 2>/dev/null | tr '\n' ' ')" \
    MF_NODE="$(node -v 2>/dev/null || true)" \
    MF_FORMAT="$FORMAT_VERSION" \
    php -r '
        $e = fn ($k) => (string) getenv($k);
        echo json_encode([
            "format_version" => (int) $e("MF_FORMAT"),
            "export_id"      => (int) $e("MF_ID"),
            "created_at"     => gmdate("c"),
            "hostname"       => $e("MF_HOST"),
            "source_ip"      => $e("MF_IP"),
            "panel_port"     => $e("MF_PORT"),
            "panel_dir"      => $e("MF_PANEL_DIR"),
            "panel_commit"   => $e("MF_COMMIT"),
            "php_versions"   => array_values(array_filter(explode(" ", $e("MF_PHP")))),
            "node_version"   => $e("MF_NODE"),
            "encrypted"      => $e("MF_ENCRYPTED") === "1",
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), PHP_EOL;' > "$out"
}

cmd_create() {
    require_root
    local id="${1:-}" db_copy="${2:-}"
    [[ "$id" =~ ^[0-9]+$ ]] || die "usage: sada-mia-backup create <export_id> <panel_db_copy>"
    [[ "$db_copy" == "$STAGING_DIR"/* && "$db_copy" != *..* ]] || die "panel DB copy must live in $STAGING_DIR"

    local passphrase=""
    if [ ! -t 0 ]; then
        IFS= read -r passphrase || true
    fi

    local work
    work=$(root_workdir "build-$id")
    trap "rm -rf '$work'" EXIT
    local meta="$work/sada-mia"
    mkdir -p "$meta/panel" "$meta/postgres"

    log "Collecting panel state"
    # Read the DB copy with www-data's permissions: the staging dir is writable by www-data,
    # so following a planted symlink as root would leak arbitrary files into the archive.
    as_www cat -- "$db_copy" > "$meta/panel/database.sqlite" || die "cannot read panel DB copy"
    cp -p "$PANEL_DIR/backend/.env" "$meta/panel/backend.env"
    [ -f "$PANEL_DIR/.env" ] && cp -p "$PANEL_DIR/.env" "$meta/panel/root.env"
    if [ -d "$PANEL_DIR/backend/storage/app/public" ]; then
        tar -C "$PANEL_DIR/backend/storage/app" -cf "$meta/panel/storage-public.tar" public
    fi
    crontab -u www-data -l > "$meta/www-data.crontab" 2>/dev/null || true

    # Refresh dump.pm2 only when PM2 is actually running apps - saving an empty list
    # (e.g. after a reboot without resurrect) would wipe the last good dump
    local pm2_count
    pm2_count=$(pm2_www jlist 2>/dev/null \
        | php -r '$l = json_decode(stream_get_contents(STDIN), true); echo is_array($l) ? count($l) : 0;' || echo 0)
    if [ "${pm2_count:-0}" -gt 0 ]; then
        log "Saving PM2 process list ($pm2_count processes)"
        pm2_www save --force >/dev/null 2>&1 || warn "pm2 save failed - using the existing dump.pm2"
    else
        warn "PM2 has no running processes - keeping the existing dump.pm2"
    fi

    log "Dumping PostgreSQL roles"
    as_postgres pg_dumpall --globals-only > "$meta/postgres/globals.sql"
    : > "$meta/postgres/databases.txt"
    local db
    while IFS= read -r db <&3; do
        [ -n "$db" ] || continue
        if [[ ! "$db" =~ ^[A-Za-z0-9_.-]+$ ]]; then
            warn "skipping database with unsupported name: $db"
            continue
        fi
        log "Dumping PostgreSQL database: $db"
        # --create also records database-level GRANT/REVOKE and settings (ALTER DATABASE ... SET)
        as_postgres pg_dump -Fc --create "$db" > "$meta/postgres/$db.dump"
        echo "$db" >> "$meta/postgres/databases.txt"
    done 3< <(as_postgres psql -At -c \
        "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname")

    local paths=() p
    for p in "${ROOTFS_PATHS[@]}"; do
        [ -e "/$p" ] && paths+=("$p")
    done
    : > "$meta/svc-enabled.txt"
    for p in /etc/systemd/system/svc-*.service; do
        [ -e "$p" ] || continue
        paths+=("${p#/}")
        systemctl is-enabled --quiet "$(basename "$p")" 2>/dev/null && basename "$p" >> "$meta/svc-enabled.txt"
    done
    printf '%s\n' "${paths[@]}" > "$meta/paths.txt"

    local encrypted=0
    [ -n "$passphrase" ] && encrypted=1
    write_manifest "$id" "$encrypted" "$meta/manifest.json"

    local host name
    host=$(hostname -s 2>/dev/null || echo server)
    name="sada-mia-${host}-$(date -u +%Y%m%d-%H%M%S)-${id}.tar.gz"
    [ "$encrypted" -eq 1 ] && name="$name.enc"
    local partial="$work/$name"

    local compress=(-z)
    command -v pigz >/dev/null 2>&1 && compress=(--use-compress-program=pigz)

    log "Creating archive $name (this can take a while)"
    local tar_rc enc_rc=0
    set +e
    if [ "$encrypted" -eq 1 ]; then
        tar "${compress[@]}" --warning=no-file-changed --ignore-failed-read -cpf - \
                -C "$work" sada-mia -C / "${paths[@]}" \
            | SADA_MIA_PASS="$passphrase" openssl enc -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" -salt \
                -pass env:SADA_MIA_PASS -out "$partial"
        local pipe_status=("${PIPESTATUS[@]}")
        tar_rc=${pipe_status[0]}; enc_rc=${pipe_status[1]}
    else
        tar "${compress[@]}" --warning=no-file-changed --ignore-failed-read -cpf "$partial" \
            -C "$work" sada-mia -C / "${paths[@]}"
        tar_rc=$?
    fi
    set -e

    # tar exits 1 when live files (logs, mail) changed while being read - the archive is still valid
    if [ "$tar_rc" -gt 1 ] || [ "$enc_rc" -ne 0 ]; then
        die "archive creation failed (tar=$tar_rc, openssl=$enc_rc)"
    fi

    local sha size
    sha=$(sha256sum "$partial" | awk '{print $1}')
    size=$(stat -c %s "$partial")
    chown www-data:www-data "$partial"
    chmod 640 "$partial"
    mkdir -p "$BACKUP_DIR"
    # rename(2) replaces a planted symlink instead of writing through it; -T refuses a planted directory
    mv -T "$partial" "$BACKUP_DIR/$name"

    log "Archive ready: $BACKUP_DIR/$name"
    echo "RESULT_FILE=$BACKUP_DIR/$name"
    echo "RESULT_SIZE=$size"
    echo "RESULT_SHA256=$sha"
}

# ── reip ─────────────────────────────────────────────────────────────────────

do_reip() {
    local old="$1" new="$2"
    [ -n "$old" ] && [ -n "$new" ] || die "could not determine old/new IP (pass --old and --new)"
    valid_ipv4 "$new" || die "invalid new IP: $new"
    if [ "$old" = "$new" ]; then
        log "Server IP unchanged ($new) - nothing to rewrite"
        return 0
    fi

    log "Rewriting server IP $old -> $new"
    local re="${old//./\\.}"
    local expr="s/(^|[^0-9.])${re}([^0-9]|\$)/\\1${new}\\2/g"

    local f
    for f in "$PANEL_DIR/backend/.env" "$PANEL_DIR/.env"; do
        [ -f "$f" ] && sed -i -E "$expr" "$f"
    done
    # grep exits 1 when nothing matches, which pipefail would turn into a fatal error
    { grep -rlE "$re" /etc/nginx/sites-available 2>/dev/null || true; } | xargs -r sed -i -E "$expr"

    # Panel DB (server_ip setting, DNS records) + regenerate BIND zones with a fresh serial
    artisan optimize:clear >/dev/null || true
    artisan app:reip "$old" "$new" || warn "panel IP rewrite failed - re-run: sudo sada-mia-backup reip --old $old --new $new"
}

cmd_reip() {
    require_root
    local old="" new=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --old) old="$2"; shift 2 ;;
            --new) new="$2"; shift 2 ;;
            *) die "unknown option: $1" ;;
        esac
    done
    [ -n "$old" ] || old=$(env_get "$PANEL_DIR/backend/.env" SERVER_IP)
    [ -n "$new" ] || new=$(detect_public_ip)
    do_reip "$old" "$new"
    restart_services
}

# ── restore ──────────────────────────────────────────────────────────────────

RESTORE_ARCHIVE=""
RESTORE_PASS=""

archive_stream() {
    if [ -n "$RESTORE_PASS" ]; then
        SADA_MIA_PASS="$RESTORE_PASS" openssl enc -d -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" \
            -pass env:SADA_MIA_PASS -in "$RESTORE_ARCHIVE"
    else
        cat "$RESTORE_ARCHIVE"
    fi
}

# Only known panel paths may be extracted - an archive can never write elsewhere on the system
allowed_member() {
    local p="$1" allowed
    [[ "$p" =~ $SVC_UNIT_RE ]] && return 0
    for allowed in "${ROOTFS_PATHS[@]}"; do
        [ "$p" = "$allowed" ] && return 0
    done
    return 1
}

cmd_restore() {
    require_root
    local src="" new_ip="" pass_file="" expected_sha="" assume_yes=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --new-ip) new_ip="$2"; shift 2 ;;
            --passphrase-file) pass_file="$2"; shift 2 ;;
            --sha256) expected_sha="$2"; shift 2 ;;
            --yes|-y) assume_yes=true; shift ;;
            -*) die "unknown option: $1" ;;
            *) src="$1"; shift ;;
        esac
    done
    [ -n "$src" ] || die "usage: sada-mia-backup restore <archive> [--new-ip IP] [--sha256 HASH] [--passphrase-file FILE] [--yes]"
    [ -f "$PANEL_DIR/backend/artisan" ] || die "panel not found at $PANEL_DIR - run install.sh first"
    RESTORE_ARCHIVE="$src"
    [ -f "$RESTORE_ARCHIVE" ] || die "archive not found: $RESTORE_ARCHIVE"

    if [ -n "$expected_sha" ]; then
        log "Verifying checksum"
        [ "$(sha256sum "$RESTORE_ARCHIVE" | awk '{print $1}')" = "$expected_sha" ] \
            || die "checksum mismatch - archive is corrupt or incomplete"
    fi

    if head -c 8 "$RESTORE_ARCHIVE" | LC_ALL=C grep -aq '^Salted__'; then
        if [ -n "$pass_file" ]; then
            RESTORE_PASS=$(<"$pass_file")
        else
            read -rsp "Archive passphrase: " RESTORE_PASS
            echo
        fi
        [ -n "$RESTORE_PASS" ] || die "this archive is encrypted - a passphrase is required"
    fi

    local work
    work=$(root_workdir restore)
    trap "rm -rf '$work'" EXIT

    log "Reading archive metadata"
    archive_stream | tar -xzf - -C "$work" sada-mia || die "could not read archive (wrong key or corrupt file?)"
    local meta="$work/sada-mia"
    local mf="$meta/manifest.json"
    [ -f "$mf" ] || die "not a Sada Mia migration archive"
    [ -f "$meta/paths.txt" ] || die "archive was made by an older panel version - update the source panel and retry"

    local members=() p
    while IFS= read -r p; do
        [ -n "$p" ] || continue
        if allowed_member "$p"; then
            members+=("$p")
        else
            warn "ignoring unexpected path in archive: $p"
        fi
    done < "$meta/paths.txt"

    local old_ip old_panel_dir src_commit cur_commit
    old_ip=$(manifest_get "$mf" source_ip)
    old_panel_dir=$(manifest_get "$mf" panel_dir)
    src_commit=$(manifest_get "$mf" panel_commit)
    cur_commit=$(git -c safe.directory='*' -C "$PANEL_DIR" rev-parse HEAD 2>/dev/null || true)
    [ -n "$new_ip" ] || new_ip=$(detect_public_ip)
    [ -n "$new_ip" ] || die "could not detect this server's public IP - pass --new-ip"

    echo
    echo "  Source host:    $(manifest_get "$mf" hostname)"
    echo "  Created at:     $(manifest_get "$mf" created_at)"
    echo "  Server IP:      ${old_ip:-unknown} -> $new_ip"
    echo "  Panel commit:   ${src_commit:-unknown} (this server: ${cur_commit:-unknown})"
    echo
    if [ -n "$src_commit" ] && [ -n "$cur_commit" ] && [ "$src_commit" != "$cur_commit" ]; then
        warn "panel versions differ - pending migrations will be applied after the restore"
    fi
    if ! $assume_yes; then
        local answer
        read -rp "This OVERWRITES apps, databases, DNS, mail and panel data on this server. Continue? [y/N] " answer
        [[ "$answer" =~ ^[Yy]$ ]] || die "aborted"
    fi

    log "Stopping panel services"
    systemctl stop sada-mia-queue 2>/dev/null || true
    local unit
    for unit in /etc/systemd/system/svc-*.service; do
        [ -e "$unit" ] && systemctl stop "$(basename "$unit")" 2>/dev/null || true
    done
    pm2_www kill >/dev/null 2>&1 || true

    # ── Panel ──
    log "Restoring panel database and configuration"
    local benv="$PANEL_DIR/backend/.env" k
    # Keep this server's addressing; take everything else (APP_KEY, secrets) from the source
    local -A keep=()
    for k in APP_URL FRONTEND_URL SANCTUM_STATEFUL_DOMAINS SESSION_DOMAIN SERVER_IP DB_DATABASE APP_ENV DB_QUEUE_RETRY_AFTER; do
        grep -qE "^$k=" "$benv" && keep[$k]=$(env_get "$benv" "$k")
    done
    install -o www-data -g www-data -m 664 "$meta/panel/backend.env" "$benv"
    for k in "${!keep[@]}"; do
        env_set "$benv" "$k" "${keep[$k]}"
    done

    local sqlite="$PANEL_DIR/backend/database/database.sqlite"
    rm -f "$sqlite-wal" "$sqlite-shm" "$sqlite-journal"
    install -o www-data -g www-data -m 664 "$meta/panel/database.sqlite" "$sqlite"
    if [ -f "$meta/panel/storage-public.tar" ]; then
        tar -C "$PANEL_DIR/backend/storage/app" -xpf "$meta/panel/storage-public.tar"
        chown -R www-data:www-data "$PANEL_DIR/backend/storage/app/public"
    fi
    artisan migrate --force
    artisan optimize:clear >/dev/null

    # ── PostgreSQL ──
    log "Restoring PostgreSQL roles"
    # postgres and roundcube belong to this server's install (roundcube's password lives in its config)
    grep -vE '^(CREATE|ALTER) ROLE "?(postgres|roundcube)"?( |;)' "$meta/postgres/globals.sql" > "$work/globals.sql" || true
    as_postgres psql -q -v ON_ERROR_STOP=0 < "$work/globals.sql" >/dev/null 2>&1 || true

    local db
    while IFS= read -r db <&3; do
        [ -n "$db" ] || continue
        [[ "$db" =~ ^[A-Za-z0-9_.-]+$ ]] || { warn "skipping database with unsupported name: $db"; continue; }
        log "Restoring PostgreSQL database: $db"
        as_postgres psql -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
        as_postgres dropdb --if-exists "$db"
        as_postgres pg_restore --create -d postgres < "$meta/postgres/$db.dump" \
            || warn "pg_restore reported errors for $db - check the database contents"
    done 3< "$meta/postgres/databases.txt"

    # ── Files ──
    log "Restoring apps, web server, certificates, DNS and mail"
    if [ "${#members[@]}" -gt 0 ]; then
        archive_stream | tar -xzpf - -C / --anchored "${RESTORE_EXCLUDES[@]}" -- "${members[@]}" \
            || die "file restore failed"
    fi

    if [ -n "$old_panel_dir" ] && [ "$old_panel_dir" != "$PANEL_DIR" ]; then
        log "Rewriting panel path $old_panel_dir -> $PANEL_DIR"
        { grep -rlF "$old_panel_dir" /etc/nginx/sites-available /etc/systemd/system/svc-*.service 2>/dev/null || true; } \
            | xargs -r sed -i "s|$old_panel_dir|$PANEL_DIR|g"
    fi

    if [ -s "$meta/www-data.crontab" ]; then
        log "Restoring cron jobs"
        if [ -n "$old_panel_dir" ]; then
            sed "s|$old_panel_dir|$PANEL_DIR|g" "$meta/www-data.crontab" | crontab -u www-data -
        else
            crontab -u www-data "$meta/www-data.crontab"
        fi
    fi

    local map
    for map in virtual_mailbox_domains virtual_mailbox_maps virtual_alias_maps; do
        [ -f "/etc/postfix/$map" ] && postmap "/etc/postfix/$map"
    done
    [ -d /var/mail/vhosts ] && chown -R vmail:vmail /var/mail/vhosts
    [ -d /etc/opendkim ] && chown -R opendkim:opendkim /etc/opendkim

    # ── PHP runtimes used by restored apps ──
    local v updated=false
    for v in $(manifest_get "$mf" php_versions); do
        [[ "$v" =~ ^[0-9]+\.[0-9]+$ ]] || continue
        [ -d "/etc/php/$v" ] && continue
        log "Installing PHP $v (used by restored apps)"
        $updated || { apt-get update -qq; updated=true; }
        apt-get install -y -qq "php$v-fpm" "php$v-cli" "php$v-pgsql" "php$v-mysql" "php$v-curl" "php$v-gd" \
            "php$v-mbstring" "php$v-xml" "php$v-zip" "php$v-bcmath" "php$v-intl" \
            || warn "could not install PHP $v"
    done

    # ── Background services and PM2 ──
    log "Starting background services"
    systemctl daemon-reload
    if [ -f "$meta/svc-enabled.txt" ]; then
        while IFS= read -r unit <&3; do
            [ -n "$unit" ] || continue
            [[ "etc/systemd/system/$unit" =~ $SVC_UNIT_RE ]] || continue
            systemctl enable --now "$unit" || warn "could not start $unit"
        done 3< "$meta/svc-enabled.txt"
    fi

    log "Resurrecting PM2 processes"
    if [ -f "$PM2_HOME_DIR/dump.pm2" ]; then
        chown www-data:www-data "$PM2_HOME_DIR/dump.pm2"
        pm2_www resurrect >/dev/null 2>&1 || warn "pm2 resurrect failed - start apps from the panel"
        pm2_www save --force >/dev/null 2>&1 || true
    fi

    do_reip "$old_ip" "$new_ip"
    restart_services

    cat <<EOF

===================================================
  Restore complete.

  Next steps:
   1. Point DNS at $new_ip: update A records / nameserver glue (ns1-ns4)
      at your registrar for every domain this server hosts.
   2. Open the firewall for this server (80, 443, 25, 465, 587, 993,
      53/tcp+udp and the panel port).
   3. If the panel itself had SSL, re-run: php artisan app:panel-ssl <domain>
   4. Keep the old server running until everything is verified.
===================================================
EOF
}

# ── restore-start / restore-run (panel-driven restore) ───────────────────────

write_status() {
    local state="$1" message="${2:-}"
    STATUS_STATE="$state" STATUS_MESSAGE="$message" php -r '
        echo json_encode([
            "state" => getenv("STATUS_STATE"),
            "message" => getenv("STATUS_MESSAGE"),
            "updated_at" => gmdate("c"),
        ]), PHP_EOL;' > "$STATUS_DIR/status.json.tmp"
    chmod 640 "$STATUS_DIR/status.json.tmp"
    chown root:www-data "$STATUS_DIR/status.json.tmp"
    mv -f "$STATUS_DIR/status.json.tmp" "$STATUS_DIR/status.json"
}

cmd_restore_start() {
    require_root
    local name="${1:-}" new_ip="${2:-}"
    [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz(\.enc)?$ ]] || die "invalid archive name"
    valid_ipv4 "$new_ip" || die "invalid IP: $new_ip"
    [ -f "$MIGRATION_DIR/$name" ] || die "archive not found: $MIGRATION_DIR/$name"
    if systemctl is-active --quiet "$RESTORE_UNIT"; then
        die "a restore is already running"
    fi

    root_workdir probe >/dev/null && rm -rf "$WORK_ROOT"/probe.*
    mkdir -p "$STATUS_DIR"
    chown root:www-data "$STATUS_DIR"
    chmod 750 "$STATUS_DIR"

    local passphrase=""
    if [ ! -t 0 ]; then
        IFS= read -r passphrase || true
    fi
    (umask 077 && printf '%s' "$passphrase" > "$PASS_FILE")

    : > "$STATUS_DIR/restore.log"
    chown root:www-data "$STATUS_DIR/restore.log"
    chmod 640 "$STATUS_DIR/restore.log"
    write_status starting

    systemctl reset-failed "$RESTORE_UNIT" >/dev/null 2>&1 || true
    # A separate unit survives the panel's own php-fpm and queue worker being restarted mid-restore
    systemd-run --unit="$RESTORE_UNIT" --collect --quiet \
        /bin/bash "$(readlink -f "$0")" restore-run "$MIGRATION_DIR/$name" "$new_ip"
    echo "RESTORE_STARTED"
}

cmd_restore_run() {
    require_root
    local archive="$1" new_ip="$2"
    exec >>"$STATUS_DIR/restore.log" 2>&1
    write_status running

    # Give the queue job that launched us a moment to finish before its worker is stopped
    sleep 3

    if ( cmd_restore "$archive" --new-ip "$new_ip" --passphrase-file "$PASS_FILE" --yes ); then
        write_status completed
        rm -f "$archive"
    else
        write_status failed "The restore stopped - see the log above"
    fi
    rm -f "$PASS_FILE"
}

# ── main ─────────────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage:
  sada-mia-backup create        <export_id> <panel_db_copy>     (used by the panel)
  sada-mia-backup restore-start <archive_name> <new_ip>         (used by the panel)
  sada-mia-backup restore       <archive> [--new-ip IP] [--sha256 HASH] [--passphrase-file FILE] [--yes]
  sada-mia-backup reip          [--old IP] [--new IP]
EOF
}

case "${1:-}" in
    create)        shift; cmd_create "$@" ;;
    restore-start) shift; cmd_restore_start "$@" ;;
    restore-run)   shift; cmd_restore_run "$@" ;;
    restore)       shift; cmd_restore "$@" ;;
    reip)          shift; cmd_reip "$@" ;;
    *)             usage; exit 1 ;;
esac
