#!/usr/bin/env bash
source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func)
# Copyright (c) 2025
# Author: iversonianGremling
# License: MIT
# Source: https://github.com/iversonianGremling/SampleSolution

APP="Sample-Solution"
var_tags="audio;music;youtube"
var_cpu="2"
var_ram="4096"
var_disk="20"
var_os="debian"
var_version="12"
var_unprivileged="1"

header_info "$APP"
variables
color
catch_errors

function update_script() {
    header_info
    check_container_storage
    check_container_resources
    if [[ ! -d /opt/sample-solution ]]; then
        msg_error "No ${APP} Installation Found!"
        exit
    fi
    msg_info "Updating ${APP}"
    cd /opt/sample-solution
    git fetch origin
    git pull origin main
    docker compose -f docker-compose.prod.yml pull
    docker compose -f docker-compose.prod.yml up -d --build
    msg_ok "Updated ${APP}"
    exit
}

start
build_container
description

msg_ok "Completed Successfully!\n"

msg_info "Setting Up Container OS"
# Remove enterprise Proxmox repositories if they exist (not needed for Debian containers)
if [ -f /etc/apt/sources.list.d/pve-enterprise.list ]; then
    rm -f /etc/apt/sources.list.d/pve-enterprise.list
fi
if [ -f /etc/apt/sources.list.d/ceph.list ]; then
    rm -f /etc/apt/sources.list.d/ceph.list
fi
# Disable enterprise repos in sources.list if present
if [ -f /etc/apt/sources.list ]; then
    sed -i '/enterprise.proxmox.com/d' /etc/apt/sources.list
fi
$STD apt-get update
$STD apt-get -y upgrade
msg_ok "Set Up Container OS"

msg_info "Installing Dependencies"
$STD apt-get install -y \
    curl \
    sudo \
    git \
    make \
    gnupg \
    ca-certificates
msg_ok "Installed Dependencies"

msg_info "Installing Docker"
$STD sh <(curl -sSL https://get.docker.com)
$STD apt-get install -y docker-compose-plugin
systemctl enable --now docker
sleep 2
docker --version
docker compose version
msg_ok "Installed Docker"

msg_info "Cloning Repository"
cd /opt
$STD git clone https://github.com/iversonianGremling/SampleSolution.git sample-solution
msg_ok "Cloned Repository"

msg_info "Setting Up Environment"
cd /opt/sample-solution
CONTAINER_IP=$(hostname -I | awk '{print $1}')

if [ -f .env.production.example ]; then
    cp .env.production.example .env
    sed -i "s/YOUR_VM_IP/$CONTAINER_IP/g" .env
else
    cat > .env << EOF
API_URL=http://$CONTAINER_IP:4000
FRONTEND_URL=http://$CONTAINER_IP:3000
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://$CONTAINER_IP:4000/api/auth/google/callback
YOUTUBE_API_KEY=your-youtube-api-key
SESSION_SECRET=CHANGE-THIS-TO-A-LONG-RANDOM-STRING
NODE_ENV=production
EOF
fi
msg_ok "Set Up Environment"

msg_info "Building Application"
$STD docker compose -f docker-compose.prod.yml build
msg_ok "Built Application"

msg_info "Starting Services"
$STD docker compose -f docker-compose.prod.yml up -d
msg_ok "Started Services"

msg_info "Verifying Docker Status"
systemctl is-active --quiet docker && msg_ok "Docker daemon is running" || msg_error "Docker daemon is not running"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -v "NAMES"
msg_ok "Docker containers verified"

msg_info "Pulling AI Model (Background)"
docker compose -f docker-compose.prod.yml exec -T ollama ollama pull llama3.2:3b 2>/dev/null &
msg_ok "AI Model Pull Started"

msg_info "Configuring Root Access"
passwd -d root
msg_ok "Configured Root Access"

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:3000${CL}"
echo -e ""
echo -e "${INFO}${YW} Login via SSH:${CL}"
echo -e "${TAB}${GATEWAY}${CL}ssh root@${IP} (no password required)"
echo -e ""
echo -e "${INFO}${YW} Configure credentials at:${CL}"
echo -e "${TAB}${GATEWAY}${CL}/opt/sample-solution/.env"
echo -e ""
echo -e "${INFO}${YW} Then restart with:${CL}"
echo -e "${TAB}${GATEWAY}${CL}docker compose -f /opt/sample-solution/docker-compose.prod.yml restart"
