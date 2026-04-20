# Gunakan Node versi stabil
FROM node:18-alpine

# Install dependencies sistem (Python, FFmpeg untuk yt-dlp)
RUN apk add --no-cache python3 py3-pip ffmpeg

# Install yt-dlp
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir yt-dlp

# Set working directory
WORKDIR /app

# Copy package dulu (biar caching optimal)
COPY package*.json ./

# Install dependencies Node.js
RUN npm install

# Copy semua file project
COPY . .

# Expose port (wajib untuk Koyeb)
EXPOSE 8080

# Jalankan bot
CMD ["npm", "start"]
