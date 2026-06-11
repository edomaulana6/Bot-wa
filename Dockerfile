# ──────────────────────────────────────────────────────────────
# Dockerfile — WA Music Bot (Koyeb)
# ──────────────────────────────────────────────────────────────
FROM node:20-slim

# Install ffmpeg (wajib untuk audio) + dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files dulu (cache layer)
COPY package.json ./
RUN npm install --omit=dev

# Copy semua source
COPY . .

# Buat folder yang dibutuhkan
RUN mkdir -p sessions temp

# Port default Koyeb
ENV PORT=8000

EXPOSE 8000

CMD ["node", "index.js"]
