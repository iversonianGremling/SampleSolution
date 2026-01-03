#!/usr/bin/env bash

# Sample Solution - Quick Install Script
# This is the main entry point for one-liner installation

set -e

REPO_URL="https://raw.githubusercontent.com/iversonianGremling/SampleSolution/main"
SCRIPT_NAME="lxc-install.sh"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

clear
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Sample Solution - Quick Install${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Downloading installation script...${NC}"
echo ""

# Download the main installation script
curl -fsSL "$REPO_URL/$SCRIPT_NAME" -o /tmp/sample-solution-install.sh

# Make it executable
chmod +x /tmp/sample-solution-install.sh

# Run it
exec /tmp/sample-solution-install.sh "$@"
