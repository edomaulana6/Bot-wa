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

fs.ensureDirSync(SESSION_DIR);
fs.ensureDirSync(TEMP_DIR);

// --- SERVER ---
const app = express();
app.get("/", (_, res) => res.send("Bot is Running"));
app.listen(PORT, () => console.log(`[SERVER] Port ${PORT}`));

// --- FUNGSI FITUR ---
async function cmdPlay(sock, jid, query) {
  await sock.sendMessage(jid, { text: "🔍 Mencari video untuk: " + query });
  // Di sini nanti kamu tambahkan logika ytdl.download dari script aslimu
}

async function cmdCari(sock, jid, query) {
  await sock.sendMessage(jid, { text: "🔎 Mencari informasi tentang: " + query });
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
      await cmdPlay(sock, jid, query);
      break;
    case "cari":
      await cmdCari(sock, jid, query);
      break;
    case "menu":
      await sock.sendMessage(jid, { text: "📜 MENU BOT:\n!play <judul>\n!cari <query>\n!ping" });
      break;
    case "ping":
      await sock.sendMessage(jid, { text: "🏓 Pong!" });
      break;
    default:
      await sock.sendMessage(jid, { text: "❌ Perintah tidak ditemukan." });
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
    
