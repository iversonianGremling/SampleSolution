#!/usr/bin/env bash

# Sample Solution - Proxmox LXC Container Creation Script
# Run this on your Proxmox host to create an LXC container

source <(curl -s https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func) 2>/dev/null || {
    # Fallback if community script build functions aren't available
    msg_info() { echo -e "\e[34m[INFO]\e[0m $1"; }
    msg_ok() { echo -e "\e[32m[OK]\e[0m $1"; }
    msg_error() { echo -e "\e[31m[ERROR]\e[0m $1"; }
}

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
CT_TEMPLATE="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"

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

echo -e "${BLUE}This script will create an LXC container optimized for Docker${NC}"
echo ""

# Check if running on Proxmox
if ! command -v pct &> /dev/null; then
    echo -e "${RED}ERROR: This script must be run on a Proxmox VE host${NC}"
    exit 1
fi

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

read -p "Create container? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Download Ubuntu template if not exists
echo -e "${BLUE}[1/4]${NC} Checking for Ubuntu template..."
if ! pveam list $CT_STORAGE | grep -q "ubuntu-22.04"; then
    echo "  Downloading Ubuntu 22.04 template..."
    pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst
    CT_TEMPLATE="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
fi
echo -e "${GREEN}✓${NC} Template ready"

# Create container
echo -e "${BLUE}[2/4]${NC} Creating LXC container..."
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

# Configure container for Docker
echo -e "${BLUE}[3/4]${NC} Configuring container for Docker..."

# Add additional configuration
cat >> /etc/pve/lxc/${CTID}.conf << 'LXCCONF'
# Docker optimizations
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop:
lxc.mount.auto: "proc:rw sys:rw"
LXCCONF

echo -e "${GREEN}✓${NC} Container configured"

# Start container
echo -e "${BLUE}[4/4]${NC} Starting container..."
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
echo ""
echo -e "${YELLOW}Getting container IP address...${NC}"
sleep 3
CT_IP=$(pct exec $CTID -- hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}LXC Container Created Successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Container ID:  $CTID"
echo "  Name:          $CT_NAME"
echo "  IP Address:    $CT_IP"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo "1. Enter the container:"
echo "   ${GREEN}pct enter $CTID${NC}"
echo ""
echo "2. Upload the installation script to the container:"
echo "   From your workstation:"
echo "   ${GREEN}scp lxc-install.sh root@$CT_IP:/root/${NC}"
echo ""
echo "   Or from Proxmox host:"
echo "   ${GREEN}pct push $CTID lxc-install.sh /root/lxc-install.sh${NC}"
echo ""
echo "3. Run the installation script inside the container:"
echo "   ${GREEN}pct enter $CTID${NC}"
echo "   ${GREEN}chmod +x /root/lxc-install.sh${NC}"
echo "   ${GREEN}/root/lxc-install.sh${NC}"
echo ""
echo -e "${YELLOW}Management Commands:${NC}"
echo "  Start:   pct start $CTID"
echo "  Stop:    pct stop $CTID"
echo "  Enter:   pct enter $CTID"
echo "  Destroy: pct destroy $CTID"
echo ""
echo -e "${GREEN}========================================${NC}"
