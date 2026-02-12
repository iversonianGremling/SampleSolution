#!/bin/bash
set -e

echo "🐍 Setting up embedded Python runtime..."
echo ""

PYTHON_VERSION="3.11"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON_DIR="$PROJECT_DIR/embedded-python"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

echo "Platform: $OS-$ARCH"
echo "Target directory: $PYTHON_DIR"
echo ""

# Clean previous installation
if [ -d "$PYTHON_DIR" ]; then
    echo "Removing previous Python installation..."
    rm -rf "$PYTHON_DIR"
fi

mkdir -p "$PYTHON_DIR"

# Download Python standalone build
echo "📥 Downloading Python standalone build..."

if [ "$OS" = "linux" ]; then
    if [ "$ARCH" = "x86_64" ]; then
        URL="https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-unknown-linux-gnu-install_only.tar.gz"
    else
        echo "❌ Unsupported architecture: $ARCH"
        exit 1
    fi
elif [ "$OS" = "darwin" ]; then
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
        URL="https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-aarch64-apple-darwin-install_only.tar.gz"
    elif [ "$ARCH" = "x86_64" ]; then
        URL="https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-apple-darwin-install_only.tar.gz"
    else
        echo "❌ Unsupported architecture: $ARCH"
        exit 1
    fi
else
    echo "❌ Unsupported OS: $OS"
    echo "For Windows, download from: https://github.com/indygreg/python-build-standalone/releases"
    exit 1
fi

# Download
TEMP_FILE="$PROJECT_DIR/python-standalone.tar.gz"
echo "Downloading from: $URL"
curl -L -o "$TEMP_FILE" "$URL"

# Extract
echo "📦 Extracting Python..."
tar -xzf "$TEMP_FILE" -C "$PYTHON_DIR" --strip-components=1

# Cleanup
rm "$TEMP_FILE"

# Find Python executable
if [ -f "$PYTHON_DIR/bin/python3" ]; then
    PYTHON_BIN="$PYTHON_DIR/bin/python3"
elif [ -f "$PYTHON_DIR/bin/python" ]; then
    PYTHON_BIN="$PYTHON_DIR/bin/python"
else
    echo "❌ Python executable not found!"
    exit 1
fi

# Test Python
echo ""
echo "Testing Python installation..."
"$PYTHON_BIN" --version

# Upgrade pip
echo ""
echo "📦 Upgrading pip..."
"$PYTHON_BIN" -m pip install --upgrade pip

# Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."

# Create requirements file if it doesn't exist
REQUIREMENTS_FILE="$PROJECT_DIR/../backend/python-requirements.txt"
if [ ! -f "$REQUIREMENTS_FILE" ]; then
    echo "Creating python-requirements.txt..."
    cat > "$REQUIREMENTS_FILE" << 'EOF'
numpy==1.24.3
librosa==0.10.1
scipy==1.11.4
scikit-learn==1.3.2
soundfile==0.12.1
EOF
fi

# Install requirements
"$PYTHON_BIN" -m pip install -r "$REQUIREMENTS_FILE"

echo ""
echo "Testing Python imports..."
"$PYTHON_BIN" -c "import numpy; print(f'✓ numpy {numpy.__version__}')"
"$PYTHON_BIN" -c "import librosa; print(f'✓ librosa {librosa.__version__}')"
"$PYTHON_BIN" -c "import scipy; print(f'✓ scipy {scipy.__version__}')"
"$PYTHON_BIN" -c "import sklearn; print(f'✓ scikit-learn {sklearn.__version__}')"

echo ""
echo "✅ Python setup complete!"
echo "   Location: $PYTHON_DIR"
echo "   Executable: $PYTHON_BIN"
echo ""
