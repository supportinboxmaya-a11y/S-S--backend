# SUR-N-SWAG Installation Guide

SUR-N-SWAG is a TikTok-like video sharing platform (with [ActivityPub](https://activitypub.rocks) federation) built with Laravel. This guide covers installation, configuration, and deployment.

## System Requirements

### Minimum Versions

- **PHP**: 8.3+
- **MySQL**: 8.0+
- **Redis**: 6.0+
- **FFmpeg**: 4.5+ (8.0+ recommended)
- **Node.js**: 20+
- **Composer**: 2.0+

### PHP Extensions Required

- BCMath
- Ctype
- Fileinfo
- JSON
- Intl
- Mbstring
- OpenSSL
- PDO
- Tokenizer
- XML
- GD or Imagick
- Redis

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/joinloops/loops-server.git
cd loops-server
```

### 2. Install PHP Dependencies

```bash
composer install --no-dev --optimize-autoloader
```

### 3. Install Node Dependencies

```bash
npm install
npm run build
```

### 4. Environment Configuration

Copy the environment file and configure:

```bash
cp .env.example .env
```

Generate application key:

```bash
php artisan key:generate
```

Link storage directory:

```bash
php artisan storage:link
```

### 5. Configure Environment Variables

Edit `.env` file with your settings:

```env
# Application
APP_NAME="SUR-N-SWAG"
APP_ENV=production
APP_KEY=
APP_DEBUG=false
APP_URL=https://your-domain.com

# Database
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=loops
DB_USERNAME=loops_user
DB_PASSWORD=your_secure_password

# Redis
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379
REDIS_DB=0

# Cache & Sessions
CACHE_DRIVER=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis

# Mail Configuration (choose one)
MAIL_MAILER=smtp
MAIL_HOST=smtp.mailtrap.io
MAIL_PORT=2525
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
MAIL_FROM_ADDRESS="hello@example.com"
MAIL_FROM_NAME="${APP_NAME}"

# Storage
# SUR-N-SWAG uses S3-compatible storage by default. To use S3, uncomment and fill
# in the values below. To run on local disk instead, leave them commented and
# see "Using Local Storage Instead of S3" below.
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_DEFAULT_REGION=us-east-1
# AWS_BUCKET=
# AWS_USE_PATH_STYLE_ENDPOINT=false
# AWS_URL=

# Video Processing
FFMPEG_BINARIES=/usr/bin/ffmpeg
FFPROBE_BINARIES=/usr/bin/ffprobe
```

## Using Local Storage Instead of S3

> [!NOTE]
> By default SUR-N-SWAG stores avatars and videos on S3-compatible storage. If you'd rather keep everything on your server's local disk, the steps below switch storage over with a single config change — no code modifications required.

SUR-N-SWAG resolves its media disk by the name `s3`. Avatars, videos, and thumbnails are all read and written through `Storage::disk('s3')` and the FFmpeg processing pipeline. Because Laravel disks are just named configuration entries, you can repoint that name at the `local` driver and every storage call will use your server's filesystem instead of an S3 bucket.

### 1. Redefine the `s3` Disk

Open `config/filesystems.php` and replace the `s3` disk definition with a local one:

```php
's3' => [
    'driver' => 'local',
    'root' => storage_path('app/public'),
    'url' => env('APP_URL').'/storage',
    'visibility' => 'public',
    'throw' => false,
],
```

The disk keeps the name `s3`, but now stores files under `storage/app/public` and serves them from `APP_URL/storage`. Any `AWS_*` values in your `.env` are simply ignored.

### 2. Confirm the Storage Symlink

You already ran this in step 4 of installation, but if not:

```bash
php artisan storage:link
```

This symlinks `public/storage` to `storage/app/public` so uploaded media is reachable over HTTP.

### 3. Rebuild Cached Config

If you've cached your configuration (as recommended for production), rebuild it so the change takes effect:

```bash
php artisan config:clear
php artisan config:cache
```

### Caveats

- **Disk space:** All avatars and videos now live on your server's disk. Make sure the volume backing `storage/` has room for your expected media, and keep an eye on it as your instance grows.
- **The disk is still named `s3`:** This is cosmetic. The name is only an identifier, so everything works — it just looks unusual in your config.
- **Serving:** Files are served directly by your web server from `APP_URL/storage` rather than streamed through PHP. The Nginx and Apache examples in this guide already expose the `storage` symlink.
- **Permissions:** Ensure `storage/` is writable by your web and queue user (see [File Permissions](#file-permissions)).
- **Custom URLs:** This relies on media URLs being generated through `Storage::disk('s3')->url()`. If you've customized anything to build URLs directly from `AWS_URL`, those spots won't pick up the local path.

This approach works reliably today. A dedicated media-disk environment variable is planned to make the choice between local and S3 storage more explicit down the line.

## Database Setup

### 1. Create Database

```sql
CREATE DATABASE loops CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'loops_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON loops.* TO 'loops_user'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Run Migrations

```bash
php artisan migrate
```

### 3. Create Admin Account

Since registration is disabled by default, create your first admin account:

```bash
php artisan create-admin-account
```

Follow the prompts to set up your admin credentials.

### 4. Generate Passport Keys

```bash
php artisan passport:keys
```

## Queue Configuration

SUR-N-SWAG uses Redis-backed queues with Horizon for queue management.

### 1. Publish Horizon Configuration

```bash
php artisan vendor:publish --provider="Laravel\Horizon\HorizonServiceProvider"
```

### 2. Configure Horizon

Edit `config/horizon.php` as needed for your environment.

### 3. Start Horizon

```bash
php artisan horizon
```

For production, use a process manager like Supervisor (make sure you replace the paths and user accordingly):

```ini
[program:loops-horizon]
process_name=%(program_name)s_%(process_num)02d
command=php /var/www/loops/artisan horizon
autostart=true
autorestart=true
user=www
redirect_stderr=true
stdout_logfile=/var/www/loops/storage/logs/horizon.log
stopwaitsecs=3600
```

## Mail Configuration

SUR-N-SWAG supports multiple mail providers. Configure one of the following:

### SMTP

```env
MAIL_MAILER=smtp
MAIL_HOST=your-smtp-host
MAIL_PORT=587
MAIL_USERNAME=your-username
MAIL_PASSWORD=your-password
MAIL_ENCRYPTION=tls
```

### Mailgun

```env
MAIL_MAILER=mailgun
MAILGUN_DOMAIN=your-domain.com
MAILGUN_SECRET=your-secret-key
```

### Amazon SES

```env
MAIL_MAILER=ses
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_DEFAULT_REGION=us-east-1
```

### Postmark

```env
MAIL_MAILER=postmark
POSTMARK_TOKEN=your-server-token
```

### Resend

```env
MAIL_MAILER=resend
RESEND_KEY=your-api-key
```

## Optional Features

### Captcha Protection

SUR-N-SWAG supports Cloudflare Turnstile and hCaptcha for spam protection.

#### Cloudflare Turnstile

```env
LOOPS_CAPTCHA=true
LOOPS_CAPTCHA_DRIVER=turnstile
TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key
```

#### hCaptcha

```env
LOOPS_CAPTCHA=true
LOOPS_CAPTCHA_DRIVER=hcaptcha
HCAPTCHA_SITE_KEY=your-site-key
HCAPTCHA_SECRET_KEY=your-secret-key
```

### Two-Factor Authentication

2FA is supported. No additional configuration required - users can enable it in their profile settings.

## Web Server Configuration

### Nginx Configuration

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com;
    root /var/www/loops/public;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    index index.php;

    charset utf-8;

    # Handle large video uploads
    client_max_body_size 100M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_hide_header X-Powered-By;
    }
}
```

### Apache Configuration

```apache
<VirtualHost *:80>
    ServerName your-domain.com
    DocumentRoot /var/www/loops/public

    <Directory /var/www/loops/public>
        AllowOverride All
        Require all granted
    </Directory>

    # Handle large video uploads
    LimitRequestBody 104857600

    ErrorLog ${APACHE_LOG_DIR}/loops_error.log
    CustomLog ${APACHE_LOG_DIR}/loops_access.log combined
