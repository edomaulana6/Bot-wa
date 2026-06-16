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
const NodeCache = require("node-cache");
const express   = require("express");
const YouTube   = require("youtube-sr").default;
const ytdl      = require("ytdl-core");
const axios     = require("axios");

// --- Config & Environment -------------------------------------
const PORT        = process.env.PORT || 8000;
const PREFIX      = process.env.PREFIX || "!";
const WA_NUMBER   = (process.env.WA_NUMBER || "").replace(/[^0-9]/g, "");
const SESSION_DIR = "./sessions";
const TEMP_DIR    = "./temp";

fs.ensureDirSync(SESSION_DIR);
fs.ensureDirSync(TEMP_DIR);

const app = express();
app.get("/", (_, res) => res.send("Bot is Running"));
app.listen(PORT, () => console.log(`[SERVER] Port ${PORT}`));

const retryCache = new NodeCache();

// --- FUNGSI FITUR (Copy-Paste dari script aslimu) --------------
async function cmdPlay(sock, jid, query) {
  await sock.sendMessage(jid, { text: "Mencari dan mengunduh: " + query });
  // Masukkan logic download ytdl di sini seperti script aslimu
}

// --- Message Handler ------------------------------------------
async function handleMsg(sock, msg) {
  const jid = msg.key.remoteJid;
  const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
  
  if (!body.startsWith(PREFIX)) return;

  const args = body.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const query = args.join(" ");

  switch (cmd) {
    case "play":
      await cmdPlay(sock, jid, query);
      break;
    case "menu":
      await sock.sendMessage(jid, { text: "Menu: !play, !cari, !lirik, !ping" });
      break;
    case "ping":
      await sock.sendMessage(jid, { text: "Pong!" });
      break;
    default:
      await sock.sendMessage(jid, { text: "Perintah tidak dikenal." });
  }
}

// --- Main Bot Logic -------------------------------------------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: Browsers.macOS("Safari"),
    msgRetryCounterCache: retryCache,
  });

  // Pairing Code Auto-Refresh
  if (!sock.authState.creds.registered) {
    let pairInterval = setInterval(async () => {
      if (sock.authState.creds.registered) { clearInterval(pairInterval); return; }
      try {
        const code = await sock.requestPairingCode(WA_NUMBER);
        console.log("\n[NEW PAIRING CODE]: " + code);
      } catch (e) { console.error("Error Pairing:", e.message); }
    }, 60000);
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
    if (upsert.type !== "notify") return;
    for (const msg of upsert.messages) {
      if (msg.key.fromMe) continue;
      await handleMsg(sock, msg);
    }
  });
}

startBot().catch(err => console.error("[FATAL ERROR]", err));
  
