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
const path      = require("path");
const NodeCache = require("node-cache");
const YouTube   = require("youtube-sr").default;
const ytdl      = require("ytdl-core");
const axios     = require("axios");
const express   = require("express");

// --- Config & Environment -------------------------------------
const PORT        = process.env.PORT || 8000;
const PREFIX      = process.env.PREFIX || "!";
const WA_NUMBER   = (process.env.WA_NUMBER || "").replace(/[^0-9]/g, "");
const SESSION_DIR = "./sessions";
const TEMP_DIR    = "./temp";

fs.ensureDirSync(SESSION_DIR);
fs.ensureDirSync(TEMP_DIR);

// --- Server for Koyeb -----------------------------------------
const app = express();
app.get("/", (_, res) => res.send("Bot is Running"));
app.listen(PORT, () => console.log(`[SERVER] Port ${PORT}`));

const retryCache = new NodeCache();

// --- [FUNGSI FITUR MUSIK & GAME DISINI] -----------------------
// Kamu bisa copy-paste fungsi: cmdPlay, cmdCari, cmdLirik, 
// cmdTebak, cmdHangman, cmdTictac, dan getMenu dari script awalmu ke sini.

async function handleMsg(sock, msg) {
  if (!msg.message) return;
  const jid = msg.key.remoteJid;
  const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

  if (!body.startsWith(PREFIX)) return;

  const args = body.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const query = args.join(" ");

  // Contoh routing perintah
  if (cmd === "play") {
    // Panggil fungsi cmdPlay yang kamu pindahkan ke sini
    await sock.sendMessage(jid, { text: "Mencari " + query + "..." });
  } 
  else if (cmd === "menu") {
    await sock.sendMessage(jid, { text: "Menu: !play, !cari, !tebak, !tictac" });
  }
}

// --- Bot Logic ------------------------------------------------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: Browsers.macOS("Safari"),
  });

  // Pairing Code
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
        try {
            const code = await sock.requestPairingCode(WA_NUMBER);
            console.log("KODE PAIRING: " + code);
        } catch (e) { console.error("Error Pairing:", e.message); }
    }, 5000);
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
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

startBot();
