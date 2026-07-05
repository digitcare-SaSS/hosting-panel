# Sada Mia Hosting Panel

A lightweight, self-hosted server management panel designed for Ubuntu Linux. This panel allows you to easily deploy and manage Next.js, Laravel, and Static HTML applications on a single server without using Docker. It provisions apps natively using PM2 for Node.js and PHP-FPM for Laravel.

---

## ✨ What's New (March 28, 2026)

- **Fixed Deployment Lifecycle:** Resolved a critical 500 error when triggering manual deployments by updating the `deployments` schema and ensuring the `deploying` status is correctly handled.
- **Improved Logging:** Fixed a bug in the deployment process where logs were being sent to an incorrect database column.
- **Enhanced Status Accuracy:** Application and deployment statuses are now consistently synchronized between the frontend and backend.

## 🚀 Key Features

### 📦 Application Management

- **Native Deployment:** Apps run directly on the host OS for maximum performance and lowest RAM overhead.
- **Framework Support:** Optimized for **Next.js** (PM2), **Laravel** (PHP 8.4 + FPM), and **Static Sites**.
- **Automated Pipeline:** Automatic Git integration, dependency installation (`npm`/`composer`), build execution, and Nginx reload.
- **Lifecycle Control:** Simplified **Running** and **Stopped** status indicators with full start/stop/restart/deploy controls.
- **Background Workers:** Manage application-specific background services (e.g., Laravel Queue Workers) via systemd.
- **Environment Management:** Web-based `.env` file editor for seamless configuration.
- **Real-time Logs:** Dedicated streaming log viewers for application, Nginx error, and access logs.

### 🌐 Infrastructure & Networking

