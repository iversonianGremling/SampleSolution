#!/usr/bin/env bash

#########################################
# Sample Solution - LXC Container Install
#########################################
# Run this script INSIDE an existing Debian/Ubuntu LXC container
#
# Usage:
#   1. Create a Debian 12 LXC container in Proxmox (2 CPU, 4GB RAM, 20GB disk)
#   2. Enable "Nesting" feature in container options
#   3. SSH into the container
#   4. Run: bash <(curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/ct/install-in-container.sh)
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
msg_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

msg_ok() {
    echo -e "${GREEN}[OK]${NC} $1"
}

msg_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

msg_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    msg_error "Please run as root (use 'sudo bash' or login as root)"
fi

echo "========================================="
echo "  Sample Solution - Container Installer"
echo "========================================="
echo ""

# Get container IP
CONTAINER_IP=$(hostname -I | awk '{print $1}')
if [ -z "$CONTAINER_IP" ]; then
    msg_error "Could not determine container IP address"
fi

msg_info "Container IP detected: $CONTAINER_IP"
NIP_IO_DOMAIN=$(echo $CONTAINER_IP | tr '.' '-').nip.io
msg_info "nip.io domain: $NIP_IO_DOMAIN"
echo ""

# Fix repositories
msg_info "Configuring repositories..."
cat > /etc/apt/sources.list << 'EOF'
deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
EOF

rm -f /etc/apt/sources.list.d/pve-enterprise.list /etc/apt/sources.list.d/ceph.list 2>/dev/null || true

apt-get update -qq
apt-get upgrade -y -qq
msg_ok "Repositories configured"

# Install dependencies
msg_info "Installing dependencies..."
apt-get install -y -qq curl sudo git gnupg ca-certificates
msg_ok "Dependencies installed"

# Install Docker
msg_info "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
    apt-get install -y -qq docker-compose-plugin
    systemctl enable --now docker
    msg_ok "Docker installed"
else
    msg_ok "Docker already installed"
fi

# Clone repository
msg_info "Cloning repository..."
cd /opt
rm -rf sample-solution
git clone https://github.com/iversonianGremling/SampleSolution.git sample-solution > /dev/null 2>&1
cd sample-solution
msg_ok "Repository cloned"

# Set up environment
msg_info "Setting up environment..."
SESSION_SECRET=$(openssl rand -hex 32)

cat > .env << EOF
# YouTube API Configuration
YOUTUBE_API_KEY=your-youtube-api-key

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://$NIP_IO_DOMAIN:4000/api/auth/google/callback

# Application URLs
API_URL=http://$NIP_IO_DOMAIN:4000
FRONTEND_URL=http://$NIP_IO_DOMAIN:3000

# Session secret
SESSION_SECRET=$SESSION_SECRET

# Node environment
NODE_ENV=production
EOF

msg_ok "Environment configured"

# Build and start services
msg_info "Building and starting services (this may take a few minutes)..."
docker compose -f docker-compose.prod.yml up -d --build > /dev/null 2>&1
msg_ok "Services started"

# Pull AI model in background
msg_info "Pulling AI model in background..."
sleep 5
docker compose -f docker-compose.prod.yml exec -T ollama ollama pull llama3.2:3b > /dev/null 2>&1 &
msg_ok "AI model pulling (background process)"

# Health check
msg_info "Verifying web interface..."
MAX_RETRIES=12
RETRY_COUNT=0
SUCCESS=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://${CONTAINER_IP}:3000 2>/dev/null || echo "000")

    if [ "$HTTP_STATUS" == "200" ] || [ "$HTTP_STATUS" == "301" ] || [ "$HTTP_STATUS" == "302" ]; then
        SUCCESS=true
        break
    fi

    RETRY_COUNT=$((RETRY_COUNT+1))
    sleep 5
done

if [ "$SUCCESS" = true ]; then
    msg_ok "Health check passed"
else
    msg_warn "Health check timeout - service may still be starting"
fi

# Disable root password for convenience
passwd -d root > /dev/null 2>&1
msg_ok "Root access configured"

echo ""
echo "========================================="
echo -e "${GREEN}✓ Installation Complete!${NC}"
echo "========================================="
echo ""
echo -e "${YELLOW}Access URLs:${NC}"
echo -e "  IP Address:    ${BLUE}http://$CONTAINER_IP:3000${NC}"
echo -e "  nip.io Domain: ${BLUE}http://$NIP_IO_DOMAIN:3000${NC} ${GREEN}(Recommended)${NC}"
echo ""
echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${RED}IMPORTANT: Configure Google OAuth${NC}"
echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}1. Edit /opt/sample-solution/.env and add your credentials:${NC}"
echo -e "   ${BLUE}nano /opt/sample-solution/.env${NC}"
echo ""
echo -e "${YELLOW}2. Add this redirect URI to Google Cloud Console:${NC}"
echo -e "   ${BLUE}http://$NIP_IO_DOMAIN:4000/api/auth/google/callback${NC}"
echo ""
echo -e "${YELLOW}3. Restart services after updating credentials:${NC}"
echo -e "   ${BLUE}cd /opt/sample-solution && docker compose -f docker-compose.prod.yml restart${NC}"
echo ""
echo -e "${GREEN}Using nip.io domain avoids Google OAuth's private IP restriction!${NC}"
echo ""
