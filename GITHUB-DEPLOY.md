# GitHub One-Liner Deployment

Deploy Sample Solution to Proxmox LXC with a single command, just like the community scripts!

## Prerequisites

1. **Proxmox VE** server (SSH access)
2. **GitHub account** (to host your repo)
3. **Google Cloud credentials** (for YouTube API)

## Setup Instructions

### Step 1: Push Your Code to GitHub

```bash
cd /home/velasco/workspaces/sample_solution

# Initialize git if not already done
git init
git add .
git commit -m "Initial commit"

# Create a new repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/sample-solution.git
git branch -M main
git push -u origin main
```

### Step 2: Update Script with Your Repository

Edit [install-lxc.sh](install-lxc.sh) and change line 6:

```bash
# FROM:
GITHUB_REPO="${GITHUB_REPO:-YOUR_USERNAME/sample_solution}"

# TO:
GITHUB_REPO="${GITHUB_REPO:-your-actual-username/sample-solution}"
```

Also update [complete-install.sh](complete-install.sh) line 3 with your repo URL.

Commit and push:
```bash
git add install-lxc.sh complete-install.sh
git commit -m "Update GitHub repo URLs"
git push
```

### Step 3: Deploy with One Command

On your **Proxmox host**, run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/sample-solution/main/install-lxc.sh)"
```

Replace `YOUR_USERNAME` with your actual GitHub username.

That's it! The script will:
- Create LXC container
- Install Docker
- Download your code from GitHub
- Set up environment

### Step 4: Configure and Start

SSH into your container (use the IP shown by the script):

```bash
# Configure .env
ssh root@CONTAINER_IP
nano /opt/sample-solution/.env
# Add your Google credentials and generate SESSION_SECRET

# Complete installation
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/sample-solution/main/complete-install.sh | bash
```

Or manually:
```bash
cd /opt/sample-solution
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Access at: `http://CONTAINER_IP:3000`

---

## Alternative: Without GitHub (Local Upload)

If you don't want to use GitHub:

### Step 1: Create Container

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/sample-solution/main/install-lxc.sh)"
```

The script will warn about missing GitHub config but continue.

### Step 2: Upload Files Manually

From your local machine:

```bash
rsync -avz --exclude 'node_modules' --exclude '.git' \
  /home/velasco/workspaces/sample_solution/ root@CONTAINER_IP:/opt/sample-solution/
```

### Step 3: Complete Installation

SSH into container and run:

```bash
ssh root@CONTAINER_IP
cd /opt/sample-solution
nano .env  # Configure
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

---

## Usage Examples

### Basic Deployment
```bash
# On Proxmox host
bash -c "$(curl -fsSL https://raw.githubusercontent.com/username/sample-solution/main/install-lxc.sh)"
```

### Custom Configuration
```bash
# Set custom container ID and resources
CTID=200 CT_CORES=6 CT_RAM=12288 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/username/sample-solution/main/install-lxc.sh)"
```

### Complete Installation (inside container)
```bash
curl -fsSL https://raw.githubusercontent.com/username/sample-solution/main/complete-install.sh | bash
```

---

## Environment Variables

The install script supports these environment variables:

- `CTID` - Container ID (default: auto)
- `CT_NAME` - Container name (default: sample-solution)
- `CT_CORES` - CPU cores (default: 4)
- `CT_RAM` - RAM in MB (default: 8192)
- `CT_DISK` - Disk in GB (default: 50)
- `CT_STORAGE` - Storage location (default: local-lvm)
- `GITHUB_REPO` - Your GitHub repo (e.g., username/repo)
- `GITHUB_BRANCH` - Branch to use (default: main)

Example with custom settings:

```bash
CTID=150 CT_CORES=8 CT_RAM=16384 GITHUB_REPO="myuser/my-app" \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/myuser/my-app/main/install-lxc.sh)"
```

---

## What Gets Installed

The one-liner script installs:

1. **Ubuntu 22.04 LXC container** (privileged, Docker-ready)
2. **Docker & Docker Compose** (latest stable)
3. **Your application files** (from GitHub or manual upload)
4. **Environment configuration** (auto-configured with container IP)

Container configuration:
- Nesting enabled (for Docker)
- Keyctl enabled
- AppArmor unconfined
- Auto-start on boot

---

## Updates

To update your deployment:

### Method 1: Update Code on GitHub

