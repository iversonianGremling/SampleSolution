#!/usr/bin/env bash

# Sample Solution - One-Command LXC Installer for Proxmox
# Run on Proxmox host: bash -c "$(curl -fsSL https://raw.githubusercontent.com/iversonianGremling/sample_solution/main/install-lxc.sh)"

set -e

# GitHub repository (update this to your repo)
GITHUB_REPO="${GITHUB_REPO:-iversonianGremling/sample_solution}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
BASE_URL="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}"

# Default configuration
CTID=""
CT_NAME="sample-solution"
CT_HOSTNAME="sample-solution"
CT_CORES="4"
CT_RAM="8192"
CT_SWAP="2048"
CT_DISK="50"
CT_STORAGE="local-lvm"
CT_BRIDGE="vmbr0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

header() {
    clear
    cat << "EOF"
    ____                        __        _____       __      __  _
   / __/____ _____ ___  ____  / /__     / ___/____  / /_  __/ /_(_)___  ____
  / /_/ ___/ __ `/ __ \/ __ \/ / _ \    \__ \/ __ \/ / / / / __/ / __ \/ __ \
 / __/ /  / /_/ / / / / /_/ / /  __/   ___/ / /_/ / / /_/ / /_/ / /_/ / / / /
/_/ /_/   \__,_/_/ /_/ .___/_/\___/   /____/\____/_/\__,_/\__/_/\____/_/ /_/
                    /_/
EOF
    echo -e "${BLUE}        Proxmox LXC One-Command Installer${NC}"
    echo ""
}

msg_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
msg_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
msg_error() { echo -e "${RED}[ERROR]${NC} $1"; }
msg_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

header

# Check if running on Proxmox
if ! command -v pct &> /dev/null; then
    msg_error "This script must be run on a Proxmox VE host"
    exit 1
fi

msg_info "This will create an LXC container and install Sample Solution"
echo ""

# Interactive configuration
echo -e "${YELLOW}Configuration:${NC}"
echo ""

read -p "Container ID (press Enter for auto): " input_ctid
if [ -n "$input_ctid" ]; then
    CTID="$input_ctid"
else
    CTID=$(pvesh get /cluster/nextid)
fi

read -p "Container name [$CT_NAME]: " input_name
CT_NAME="${input_name:-$CT_NAME}"

read -p "CPU cores [$CT_CORES]: " input_cores
CT_CORES="${input_cores:-$CT_CORES}"

read -p "RAM in MB [$CT_RAM]: " input_ram
CT_RAM="${input_ram:-$CT_RAM}"

read -p "Disk size in GB [$CT_DISK]: " input_disk
CT_DISK="${input_disk:-$CT_DISK}"

read -p "Storage location [$CT_STORAGE]: " input_storage
CT_STORAGE="${input_storage:-$CT_STORAGE}"

echo ""
echo -e "${GREEN}Summary:${NC}"
echo "  CT ID:       $CTID"
echo "  Name:        $CT_NAME"
echo "  Cores:       $CT_CORES"
echo "  RAM:         ${CT_RAM}MB"
echo "  Disk:        ${CT_DISK}GB"
echo "  Storage:     $CT_STORAGE"
echo ""

read -p "Continue? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Download Ubuntu template if needed
msg_info "Checking Ubuntu template..."
if ! pveam list local | grep -q "ubuntu-22.04"; then
    msg_info "Downloading Ubuntu 22.04 template (this may take a few minutes)..."
    pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst
fi
CT_TEMPLATE="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
msg_ok "Template ready"

# Create container
msg_info "Creating LXC container..."
pct create $CTID $CT_TEMPLATE \
    --hostname $CT_HOSTNAME \
    --cores $CT_CORES \
    --memory $CT_RAM \
    --swap $CT_SWAP \
    --rootfs $CT_STORAGE:$CT_DISK \
    --net0 name=eth0,bridge=$CT_BRIDGE,firewall=1,ip=dhcp \
    --unprivileged 0 \
    --features nesting=1,keyctl=1 \
    --onboot 1 \
    --start 0

if [ $? -ne 0 ]; then
    msg_error "Failed to create container"
    exit 1
fi
msg_ok "Container created (ID: $CTID)"

# Configure for Docker
msg_info "Configuring for Docker..."
cat >> /etc/pve/lxc/${CTID}.conf << 'LXCCONF'
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop:
lxc.mount.auto: "proc:rw sys:rw"
LXCCONF
msg_ok "Container configured"

# Start container
msg_info "Starting container..."
pct start $CTID
sleep 5

# Wait for container to be ready
msg_info "Waiting for container to initialize..."
for i in {1..30}; do
    if pct exec $CTID -- systemctl is-system-running --wait 2>/dev/null | grep -qE "running|degraded"; then
        break
    fi
    sleep 2
done
msg_ok "Container started"

# Get container IP
msg_info "Getting container IP address..."
sleep 3
CT_IP=$(pct exec $CTID -- hostname -I | awk '{print $1}')
msg_ok "Container IP: $CT_IP"

# Install Docker in container
msg_info "Installing Docker (this takes 2-3 minutes)..."
pct exec $CTID -- bash <<'DOCKER_INSTALL'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl gnupg lsb-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl start docker
systemctl enable docker
DOCKER_INSTALL
msg_ok "Docker installed"

# Create directories
msg_info "Setting up directories..."
pct exec $CTID -- mkdir -p /opt/sample-solution
pct exec $CTID -- mkdir -p /opt/sample-solution-backups
msg_ok "Directories created"

# Download configuration files
msg_info "Downloading configuration files..."

# Check if GitHub repo is configured
if [[ "$GITHUB_REPO" == "YOUR_USERNAME/sample_solution" ]]; then
    msg_warn "GitHub repository not configured"
    msg_info "You'll need to manually upload files to the container"
    MANUAL_MODE=true
else
    # Download docker-compose and env template
    pct exec $CTID -- curl -fsSL "${BASE_URL}/docker-compose.prod.yml" -o /opt/sample-solution/docker-compose.prod.yml
    pct exec $CTID -- curl -fsSL "${BASE_URL}/.env.production.example" -o /opt/sample-solution/.env.production.example
    msg_ok "Configuration files downloaded"
    MANUAL_MODE=false
fi

# Create .env file
msg_info "Creating environment file..."
pct exec $CTID -- bash -c "cat > /opt/sample-solution/.env" <<ENVFILE
# Sample Solution - Production Environment Configuration

# Server Configuration (auto-configured)
API_URL=http://${CT_IP}:4000
FRONTEND_URL=http://${CT_IP}:3000
GOOGLE_REDIRECT_URI=http://${CT_IP}:4000/api/auth/google/callback

# Google OAuth & YouTube API (REQUIRED - Add your values)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
YOUTUBE_API_KEY=your-youtube-api-key

# Security (REQUIRED - Generate a strong random string)
SESSION_SECRET=CHANGE-THIS-TO-A-LONG-RANDOM-STRING

# Optional Configuration
NODE_ENV=production
ENVFILE
msg_ok "Environment file created"

# Final instructions
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Container Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Container ID:  $CTID"
echo "  Container IP:  $CT_IP"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo ""

if [ "$MANUAL_MODE" = true ]; then
    echo -e "${BLUE}1. Upload your application files:${NC}"
    echo "   From your local machine:"
    echo -e "   ${GREEN}rsync -avz --exclude 'node_modules' --exclude '.git' \\${NC}"
    echo -e "   ${GREEN}  . root@${CT_IP}:/opt/sample-solution/${NC}"
    echo ""
else
    echo -e "${BLUE}1. Files will be downloaded from your GitHub repo${NC}"
    echo "   Or manually upload if you prefer:"
    echo -e "   ${GREEN}rsync -avz frontend backend root@${CT_IP}:/opt/sample-solution/${NC}"
    echo ""
fi

echo -e "${BLUE}2. Configure environment variables:${NC}"
echo -e "   ${GREEN}pct enter $CTID${NC}"
echo -e "   ${GREEN}nano /opt/sample-solution/.env${NC}"
echo ""
echo "   Required values:"
echo "   - GOOGLE_CLIENT_ID"
echo "   - GOOGLE_CLIENT_SECRET"
echo "   - YOUTUBE_API_KEY"
echo "   - SESSION_SECRET (generate: openssl rand -base64 32)"
echo ""

if [ "$MANUAL_MODE" = false ]; then
    echo -e "${BLUE}3. Build and start the application:${NC}"
    echo -e "   ${GREEN}pct enter $CTID${NC}"
    echo -e "   ${GREEN}cd /opt/sample-solution${NC}"
    echo -e "   ${GREEN}docker compose -f docker-compose.prod.yml build${NC}"
    echo -e "   ${GREEN}docker compose -f docker-compose.prod.yml --env-file .env up -d${NC}"
    echo ""
    echo -e "${BLUE}4. Pull Ollama model:${NC}"
    echo -e "   ${GREEN}docker compose -f docker-compose.prod.yml exec ollama ollama pull llama3.2:3b${NC}"
    echo ""
fi

echo -e "${GREEN}Access your application:${NC}"
echo "  Frontend: http://${CT_IP}:3000"
echo "  Backend:  http://${CT_IP}:4000"
echo ""
echo -e "${YELLOW}Management:${NC}"
echo "  Enter container:  pct enter $CTID"
echo "  Start:            pct start $CTID"
echo "  Stop:             pct stop $CTID"
echo "  Snapshot:         pct snapshot $CTID pre-update"
echo ""
echo -e "${GREEN}========================================${NC}"
