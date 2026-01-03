#!/bin/bash

# Sample Solution - Proxmox Deployment Script
# This script automates deployment on a fresh Ubuntu/Debian VM

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/opt/sample-solution"
BACKUP_DIR="/opt/sample-solution-backups"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Sample Solution - Proxmox Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "Please run as root (use sudo)"
    exit 1
fi

# Get VM IP address
VM_IP=$(hostname -I | awk '{print $1}')
print_status "Detected VM IP: $VM_IP"

# Step 1: System Updates
print_status "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
print_status "System updated"

# Step 2: Install Docker
if ! command -v docker &> /dev/null; then
    print_status "Installing Docker..."

    # Install dependencies
    apt-get install -y -qq \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Set up repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start and enable Docker
    systemctl start docker
    systemctl enable docker

    print_status "Docker installed successfully"
else
    print_status "Docker already installed"
fi

# Step 3: Create application directory
print_status "Setting up application directory..."
mkdir -p "$APP_DIR"
mkdir -p "$BACKUP_DIR"

# Step 4: Check if .env file exists
if [ ! -f "$APP_DIR/.env" ]; then
    print_warning "No .env file found!"
    echo ""
    echo "Please create $APP_DIR/.env with your configuration."
    echo "You can use the .env.production.example as a template."
    echo ""
    echo "Required variables:"
    echo "  - GOOGLE_CLIENT_ID"
    echo "  - GOOGLE_CLIENT_SECRET"
    echo "  - YOUTUBE_API_KEY"
    echo "  - SESSION_SECRET"
    echo "  - API_URL (e.g., http://$VM_IP:4000)"
    echo "  - FRONTEND_URL (e.g., http://$VM_IP:3000)"
    echo "  - GOOGLE_REDIRECT_URI (e.g., http://$VM_IP:4000/api/auth/google/callback)"
    echo ""
    print_warning "Deployment will continue, but you need to configure .env before starting the app"
fi

# Step 5: Copy application files
if [ -d "$(pwd)/frontend" ] && [ -d "$(pwd)/backend" ]; then
    print_status "Copying application files to $APP_DIR..."

    # Backup existing installation if it exists
    if [ -d "$APP_DIR/frontend" ]; then
        BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
        print_status "Backing up existing installation to $BACKUP_DIR/$BACKUP_NAME..."
        mkdir -p "$BACKUP_DIR/$BACKUP_NAME"
        cp -r "$APP_DIR"/* "$BACKUP_DIR/$BACKUP_NAME/" 2>/dev/null || true
    fi

    # Copy new files
    cp -r frontend "$APP_DIR/"
    cp -r backend "$APP_DIR/"
    cp docker-compose.prod.yml "$APP_DIR/"
    cp .env.production.example "$APP_DIR/" 2>/dev/null || true

    print_status "Application files copied"
else
    print_error "Could not find frontend and backend directories"
    print_error "Please run this script from the project root directory"
    exit 1
fi

# Step 6: Build and start containers
cd "$APP_DIR"

print_status "Building Docker images (this may take a few minutes)..."
docker compose -f docker-compose.prod.yml build

if [ -f "$APP_DIR/.env" ]; then
    print_status "Starting containers..."
    docker compose -f docker-compose.prod.yml --env-file .env up -d

    # Wait for containers to be ready
    sleep 5

    # Step 7: Pull Ollama model (optional but recommended)
    print_status "Pulling Ollama model (llama3.2:3b)..."
    docker compose -f docker-compose.prod.yml exec -T ollama ollama pull llama3.2:3b || \
        print_warning "Failed to pull Ollama model. You can do this manually later with: docker compose exec ollama ollama pull llama3.2:3b"

    print_status "Deployment complete!"
else
    print_warning "Skipping container startup - configure .env first"
    echo ""
    echo "After configuring .env, start the application with:"
    echo "  cd $APP_DIR"
    echo "  docker compose -f docker-compose.prod.yml --env-file .env up -d"
fi

# Step 8: Display status and access information
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Summary${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Application directory: $APP_DIR"
echo "Backup directory: $BACKUP_DIR"
echo ""

if [ -f "$APP_DIR/.env" ]; then
    echo "Container status:"
    docker compose -f docker-compose.prod.yml ps
    echo ""
    echo -e "${GREEN}Access your application:${NC}"
    echo "  Frontend: http://$VM_IP:3000"
    echo "  Backend:  http://$VM_IP:4000"
    echo "  Ollama:   http://$VM_IP:11434"
else
    echo -e "${YELLOW}Next steps:${NC}"
    echo "  1. Configure $APP_DIR/.env with your settings"
    echo "  2. Start the application:"
    echo "     cd $APP_DIR"
    echo "     docker compose -f docker-compose.prod.yml --env-file .env up -d"
fi

echo ""
echo -e "${GREEN}Useful commands:${NC}"
echo "  View logs:       docker compose -f docker-compose.prod.yml logs -f"
echo "  Stop app:        docker compose -f docker-compose.prod.yml down"
echo "  Restart app:     docker compose -f docker-compose.prod.yml restart"
echo "  Update app:      Run this script again"
echo ""
echo -e "${GREEN}========================================${NC}"
