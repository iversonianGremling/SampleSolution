#!/usr/bin/env bash

# Sample Solution - Complete Proxmox Installation Script
# Run this on your Proxmox host to create and configure everything

set -e

REPO_URL="https://raw.githubusercontent.com/iversonianGremling/SampleSolution/main"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

clear
cat << "EOF"
    ____                        __        _____       __      __  _
   / __/____ _____ ___  ____  / /__     / ___/____  / /_  __/ /_(_)___  ____
  / /_/ ___/ __ `/ __ \/ __ \/ / _ \    \__ \/ __ \/ / / / / __/ / __ \/ __ \
 / __/ /  / /_/ / / / / /_/ / /  __/   ___/ / /_/ / / /_/ / /_/ / /_/ / / / /
/_/ /_/   \__,_/_/ /_/ .___/_/\___/   /____/\____/_/\__,_/\__/_/\____/_/ /_/
                    /_/

        Proxmox LXC Container Setup for Sample Solution

EOF

echo -e "${BLUE}This script will:${NC}"
echo "  1. Create an LXC container optimized for Docker"
echo "  2. Install Docker and dependencies"
echo "  3. Download and setup the Sample Solution application"
echo ""

# Check if running on Proxmox
if ! command -v pct &> /dev/null; then
    echo -e "${RED}ERROR: This script must be run on a Proxmox VE host${NC}"
    exit 1
fi

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
echo "  Hostname:    $CT_HOSTNAME"
echo "  Cores:       $CT_CORES"
echo "  RAM:         ${CT_RAM}MB"
echo "  Swap:        ${CT_SWAP}MB"
echo "  Disk:        ${CT_DISK}GB"
echo "  Storage:     $CT_STORAGE"
echo "  Template:    Ubuntu 22.04"
echo ""

read -p "Create and setup container? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Starting Installation${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Step 1: Download Ubuntu template if not exists
echo -e "${BLUE}[1/6]${NC} Checking for Ubuntu template..."
if ! pveam list local | grep -q "ubuntu-22.04"; then
    echo "  Downloading Ubuntu 22.04 template..."
    pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst
fi
CT_TEMPLATE="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
echo -e "${GREEN}✓${NC} Template ready"

# Step 2: Create container
echo -e "${BLUE}[2/6]${NC} Creating LXC container..."
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
    echo -e "${RED}✗ Failed to create container${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Container created (ID: $CTID)"

# Step 3: Configure container for Docker
echo -e "${BLUE}[3/6]${NC} Configuring container for Docker..."
cat >> /etc/pve/lxc/${CTID}.conf << 'LXCCONF'
# Docker optimizations
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop:
lxc.mount.auto: "proc:rw sys:rw"
LXCCONF
echo -e "${GREEN}✓${NC} Container configured"

# Step 4: Start container
echo -e "${BLUE}[4/6]${NC} Starting container..."
pct start $CTID
sleep 5

# Wait for container to be ready
echo "  Waiting for container to initialize..."
for i in {1..30}; do
    if pct exec $CTID -- systemctl is-system-running --wait 2>/dev/null | grep -qE "running|degraded"; then
        break
    fi
    sleep 2
done
echo -e "${GREEN}✓${NC} Container started"

# Get container IP
CT_IP=$(pct exec $CTID -- hostname -I | awk '{print $1}')
echo "  Container IP: $CT_IP"

# Step 5: Download installation script into container
echo -e "${BLUE}[5/6]${NC} Downloading installation script..."
pct exec $CTID -- bash -c "curl -fsSL $REPO_URL/lxc-install.sh -o /tmp/lxc-install.sh && chmod +x /tmp/lxc-install.sh"
echo -e "${GREEN}✓${NC} Installation script ready"

# Step 6: Run installation
echo -e "${BLUE}[6/6]${NC} Running installation inside container..."
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Container Installation Starting${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Ask if they want to run the installation now or later
read -p "Run the installation script now? (y/n): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${BLUE}Starting installation in container...${NC}"
    echo -e "${YELLOW}You'll need to interact with the installation script.${NC}"
    echo ""
    sleep 2

    # Run the installation script interactively
    pct enter $CTID -- /tmp/lxc-install.sh

    INSTALL_STATUS=$?

    if [ $INSTALL_STATUS -eq 0 ]; then
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Installation Complete!${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        echo "  Container ID:  $CTID"
        echo "  IP Address:    $CT_IP"
        echo ""
        echo -e "${GREEN}Access your application:${NC}"
        echo "  Frontend: http://$CT_IP:3000"
        echo "  Backend:  http://$CT_IP:4000"
        echo ""
    else
        echo ""
        echo -e "${YELLOW}Installation was interrupted or incomplete.${NC}"
        echo "You can continue the installation by running:"
        echo "  pct enter $CTID"
        echo "  /tmp/lxc-install.sh"
        echo ""
    fi
else
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Container Created Successfully!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "  Container ID:  $CTID"
    echo "  IP Address:    $CT_IP"
    echo ""
    echo -e "${YELLOW}To complete the installation:${NC}"
    echo "  1. Enter the container:"
    echo "     ${GREEN}pct enter $CTID${NC}"
    echo ""
    echo "  2. Run the installation script:"
    echo "     ${GREEN}/tmp/lxc-install.sh${NC}"
    echo ""
fi

echo -e "${YELLOW}Management Commands:${NC}"
echo "  Start:   pct start $CTID"
echo "  Stop:    pct stop $CTID"
echo "  Enter:   pct enter $CTID"
echo "  Destroy: pct destroy $CTID"
echo ""
echo -e "${GREEN}========================================${NC}"
