# One-Liner Deployment 🚀

Deploy Sample Solution to Proxmox LXC with a single command!

## Quick Start

### On Your Proxmox Host:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/sample-solution/main/install-lxc.sh)"
```

Replace `YOUR_USERNAME` with your GitHub username.

---

## Prerequisites

- ✅ Proxmox VE host
- ✅ GitHub account (to host this repo)
- ✅ Google Cloud credentials

---

## Full Deployment Steps

### 1️⃣ Push to GitHub

```bash
# In your local project directory
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/sample-solution.git
git branch -M main
git push -u origin main
```

### 2️⃣ Update Script URLs

Edit [install-lxc.sh](install-lxc.sh) line 6:

```bash
GITHUB_REPO="${GITHUB_REPO:-YOUR_USERNAME/sample-solution}"
```

Change `YOUR_USERNAME` to your actual GitHub username.

Commit and push:
```bash
git add install-lxc.sh
git commit -m "Update repo URL"
git push
```

### 3️⃣ Run One-Liner on Proxmox

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/sample-solution/main/install-lxc.sh)"
```

This creates an LXC container, installs Docker, and sets everything up.

### 4️⃣ Configure Environment

```bash
# SSH to container (use IP from script output)
ssh root@CONTAINER_IP

# Edit configuration
nano /opt/sample-solution/.env
```

Add your values:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `YOUTUBE_API_KEY`
- `SESSION_SECRET` (generate with: `openssl rand -base64 32`)

### 5️⃣ Complete Installation

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/sample-solution/main/complete-install.sh | bash
```

### 6️⃣ Access Your App

Open your browser:
- Frontend: `http://CONTAINER_IP:3000`
- Backend: `http://CONTAINER_IP:4000`

---

## Alternative: Manual Upload (No GitHub)

If you don't want to use GitHub:

```bash
# 1. Create container with default script
bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/docker.sh)"

# 2. Upload files from local machine
rsync -avz --exclude 'node_modules' --exclude '.git' \
  . root@CONTAINER_IP:/opt/sample-solution/

# 3. SSH and complete setup
ssh root@CONTAINER_IP
cd /opt/sample-solution
nano .env
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

---

## Custom Configuration

```bash
# Custom resources
CTID=200 CT_CORES=8 CT_RAM=16384 CT_DISK=100 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/sample-solution/main/install-lxc.sh)"
```

---

## Management

```bash
# From Proxmox host
pct enter CTID     # Enter container
pct start CTID     # Start
pct stop CTID      # Stop
pct snapshot CTID  # Snapshot

# Inside container
cd /opt/sample-solution
docker compose -f docker-compose.prod.yml logs -f  # View logs
docker compose -f docker-compose.prod.yml restart  # Restart
docker compose -f docker-compose.prod.yml down     # Stop
```

---

## Files Explained

- **[install-lxc.sh](install-lxc.sh)** - Main one-liner installer (run on Proxmox host)
- **[complete-install.sh](complete-install.sh)** - Finishes setup (run inside container)
- **[docker-compose.prod.yml](docker-compose.prod.yml)** - Production Docker config
- **[.env.production.example](.env.production.example)** - Environment template

---

## See Also

- **[GITHUB-DEPLOY.md](GITHUB-DEPLOY.md)** - Detailed GitHub deployment guide
- **[DEPLOY-LXC.md](DEPLOY-LXC.md)** - Complete LXC documentation
- **[LXC-QUICKSTART.md](LXC-QUICKSTART.md)** - Quick reference card

---

**Total deployment time: ~10 minutes** ⚡
