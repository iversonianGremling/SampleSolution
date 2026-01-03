#!/usr/bin/env bash
source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func)
# Copyright (c) 2025
# License: MIT
# Source: https://github.com/iversonianGremling/SampleSolution

APP="Sample-Solution"
var_tags="audio;music;youtube"
var_cpu="2"
var_ram="4096"
var_disk="20"
var_os="debian"
var_version="12"
var_unprivileged="0"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  msg_info "Updating $APP"
  cd /opt/sample-solution

  # Pull latest changes
  git fetch origin
  git pull origin main

  # Rebuild and restart
  docker compose -f docker-compose.prod.yml pull
  docker compose -f docker-compose.prod.yml up -d --build

  msg_ok "Updated $APP"
  exit
}

start
build_container
description

msg_ok "Container Created"

msg_info "Installing Dependencies"
$STD apt-get update
$STD apt-get install -y curl ca-certificates gnupg git
msg_ok "Dependencies Installed"

msg_info "Installing Docker"
$STD bash <(curl -fsSL https://get.docker.com)
msg_ok "Docker Installed"

msg_info "Cloning Repository"
cd /opt
$STD git clone https://github.com/iversonianGremling/SampleSolution.git sample-solution
msg_ok "Repository Cloned"

msg_info "Setting up Environment"
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
msg_ok "Environment Configured"

msg_info "Building Application (this may take a few minutes)"
$STD docker compose -f docker-compose.prod.yml build
msg_ok "Application Built"

msg_info "Starting Services"
$STD docker compose -f docker-compose.prod.yml up -d
msg_ok "Services Started"

msg_info "Pulling AI Model"
docker compose -f docker-compose.prod.yml exec -T ollama ollama pull llama3.2:3b 2>/dev/null || msg_warn "AI model pull failed - run manually later"
msg_ok "Setup Complete"

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} has been installed!${CL}"
echo -e "${INFO}${YW} Access the application at:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:3000${CL}"
echo -e ""
echo -e "${INFO}${YW} Configure credentials at:${CL}"
echo -e "${TAB}${GATEWAY}${CL}/opt/sample-solution/.env"
echo -e ""
echo -e "${INFO}${YW} Then restart with:${CL}"
echo -e "${TAB}${GATEWAY}${CL}docker compose -f /opt/sample-solution/docker-compose.prod.yml restart"
