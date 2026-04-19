# Gunakan Node versi stabil
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package dulu (biar caching optimal)
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy semua file project
COPY . .

# Expose port (wajib untuk Koyeb)
EXPOSE 8080

# Jalankan bot
CMD ["npm", "start"]
