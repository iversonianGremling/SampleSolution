# Proxmox LXC Deployment Guide

Deploy Sample Solution in a lightweight Proxmox LXC container with Docker support.

## Why LXC?

- **More efficient**: Lower overhead than VMs
- **Faster startup**: Boots in seconds
- **Better resource sharing**: Near-native performance
- **Easier snapshots/backups**: Built-in Proxmox integration

## Quick Start (Automated)

### Step 1: Run LXC Creation Script on Proxmox Host

From your local machine, transfer the script to Proxmox:

```bash
scp proxmox-lxc-create.sh root@proxmox-host:/root/
```

On your Proxmox host:

```bash
cd /root
chmod +x proxmox-lxc-create.sh
./proxmox-lxc-create.sh
```

The script will:
- Create an LXC container with Ubuntu 22.04
- Configure it for Docker (privileged mode, nesting enabled)
- Set up networking with DHCP
- Provide the container IP address

**Recommended specs** (you'll be prompted):
- **CPU**: 4 cores
- **RAM**: 8192 MB
- **Disk**: 50 GB
- **Storage**: local-lvm (or your preferred storage)

### Step 2: Transfer Application Files

**Option A - From your local machine:**

```bash
# Get the container IP from the script output, then:
rsync -avz --exclude 'node_modules' --exclude '.git' \
  /home/velasco/workspaces/sample_solution/ root@CONTAINER_IP:/tmp/sample-solution/
```

**Option B - From Proxmox host:**

```bash
# Upload your files to Proxmox first
scp -r /home/velasco/workspaces/sample_solution root@proxmox-host:/tmp/

# Then on Proxmox host, push to container (replace 100 with your CT ID)
pct push 100 /tmp/sample_solution /tmp/sample-solution -r
```

**Option C - Using Git (if you have a repository):**

```bash
# Enter the container
pct enter 100

# Clone your repository
cd /tmp
git clone https://github.com/yourusername/sample-solution.git
```

### Step 3: Transfer and Run Installation Script

**From your local machine:**

```bash
scp lxc-install.sh root@CONTAINER_IP:/root/
ssh root@CONTAINER_IP
```

**Or from Proxmox host:**

```bash
pct push 100 lxc-install.sh /root/lxc-install.sh
pct enter 100
```

**Then inside the container:**

```bash
chmod +x /root/lxc-install.sh
/root/lxc-install.sh
```

The installation script will:
- Install Docker and dependencies
- Copy application files to `/opt/sample-solution`
- Create and configure `.env` file
- Build Docker images
- Start all services
- Pull Ollama model

### Step 4: Configure Environment

The script will auto-create `.env` and set the container IP. You need to add:

```bash
nano /opt/sample-solution/.env
```

Required values:
- `GOOGLE_CLIENT_ID` - From Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
- `YOUTUBE_API_KEY` - From Google Cloud Console
- `SESSION_SECRET` - Generate with: `openssl rand -base64 32`

The script already set:
- `API_URL=http://CONTAINER_IP:4000`
- `FRONTEND_URL=http://CONTAINER_IP:3000`
- `GOOGLE_REDIRECT_URI=http://CONTAINER_IP:4000/api/auth/google/callback`

### Step 5: Start Application

If you didn't start it during installation:

```bash
cd /opt/sample-solution
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

### Step 6: Access Application

- **Frontend**: `http://CONTAINER_IP:3000`
- **Backend**: `http://CONTAINER_IP:4000`
- **Ollama**: `http://CONTAINER_IP:11434`

## Manual LXC Setup

If you prefer to create the container manually:

### 1. Create LXC Container in Proxmox Web UI

**Container settings:**
- Template: Ubuntu 22.04
- Disk: 50GB
- CPU: 4 cores
- Memory: 8192 MB
- Network: Bridge (vmbr0), DHCP

**Important - Options tab:**
- Features: Enable "Nesting" and "Keyctl"
- Set as **Privileged** container

### 2. Additional Configuration

On Proxmox host, edit `/etc/pve/lxc/<CTID>.conf`:

```bash
nano /etc/pve/lxc/100.conf  # Replace 100 with your container ID
```

Add these lines:

```
# Docker support
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop:
lxc.mount.auto: "proc:rw sys:rw"
```

### 3. Start Container and Continue

```bash
pct start 100
pct enter 100
```

Then follow Steps 2-6 from the automated section above.

## Container Management

### From Proxmox Host

```bash
# Start container
pct start 100

# Stop container
pct stop 100

# Enter container
pct enter 100

# View container config
pct config 100

# Create snapshot
pct snapshot 100 before-update

# Restore snapshot
pct rollback 100 before-update

# Destroy container (careful!)
pct destroy 100
```

### Inside Container

```bash
# View application logs
cd /opt/sample-solution
docker compose -f docker-compose.prod.yml logs -f

# Stop application
docker compose -f docker-compose.prod.yml down

# Start application
docker compose -f docker-compose.prod.yml --env-file .env up -d

# Restart application
docker compose -f docker-compose.prod.yml restart

# View container status
docker compose -f docker-compose.prod.yml ps

# Update Ollama model
docker compose -f docker-compose.prod.yml exec ollama ollama pull llama3.2:3b
```

## Updating Application

### Method 1: Re-run Installation Script

```bash
# Transfer new files
rsync -avz --exclude 'node_modules' \
  /home/velasco/workspaces/sample_solution/ root@CONTAINER_IP:/tmp/sample-solution/

# Enter container and run install script
pct enter 100
/root/lxc-install.sh
```

The script automatically backs up the existing installation.

### Method 2: Manual Update

```bash
# Enter container
pct enter 100

# Stop application
cd /opt/sample-solution
docker compose -f docker-compose.prod.yml down

# Backup current version
cp -r /opt/sample-solution /opt/sample-solution-backup-$(date +%Y%m%d)

# Copy new files (after uploading to /tmp/sample-solution)
cp -r /tmp/sample-solution/* /opt/sample-solution/

# Rebuild and restart
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

## Backups

### Proxmox Backup (Recommended)

**Create backup:**
```bash
vzdump 100 --compress zstd --mode snapshot --storage local
```

**Restore from backup:**
```bash
pct restore 100 /var/lib/vz/dump/vzdump-lxc-100-*.tar.zst
```

**Automated backups:**
Configure in Proxmox UI: Datacenter → Backup → Add

### Application Data Backup

```bash
# Enter container
pct enter 100

# Backup Docker volumes
cd /opt/sample-solution
docker run --rm \
  -v sample-solution_sample_data:/data \
  -v $(pwd):/backup \
  ubuntu tar czf /backup/data-backup-$(date +%Y%m%d).tar.gz /data
```

## Networking

### Access from LAN

Container gets DHCP IP by default. Access directly via that IP.

### Static IP (Optional)

On Proxmox host, edit container config:

```bash
pct set 100 -net0 name=eth0,bridge=vmbr0,firewall=1,ip=192.168.1.100/24,gw=192.168.1.1
```

Update `.env` file inside container with new IP.

### Port Forwarding (Optional)

To access from outside your network, set up port forwarding on Proxmox host:

```bash
# Add to /etc/network/interfaces or use iptables
iptables -t nat -A PREROUTING -p tcp --dport 3000 -j DNAT --to-destination CONTAINER_IP:3000
iptables -t nat -A PREROUTING -p tcp --dport 4000 -j DNAT --to-destination CONTAINER_IP:4000
```

### Reverse Proxy with SSL

For production, set up nginx in another container or on Proxmox host.

**Example nginx config:**
```nginx
server {
    listen 80;
    server_name sample.yourdomain.com;

    location / {
        proxy_pass http://CONTAINER_IP:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api {
        proxy_pass http://CONTAINER_IP:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then add SSL with Let's Encrypt:
```bash
certbot --nginx -d sample.yourdomain.com
```

## Resource Monitoring

### Container Resources

```bash
# From Proxmox host
pct exec 100 -- df -h        # Disk usage
pct exec 100 -- free -h      # Memory usage
pct exec 100 -- top -bn1     # CPU usage
```

### Application Resources

```bash
# Inside container
docker stats
docker compose -f docker-compose.prod.yml ps
```

## Troubleshooting

### Docker won't start in container

**Check container is privileged and has nesting:**
```bash
# On Proxmox host
pct config 100 | grep -E "unprivileged|features"
```

Should show:
```
features: keyctl=1,nesting=1
unprivileged: 0
```

**Check AppArmor profile:**
```bash
cat /etc/pve/lxc/100.conf | grep apparmor
```

Should have:
```
lxc.apparmor.profile: unconfined
```

### Container won't start

```bash
# Check logs
pct log 100 tail -n 50

# Try starting in foreground
pct start 100 --debug
```

### Out of disk space

```bash
# Check disk usage
pct exec 100 -- df -h

# Clean Docker
pct exec 100 -- docker system prune -af
pct exec 100 -- docker volume prune -f

# Resize disk (on Proxmox host)
pct resize 100 rootfs +20G
```

### Out of memory

```bash
# Increase RAM (on Proxmox host)
pct set 100 -memory 12288  # 12GB

# Restart container
pct stop 100
pct start 100
```

### Network issues

```bash
# Inside container, check IP
ip addr show

# Restart networking
systemctl restart networking

# From Proxmox host, reconfigure
pct set 100 -net0 name=eth0,bridge=vmbr0,firewall=1,ip=dhcp
```

## Performance Tips

1. **Use local storage** for container disk (faster than network storage)
2. **Enable CPU passthrough** in container options
3. **Disable swap** if you have enough RAM
4. **Use overlay2** storage driver for Docker (default in Ubuntu 22.04)
5. **Regular cleanup**:
   ```bash
   docker system prune -af --volumes
   ```

## Security Considerations

⚠️ **Privileged containers** have less isolation than VMs:

- Use firewall rules to restrict access
- Keep container and host updated
- Don't expose container SSH to internet
- Use strong passwords/keys
- Consider unprivileged container + Docker (more complex setup)

## Advantages over VM

- **Resource efficiency**: Uses ~200-300MB RAM when idle vs ~1GB+ for VM
- **Faster backups**: Snapshot in seconds
- **Quick clones**: Duplicate container instantly
- **Lower overhead**: Near-native performance
- **Easier migration**: Move between Proxmox hosts easily

## Community Scripts Integration

This deployment is similar to the scripts at https://community-scripts.github.io/ProxmoxVE/scripts

You can integrate it into that ecosystem by:

1. Creating a helper script wrapper
2. Adding to your personal Proxmox scripts collection
3. Automating with Proxmox API

The [proxmox-lxc-create.sh](proxmox-lxc-create.sh) script follows the same patterns as those community scripts.
