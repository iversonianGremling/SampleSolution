FROM node:20-bookworm

ARG INSTALL_YTDLP=1
ARG INSTALL_SPOTDL=1

# Install ffmpeg, python, and build tools for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    ffmpeg \
    curl \
    unzip \
    bzip2 \
    jq \
    build-essential \
    g++ \
    make \
    pkg-config \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libsndfile1-dev \
    libfftw3-dev \
    libsamplerate0-dev \
    libyaml-dev \
    libchromaprint-dev \
    libchromaprint-tools \
    && curl https://rclone.org/install.sh | bash \
    && RESTIC_VERSION=$(curl -fsSL https://api.github.com/repos/restic/restic/releases/latest | jq -r '.tag_name' | tr -d 'v') \
    && curl -fsSL "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2" | bunzip2 > /usr/local/bin/restic \
    && chmod +x /usr/local/bin/restic \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (for better layer caching)
COPY requirements.txt ./
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHON_PATH="/opt/venv/bin/python"
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_YTDLP" = "1" ]; then pip install --no-cache-dir --upgrade yt-dlp; fi \
    && if [ "$INSTALL_SPOTDL" = "1" ]; then pip install --no-cache-dir --upgrade spotdl; fi


COPY package*.json ./
# Install and build native modules from source inside container
RUN npm install --build-from-source

COPY . .
RUN npm run build && mkdir -p /app/dist/python && cp -r src/python/* /app/dist/python/

# Create data directory
RUN mkdir -p /app/data/audio /app/data/slices /app/data/peaks

EXPOSE 4000

CMD ["npm", "start"]
