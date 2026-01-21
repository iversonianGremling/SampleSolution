# Proxmox Installation Guide

This guide shows you how to install Sample Solution on Proxmox LXC containers.

## Method 1: Manual Container Setup (Recommended)

This is the most reliable method.

### Step 1: Create LXC Container in Proxmox

1. In Proxmox web UI, click **Create CT**
2. Configure the container:
   - **Hostname**: sample-solution
   - **Template**: Debian 12 (bookworm)
   - **Disk**: 20 GB
   - **CPU**: 2 cores
   - **RAM**: 4096 MB
   - **Network**: DHCP or static IP
   - **Unprivileged**: ✓ Yes

3. **IMPORTANT**: After creating, enable **Nesting**:
   - Select the container
   - Go to **Options** → **Features**
   - Check **nesting**
   - Click **OK**

### Step 2: Start Container and Install

1. Start the container
2. Open the **Console** from Proxmox web UI
3. Login as root (default password is what you set during creation)
4. Run the installation script:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/iversonianGremling/SampleSolution/main/ct/install-in-container.sh)
```

Or download and run manually:

```bash
wget https://raw.githubusercontent.com/iversonianGremling/SampleSolution/main/ct/install-in-container.sh
bash install-in-container.sh
```

### Step 3: Configure Google OAuth

After installation:

1. Note the **nip.io domain** shown in the output (e.g., `http://192-168-1-100.nip.io:3000`)

2. Edit the environment file:
   ```bash
   nano /opt/sample-solution/.env
   ```

3. Add your Google credentials:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `YOUTUBE_API_KEY`

4. In [Google Cloud Console](https://console.cloud.google.com):
   - Go to **Credentials**
   - Add authorized redirect URI:
     ```
     http://YOUR-IP-WITH-DASHES.nip.io:4000/api/auth/google/callback
     ```
     Example: `http://192-168-1-100.nip.io:4000/api/auth/google/callback`

5. Restart services:
   ```bash
   cd /opt/sample-solution
   docker compose -f docker-compose.prod.yml restart
   ```

6. Access your app at:
   ```
   http://YOUR-IP-WITH-DASHES.nip.io:3000
   ```

## Method 2: Automated Script (Advanced)

The [sample-solution.sh](ct/sample-solution.sh) script is designed for automated deployment using Proxmox Community Scripts framework.

**This method requires:**
- Running from Proxmox host (not inside container)
- Proxmox Community Scripts helper functions
- More advanced Proxmox knowledge

If you're not familiar with Proxmox scripting, **use Method 1 instead**.

## Why nip.io?

**Problem**: Google OAuth doesn't accept private IP addresses (like `192.168.1.100`) in redirect URIs.

**Solution**: [nip.io](https://nip.io) is a free DNS service that automatically resolves domains to IPs:
- `192-168-1-100.nip.io` → `192.168.1.100`
- `10-0-0-50.nip.io` → `10.0.0.50`

Since it's a real `.io` domain, Google OAuth accepts it, but it still points to your private IP!

## Troubleshooting

### Docker not starting
```bash
# Check if nesting is enabled
cat /proc/self/status | grep CapEff
# Should show capabilities

# Enable from Proxmox host:
pct set CONTAINER_ID --features nesting=1
```

### Services not accessible
```bash
# Check service status
cd /opt/sample-solution
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs

# Restart services
docker compose -f docker-compose.prod.yml restart
```

### OAuth redirect not working
1. Make sure you're accessing via the **nip.io domain**, not the IP address
2. Verify the redirect URI in Google Cloud Console matches exactly
3. Clear browser cache and cookies
4. Check `.env` file has correct `GOOGLE_REDIRECT_URI`

## Updating the Application

```bash
cd /opt/sample-solution
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
```

## Useful Commands

```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f

# Restart services
docker compose -f docker-compose.prod.yml restart

# Stop services
docker compose -f docker-compose.prod.yml down

# Start services
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps
```