```bash
# Push your changes
git add .
git commit -m "Update"
git push

# On Proxmox, recreate container or:
# SSH into container
pct enter CTID
cd /opt/sample-solution
docker compose down
git pull origin main  # If using git
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### Method 2: Re-run Install Script

Creates a new container with latest code:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/username/sample-solution/main/install-lxc.sh)"
```

---

## Repository Structure

For the one-liner to work, your GitHub repo should have:

```
sample-solution/
├── frontend/
├── backend/
├── docker-compose.prod.yml
├── .env.production.example
├── install-lxc.sh              # One-liner installer
├── complete-install.sh         # Completion script
├── GITHUB-DEPLOY.md           # This file
└── README.md
```

---

## Comparison with Community Scripts

Just like https://community-scripts.github.io/ProxmoxVE/scripts:

| Feature | Community Scripts | This Solution |
|---------|------------------|---------------|
| One-liner install | ✅ | ✅ |
| Auto LXC creation | ✅ | ✅ |
| Pre-configured | ✅ | ✅ |
| Updates via GitHub | ✅ | ✅ |
| Custom config | ✅ | ✅ |

**Differences:**
- Community scripts are for standard apps (Docker, Home Assistant, etc.)
- This is for **your custom application**
- Includes your specific code and configuration

---

## Troubleshooting

### Script fails to download

**Check your GitHub repo is public:**
- Go to Settings → Change visibility to Public
- Or use a personal access token for private repos

### Container created but app not running

```bash
# Check Docker is running
pct enter CTID
systemctl status docker

# Check if files were uploaded
ls -la /opt/sample-solution

# Check .env configuration
cat /opt/sample-solution/.env
```

### Can't access the app

```bash
# Check containers are running
docker ps

# Check logs
docker compose -f docker-compose.prod.yml logs

# Verify IP
hostname -I
```

### Update script URLs

If you renamed your repo or changed branch:

```bash
# Edit the script
nano install-lxc.sh

# Update GITHUB_REPO and GITHUB_BRANCH variables
# Commit and push
git commit -am "Update URLs"
git push
```

---

## Security Notes

⚠️ **Important:**

1. **Never commit `.env` with real credentials** to GitHub
   - Use `.env.production.example` as a template
   - Add `.env` to `.gitignore`

2. **Keep SESSION_SECRET secure**
   - Generate a strong random value
   - Don't use the default

3. **Consider private repository** if code contains sensitive logic
   - Use GitHub personal access tokens for authentication
   - Or use manual upload method

4. **Update regularly**
   - Keep Proxmox updated
   - Keep container packages updated: `apt update && apt upgrade`
   - Update Docker images: `docker compose pull`

---

## Advanced: Automated Updates

Create a cron job inside the container to auto-update from GitHub:

```bash
# Inside container
cat > /opt/update-app.sh << 'EOF'
#!/bin/bash
cd /opt/sample-solution
git pull origin main
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
EOF

chmod +x /opt/update-app.sh

# Add to cron (update daily at 2 AM)
echo "0 2 * * * /opt/update-app.sh" | crontab -
```

---

## Support

If you encounter issues:

1. Check [DEPLOY-LXC.md](DEPLOY-LXC.md) for detailed troubleshooting
2. Review container logs: `pct log CTID`
3. Check Docker logs: `docker compose logs`
4. Verify `.env` configuration

---

## Example: Full Deployment Session

```bash
# 1. On your local machine - push to GitHub
cd /home/velasco/workspaces/sample_solution
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/myuser/sample-solution.git
git push -u origin main

# 2. On Proxmox host - deploy
ssh root@proxmox-host
bash -c "$(curl -fsSL https://raw.githubusercontent.com/myuser/sample-solution/main/install-lxc.sh)"
# Note the container IP, e.g., 192.168.1.100

# 3. Configure and complete
ssh root@192.168.1.100
nano /opt/sample-solution/.env
# Add: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YOUTUBE_API_KEY
# Change SESSION_SECRET to: (output of) openssl rand -base64 32
curl -fsSL https://raw.githubusercontent.com/myuser/sample-solution/main/complete-install.sh | bash

# 4. Access
# Open browser: http://192.168.1.100:3000
```

Total time: ~10 minutes (mostly waiting for Docker build)

---

That's it! You now have a community-script-style one-liner deployment for your custom application.
