# Sada Mia Hosting Panel - all-in-one container
#
# The panel orchestrates the host OS (systemd units, nginx, PostgreSQL, BIND9,
# Postfix/Dovecot, PM2), so the container runs a full systemd init and the
# stock install.sh is executed on first boot by sada-mia-install.service.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC \
    container=docker

# systemd + base tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
        systemd systemd-sysv dbus sudo ca-certificates curl wget git unzip \
        gnupg software-properties-common openssl acl procps iproute2 \
        sqlite3 libsqlite3-dev cron less nano socat \
    && rm -rf /var/lib/apt/lists/*

# Pre-install the packages install.sh would otherwise fetch on first boot
# (install.sh detects them and skips straight to configuration).
RUN echo "postfix postfix/mailname string panel.local" | debconf-set-selections \
    && echo "postfix postfix/main_mailer_type string 'Internet Site'" | debconf-set-selections \
    && add-apt-repository ppa:ondrej/php -y \
    && apt-get update && apt-get install -y -o Dpkg::Options::="--force-confold" \
        nginx certbot python3-certbot-nginx opendkim opendkim-tools \
        php8.4 php8.4-fpm php8.4-cli php8.4-sqlite3 php8.4-curl php8.4-mbstring \
        php8.4-xml php8.4-zip php8.4-pgsql php8.4-bcmath php8.4-intl php8.4-gd \
        php8.4-readline redis-server \
        postgresql postgresql-contrib \
        bind9 bind9utils bind9-doc \
        postfix postfix-pcre dovecot-core dovecot-imapd dovecot-pop3d \
    && rm -rf /var/lib/apt/lists/*

# Composer, Node.js 20 LTS, PM2
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pm2 \
    && rm -rf /var/lib/apt/lists/*

# Trim systemd units that make no sense inside a container
RUN systemctl mask \
        getty.target console-getty.service systemd-udevd.service \
        systemd-udev-trigger.service systemd-modules-load.service \
        systemd-remount-fs.service sys-kernel-debug.mount \
        sys-kernel-tracing.mount sys-kernel-config.mount \
        systemd-firstboot.service systemd-timesyncd.service

# install.sh gives php8.4-fpm ReadWritePaths= for these; systemd refuses to
# start the unit if any are missing, so create them up front.
RUN mkdir -p /etc/letsencrypt /var/lib/letsencrypt /var/log/letsencrypt /etc/opendkim

# Docker's /etc/hosts maps localhost to ::1 as well, but install.sh's pg_hba
# sed for ::1 never matches, leaving it on scram while passwords are md5.
RUN sed -i -E 's|^(host\s+all\s+all\s+::1/128\s+)scram-sha-256|\1md5|' /etc/postgresql/*/main/pg_hba.conf

# The opendkim.conf written by install.sh sets no PidFile, so don't make
# systemd wait for one.
RUN mkdir -p /etc/systemd/system/opendkim.service.d \
    && printf '[Service]\nPIDFile=\n' > /etc/systemd/system/opendkim.service.d/no-pidfile.conf

COPY . /opt/sada-mia-hosting-panel
COPY docker/firstboot.sh /usr/local/bin/sada-mia-firstboot
COPY docker/sada-mia-install.service /etc/systemd/system/sada-mia-install.service
COPY docker/port-alias.sh /usr/local/bin/sada-mia-port-alias
COPY docker/sada-mia-port-alias.service /etc/systemd/system/sada-mia-port-alias.service
COPY docker/dev-setup.sh /usr/local/bin/sada-mia-dev-setup
COPY docker/sada-mia-dev.service /etc/systemd/system/sada-mia-dev.service

RUN chmod +x /usr/local/bin/sada-mia-firstboot /usr/local/bin/sada-mia-port-alias /usr/local/bin/sada-mia-dev-setup \
        /opt/sada-mia-hosting-panel/*.sh /opt/sada-mia-hosting-panel/scripts/*.sh \
    && systemctl enable sada-mia-install.service sada-mia-port-alias.service sada-mia-dev.service

WORKDIR /opt/sada-mia-hosting-panel

EXPOSE 8083 80 443

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
