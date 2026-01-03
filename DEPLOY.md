# Proxmox Deployment Guide

This guide walks you through deploying Sample Solution on a Proxmox server.

## Prerequisites

- Proxmox VE server
- Basic familiarity with SSH and Linux commands
- Google Cloud credentials (see [SETUP.md](SETUP.md))

## Quick Start

### 1. Create a VM in Proxmox

**Recommended specs:**
- **OS**: Ubuntu 22.04 LTS or Debian 12
- **CPU**: 2-4 cores
- **RAM**: 8 GB minimum (Ollama needs ~4GB)
- **Storage**: 50-100 GB
- **Network**: Bridged adapter for easy access

### 2. SSH into Your VM

```bash
ssh user@YOUR_VM_IP
```

### 3. Transfer Application Files

From your local machine:

```bash
# Method 1: Using SCP
cd /home/velasco/workspaces/sample_solution
scp -r * user@YOUR_VM_IP:/tmp/sample-solution/

# Method 2: Using rsync (recommended)
rsync -avz --exclude 'node_modules' --exclude '.git' \
  ./ user@YOUR_VM_IP:/tmp/sample-solution/
```

### 4. Configure Environment

On the VM:

```bash
cd /tmp/sample-solution
cp .env.production.example .env
nano .env  # or use vim/vi
```

Update these values in `.env`:
- Replace `YOUR_VM_IP` with your actual VM IP address
- Add your Google OAuth credentials
- Add your YouTube API key
- Generate and set a strong `SESSION_SECRET`

**Generate a secure session secret:**
```bash
openssl rand -base64 32
```

### 5. Run Deployment Script

```bash
cd /tmp/sample-solution
sudo chmod +x deploy-proxmox.sh
sudo ./deploy-proxmox.sh
```

The script will:
- Install Docker and Docker Compose
- Set up the application in `/opt/sample-solution`
- Build Docker images
- Start all services
- Pull the Ollama AI model

This takes 5-10 minutes depending on your internet speed.

### 6. Access Your Application

Once deployment completes:

- **Frontend**: `http://YOUR_VM_IP:3000`
- **Backend API**: `http://YOUR_VM_IP:4000`
- **Ollama**: `http://YOUR_VM_IP:11434`

## Post-Deployment Configuration

### Update Google OAuth Settings

In your Google Cloud Console, add these to your OAuth 2.0 credentials:

**Authorized JavaScript origins:**
```
http://YOUR_VM_IP:3000
```

**Authorized redirect URIs:**
```
http://YOUR_VM_IP:4000/api/auth/google/callback
```

### Open Firewall Ports (if needed)

If you can't access the app, you may need to open ports:

```bash
# On the VM
sudo ufw allow 3000/tcp
sudo ufw allow 4000/tcp
sudo ufw allow 11434/tcp
```

## Management Commands

All commands should be run from `/opt/sample-solution`:

```bash
cd /opt/sample-solution
```

### View Logs
```bash
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml logs -f backend  # Just backend
docker compose -f docker-compose.prod.yml logs -f frontend # Just frontend
```

### Stop Application
```bash
docker compose -f docker-compose.prod.yml down
```

### Start Application
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

### Restart Application
```bash
docker compose -f docker-compose.prod.yml restart
```

### Update Application

Re-run the deployment script with new files:

```bash
# Transfer new files from your local machine
rsync -avz --exclude 'node_modules' \
  /home/velasco/workspaces/sample_solution/ user@YOUR_VM_IP:/tmp/sample-solution/

# On the VM, run deployment script again
cd /tmp/sample-solution
sudo ./deploy-proxmox.sh
```

### View Container Status
```bash
docker compose -f docker-compose.prod.yml ps
```

### Access Container Shell
```bash
docker compose -f docker-compose.prod.yml exec backend sh
docker compose -f docker-compose.prod.yml exec frontend sh
```

### Pull Ollama Model (if not done automatically)
```bash
docker compose -f docker-compose.prod.yml exec ollama ollama pull llama3.2:3b
```

## Advanced Configuration

### Using a Domain Name

If you have a domain pointing to your VM:

1. Update `.env`:
```bash
API_URL=http://yourdomain.com:4000
FRONTEND_URL=http://yourdomain.com:3000
GOOGLE_REDIRECT_URI=http://yourdomain.com:4000/api/auth/google/callback
```

2. Restart the app:
```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

### Reverse Proxy with SSL (Recommended)

For production use, set up nginx with Let's Encrypt:

1. Install nginx:
```bash
sudo apt install nginx certbot python3-certbot-nginx
```

2. Create nginx config at `/etc/nginx/sites-available/sample-solution`:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

3. Enable and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/sample-solution /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com
```

### Backup Data

Your data is stored in Docker volumes. To backup:

```bash
# Backup database and audio files
docker run --rm -v sample-solution_sample_data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/sample-data-backup-$(date +%Y%m%d).tar.gz /data

# Backup Ollama models
docker run --rm -v sample-solution_ollama_data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/ollama-backup-$(date +%Y%m%d).tar.gz /data
```

### Auto-Start on Boot

Docker containers with `restart: unless-stopped` will automatically start when the VM boots.

To ensure Docker starts on boot:
```bash
sudo systemctl enable docker
```

## Troubleshooting

### Containers won't start
```bash
# Check logs
docker compose -f docker-compose.prod.yml logs

# Check .env file
cat .env

# Verify Docker is running
sudo systemctl status docker
```

### Can't access from other machines
```bash
# Check if ports are listening
sudo netstat -tlnp | grep -E '3000|4000'

# Check firewall
sudo ufw status
```

### Out of memory
```bash
# Check memory usage
docker stats

# Ollama is memory-intensive - you may need to upgrade RAM
# Or reduce Ollama's memory reservation in docker-compose.prod.yml
```

### Google OAuth not working
- Verify redirect URIs in Google Cloud Console match your `.env`
- Check that `FRONTEND_URL` and `API_URL` are correct
- Ensure you're using `http://` not `https://` (unless you set up SSL)

## Monitoring

### Resource Usage
```bash
# Overall
docker stats

# Disk usage
docker system df
```

### Check Application Health
```bash
# Backend health
curl http://localhost:4000/api/health

# Frontend
curl http://localhost:3000
```

## Security Considerations

⚠️ **Important for production:**

1. **Change default ports** or use a reverse proxy
2. **Enable HTTPS** with Let's Encrypt
3. **Use strong `SESSION_SECRET`**
4. **Keep system updated**: `sudo apt update && sudo apt upgrade`
5. **Limit SSH access** with SSH keys only
6. **Enable firewall**: `sudo ufw enable`
7. **Regular backups** of data volumes

## Support

- See [SETUP.md](SETUP.md) for Google API setup
- See [README.md](README.md) for application usage
- Check Docker logs for errors
- Verify all environment variables are set correctly
