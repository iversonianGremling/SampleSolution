#!/usr/bin/env bash

# Sample Solution - Automated LXC Installation Script
# This version automatically clones from GitHub instead of requiring manual file upload
# Run this INSIDE the LXC container after it's been created

set -e

# Repository configuration
REPO_URL="https://github.com/iversonianGremling/SampleSolution.git"
REPO_BRANCH="main"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_DIR="/opt/sample-solution"
BACKUP_DIR="/opt/sample-solution-backups"

clear
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Sample Solution - Automated Installation${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${BLUE}[→]${NC} $1"
}

print_ok() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Check if running inside container
if [ ! -f /.dockerenv ] && [ ! -f /run/.containerenv ]; then
    if ! grep -q "lxc\|container" /proc/1/cgroup 2>/dev/null; then
        print_warning "This script is designed to run inside an LXC container"
        read -p "Continue anyway? (y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 0
        fi
    fi
fi

# Get container IP
CONTAINER_IP=$(hostname -I | awk '{print $1}')
print_status "Container IP: $CONTAINER_IP"
echo ""

# Step 1: Update system
print_status "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
print_ok "System updated"

# Step 2: Install dependencies
print_status "Installing required packages..."
apt-get install -y -qq \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    wget \
    git \
    nano \
    net-tools
print_ok "Dependencies installed"

# Step 3: Install Docker
if ! command -v docker &> /dev/null; then
    print_status "Installing Docker..."

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
    apt-get install -y -qq \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin

    # Start Docker
    systemctl start docker
    systemctl enable docker

    print_ok "Docker installed successfully"
else
    print_ok "Docker already installed"
fi

# Verify Docker works
if ! docker ps &> /dev/null; then
    print_error "Docker is not running properly"
    exit 1
fi

# Step 4: Create directories
print_status "Setting up application directories..."
mkdir -p "$APP_DIR"
mkdir -p "$BACKUP_DIR"
print_ok "Directories created"

