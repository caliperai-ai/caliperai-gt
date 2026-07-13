#!/bin/bash
# =============================================================================
# Production Deployment Script for Sensor Fusion Annotation Platform
# =============================================================================
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
COMPOSE_FILE="docker-compose.prod.yml"
GPU_COMPOSE_FILE="docker-compose.prod.gpu.yml"
ENV_FILE=".env"
USE_GPU=false
BUILD_ONLY=false
PULL_IMAGES=false
BACKUP_BEFORE=false

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS] [COMMAND]

Commands:
  up          Start all services (default)
  down        Stop all services
  restart     Restart all services
  build       Build all images
  logs        Show logs
  status      Show service status
  backup      Backup database
  restore     Restore database from backup

Options:
  --gpu           Enable GPU support (SAM2)
  --build         Force rebuild images
  --pull          Pull latest base images
  --backup        Backup database before operation
  --env FILE      Use custom environment file (default: .env)
  -h, --help      Show this help message

Examples:
  ./deploy.sh up                    # Start without GPU
  ./deploy.sh up --gpu              # Start with GPU support
  ./deploy.sh up --gpu --build      # Rebuild and start with GPU
  ./deploy.sh down                  # Stop all services
  ./deploy.sh logs -f backend       # Follow backend logs
  ./deploy.sh backup                # Backup database
EOF
}

check_requirements() {
    log_info "Checking requirements..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose v2."
        exit 1
    fi
    
    # Check .env file
    if [[ ! -f "$PROJECT_ROOT/$ENV_FILE" ]]; then
        log_error "Environment file '$ENV_FILE' not found."
        log_info "Copy .env.production.example to .env and configure it:"
        log_info "  cp .env.production.example .env"
        exit 1
    fi
    
    # Validate required env vars
    source "$PROJECT_ROOT/$ENV_FILE"
    
    if [[ "${POSTGRES_PASSWORD:-}" == "CHANGE_ME_USE_STRONG_PASSWORD" ]]; then
        log_error "POSTGRES_PASSWORD is not configured. Edit .env file."
        exit 1
    fi
    
    if [[ "${SECRET_KEY:-}" == "CHANGE_ME_USE_LONG_RANDOM_STRING" ]]; then
        log_error "SECRET_KEY is not configured. Edit .env file."
        exit 1
    fi
    
    # Check GPU if enabled
    if [[ "$USE_GPU" == true ]]; then
        if ! command -v nvidia-smi &> /dev/null; then
            log_warn "NVIDIA drivers not found. GPU features may not work."
        else
            log_info "GPU detected: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
        fi
        
        if [[ ! -d "$PROJECT_ROOT/models/sam2" ]]; then
            log_error "SAM2 models not found. Run: python scripts/download_sam2_models.py"
            exit 1
        fi
    fi
    
    log_success "All requirements satisfied"
}

check_ssl_certs() {
    source "$PROJECT_ROOT/$ENV_FILE"
    
    local cert_path="${SSL_CERT_PATH:-./certs/fullchain.pem}"
    local key_path="${SSL_KEY_PATH:-./certs/privkey.pem}"
    
    if [[ ! -f "$PROJECT_ROOT/$cert_path" ]] || [[ ! -f "$PROJECT_ROOT/$key_path" ]]; then
        log_warn "SSL certificates not found at $cert_path and $key_path"
        log_info "Creating self-signed certificates for development..."
        
        mkdir -p "$PROJECT_ROOT/certs"
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$PROJECT_ROOT/certs/privkey.pem" \
            -out "$PROJECT_ROOT/certs/fullchain.pem" \
            -subj "/CN=localhost" \
            2>/dev/null
        
        log_warn "Self-signed certificates created. For production, use Let's Encrypt or proper CA."
    fi
}

get_compose_command() {
    local cmd="docker compose -f $PROJECT_ROOT/$COMPOSE_FILE"
    
    if [[ "$USE_GPU" == true ]]; then
        cmd="$cmd -f $PROJECT_ROOT/$GPU_COMPOSE_FILE"
    fi
    
    cmd="$cmd --env-file $PROJECT_ROOT/$ENV_FILE"
    
    echo "$cmd"
}

