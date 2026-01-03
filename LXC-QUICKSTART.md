# LXC Quick Start Guide

**One-page reference for deploying Sample Solution on Proxmox LXC**

## 1️⃣ Create Container (On Proxmox Host)

```bash
# Upload and run creation script
scp proxmox-lxc-create.sh root@proxmox-host:/root/
ssh root@proxmox-host
chmod +x proxmox-lxc-create.sh
./proxmox-lxc-create.sh
```

Follow prompts. Note the **Container ID** and **IP address**.

## 2️⃣ Upload Files

```bash
# From your local machine (replace CONTAINER_IP)
rsync -avz --exclude 'node_modules' --exclude '.git' \
  /home/velasco/workspaces/sample_solution/ root@CONTAINER_IP:/tmp/sample-solution/
```

## 3️⃣ Install Application

```bash
# Transfer install script
scp lxc-install.sh root@CONTAINER_IP:/root/

# SSH into container
ssh root@CONTAINER_IP

# Run installation
chmod +x /root/lxc-install.sh
/root/lxc-install.sh
```

## 4️⃣ Configure .env

```bash
nano /opt/sample-solution/.env
```

**Add these values:**
- `GOOGLE_CLIENT_ID` - From Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
- `YOUTUBE_API_KEY` - From Google Cloud Console
- `SESSION_SECRET` - Generate: `openssl rand -base64 32`

**IP is already set!** The script auto-filled it.

## 5️⃣ Access App

- Frontend: `http://CONTAINER_IP:3000`
- Backend: `http://CONTAINER_IP:4000`

---

## Quick Commands

### Proxmox Host Commands

```bash
pct enter 100          # Enter container (replace 100 with your CT ID)
pct start 100          # Start container
pct stop 100           # Stop container
pct restart 100        # Restart container
pct snapshot 100 snap1 # Create snapshot
pct list               # List all containers
```

### Inside Container

```bash
cd /opt/sample-solution

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Stop app
docker compose -f docker-compose.prod.yml down

# Start app
docker compose -f docker-compose.prod.yml --env-file .env up -d

# Restart app
docker compose -f docker-compose.prod.yml restart

# Check status
docker compose -f docker-compose.prod.yml ps

# Update Ollama model
docker compose -f docker-compose.prod.yml exec ollama ollama pull llama3.2:3b
```

---

## Troubleshooting

**Can't access the app?**
```bash
# Check containers are running
docker compose -f docker-compose.prod.yml ps

# Check firewall
ufw status
```

**Docker errors?**
```bash
# Check Docker is running
systemctl status docker

# Restart Docker
systemctl restart docker
```

**Need to edit .env again?**
```bash
nano /opt/sample-solution/.env
docker compose -f docker-compose.prod.yml restart
```

---

## Update App

```bash
# Upload new files to /tmp/sample-solution
# Then re-run install script
/root/lxc-install.sh
```

---

## Backup

```bash
# From Proxmox host (replace 100 with CT ID)
vzdump 100 --compress zstd --mode snapshot --storage local
```

---

**Full docs:** [DEPLOY-LXC.md](DEPLOY-LXC.md)
