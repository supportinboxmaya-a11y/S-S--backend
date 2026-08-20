#!/bin/bash
# Loops Restore Script
# Restores MariaDB database and Redis data from backups

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups}"

# Database credentials from environment
DB_HOST="${DB_HOST:-mysqldb}"
DB_DATABASE="${DB_DATABASE:-loops_server}"
DB_USERNAME="${DB_USERNAME:-loops_admin}"
DB_PASSWORD="${DB_PASSWORD}"

REDIS_HOST="${REDIS_HOST:-redis}"
REDIS_PASSWORD="${REDIS_PASSWORD}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

list_backups() {
    echo "Available MySQL backups:"
    ls -lh "${BACKUP_DIR}/mysql/loops_*.sql.gz" 2>/dev/null || echo "  None found"
    echo ""
    echo "Available Redis backups:"
    ls -lh "${BACKUP_DIR}/redis/loops_*.rdb.gz" 2>/dev/null || echo "  None found"
}

restore_mysql() {
    local backup_file="$1"
    
    if [[ ! -f "${backup_file}" ]]; then
        log "ERROR: Backup file not found: ${backup_file}"
        return 1
    fi
    
    log "Restoring MariaDB from ${backup_file}..."
    
    # Drop and recreate database
    mysql \
        --host="${DB_HOST}" \
        --user="${DB_USERNAME}" \
        --password="${DB_PASSWORD}" \
        -e "DROP DATABASE IF EXISTS \`${DB_DATABASE}\`; CREATE DATABASE \`${DB_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    
    # Restore from backup
    if gunzip -c "${backup_file}" | mysql \
        --host="${DB_HOST}" \
        --user="${DB_USERNAME}" \
        --password="${DB_PASSWORD}" \
        "${DB_DATABASE}"; then
        log "MariaDB restore completed"
    else
        log "ERROR: MariaDB restore failed"
        return 1
    fi
}

restore_redis() {
    local backup_file="$1"
    
    if [[ ! -f "${backup_file}" ]]; then
        log "ERROR: Backup file not found: ${backup_file}"
        return 1
    fi
    
    log "Restoring Redis from ${backup_file}..."
    
    # Stop Redis writes temporarily
    redis-cli -h "${REDIS_HOST}" -a "${REDIS_PASSWORD}" CONFIG SET stop-writes-on-bgsave-error no
    
    # Copy backup to Redis container
    if docker cp "${backup_file}" loops-redis:/data/dump.rdb; then
        # Restart Redis to load the dump
        docker restart loops-redis
        sleep 5
        log "Redis restore completed"
    else
        log "ERROR: Failed to copy Redis dump"
        return 1
    fi
}

# Main
main() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: $0 [list|mysql <backup_file>|redis <backup_file>|all <mysql_backup> <redis_backup>]"
        list_backups
        exit 1
    fi
    
    case "$1" in
        list)
            list_backups
            ;;
        mysql)
            restore_mysql "$2"
            ;;
        redis)
            restore_redis "$2"
            ;;
        all)
            restore_mysql "$2"
            restore_redis "$3"
            ;;
        *)
            echo "Unknown command: $1"
            exit 1
            ;;
    esac
}

main "$@"