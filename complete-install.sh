#!/usr/bin/env bash

# Sample Solution - Complete Installation (Run inside LXC container)
# curl -fsSL https://raw.githubusercontent.com/iversonianGremling/sample_solution/main/complete-install.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_DIR="/opt/sample-solution"

msg_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
msg_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
msg_error() { echo -e "${RED}[ERROR]${NC} $1"; }
msg_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

clear
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Sample Solution - Final Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

cd "$APP_DIR"

# Check if required files exist
if [ ! -f "docker-compose.prod.yml" ]; then
    msg_error "docker-compose.prod.yml not found in $APP_DIR"
    msg_error "Please upload your application files first"
    exit 1
fi

if [ ! -d "frontend" ] || [ ! -d "backend" ]; then
    msg_error "frontend and backend directories not found"
    msg_error "Please upload your application files first"
    exit 1
fi

# Check .env file
if [ ! -f ".env" ]; then
    msg_error "No .env file found"
    exit 1
fi

# Check if .env is configured
if grep -q "your-client-id.apps.googleusercontent.com" .env; then
    msg_warn "⚠️  .env file contains default values"
    msg_warn "You need to configure:"
    echo "  - GOOGLE_CLIENT_ID"
    echo "  - GOOGLE_CLIENT_SECRET"
    echo "  - YOUTUBE_API_KEY"
    echo "  - SESSION_SECRET"
    echo ""
    read -p "Edit .env now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
    else
        msg_warn "Continuing anyway, but app may not work correctly"
    fi
fi

# Build images
msg_info "Building Docker images (this takes 5-10 minutes)..."
docker compose -f docker-compose.prod.yml build
msg_ok "Images built successfully"

# Start containers
msg_info "Starting containers..."
docker compose -f docker-compose.prod.yml --env-file .env up -d
msg_ok "Containers started"

# Wait for services
msg_info "Waiting for services to be ready..."
sleep 10

# Pull Ollama model
msg_info "Pulling Ollama model (llama3.2:3b)..."
docker compose -f docker-compose.prod.yml exec -T ollama ollama pull llama3.2:3b || \
    msg_warn "Failed to pull Ollama model. Run manually later: docker compose exec ollama ollama pull llama3.2:3b"

# Get IP
CONTAINER_IP=$(hostname -I | awk '{print $1}')

# Show status
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Access your application:${NC}"
echo "  Frontend: http://${CONTAINER_IP}:3000"
echo "  Backend:  http://${CONTAINER_IP}:4000"
echo "  Ollama:   http://${CONTAINER_IP}:11434"
echo ""
echo -e "${BLUE}Container status:${NC}"
docker compose -f docker-compose.prod.yml ps
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  View logs:    docker compose -f docker-compose.prod.yml logs -f"
echo "  Restart:      docker compose -f docker-compose.prod.yml restart"
echo "  Stop:         docker compose -f docker-compose.prod.yml down"
echo ""
echo -e "${GREEN}========================================${NC}"
