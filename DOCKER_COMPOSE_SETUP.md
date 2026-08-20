# SUR-N-SWAG Docker Compose Setup with serversideup/php container

This setup uses `serversideup/php` (FrankenPHP) as the base image and is designed to work behind a reverse proxy like Caddy, Nginx, Traefik, Cloudflare Tunnel, etc for HTTPS termination.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare / CDN                        │
│  (SSL Termination, DDoS Protection, Caching)               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      Caddy (FrankenPHP)                     │
│  (HTTPS, Rate Limiting, Security Headers, WebSocket Proxy) │
└─────────────────────────┬───────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
   ┌──────────┐    ┌──────────────┐  ┌──────────┐
   │ loops    │    │ loops-reverb │  │ loops    │
   │ (API)    │    │ (WebSocket)  │  │ horizon  │
   └──────────┘    └──────────────┘  └──────────┘
         │                │                │
         └────────────────┼────────────────┘
                          ▼
                 ┌─────────────────┐
                 │   MySQL + Redis │
                 └─────────────────┘
```

## Prerequisites

- Docker and Docker Compose v2+
- A reverse proxy (Caddy recommended, or Nginx/Traefik)
- Domain name with DNS pointing to server
- Email provider (SMTP) for sending emails
- S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, etc.)
- (Optional) Cloudflare account for CDN/DDoS protection

## Quick Start

### 1. Clone and prepare permissions
```bash
git clone https://github.com/joinloops/loops-server
cd loops-server
sudo chown -R www-data:www-data storage/ bootstrap/cache/
sudo find storage/ -type d -exec chmod 755 {} \;
sudo find storage/ -type f -exec chmod 644 {} \;
```

### 2. Copy the environment file and generate secure secrets
```bash
cp .env.docker.example .env

# Generate secure passwords
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=\"$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)\"|" .env
sed -i "s|^DB_ROOT_PASSWORD=.*|DB_ROOT_PASSWORD=\"$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)\"|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=\"$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)\"|" .env
```

### 3. Update `.env` with your configuration:
- **APP_KEY**: Generate with https://laravel-encryption-key-generator.vercel.app/
- **APP_URL**: Your full domain (e.g., `https://loops.example.com`)
- **APP_DOMAIN**: Your domain without protocol (e.g., `loops.example.com`)
- **CADDY_EMAIL**: Email for Let's Encrypt certificates
- **CORS_ALLOWED_ORIGINS**: Your frontend domain
- **Mail settings**: SMTP host, port, username, password
- **S3 storage**: AWS keys, bucket, region, endpoint
- **Reverb**: Generate APP_ID, APP_KEY, APP_SECRET with `php artisan reverb:install` (run locally or in container)
- **Health endpoint**: Set `LOOPS_HEALTH_ENDPOINT_SECRET`
- **Music provider**: Configure if using different provider

### 4. Build containers
```bash
docker compose build
```

### 5. Start infrastructure first
```bash
docker compose up -d mysqldb redis
# Wait 30 seconds for database and Redis to be ready
```

### 6. Start application services
```bash
docker compose up -d
docker compose logs -f
```

### 7. Initialize application
```bash
# Seed admin settings
docker compose exec loops php artisan db:seed --class=AdminSettingsSeeder

# Generate Passport keys
docker compose exec loops php artisan passport:keys

# Ensure boot-time environment
docker compose exec loops php artisan app:ensure-boottime

# Create admin user
docker compose exec loops php artisan create-admin-account
```

## Services

| Service | Description | Ports |
|---------|-------------|-------|
| **mysqldb** | MariaDB 10.11+ | 3306 (internal) |
| **redis** | Redis 7+ | 6379 (internal) |
| **loops** | Main API (FrankenPHP) | 80/443 via Caddy |
| **loops-reverb** | WebSocket Server | 8080 (internal) |
| **horizon** | Queue Worker Dashboard | - |
| **scheduler** | Laravel Scheduler | - |

## Production Reverse Proxy: Caddy (Built into FrankenPHP)

The `Caddyfile` is included and configured for:
- Automatic HTTPS via Let's Encrypt (or Cloudflare origin certs)
- HTTP/2 and HTTP/3 support
- Rate limiting (100 req/s API, 10 req/s auth)
- Security headers (HSTS, CSP, X-Frame-Options, etc.)
- WebSocket proxy for Reverb (`/app/*` path)
- 500MB client max body size for video uploads
- 5-minute read/write timeouts for large uploads

### Cloudflare Setup (Recommended)

1. **DNS**: Create A/CNAME record pointing to your server IP
2. **SSL/TLS**: Set to "Full (Strict)" 
3. **Edge Certificates**: Enable "Always Use HTTPS", "Automatic HTTPS Rewrites"
4. **Network**: Enable "HTTP/2", "HTTP/3 (with QUIC)"
5. **Security**: Enable "Bot Fight Mode", configure WAF rules
6. **Caching**: Cache static assets, bypass for API routes

### Nginx Alternative

If using Nginx instead of Caddy, see [Manual Nginx Configuration](#manual-nginx-configuration) below.

## Backup & Restore

### Automated Backups
```bash
# Run backup manually
docker compose exec loops /var/www/html/scripts/backup.sh

# Or run from host
./scripts/backup.sh
```

Backups are stored in `/backups/mysql/` and `/backups/redis/` with 30-day retention (configurable via `BACKUP_RETENTION_DAYS`).

### Restore
```bash
# List available backups
./scripts/restore.sh list

# Restore specific backup
./scripts/restore.sh mysql /backups/mysql/loops_20240820_120000.sql.gz
./scripts/restore.sh redis /backups/redis/loops_20240820_120000.rdb.gz

# Restore both
./scripts/restore.sh all /backups/mysql/loops_...sql.gz /backups/redis/...rdb.gz
```

### Automated via Cron (on host)
```bash
# Add to crontab for daily 2 AM backups
0 2 * * * /path/to/loops-server/scripts/backup.sh >> /var/log/loops-backup.log 2>&1
```

## Health Checks & Monitoring

### Health Endpoints
- **`GET /ping`** - Simple liveness check (returns "pong!")
- **`GET /health?key=<secret>`** - Comprehensive health check (DB, Redis, Disk)

### Enable Health Checks
```bash
# In .env
LOOPS_HEALTH_ENDPOINT_ENABLED=true
LOOPS_HEALTH_ENDPOINT_SECRET="your-secret-key"
```

### Docker Health Checks
All services include health checks:
- **mysqldb**: `mysqladmin ping`
- **redis**: `redis-cli ping`
- **loops-reverb**: `php artisan reverb:status`
- **scheduler**: Custom schedule check

### Logging
- **Format**: JSON (stdout) for production log aggregation
- **Channels**: `daily` (files), `json` (stdout), `stderr`, `admin_security`
- **Levels**: `info` default, `debug` for development
- **Integration**: Compatible with Datadog, Elastic, Loki, CloudWatch

### Metrics (Prometheus)
Add `prometheus/client_php` to scrape metrics from `/metrics` endpoint (if enabled).

## Security Configuration

### Rate Limiting
- **API**: 120 req/min, 3000 req/hr per user
- **Auth endpoints**: 10 req/min
- **Search**: 30 req/min
- **Klipy/GIF**: 15 req/min
- **Music**: 30 req/min
- **Reverb**: Handled by Caddy (100 req/s)

### CORS
Configured via `config/cors.php`:
- Allowed origins: `CORS_ALLOWED_ORIGINS` (comma-separated)
- Credentials: Enabled
- Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS

### Security Headers (via Caddy)
- HSTS with preload
- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- Referrer-Policy: strict-origin-when-cross-origin
- CSP: Restrictive for API endpoints
- Permissions-Policy: Camera, microphone, geolocation disabled

### Video Upload Limits
- Max file size: 100MB (configurable via `LOOPS_MEDIA_MAX_VIDEO_SIZE`)
- Max duration: 180 seconds
- Allowed formats: mp4 (configurable)

## Upgrade Procedure

```bash
# 1. Pull latest changes
git pull

# 2. Build new images
docker compose build --pull

# 3. Run migrations (if any)
docker compose exec loops php artisan migrate --force

# 4. Restart services
docker compose up -d

# 5. Clear caches
docker compose exec loops php artisan optimize:clear
docker compose exec loops php artisan config:cache
docker compose exec loops php artisan route:cache
docker compose exec loops php artisan view:cache
```

## Troubleshooting

### Permission Issues
```bash
sudo find storage/ -type d -exec chmod 755 {} \;
sudo find storage/ -type f -exec chmod 644 {} \;
sudo chown -R www-data:www-data storage/ bootstrap/cache/
```

### Database Connection Issues
```bash
# Check database logs
docker compose logs mysqldb

# Verify connection from app container
docker compose exec loops php artisan tinker --execute="DB::connection()->getPdo();"
```

### WebSocket Not Working
1. Verify Reverb is running: `docker compose logs loops-reverb`
2. Check Caddy WebSocket proxy config in Caddyfile
3. Ensure reverse proxy passes `Upgrade` and `Connection` headers
4. Check firewall allows port 8080 (internal) or 443 (external)

### Video Processing Fails
1. Check FFmpeg is available: `docker compose exec loops ffmpeg -version`
2. Check fpcalc for audio fingerprinting: `docker compose exec loops fpcalc -version`
3. Verify storage permissions and disk space

## Environment Variables Reference

See `.env.docker.example` for complete list. Key production variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_KEY` | Yes | Laravel encryption key |
| `APP_URL` | Yes | Full URL with HTTPS |
| `APP_DOMAIN` | Yes | Domain for Caddy |
| `CADDY_EMAIL` | Yes | Let's Encrypt email |
| `CORS_ALLOWED_ORIGINS` | Yes | Frontend domain(s) |
| `DB_PASSWORD` | Yes | Database password |
| `REDIS_PASSWORD` | Yes | Redis password |
| `MAIL_*` | Yes | SMTP configuration |
| `AWS_*` | Yes | S3 storage config |
| `REVERB_APP_ID/KEY/SECRET` | Yes | WebSocket auth |
| `LOOPS_HEALTH_ENDPOINT_SECRET` | Recommended | Health check auth |

## Music Provider (Audius)

The system integrates with Audius for music/sound search:
- No API key required for basic usage
- Configure via `MUSIC_PROVIDER=audius` in `.env`
- Cached for 1 hour (`MUSIC_CACHE_TTL`)
- Rate limited to 30 req/min per user

## Federation (ActivityPub)

For federation to work:
- Set `FEDERATION_ENABLED=true` in admin settings
- Configure domain in `APP_URL`
- Ensure WebFinger/NodeInfo endpoints accessible
- Authorized Fetch: `FEDERATION_AUTHORIZED_FETCH=true`

## License

AGPL-3.0-only - See LICENSE file for details.