<?php

return [
    'apps_base_path'  => env('APPS_BASE_PATH', '/var/www/hosting-apps'),
    'port_range_start' => (int) env('PORT_RANGE_START', 3000),
    'port_range_end'   => (int) env('PORT_RANGE_END', 9999),
    'php_fpm_sock'     => env('PHP_FPM_SOCK', '/var/run/php/php8.4-fpm.sock'),
    'admin_email'      => env('PANEL_ADMIN_EMAIL', 'admin@panel.local'),
    'admin_password'   => env('PANEL_ADMIN_PASSWORD', 'admin'),
    'terminal_timeout' => (int) env('TERMINAL_TIMEOUT', 300),
    // Must match the directories in scripts/sada-mia-backup.sh
    'backup_path'      => '/var/backups/sada-mia',
    'backup_helper'    => '/usr/local/sbin/sada-mia-backup',
    // Written by the root restore (root:www-data 0750); must match STATUS_DIR in the helper
    'restore_status_path' => '/var/lib/sada-mia/restore',
];
