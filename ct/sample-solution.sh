#!/usr/bin/env bash
source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func)

# --- Configuration ---
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

# --- Host-Level Automation ---
msg_info "Enabling Docker Features (Nesting & Keyctl)"
# This allows Docker to run inside the LXC without permission errors
pct set $CTID --features nesting=1,keyctl=1
msg_ok "Features Enabled"

# --- Container-Level Setup ---
description

msg_info "Fixing Repositories (Removing Enterprise Errors)"
# Direct overwrite to stop the 401 Unauthorized errors
$STD bash -c "cat <<EOF > /etc/apt/sources.list
deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
EOF"

$STD bash -c "rm -f /etc/apt/sources.list.d/pve-enterprise.list /etc/apt/sources.list.d/ceph.list"
$STD apt-get update
$STD apt-get -y upgrade
msg_ok "Repositories Sanitized"

msg_info "Installing Dependencies"
$STD apt-get install -y curl sudo git make gnupg fuse-overlayfs ca-certificates
msg_ok "Dependencies Installed"

msg_info "Installing Docker"
$STD sh <(curl -sSL https://get.docker.com)
$STD apt-get install -y docker-compose-plugin
systemctl enable --now docker
msg_ok "Docker Installed"

msg_info "Cloning Repository"
cd /opt
if [ -d "sample-solution" ]; then rm -rf sample-solution; fi
$STD git clone https://github.com/iversonianGremling/SampleSolution.git sample-solution
msg_ok "Repository Cloned"

msg_info "Setting Up Environment"
cd /opt/sample-solution
CONTAINER_IP=$(hostname -I | awk '{print $1}')

if [ -f .env.production.example ]; then
    cp .env.production.example .env
    sed -i "s/YOUR_VM_IP/$CONTAINER_IP/g" .env
else
    SESSION_SECRET=$(openssl rand -hex 32)
    cat > .env << EOF
API_URL=http://$CONTAINER_IP:4000
FRONTEND_URL=http://$CONTAINER_IP:3000
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://$CONTAINER_IP:4000/api/auth/google/callback
YOUTUBE_API_KEY=your-youtube-api-key
SESSION_SECRET=$SESSION_SECRET
NODE_ENV=production
EOF
fi
msg_ok "Environment Configured"

msg_info "Building & Starting Services (This takes a few minutes)"
$STD docker compose -f docker-compose.prod.yml up -d --build
msg_ok "Services Started"

msg_info "Pulling AI Model (Background)"
sleep 5
docker compose -f docker-compose.prod.yml exec -T ollama ollama pull llama3.2:3b >/dev/null 2>&1 &
msg_ok "AI Model Pulling"

# --- New Health Check Block ---
msg_info "Verifying Web Interface Accessibility"
MAX_RETRIES=12
RETRY_COUNT=0
SUCCESS=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  # Check if port 3000 returns a valid HTTP status code
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://${IP}:3000 || echo "000")
  
  if [ "$HTTP_STATUS" == "200" ]; then
    SUCCESS=true
    break
  fi
  
  RETRY_COUNT=$((RETRY_COUNT+1))
  sleep 5
done

if [ "$SUCCESS" = true ]; then
  msg_ok "Health Check Passed: Application is reachable at http://${IP}:3000"
else
  msg_warn "Health Check Timeout: The service might still be starting or check your firewall."
fi

msg_info "Finalizing"
passwd -d root
msg_ok "Root Access Configured"

msg_ok "Completed Successfully!\n"
echo -e "${GN}${APP} is fully automated and running!${CL}"
echo -e "${YW}Access URL: ${BL}http://${IP}:3000${CL}"
