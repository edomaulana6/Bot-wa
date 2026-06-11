FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    python3 \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY . .

RUN mkdir -p sessions temp

ENV PORT=8000

EXPOSE 8000

CMD ["node", "index.js"]
