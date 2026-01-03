#!/usr/bin/env bash

# Sample Solution - Credentials Checker
# Quick script to verify if all required credentials are configured

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_ok() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Find .env file
ENV_FILE=""
if [ -f ".env" ]; then
    ENV_FILE=".env"
elif [ -f "backend/.env" ]; then
    ENV_FILE="backend/.env"
elif [ -f "/opt/sample-solution/.env" ]; then
    ENV_FILE="/opt/sample-solution/.env"
else
    print_error "No .env file found!"
    echo "Searched in: .env, backend/.env, /opt/sample-solution/.env"
    exit 1
fi

echo ""
echo -e "${BLUE}Checking credentials in: $ENV_FILE${NC}"
echo ""

MISSING_CREDS=0

# Check YouTube API Key
if ! grep -q "^YOUTUBE_API_KEY=.\+$" "$ENV_FILE" 2>/dev/null || \
   grep -q "^YOUTUBE_API_KEY=your" "$ENV_FILE" 2>/dev/null || \
   grep -q "^YOUTUBE_API_KEY=$" "$ENV_FILE" 2>/dev/null; then
    print_error "YOUTUBE_API_KEY not configured"
    MISSING_CREDS=1
else
    print_ok "YOUTUBE_API_KEY configured"
fi

# Check Google Client ID
if ! grep -q "^GOOGLE_CLIENT_ID=.\+$" "$ENV_FILE" 2>/dev/null || \
   grep -q "^GOOGLE_CLIENT_ID=your" "$ENV_FILE" 2>/dev/null || \
   grep -q "^GOOGLE_CLIENT_ID=$" "$ENV_FILE" 2>/dev/null; then
    print_error "GOOGLE_CLIENT_ID not configured"
    MISSING_CREDS=1
else
    print_ok "GOOGLE_CLIENT_ID configured"
fi

# Check Google Client Secret
if ! grep -q "^GOOGLE_CLIENT_SECRET=.\+$" "$ENV_FILE" 2>/dev/null || \
   grep -q "^GOOGLE_CLIENT_SECRET=your" "$ENV_FILE" 2>/dev/null || \
   grep -q "^GOOGLE_CLIENT_SECRET=GOCSPX-your" "$ENV_FILE" 2>/dev/null || \
   grep -q "^GOOGLE_CLIENT_SECRET=$" "$ENV_FILE" 2>/dev/null; then
    print_error "GOOGLE_CLIENT_SECRET not configured"
    MISSING_CREDS=1
else
    print_ok "GOOGLE_CLIENT_SECRET configured"
fi

# Check Session Secret
if ! grep -q "^SESSION_SECRET=.\+$" "$ENV_FILE" 2>/dev/null || \
   grep -q "^SESSION_SECRET=CHANGE-THIS" "$ENV_FILE" 2>/dev/null || \
   grep -q "^SESSION_SECRET=your" "$ENV_FILE" 2>/dev/null || \
   grep -q "^SESSION_SECRET=$" "$ENV_FILE" 2>/dev/null; then
    print_error "SESSION_SECRET not configured (or using default value)"
    MISSING_CREDS=1
else
    print_ok "SESSION_SECRET configured"
fi

echo ""

if [ $MISSING_CREDS -eq 1 ]; then
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}Configuration Incomplete${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "Please edit $ENV_FILE and add the missing credentials."
    echo ""
    echo -e "${BLUE}Required credentials:${NC}"
    echo "  YOUTUBE_API_KEY         - Get from Google Cloud Console"
    echo "  GOOGLE_CLIENT_ID        - OAuth 2.0 Client ID"
    echo "  GOOGLE_CLIENT_SECRET    - OAuth 2.0 Client Secret"
    echo "  SESSION_SECRET          - Generate with: openssl rand -base64 32"
    echo ""
    echo -e "${BLUE}After updating credentials, restart your application:${NC}"
    echo "  # If using Docker:"
    echo "  docker compose restart"
    echo ""
    echo "  # If running locally:"
    echo "  cd backend && npm run dev"
    echo ""
    exit 1
else
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}All Credentials Configured!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Your application is ready to use."
    echo ""
    exit 0
fi
