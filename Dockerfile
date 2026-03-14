# Gunakan versi 'bullseye' yang repositorinya masih aktif
FROM node:18-bullseye

# Update dan install library pendukung (FFmpeg untuk stiker/video)
RUN apt-get update && \
    apt-get install -y ffmpeg imagemagick webp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set folder kerja
WORKDIR /app

# Copy file konfigurasi
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy semua file bot ke dalam container
COPY . .

# Jalankan bot
CMD ["node", "index.js"]
