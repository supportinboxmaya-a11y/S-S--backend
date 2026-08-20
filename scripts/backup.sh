#!/bin/bash
# Loops Backup Script
# Backs up MariaDB database and Redis data

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Database credentials from environment
DB_HOST="${DB_HOST:-mysqldb}"
DB_DATABASE="${DB_DATABASE:-loops_server}"
DB_USERNAME="${DB_USERNAME:-loops_admin}"
DB_PASSWORD="${DB_PASSWORD}"

REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PASSWORD="${REDIS_PASSWORD}"

# Create backup directory
mkdir -p "${BACKUP_DIR}/mysql"
mkdir -p "${BACKUP_DIR}/redis"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Backup MariaDB
backup_mysql() {
    log "Starting MariaDB backup..."
    local backup_file="${BACKUP_DIR}/mysql/loops_${DATE}.sql.gz"
    
    if mysqldump \
        --host="${DB_HOST}" \
        --user="${DB_USERNAME}" \
        --password="${DB_PASSWORD}" \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        "${DB_DATABASE}" | gzip > "${backup_file}"; then
        log "MariaDB backup completed: ${backup_file}"
        echo "${backup_file}"
    else
        log "ERROR: MariaDB backup failed"
        return 1
    fi
}

# Backup Redis
backup_redis() {
    log "Starting Redis backup..."
    local backup_file="${BACKUP_DIR}/redis/loops_${DATE}.rdb"
    
    # Trigger BGSAVE and copy the dump file
    if redis-cli -h "${REDIS_HOST}" -a "${REDIS_PASSWORD}" BGSAVE; then
        # Wait for background save to complete
        while [ "$(redis-cli -h "${REDIS_HOST}" -a "${REDIS_PASSWORD}" LASTSAVE)" -eq "$(redis-cli -h "${REDIS_HOST}" -a "${REDIS_PASSWORD}" LASTSAVE)" ]; do
            sleep 1
        done
        
        # Copy the dump file
        if docker cp loops-redis:/data/dump.rdb "${backup_file}"; then
            gzip "${backup_file}"
            log "Redis backup completed: ${backup_file}.gz"
            echo "${backup_file}.gz"
        else
            log "ERROR: Failed to copy Redis dump"
            return 1
        fi
    else
        log "ERROR: Redis BGSAVE failed"
        return 1
    fi
}

# Clean old backups
cleanup_old_backups() {
    log "Cleaning up backups older than ${RETENTION_DAYS} days..."
    find "${BACKUP_DIR}/mysql" -name "loops_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
    find "${BACKUP_DIR}/redis" -name "loops_*.rdb.gz" -mtime +${RETENTION_DAYS} -delete
    log "Cleanup completed"
}

# Main
main() {
    log "=== Loops Backup Started ==="
    
    backup_mysql
    backup_redis
    cleanup_old_backups
    
    log "=== Loops Backup Completed ==="
}

main "$@"