# Step 5: Clone repository
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Downloading Application Files${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

print_status "Cloning repository from GitHub..."
cd /tmp
rm -rf sample-solution-clone
git clone --branch "$REPO_BRANCH" "$REPO_URL" sample-solution-clone

if [ ! -d "/tmp/sample-solution-clone/frontend" ] || [ ! -d "/tmp/sample-solution-clone/backend" ]; then
    print_error "Failed to clone repository or repository structure is incorrect"
    exit 1
fi

print_ok "Repository cloned successfully"

print_status "Copying application files to $APP_DIR..."
cp -r /tmp/sample-solution-clone/frontend "$APP_DIR/"
cp -r /tmp/sample-solution-clone/backend "$APP_DIR/"
cp /tmp/sample-solution-clone/docker-compose.prod.yml "$APP_DIR/" 2>/dev/null || \
    cp /tmp/sample-solution-clone/docker-compose.yml "$APP_DIR/docker-compose.prod.yml" 2>/dev/null || true
cp /tmp/sample-solution-clone/.env.production.example "$APP_DIR/" 2>/dev/null || true

# Clean up clone
rm -rf /tmp/sample-solution-clone

print_ok "Files copied"

# Step 6: Configure environment
echo ""
print_status "Configuring environment..."

if [ ! -f "$APP_DIR/.env" ]; then
    if [ -f "$APP_DIR/.env.production.example" ]; then
        cp "$APP_DIR/.env.production.example" "$APP_DIR/.env"

        # Auto-replace YOUR_VM_IP with actual IP
        sed -i "s/YOUR_VM_IP/$CONTAINER_IP/g" "$APP_DIR/.env"

        print_ok "Environment template created at $APP_DIR/.env"
        echo ""
        print_warning "You MUST edit $APP_DIR/.env with your credentials:"
        echo "  - GOOGLE_CLIENT_ID"
        echo "  - GOOGLE_CLIENT_SECRET"
        echo "  - YOUTUBE_API_KEY"
        echo "  - SESSION_SECRET (generate with: openssl rand -base64 32)"
        echo ""
        echo "The IP address has been set to: $CONTAINER_IP"
        echo ""

        read -p "Do you want to edit .env now? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            nano "$APP_DIR/.env"
        fi
    else
        print_warning "No .env template found. Creating basic .env file..."
        cat > "$APP_DIR/.env" << EOF
# Frontend API URL
API_URL=http://$CONTAINER_IP:4000

# Frontend URL
FRONTEND_URL=http://$CONTAINER_IP:3000

# Google OAuth & YouTube API
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://$CONTAINER_IP:4000/api/auth/google/callback
YOUTUBE_API_KEY=your-youtube-api-key

# Session Secret
SESSION_SECRET=CHANGE-THIS-TO-A-LONG-RANDOM-STRING

# Node environment
NODE_ENV=production
EOF
        print_warning "Created basic .env file. Please edit it with your credentials."
    fi
else
    print_ok "Environment file already exists"
fi

# Step 7: Verify credentials before starting
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Credentials Verification${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

if [ -f "$APP_DIR/.env" ]; then
    print_status "Checking credentials in .env file..."

    MISSING_CREDS=0

    # Check YouTube API Key
    if ! grep -q "^YOUTUBE_API_KEY=.\+$" "$APP_DIR/.env" || grep -q "^YOUTUBE_API_KEY=your" "$APP_DIR/.env"; then
        print_warning "YOUTUBE_API_KEY not configured"
        MISSING_CREDS=1
    else
        print_ok "YOUTUBE_API_KEY configured"
    fi

    # Check Google OAuth
    if ! grep -q "^GOOGLE_CLIENT_ID=.\+$" "$APP_DIR/.env" || grep -q "^GOOGLE_CLIENT_ID=your" "$APP_DIR/.env"; then
        print_warning "GOOGLE_CLIENT_ID not configured"
        MISSING_CREDS=1
    else
        print_ok "GOOGLE_CLIENT_ID configured"
    fi

    if ! grep -q "^GOOGLE_CLIENT_SECRET=.\+$" "$APP_DIR/.env" || grep -q "^GOOGLE_CLIENT_SECRET=your" "$APP_DIR/.env"; then
        print_warning "GOOGLE_CLIENT_SECRET not configured"
        MISSING_CREDS=1
    else
        print_ok "GOOGLE_CLIENT_SECRET configured"
    fi

    # Check Session Secret
    if ! grep -q "^SESSION_SECRET=.\+$" "$APP_DIR/.env" || grep -q "^SESSION_SECRET=CHANGE-THIS" "$APP_DIR/.env" || grep -q "^SESSION_SECRET=your" "$APP_DIR/.env"; then
        print_warning "SESSION_SECRET not configured"
        MISSING_CREDS=1
    else
        print_ok "SESSION_SECRET configured"
    fi

    if [ $MISSING_CREDS -eq 1 ]; then
        echo ""
        print_error "Some credentials are missing or using default values!"
        echo ""
        echo -e "${BLUE}The application will start, but you'll see a setup screen on the frontend.${NC}"
        echo -e "${BLUE}To fix this:${NC}"
        echo "  1. Edit $APP_DIR/.env with your credentials"
        echo "  2. Restart the containers: docker compose -f $APP_DIR/docker-compose.prod.yml restart"
        echo ""
        read -p "Continue with startup anyway? (y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Startup cancelled. Edit .env and run the startup manually:"
            echo "  cd $APP_DIR"
            echo "  docker compose -f docker-compose.prod.yml up -d"
            exit 0
        fi
    else
        print_ok "All credentials configured!"
    fi
else
    print_error "No .env file found at $APP_DIR/.env"
    echo "Please create one before starting the application."
    exit 1
fi

# Step 8: Build and start
cd "$APP_DIR"

echo ""
read -p "Build and start the application now? (y/n): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Building Docker images (this will take several minutes)..."
    docker compose -f docker-compose.prod.yml build
    print_ok "Images built"

    if [ -f "$APP_DIR/.env" ]; then
        print_status "Starting containers..."
        docker compose -f docker-compose.prod.yml --env-file .env up -d
        print_ok "Containers started"

        sleep 5

        # Pull Ollama model
        print_status "Pulling Ollama model (llama3.2:3b)..."
        docker compose -f docker-compose.prod.yml exec -T ollama ollama pull llama3.2:3b || \
            print_warning "Failed to pull Ollama model. Run manually: docker compose exec ollama ollama pull llama3.2:3b"
    else
        print_warning "No .env file found. Skipping container startup."
    fi
fi

# Step 9: Summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Application directory: $APP_DIR"
echo "Container IP: $CONTAINER_IP"
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Access your application:${NC}"
    echo "  Frontend: http://$CONTAINER_IP:3000"
    echo "  Backend:  http://$CONTAINER_IP:4000"
    echo "  Ollama:   http://$CONTAINER_IP:11434"
    echo ""
    echo "Container status:"
    docker compose -f docker-compose.prod.yml ps
    echo ""
    echo -e "${BLUE}If you can't access the application:${NC}"
    echo "  1. Check if containers are running: docker compose -f $APP_DIR/docker-compose.prod.yml ps"
    echo "  2. View logs: docker compose -f $APP_DIR/docker-compose.prod.yml logs -f"
    echo "  3. Check firewall on Proxmox host"
else
    echo "To start the application later:"
    echo "  cd $APP_DIR"
    echo "  docker compose -f docker-compose.prod.yml --env-file .env up -d"
fi

echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "  View logs:    docker compose -f $APP_DIR/docker-compose.prod.yml logs -f"
echo "  Stop:         docker compose -f $APP_DIR/docker-compose.prod.yml down"
echo "  Restart:      docker compose -f $APP_DIR/docker-compose.prod.yml restart"
echo "  Shell:        docker compose -f $APP_DIR/docker-compose.prod.yml exec backend sh"
echo ""
echo -e "${GREEN}========================================${NC}"
