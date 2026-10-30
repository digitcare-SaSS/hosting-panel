#!/bin/bash
# Runs install.sh once, on the container's first boot.
set -e

MARKER=/var/lib/sada-mia/installed

if [ -f "$MARKER" ]; then
    echo "==> Sada Mia Panel already installed, skipping first-boot install."
    exit 0
fi

cd /opt/sada-mia-hosting-panel
# Local mode: no TTY is available for `artisan migrate`'s production prompt,
# and Let's Encrypt can't issue certificates for a localhost install anyway.
if [ ! -f .env ]; then
    printf 'APP_ENV=local\nPANEL_PORT=8083\nPANEL_IP=127.0.0.1\n' > .env
fi

./install.sh 127.0.0.1 8083

mkdir -p "$(dirname "$MARKER")"
touch "$MARKER"
