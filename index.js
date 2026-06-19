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

// --- KONFIGURASI ---
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

// --- FUNGSI BANTU KONVERSI DURASI ---
function durationToSeconds(duration) {
  if (typeof duration === "number") return duration;
  if (typeof duration === "string") {
    const parts = duration.split(":").map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (typeof duration === "object" && duration !== null) {
    const { hours = 0, minutes = 0, seconds = 0 } = duration;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return 0; // fallback
}

// --- FUNGSI FITUR ---
async function cmdPlay(sock, jid, query) {
  try {
    await sock.sendMessage(jid, { text: "🔍 Mencari video untuk: " + query });
    
    const searchResults = await YouTube.search(query, { limit: 5 });
    if (!searchResults || searchResults.length === 0) {
      await sock.sendMessage(jid, { text: "❌ Tidak ditemukan video untuk: " + query });
      return;
    }

    // Filter durasi
    const filteredVideos = searchResults.filter(video => {
      const dur = durationToSeconds(video.duration);
      return dur > 0 && dur <= MAX_DURATION;
    });

    if (filteredVideos.length === 0) {
      await sock.sendMessage(jid, { 
        text: `❌ Tidak ditemukan video dengan durasi ≤ 10 menit untuk: "${query}"\n\nCoba gunakan kata kunci yang lebih spesifik.` 
      });
      return;
    }

    const video = filteredVideos[0];
    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
    const totalSec = durationToSeconds(video.duration);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;

    await sock.sendMessage(jid, { 
      text: `🎵 *${video.title}*\n👤 ${video.channel.name}\n⏱️ ${minutes}:${seconds.toString().padStart(2, '0')}\n🔗 ${videoUrl}`
    });

    await sock.sendMessage(jid, { text: "📥 Mengunduh audio..." });

    const audioStream = ytdl(videoUrl, {
      filter: "audioonly",
      quality: "lowestaudio",
      highWaterMark: 1 << 25, // 32MB
    });

    const fileName = `${TEMP_DIR}/${video.id}.mp3`;
    const writeStream = fs.createWriteStream(fileName);
    audioStream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      audioStream.on("error", reject);
    });

    await sock.sendMessage(jid, { 
      audio: { url: fileName },
      mimetype: "audio/mpeg",
      fileName: `${video.title}.mp3`
    });

    fs.unlinkSync(fileName);

  } catch (error) {
    console.error("Error di cmdPlay:", error);
    await sock.sendMessage(jid, { text: "❌ Terjadi kesalahan saat memproses permintaan." });
  }
}

async function cmdCari(sock, jid, query) {
  try {
    await sock.sendMessage(jid, { text: "🔎 Mencari informasi tentang: " + query });

    const searchResults = await YouTube.search(query, { limit: 10 });
    if (!searchResults || searchResults.length === 0) {
      await sock.sendMessage(jid, { text: "❌ Tidak ditemukan hasil untuk: " + query });
      return;
    }

    const filteredVideos = searchResults.filter(video => {
      const dur = durationToSeconds(video.duration);
      return dur > 0 && dur <= MAX_DURATION;
    });

    if (filteredVideos.length === 0) {
      await sock.sendMessage(jid, { 
        text: `❌ Tidak ditemukan video dengan durasi ≤ 10 menit untuk: "${query}"` 
      });
      return;
    }

    let resultText = `📋 *Hasil Pencarian (≤ 10 menit):*\n\n`;
    filteredVideos.slice(0, 5).forEach((video, index) => {
      const totalSec = durationToSeconds(video.duration);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      resultText += `${index + 1}. *${video.title}*\n`;
      resultText += `   👤 ${video.channel.name}\n`;
      resultText += `   ⏱️ ${minutes}:${seconds.toString().padStart(2, '0')}\n\n`;
    });

    await sock.sendMessage(jid, { text: resultText });

  } catch (error) {
    console.error("Error di cmdCari:", error);
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

  // Cek WA_NUMBER sebelum pairing
  if (!WA_NUMBER) {
    console.warn("[WARNING] WA_NUMBER tidak diisi. Pairing code tidak akan dikirim.");
  } else if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(WA_NUMBER);
        console.log("[KODE PAIRING]: " + code);
      } catch (e) {
        console.error("Error Pairing:", e.message);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        startBot();
      }
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
