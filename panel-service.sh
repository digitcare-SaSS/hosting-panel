#!/bin/bash

# Script to enable or disable the Sada Mia Hosting Panel and its services.
# This is useful when you want to free up system resources and ports (like 80, 5432, etc.)
# for other local development projects.

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./panel-service.sh [start|stop|status])"
  exit 1
fi

ACTION=$1

if [ "$ACTION" != "start" ] && [ "$ACTION" != "stop" ] && [ "$ACTION" != "status" ]; then
    echo "Usage: sudo ./panel-service.sh [start|stop|status]"
    exit 1
fi

# Note: 'named' is the service name for BIND9
SERVICES=(
    "nginx"
    "php8.4-fpm"
    "postgresql"
    "named"
    "postfix"
    "dovecot"
    "opendkim"
    "sada-mia-queue"
    "redis-server"
)

if [ "$ACTION" == "stop" ]; then
    echo "Stopping Hosting Panel Services..."
    
    # Stop apps managed by systemd
    echo "Stopping user apps (svc-*)..."
    systemctl stop svc-* 2>/dev/null || true
    
    # Stop PM2 processes running as www-data
    if command -v pm2 >/dev/null 2>&1; then
        echo "Stopping PM2 processes for www-data..."
        sudo -u www-data pm2 stop all 2>/dev/null || true
    fi

    # Ensure MySQL root user is accessible for local development
    if command -v mysql >/dev/null 2>&1; then
        echo "Ensuring MySQL root user is accessible for local development..."
        mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY ''; FLUSH PRIVILEGES;" 2>/dev/null || true
    fi

    # Stop core services
    for service in "${SERVICES[@]}"; do
        echo "Stopping $service..."
        systemctl stop "$service" 2>/dev/null || true
    done

    echo "========================================="
    echo "Hosting Panel disabled successfully."
    echo "Ports 80, 5432, 53, 25, 587, 143, etc., should now be free."
    echo "========================================="

elif [ "$ACTION" == "start" ]; then
    echo "Starting Hosting Panel Services..."
    
    # Start core services
    for service in "${SERVICES[@]}"; do
        echo "Starting $service..."
        systemctl start "$service" 2>/dev/null || true
    done

    # Start apps managed by systemd
    echo "Starting user apps (svc-*)..."
    systemctl start svc-* 2>/dev/null || true

    # Start PM2 processes running as www-data
    if command -v pm2 >/dev/null 2>&1; then
        echo "Starting PM2 processes for www-data..."
        sudo -u www-data pm2 start all 2>/dev/null || true
    fi

    echo "========================================="
    echo "Hosting Panel enabled successfully."
    echo "========================================="

elif [ "$ACTION" == "status" ]; then
    echo "Checking Hosting Panel Services Status..."
    echo "-----------------------------------------"
    
    for service in "${SERVICES[@]}"; do
        if systemctl is-active --quiet "$service"; then
            echo -e "[\033[32m RUNNING \033[0m] $service"
        else
            echo -e "[\033[31m STOPPED \033[0m] $service"
        fi
    done
    
    echo "-----------------------------------------"
    echo "User Apps (svc-*):"
    systemctl list-units --type=service --all | grep svc- || echo "  No svc-* apps found."
    
    echo "-----------------------------------------"
    echo "PM2 Apps (www-data):"
    if command -v pm2 >/dev/null 2>&1; then
        sudo -u www-data pm2 ls 2>/dev/null || echo "  No PM2 apps found."
    else
        echo "  PM2 is not installed."
    fi
fi
