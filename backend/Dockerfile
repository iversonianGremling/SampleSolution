FROM node:20-bookworm

# Install yt-dlp, ffmpeg, python, and build tools for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    build-essential \
    g++ \
    make \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (for better layer caching)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY package*.json ./
# Install and build native modules from source inside container
RUN npm install --build-from-source

COPY . .
RUN npm run build && mkdir -p /app/dist/python && cp -r src/python/* /app/dist/python/

# Create data directory
RUN mkdir -p /app/data/audio /app/data/slices /app/data/peaks

EXPOSE 4000

CMD ["npm", "start"]