</VirtualHost>
```

## File Permissions

Set appropriate permissions:

```bash
sudo chown -R www-data:www-data /var/www/loops
sudo chmod -R 755 /var/www/loops
sudo chmod -R 775 /var/www/loops/storage
sudo chmod -R 775 /var/www/loops/bootstrap/cache
```

## Cron Jobs

Add to your crontab:

```bash
# Laravel Scheduler
* * * * * cd /var/www/loops && php artisan schedule:run >> /dev/null 2>&1
```

## Production Optimization

### 1. Optimize Configuration

```bash
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

### 2. Enable OPcache

Add to your PHP configuration:

```ini
opcache.enable=1
opcache.memory_consumption=128
opcache.interned_strings_buffer=8
opcache.max_accelerated_files=4000
opcache.revalidate_freq=2
opcache.fast_shutdown=1
```

### 3. Configure PHP-FPM

Optimize `php-fpm` settings for video processing:

```ini
pm.max_children = 50
pm.start_servers = 10
pm.min_spare_servers = 5
pm.max_spare_servers = 20
pm.max_requests = 1000

# Increase limits for video uploads
upload_max_filesize = 100M
post_max_size = 100M
max_execution_time = 300
memory_limit = 512M
```

## Security Considerations

1. **Disable debug mode** in production (`APP_DEBUG=false`)
2. **Use HTTPS** for all connections
3. **Regularly update** dependencies
4. **Monitor logs** for suspicious activity
5. **Use strong passwords** and enable 2FA
6. **Keep FFmpeg updated** for security patches

## Updates

To update SUR-N-SWAG:

```bash
# Pull latest changes
git pull origin main

# Update dependencies
composer install --no-dev --optimize-autoloader

# Install frontend deps + rebuild frontend
npm ci && npm run build

# Run migrations
php artisan migrate

# Clear caches
php artisan cache:clear
php artisan config:clear
php artisan view:clear

# Rebuild caches
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Restart services
php artisan horizon:terminate
```
