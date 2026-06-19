"use strict";

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");

const pino      = require("pino");
const fs        = require("fs-extra");
const express   = require("express");
const YouTube   = require("youtube-sr").default;
const ytdl      = require("ytdl-core");
const axios     = require("axios");

// --- CONFIGURATION ---
const PORT        = process.env.PORT || 8000;
const PREFIX      = "!";
const WA_NUMBER   = (process.env.WA_NUMBER || "").replace(/[^0-9]/g, "");
const SESSION_DIR = "./sessions";
const TEMP_DIR    = "./temp";
const MAX_DURATION = 600; // 10 menit dalam detik

fs.ensureDirSync(SESSION_DIR);
fs.ensureDirSync(TEMP_DIR);

// --- SERVER ---
const app = express();
app.get("/", (_, res) => res.send("Bot is Running"));
app.listen(PORT, () => console.log(`[SERVER] Port ${PORT}`));

// --- FUNGSI FITUR ---
async function cmdPlay(sock, jid, query) {
  try {
    await sock.sendMessage(jid, { text: "🔍 Mencari video untuk: " + query });
    
    // Cari video di YouTube
    const searchResults = await YouTube.search(query, { limit: 5 });
    
    if (!searchResults || searchResults.length === 0) {
      await sock.sendMessage(jid, { text: "❌ Tidak ditemukan video untuk: " + query });
      return;
    }

    // Filter video dengan durasi <= 10 menit
    const filteredVideos = searchResults.filter(video => {
      const durationSeconds = video.duration;
      return durationSeconds && durationSeconds <= MAX_DURATION;
    });

    if (filteredVideos.length === 0) {
      await sock.sendMessage(jid, { 
        text: `❌ Tidak ditemukan video dengan durasi ≤ 10 menit untuk: "${query}"\n\nCoba gunakan kata kunci yang lebih spesifik.` 
      });
      return;
    }

    // Ambil video pertama yang memenuhi filter durasi
    const video = filteredVideos[0];
    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
    const durationMinutes = Math.floor(video.duration / 60);
    const durationSeconds = video.duration % 60;

    // Kirim informasi video
    await sock.sendMessage(jid, { 
      text: `🎵 *${video.title}*\n👤 ${video.channel.name}\n⏱️ ${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}\n🔗 ${videoUrl}`
    });

    // Download audio dari video
    await sock.sendMessage(jid, { text: "📥 Mengunduh audio..." });
    
    const audioStream = ytdl(videoUrl, {
      filter: 'audioonly',
      quality: 'lowestaudio',
    });

    // Simpan audio ke file sementara
    const fileName = `${TEMP_DIR}/${video.id}.mp3`;
    const writeStream = fs.createWriteStream(fileName);
    audioStream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      audioStream.on('error', reject);
    });

    // Kirim audio ke WhatsApp
    await sock.sendMessage(jid, { 
      audio: { url: fileName },
      mimetype: 'audio/mpeg',
      fileName: `${video.title}.mp3`
    });

    // Hapus file sementara
    fs.unlinkSync(fileName);
    
  } catch (error) {
    console.error('Error di cmdPlay:', error);
    await sock.sendMessage(jid, { text: "❌ Terjadi kesalahan saat memproses permintaan." });
  }
}

async function cmdCari(sock, jid, query) {
  try {
    await sock.sendMessage(jid, { text: "🔎 Mencari informasi tentang: " + query });
    
    // Cari video di YouTube dengan filter durasi
    const searchResults = await YouTube.search(query, { limit: 10 });
    
    if (!searchResults || searchResults.length === 0) {
      await sock.sendMessage(jid, { text: "❌ Tidak ditemukan hasil untuk: " + query });
      return;
    }

    // Filter video dengan durasi <= 10 menit
    const filteredVideos = searchResults.filter(video => {
      const durationSeconds = video.duration;
      return durationSeconds && durationSeconds <= MAX_DURATION;
    });

    if (filteredVideos.length === 0) {
      await sock.sendMessage(jid, { 
        text: `❌ Tidak ditemukan video dengan durasi ≤ 10 menit untuk: "${query}"` 
      });
      return;
    }

    // Tampilkan 5 hasil teratas dengan durasi
    let resultText = `📋 *Hasil Pencarian (≤ 10 menit):*\n\n`;
    filteredVideos.slice(0, 5).forEach((video, index) => {
      const durationMinutes = Math.floor(video.duration / 60);
      const durationSeconds = video.duration % 60;
      resultText += `${index + 1}. *${video.title}*\n`;
      resultText += `   👤 ${video.channel.name}\n`;
      resultText += `   ⏱️ ${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}\n\n`;
    });

    await sock.sendMessage(jid, { text: resultText });
    
  } catch (error) {
    console.error('Error di cmdCari:', error);
    await sock.sendMessage(jid, { text: "❌ Terjadi kesalahan saat mencari." });
  }
}

// --- MESSAGE HANDLER ---
async function handleMsg(sock, msg) {
  if (!msg.message) return;
  const jid = msg.key.remoteJid;
  const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
  
  console.log(`[PESAN MASUK] ${body}`);

  if (!body.startsWith(PREFIX)) return;

  const args = body.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const query = args.join(" ");

  switch (cmd) {
    case "play":
      if (!query) {
        await sock.sendMessage(jid, { text: "❌ Gunakan: !play <judul lagu>" });
        return;
      }
      await cmdPlay(sock, jid, query);
      break;
    case "cari":
      if (!query) {
        await sock.sendMessage(jid, { text: "❌ Gunakan: !cari <kata kunci>" });
        return;
      }
      await cmdCari(sock, jid, query);
      break;
    case "menu":
      await sock.sendMessage(jid, { 
        text: `📜 *MENU BOT*\n\n` +
              `!play <judul> - Cari & putar lagu (≤ 10 menit)\n` +
              `!cari <query> - Cari video (≤ 10 menit)\n` +
              `!ping - Cek koneksi bot\n` +
              `!menu - Tampilkan menu ini\n\n` +
              `⏱️ *Maksimal durasi: 10 menit*` 
      });
      break;
    case "ping":
      await sock.sendMessage(jid, { text: "🏓 Pong!" });
      break;
    default:
      await sock.sendMessage(jid, { text: "❌ Perintah tidak ditemukan. Ketik !menu untuk melihat daftar perintah." });
  }
}

// --- BOT LOGIC ---
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: Browsers.macOS("Safari"),
  });

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(WA_NUMBER);
        console.log("[KODE PAIRING]: " + code);
      } catch (e) { console.error("Error Pairing:", e.message); }
    }, 3000);
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
    } else if (connection === "open") {
      console.log("[STATUS] Bot Berhasil Terhubung!");
    }
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", async (upsert) => {
    for (const msg of upsert.messages) {
      await handleMsg(sock, msg);
    }
  });
}

startBot();