- **Load Balancing:** Built-in Nginx load balancers with support for **Round Robin**, **Least Connections**, and **IP Hash** algorithms.
- **DNS Management:** Full-featured **BIND9 integration** for managing domains, subdomains, and records (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA).
- **SSL / TLS:** Automated **Certbot (Let's Encrypt)** integration for all apps and load balancers. Supports Force HTTPS and securing the panel itself.
- **Database Management:** One-click **PostgreSQL** database and user provisioning with granular permission and global privilege management.
- **Email Service:** Complete **Postfix/Dovecot** suite for managing email domains, accounts, and aliases directly from the panel.

### 💼 CRM & Monetization

- **Customer CRM:** Comprehensive client tracking for leads and active subscribers with linked resource management.
- **Subscription Engine:** Advanced subscription management with support for **Flat Rate** and **Credit-based** plans.
- **Integrated Payments:** Ready-to-use payment gateway integrations for **bKash**, **Nagad**, and **SSLCommerz**.
- **Metered Billing:** Track and bill usage for specific API routes (**Billable Routes**) with detailed access logs.
- **Client Portal:** A dedicated public portal for customers to manage their own subscriptions and payments.
- **Automatic Gating:** Instant Nginx-level blocking for expired accounts with a professional "Expired Notice" landing page.

### 🛠️ Developer Tools & Security

- **Web Terminal:** Integrated browser-based shell access for quick server commands.
- **File Manager:** Full-featured web interface for file operations (upload, download, rename, chmod, compress/extract).
- **Queue Monitor:** Visual tracking for Laravel queue health, including ready, delayed, and failed job counts.
- **Cron Management:** Easy-to-use UI for managing system-level cron jobs and viewing execution logs.
- **Server Health:** Live dashboard for monitoring CPU, RAM, Disk usage, and active system processes.
- **GitHub Integration:** Seamless OAuth connection with support for **Auto-Deploy on Push** via webhooks.

---

## ⌨️ Artisan CLI Reference

The panel includes several custom Artisan commands for system orchestration and maintenance:

| Command                              | Description                                                                            |
| :----------------------------------- | :------------------------------------------------------------------------------------- |
| `php artisan app:nginx-sync`         | Regenerates Nginx configuration files for all applications using current stubs.        |
| `php artisan app:nginx-ssl-sync`     | Regenerates Nginx SSL configurations for all apps and load balancers.                  |
| `php artisan app:ssl-renew`          | Renews all Let's Encrypt certificates and syncs status (Runs **Daily** via Scheduler). |
| `php artisan app:panel-ssl {domain}` | Secures the hosting panel (port 8083) using an existing domain's certificate.          |
| `php artisan cron:run {id}`          | Force-runs a specific UI-managed cron job and captures its output.                     |

---

## 🛠️ Technology Stack

**Frontend (Admin UI):**

- React 18 (SPA) + Vite
- Tailwind CSS + shadcn/ui
- Lucide React Icons

**Backend (API & Orchestrator):**

- Laravel 11 (PHP 8.4)
- SQLite (Application Metadata)
- Laravel Sanctum (Token Auth)
- Direct shell execution (`proc_open`) for systems orchestration.

**Server Infrastructure:**

- **Web:** Nginx (Proxy/Static)
- **Processes:** PM2 & Systemd
- **Database:** PostgreSQL
- **DNS:** BIND9
- **Email:** Postfix & Dovecot
- **Certificates:** Certbot (Let's Encrypt)

---

## 📥 Installation

The panel comes with a one-click automated bash script designed to be run on a fresh **Ubuntu 22.04 / 24.04** server.

### Prerequisites

- A fresh Ubuntu Server instance.
- Root or `sudo` access via SSH.

### 1. Download the repository

SSH into your server and clone this repository:

```bash
git clone https://github.com/your-username/sada-mia-hosting-panel.git
cd sada-mia-hosting-panel
```

### 2. Configure Environment (Optional)

The installer will automatically generate an `.env` file in the root directory if one doesn't exist. You can pre-create this file to customize the installation behavior:

```env
# panel root .env
APP_ENV=production    # Use "local" to bind to the LAN IP automatically
PANEL_PORT=8083       # Default Nginx port
PANEL_IP=             # Explicit IP to bind to
```

### 3. Run the Installer

Run the installation script. By default, it will auto-detect your server's public IP and run on port `8083`.
_ (If you set `APP_ENV=local` in the `.env` file, it will automatically use your local network IP instead of fetching your public IP)._

```bash
chmod +x install.sh

# Option A: Auto-detect public IP and use default port (8083)
sudo ./install.sh

# Option B: Specify IP, use default port (8083)
sudo ./install.sh 192.168.1.100

# Option C: Specify IP and custom port
sudo ./install.sh 192.168.1.100 8080

# Option D: Run with Data Cleanup (Keeps tools, resets apps/data)
sudo ./install.sh --cleanup
```

### 💡 Data Cleanup Mode

Using the `--cleanup` flag allows you to reset the panel without reinstalling foundational software (PHP, Nginx, etc.).
**What gets cleaned up:**

- All deployed apps in `/var/www/hosting-apps/`
- Nginx site configurations, BIND9 zone files, and Postfix data.
- The panel database (reset to original seeded state).

### 3. Log In

Once finished, go to `http://<YOUR_SERVER_IP>:<YOUR_PORT>` in your browser.

- **Default Email:** `admin@panel.local`
- **Default Password:** `admin`
  _(Change these in the Settings tab immediately after logging in)._

---

## 📁 Storage & Permissions

To ensure logos and other uploads work correctly, especially on remote hosts, make sure the storage directories have the correct permissions:

```bash
# From the project root
sudo chown -R www-data:www-data backend/storage backend/public/storage
sudo chmod -R 775 backend/storage backend/public/storage

# Ensure the logos directory exists and is writable
mkdir -p backend/storage/app/public/logos
sudo chown -R www-data:www-data backend/storage/app/public/logos
sudo chmod -R 775 backend/storage/app/public/logos

# Allow the web server to update the .env (for Panel URL synchronization)
sudo chown www-data:www-data backend/.env
sudo chmod 664 backend/.env
```

> [!TIP]
> If your logo URLs are showing an IP address instead of your domain, update the **Panel URL** in the **Settings -> System Settings** tab. This will automatically synchronize your `.env` file's `APP_URL`.

---

## 🐙 GitHub Integration

1. **OAuth App:** Register a new OAuth app in GitHub Settings with the callback: `http://<IP>:<PORT>/github/callback`.
2. **Setup:** Enter your Client ID, Secret, and a Webhook Secret in the panel's **Settings** tab.
3. **Connect:** Click "Connect GitHub" and you're ready to pick repositories and enable **Auto-Deploy on Push**!

---

## 🛑 Toggling Panel Services (Port Conflicts)

If you are developing other projects on the same machine (using commands like `composer dev`, `npm run dev`, or `php artisan serve`), you might encounter port conflicts (e.g., ports 80, 5432, or 53 already in use). 

You can use the included `panel-service.sh` script to temporarily disable all hosting panel background services (Nginx, PostgreSQL, Redis, Postfix, Bind9, etc.) and free up your system resources.

```bash
# Make the script executable (only needed once)
chmod +x panel-service.sh

# Stop all panel services and free up ports
sudo ./panel-service.sh stop

# Start all panel services when you want to use the panel again
sudo ./panel-service.sh start

# Check the status of all panel services
sudo ./panel-service.sh status
```

---

## 💻 Local Development

```bash
chmod +x start.sh
./start.sh
```

Concurrently boots the **Laravel API** (8000) and **Vite React** (5173) server.
_(Note: System operations like Nginx/PM2 require a native Ubuntu environment)._

### 🔄 Restarting & Stopping Services

If you are using `./start.sh`, simply press `Ctrl+C` in your terminal to stop all background processes (API, Queue, and Frontend).

If any processes get stuck or you need to manually kill then, use the following commands:

```bash
# Kill the Laravel API server
pkill -f "php artisan serve"

# Kill the Queue worker
pkill -f "php artisan queue:work"

# Kill the Vite development server
pkill -f "vite"
```

To restart everything cleanly:

```bash
# One-liner to kill and restart
pkill -f "php artisan" && pkill -f "vite" && ./start.sh
```

---

## 📂 Project Structure

- `/backend/` - Laravel API and Core Orchestration.
- `/frontend/` - React Admin Interface.
- `install.sh` - System Provisioning script.
- `start.sh` - Development boot script.