backup_database() {
    log_info "Backing up database..."
    
    local backup_dir="$PROJECT_ROOT/backups"
    mkdir -p "$backup_dir"
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="$backup_dir/backup_$timestamp.dump"
    
    source "$PROJECT_ROOT/$ENV_FILE"
    
    docker exec anno-postgres pg_dump -U postgres -d annotation_platform -Fc > "$backup_file"
    
    log_success "Database backed up to: $backup_file"
    
    # Keep only last 7 backups
    find "$backup_dir" -name "backup_*.dump" -type f -mtime +7 -delete
}

restore_database() {
    local backup_file="$1"
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi
    
    log_warn "This will overwrite the current database. Continue? (y/N)"
    read -r confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        log_info "Restore cancelled."
        exit 0
    fi
    
    log_info "Restoring database from: $backup_file"
    
    source "$PROJECT_ROOT/$ENV_FILE"
    
    cat "$backup_file" | docker exec -i anno-postgres pg_restore -U postgres -d annotation_platform -c
    
    log_success "Database restored successfully"
}

cmd_up() {
    check_requirements
    check_ssl_certs
    
    if [[ "$BACKUP_BEFORE" == true ]]; then
        # Only backup if database is running
        if docker ps --format '{{.Names}}' | grep -q "anno-postgres"; then
            backup_database
        fi
    fi
    
    local compose_cmd=$(get_compose_command)
    
    log_info "Starting services..."
    
    local extra_args=""
    if [[ "$BUILD_ONLY" == true ]]; then
        extra_args="--build"
    fi
    
    if [[ "$PULL_IMAGES" == true ]]; then
        log_info "Pulling latest images..."
        $compose_cmd pull
    fi
    
    $compose_cmd up -d $extra_args
    
    log_info "Waiting for services to be healthy..."
    sleep 5
    
    # Show status
    $compose_cmd ps
    
    log_success "Deployment complete!"
    
    source "$PROJECT_ROOT/$ENV_FILE"
    log_info "Application available at: https://${DOMAIN:-localhost}"
}

cmd_down() {
    local compose_cmd=$(get_compose_command)
    
    log_info "Stopping services..."
    $compose_cmd down
    
    log_success "Services stopped"
}

cmd_restart() {
    local compose_cmd=$(get_compose_command)
    
    log_info "Restarting services..."
    $compose_cmd restart
    
    log_success "Services restarted"
}

cmd_build() {
    check_requirements
    
    local compose_cmd=$(get_compose_command)
    
    log_info "Building images..."
    
    if [[ "$PULL_IMAGES" == true ]]; then
        log_info "Pulling latest base images..."
        $compose_cmd build --pull
    else
        $compose_cmd build
    fi
    
    log_success "Build complete"
}

cmd_logs() {
    local compose_cmd=$(get_compose_command)
    shift # Remove 'logs' from args
    $compose_cmd logs "$@"
}

cmd_status() {
    local compose_cmd=$(get_compose_command)
    
    echo ""
    echo "=== Service Status ==="
    $compose_cmd ps
    
    echo ""
    echo "=== Resource Usage ==="
    docker stats --no-stream $(docker ps --filter "name=anno-" --format "{{.Names}}")
}

# Parse arguments
COMMAND="up"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        --gpu)
            USE_GPU=true
            shift
            ;;
        --build)
            BUILD_ONLY=true
            shift
            ;;
        --pull)
            PULL_IMAGES=true
            shift
            ;;
        --backup)
            BACKUP_BEFORE=true
            shift
            ;;
        --env)
            ENV_FILE="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        up|down|restart|build|logs|status|backup|restore)
            COMMAND="$1"
            shift
            EXTRA_ARGS=("$@")
            break
            ;;
        *)
            EXTRA_ARGS+=("$1")
            shift
            ;;
    esac
done

# Execute command
cd "$PROJECT_ROOT"

case $COMMAND in
    up)
        cmd_up
        ;;
    down)
        cmd_down
        ;;
    restart)
        cmd_restart
        ;;
    build)
        cmd_build
        ;;
    logs)
        cmd_logs "${EXTRA_ARGS[@]:-}"
        ;;
    status)
        cmd_status
        ;;
    backup)
        backup_database
        ;;
    restore)
        if [[ ${#EXTRA_ARGS[@]} -eq 0 ]]; then
            log_error "Usage: $0 restore <backup_file>"
            exit 1
        fi
        restore_database "${EXTRA_ARGS[0]}"
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac
