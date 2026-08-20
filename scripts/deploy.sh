#!/bin/bash
# Loops Deployment Script
# Usage: ./scripts/deploy.sh [environment]

set -euo pipefail

ENVIRONMENT="${1:-production}"
PROJECT_DIR="${PROJECT_DIR:-/opt/loops}"
BACKUP_BEFORE_DEPLOY="${BACKUP_BEFORE_DEPLOY:-true}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

check_requirements() {
    log "Checking requirements..."
    command -v docker >/dev/null 2>&1 || { log "ERROR: docker not found"; exit 1; }
    command -v docker compose >/dev/null 2>&1 || { log "ERROR: docker compose not found"; exit 1; }
    
    if [[ ! -f ".env" ]]; then
        log "ERROR: .env file not found. Copy .env.docker.example to .env and configure."
        exit 1
    fi
    
    log "Requirements check passed"
}

backup_before_deploy() {
    if [[ "$BACKUP_BEFORE_DEPLOY" == "true" ]]; then
        log "Creating pre-deployment backup..."
        ./scripts/backup.sh
        log "Backup completed"
    fi
}

build_images() {
    log "Building Docker images..."
    docker compose build --pull
    log "Build completed"
}

run_migrations() {
    log "Running database migrations..."
    docker compose exec -T loops php artisan migrate --force
    log "Migrations completed"
}

clear_caches() {
    log "Clearing and rebuilding caches..."
    docker compose exec -T loops php artisan optimize:clear
    docker compose exec -T loops php artisan config:cache
    docker compose exec -T loops php artisan route:cache
    docker compose exec -T loops php artisan view:cache
    log "Caches rebuilt"
}

restart_services() {
    log "Restarting services..."
    docker compose up -d
    log "Services restarted"
}

health_check() {
    log "Performing health check..."
    sleep 10
    
    # Check if containers are running
    if ! docker compose ps | grep -q "Up"; then
        log "ERROR: Some containers are not running"
        docker compose ps
        exit 1
    fi
    
    # Check health endpoint
    if curl -f -s "http://localhost/ping" >/dev/null; then
        log "Health check passed"
    else
        log "WARNING: Health endpoint not responding"
    fi
}

main() {
    log "=== Starting Loops Deployment ($ENVIRONMENT) ==="
    
    check_requirements
    backup_before_deploy
    build_images
    run_migrations
    clear_caches
    restart_services
    health_check
    
    log "=== Deployment Completed Successfully ==="
}

main "$@"