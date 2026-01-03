#!/usr/bin/env bash

# Sample Solution - Quick Install Script
# This is the main entry point for one-liner installation

set -e

REPO_URL="https://raw.githubusercontent.com/iversonianGremling/SampleSolution/main"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

clear
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Sample Solution - Quick Install${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Detect environment
if command -v pct &> /dev/null; then
    # Running on Proxmox host
    echo -e "${BLUE}Detected: Proxmox VE host${NC}"
    echo -e "${YELLOW}This will create and setup an LXC container${NC}"
    echo ""
    SCRIPT_NAME="proxmox-install.sh"
elif grep -q "lxc\|container" /proc/1/cgroup 2>/dev/null || [ -f /.dockerenv ] || [ -f /run/.containerenv ]; then
    # Running inside a container
    echo -e "${BLUE}Detected: LXC/Container environment${NC}"
    echo -e "${YELLOW}This will install Sample Solution in this container${NC}"
    echo ""
    SCRIPT_NAME="lxc-install.sh"
else
    # Unknown environment
    echo -e "${YELLOW}Unable to detect environment automatically${NC}"
    echo ""
    echo "Please choose installation type:"
    echo "  1) Proxmox host (create new LXC container)"
    echo "  2) Inside existing LXC/container"
    echo ""
    read -p "Selection (1 or 2): " -n 1 -r
    echo
    echo ""

    if [[ $REPLY == "1" ]]; then
        SCRIPT_NAME="proxmox-install.sh"
    elif [[ $REPLY == "2" ]]; then
        SCRIPT_NAME="lxc-install.sh"
    else
        echo "Invalid selection. Exiting."
        exit 1
    fi
fi

echo -e "${BLUE}Downloading installation script...${NC}"
echo ""

# Download the appropriate installation script
curl -fsSL "$REPO_URL/$SCRIPT_NAME" -o /tmp/sample-solution-install.sh

# Make it executable
chmod +x /tmp/sample-solution-install.sh

# Run it
exec /tmp/sample-solution-install.sh "$@"
