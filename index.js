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

// --- Config ---------------------------------------------------
const PREFIX      = process.env.PREFIX       || "!";
const BOT_NAME    = process.env.BOT_NAME     || "MusicBot";
const WA_NUMBER   = (process.env.WA_NUMBER   || "").replace(/[^0-9]/g, "");
const SESSION_DIR = process.env.SESSION_DIR  || "./sessions";
const TEMP_DIR    = "./temp";
const MAX_DUR     = parseInt(process.env.MAX_DURATION || "15");
const PORT        = parseInt(process.env.PORT || "8000");

fs.ensureDirSync(SESSION_DIR);
fs.ensureDirSync(TEMP_DIR);

// --- HTTP Keep-alive -----------------------------------------
const app = express();
app.get("/",       (_, res) => res.send("OK " + BOT_NAME));
app.get("/health", (_, res) => res.json({ status: "ok", uptime: process.uptime() }));
app.listen(PORT, () => console.log("[HTTP] port " + PORT));

// --- State ----------------------------------------------------
const retryCache = new NodeCache();
const playHist   = {};
const tebakGame  = {};
const tebakSkor  = {};
const hmGame     = {};
const tttGame    = {};

// --- Helper ---------------------------------------------------
function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function addHist(jid, item) {
  if (!playHist[jid]) playHist[jid] = [];
  playHist[jid].unshift(item);
  if (playHist[jid].length > 10) playHist[jid].pop();
}

setInterval(() => {
  try {
    const now = Date.now();
    fs.readdirSync(TEMP_DIR).forEach(function(f) {
      const fp = path.join(TEMP_DIR, f);
      if (now - fs.statSync(fp).mtimeMs > 600000) fs.removeSync(fp);
    });
  } catch (_) {}
}, 300000);

// --- Thumbnail -----------------------------------------------
async function makeThumbnail(videoId) {
  try {
    const { Jimp } = require("jimp");
    const url = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 8000 });
    const img = await Jimp.read(Buffer.from(res.data));
    img.resize({ w: 640, h: 360 });
    return await img.getBuffer("image/jpeg");
  } catch (e) {
    console.error("[THUMB]", e.message);
    return null;
  }
}

// --- Menu -----------------------------------------------------
function getMenu() {
  const P = PREFIX;
  return (
    "=== MUSIK BOT v3 ===\n\n" +
    "*MUSIK*\n" +
    P + "play <judul>  - download MP3\n" +
    P + "mp4 <judul>   - download MP4\n" +
    P + "cari <judul>  - cari lagu\n" +
    P + "info <judul>  - info lagu\n" +
    P + "lirik <judul> - lirik lagu\n" +
    P + "history       - riwayat putar\n\n" +
    "*GAME*\n" +
    P + "tebak   - Tebak Judul Lagu\n" +
    P + "skip    - Lewati soal\n" +
    P + "hangman - Tebak Kata\n" +
    P + "tictac  - Tic-Tac-Toe\n" +
    P + "skor    - Papan Skor\n\n" +
    "*LAIN*\n" +
    P + "ping - cek status\n" +
    P + "menu - tampilkan ini"
  );
}

// --- CMD: play ------------------------------------------------
async function cmdPlay(sock, jid, query, asVideo) {
  await sock.sendMessage(jid, { text: "Mencari " + query + "..." });

  let vid;
  try {
    const results = await YouTube.search(query, { limit: 1, type: "video" });
    if (!results.length) return sock.sendMessage(jid, { text: "Lagu tidak ditemukan." });
    vid = results[0];
  } catch (e) {
    return sock.sendMessage(jid, { text: "Gagal mencari: " + e.message });
  }

  const durSec  = Math.floor((vid.duration || 0) / 1000);
  const durMin  = Math.floor(durSec / 60);
  if (durMin > MAX_DUR)
    return sock.sendMessage(jid, { text: "Durasi " + durMin + " menit terlalu panjang. Maks " + MAX_DUR + " menit." });

  const title   = vid.title || "Unknown";
  const ytUrl   = "https://www.youtube.com/watch?v=" + vid.id;
  const dur     = fmtDur(durSec);
  const channel = (vid.channel && vid.channel.name) || "Unknown";

  const thumb = await makeThumbnail(vid.id);
  if (thumb) {
    await sock.sendMessage(jid, {
      image: thumb,
      caption: "*" + title + "*\n" + channel + " | " + dur + "\n\nMengunduh...",
      mimetype: "image/jpeg",
    });
  } else {
    await sock.sendMessage(jid, { text: "*" + title + "*\n" + channel + " | " + dur + "\n\nMengunduh..." });
  }

  const ext = asVideo ? "mp4" : "mp3";
  const tmp = path.join(TEMP_DIR, Date.now() + "." + ext);

  try {
    await new Promise(function(resolve, reject) {
      const stream = asVideo
        ? ytdl(ytUrl, { quality: "highestvideo" })
        : ytdl(ytUrl, { quality: "highestaudio", filter: "audioonly" });
      stream.pipe(fs.createWriteStream(tmp)).on("finish", resolve).on("error", reject);
    });

    if (asVideo) {
      await sock.sendMessage(jid, {
        video: { url: tmp },
        caption: title + " | " + channel + " | " + dur,
        fileName: title + ".mp4",
        mimetype: "video/mp4",
      });
    } else {
      await sock.sendMessage(jid, {
        audio: { url: tmp },
        mimetype: "audio/mpeg",
        ptt: false,
        fileName: title + ".mp3",
      });
    }

    addHist(jid, { title, dur, channel });
    await sock.sendMessage(jid, { text: "Selesai! Ketik " + PREFIX + "lirik " + title + " untuk liriknya." });
  } catch (e) {
    console.error("[PLAY]", e.message);
    fs.removeSync(tmp);
    await sock.sendMessage(jid, { text: "Gagal download: " + e.message });
  }
}

// --- CMD: cari ------------------------------------------------
async function cmdCari(sock, jid, query) {
  await sock.sendMessage(jid, { text: "Mencari " + query + "..." });
  try {
    const results = await YouTube.search(query, { limit: 5, type: "video" });
    if (!results.length) return sock.sendMessage(jid, { text: "Tidak ada hasil." });

    let msg = "Hasil: " + query + "\n\n";
    results.forEach(function(v, i) {
      const dur = fmtDur(Math.floor((v.duration || 0) / 1000));
      msg += (i + 1) + ". " + v.title + "\n   " + ((v.channel && v.channel.name) || "?") + " | " + dur + "\n\n";
    });
    msg += "Ketik " + PREFIX + "play <judul> untuk download.";
    await sock.sendMessage(jid, { text: msg });
  } catch (e) {
    await sock.sendMessage(jid, { text: "Gagal mencari: " + e.message });
  }
}

// --- CMD: info ------------------------------------------------
async function cmdInfo(sock, jid, query) {
  await sock.sendMessage(jid, { text: "Mengambil info..." });
  try {
    const results = await YouTube.search(query, { limit: 1, type: "video" });
    if (!results.length) return sock.sendMessage(jid, { text: "Tidak ditemukan." });
    const v   = results[0];
    const dur = fmtDur(Math.floor((v.duration || 0) / 1000));

    const caption =
      "INFO LAGU\n" +
      "Judul:   " + v.title + "\n" +
      "Channel: " + ((v.channel && v.channel.name) || "?") + "\n" +
      "Durasi:  " + dur + "\n" +
      "Views:   " + fmtNum(v.views || 0) + "\n" +
      "Link:    youtu.be/" + v.id;

    const thumb = await makeThumbnail(v.id);
    if (thumb) {
      await sock.sendMessage(jid, { image: thumb, caption: caption, mimetype: "image/jpeg" });
    } else {
      await sock.sendMessage(jid, { text: caption });
    }
  } catch (e) {
    await sock.sendMessage(jid, { text: "Gagal: " + e.message });
  }
}

// --- CMD: lirik -----------------------------------------------
async function cmdLirik(sock, jid, query) {
  await sock.sendMessage(jid, { text: "Mencari lirik " + query + "..." });
  try {
    const r = await axios.get(
      "https://lyrist.vercel.app/api/" + encodeURIComponent(query),
      { timeout: 10000 }
    );
    if (!r.data || !r.data.lyrics) throw new Error("no lyrics");
    const lyrics = r.data.lyrics.substring(0, 3500) + (r.data.lyrics.length > 3500 ? "\n\n(dipotong)" : "");
    const msg = (r.data.title || query) + "\n" + (r.data.artist || "Unknown") + "\n\n" + lyrics;
    await sock.sendMessage(jid, { text: msg });
  } catch (_) {
    await sock.sendMessage(jid, { text: "Lirik tidak ditemukan. Coba tulis judul dalam Bahasa Inggris." });
  }
}

// --- CMD: history ---------------------------------------------
async function cmdHistory(sock, jid) {
  const h = playHist[jid];
  if (!h || !h.length) return sock.sendMessage(jid, { text: "Belum ada riwayat." });
  let msg = "RIWAYAT PEMUTARAN\n\n";
  h.forEach(function(x, i) { msg += (i + 1) + ". " + x.title + "\n   " + x.channel + " | " + x.dur + "\n\n"; });
  await sock.sendMessage(jid, { text: msg });
}

// --- GAME: Tebak Lagu -----------------------------------------
const SONGS = [
  { title: "shape of you",       artist: "Ed Sheeran",        hint: "Lagu pop 2017, ketemu di gym" },
  { title: "bohemian rhapsody",  artist: "Queen",              hint: "Rock klasik 1975, ada bagian opera" },
  { title: "blinding lights",    artist: "The Weeknd",         hint: "Synth-pop 2019 nuansa 80-an" },
  { title: "levitating",         artist: "Dua Lipa",           hint: "Disko-pop 2020 tentang terbang" },
  { title: "lantas",             artist: "Juicy Luicy",        hint: "Pop Indonesia tentang rasa belum selesai" },
  { title: "hati-hati di jalan", artist: "Tulus",              hint: "Pop Indonesia, sering jadi OST film" },
  { title: "kangen",             artist: "Dewa 19",            hint: "Rock Indonesia lawas tentang rindu" },
  { title: "stressed out",       artist: "Twenty One Pilots",  hint: "Alt hip-hop, nostalgia masa kecil" },
  { title: "dynamite",           artist: "BTS",                hint: "K-Pop 2020 berbahasa Inggris" },
  { title: "someone like you",   artist: "Adele",              hint: "Piano ballad tentang mantan menikah" },
  { title: "riptide",            artist: "Vance Joy",          hint: "Indie pop Australia pakai ukulele" },
  { title: "stay",               artist: "The Kid LAROI",      hint: "Viral TikTok 2021 feat Justin Bieber" },
  { title: "satu",               artist: "Gigi",               hint: "Rock Indonesia era 2000-an" },
  { title: "manusia kuat",       artist: "Tulus",              hint: "Pop Indonesia tentang ketangguhan" },
  { title: "peaches",            artist: "Justin Bieber",      hint: "R&B 2021 tentang California" },
];

async function cmdTebak(sock, jid) {
  if (tebakGame[jid]) {
    const g = tebakGame[jid];
    return sock.sendMessage(jid, {
      text: "Masih ada soal aktif!\n\nPetunjuk: " + g.hint + "\nArtis: " + g.artist + "\n\nKetik jawaban atau " + PREFIX + "skip untuk lewati.",
    });
  }
  const s = SONGS[Math.floor(Math.random() * SONGS.length)];
  tebakGame[jid] = { title: s.title, artist: s.artist, hint: s.hint, attempts: 0, start: Date.now() };
  await sock.sendMessage(jid, {
    text: "TEBAK JUDUL LAGU!\n\nPetunjuk: " + s.hint + "\nArtis: " + s.artist + "\n\nKetik judul lagu! (3 kesempatan)\n" + PREFIX + "skip = lewati",
  });
}

async function handleTebakJawab(sock, jid, sender, text) {
  const g = tebakGame[jid];
  if (!g) return false;

  g.attempts++;
  const jaw = text.trim().toLowerCase();

  if (jaw === g.title || jaw.includes(g.title) || g.title.includes(jaw)) {
    const skor = Math.max(10, 100 - Math.floor((Date.now() - g.start) / 1000));
    if (!tebakSkor[jid]) tebakSkor[jid] = {};
    tebakSkor[jid][sender] = (tebakSkor[jid][sender] || 0) + skor;
    delete tebakGame[jid];
    await sock.sendMessage(jid, {
      text: "BENAR! +" + skor + " poin\nJawaban: " + g.title + "\nSkor kamu: " + tebakSkor[jid][sender] + "\n\n" + PREFIX + "tebak untuk lanjut!",
    });
  } else if (g.attempts >= 3) {
    delete tebakGame[jid];
    await sock.sendMessage(jid, {
      text: "Habis! Jawaban: " + g.title + "\n\n" + PREFIX + "tebak untuk coba lagi!",
    });
  } else {
    await sock.sendMessage(jid, {
      text: "Salah! Sisa " + (3 - g.attempts) + " kesempatan.\nPetunjuk: " + g.hint,
    });
  }
  return true;
}

// --- GAME: Hangman --------------------------------------------
const HM_WORDS = [
  "gitar","drum","piano","melodi","lirik","konser","album","single",
  "vokal","bassist","gitaris","drummer","nada","kunci","tempo","ritme",
  "beatbox","rapper","penyanyi","musisi",
];

async function cmdHangman(sock, jid) {
  if (hmGame[jid]) {
    const g = hmGame[jid];
    const disp = g.word.split("").map(function(c) { return g.guessed.includes(c) ? c : "_"; }).join(" ");
    return sock.sendMessage(jid, {
      text: "Hangman masih jalan!\n\nSalah: " + g.wrong + "/6\nKata: " + disp + "\nHuruf: " + (g.guessed.join(", ") || "-") + "\n\nKirim 1 huruf.",
    });
  }
  const word = HM_WORDS[Math.floor(Math.random() * HM_WORDS.length)];
  hmGame[jid] = { word: word, guessed: [], wrong: 0 };
  const disp = word.split("").map(function() { return "_"; }).join(" ");
  await sock.sendMessage(jid, {
    text: "HANGMAN MUSIK!\n\nSalah: 0/6\nKata: " + disp + " (" + word.length + " huruf)\n\nKirim 1 huruf!\n" + PREFIX + "hhint = petunjuk | " + PREFIX + "hstop = berhenti",
  });
}

async function handleHangmanHuruf(sock, jid, sender, letter) {
  const g = hmGame[jid];
  if (!g) return false;
  if (!/^[a-z]$/i.test(letter)) return false;

  const l = letter.toLowerCase();
  if (g.guessed.includes(l)) {
    await sock.sendMessage(jid, { text: "Huruf " + l.toUpperCase() + " sudah ditebak." });
    return true;
  }

  g.guessed.push(l);
  if (!g.word.includes(l)) g.wrong++;

  const disp = g.word.split("").map(function(c) { return g.guessed.includes(c) ? c : "_"; }).join(" ");
  const done = !disp.includes("_");
  const dead = g.wrong >= 6;

  if (done) {
    if (!tebakSkor[jid]) tebakSkor[jid] = {};
    tebakSkor[jid][sender] = (tebakSkor[jid][sender] || 0) + 50;
    delete hmGame[jid];
    await sock.sendMessage(jid, { text: "BENAR SEMUA! +50 poin\nKata: " + g.word.toUpperCase() + "\n\n" + PREFIX + "hangman lagi!" });
  } else if (dead) {
    delete hmGame[jid];
    await sock.sendMessage(jid, { text: "GAME OVER!\nKata: " + g.word.toUpperCase() + "\n\n" + PREFIX + "hangman untuk coba lagi!" });
  } else {
    await sock.sendMessage(jid, {
      text: (g.word.includes(l) ? "Benar!" : "Salah!") + "\n\nSalah: " + g.wrong + "/6\nKata: " + disp + "\nHuruf: " + g.guessed.join(", "),
    });
  }
  return true;
}

// --- GAME: Tic-Tac-Toe ----------------------------------------
function boardStr(b) {
  function s(i) { return b[i] === 0 ? "[ ]" : b[i] === 1 ? "[X]" : "[O]"; }
  return s(0)+s(1)+s(2)+"\n"+s(3)+s(4)+s(5)+"\n"+s(6)+s(7)+s(8);
}

function checkWin(b, p) {
  return [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
    .some(function(w) { return w.every(function(i) { return b[i] === p; }); });
}

function aiMove(b) {
  for (var p = 2; p >= 1; p--) {
    for (var i = 0; i < 9; i++) {
      if (b[i] === 0) { b[i] = p; if (checkWin(b, p)) { b[i] = 0; return i; } b[i] = 0; }
    }
  }
  if (b[4] === 0) return 4;
  var free = [];
  b.forEach(function(v, i) { if (v === 0) free.push(i); });
  return free[Math.floor(Math.random() * free.length)];
}

async function cmdTictac(sock, jid, sender) {
  tttGame[jid] = { board: [0,0,0,0,0,0,0,0,0], player: sender };
  await sock.sendMessage(jid, {
    text: "TIC-TAC-TOE vs BOT\n\n" + boardStr(tttGame[jid].board) + "\n\nKamu [X] vs Bot [O]\n\nPilih posisi (1-9):\n1 2 3\n4 5 6\n7 8 9",
  });
}

async function handleTictacMove(sock, jid, sender, num) {
  const g = tttGame[jid];
  if (!g || g.player !== sender) return false;
  if (isNaN(num) || num < 1 || num > 9) return false;

  const idx = num - 1;
  if (g.board[idx] !== 0) {
    await sock.sendMessage(jid, { text: "Posisi sudah terisi! Pilih lain." });
    return true;
  }

  g.board[idx] = 1;
  if (checkWin(g.board, 1)) {
    delete tttGame[jid];
    if (!tebakSkor[jid]) tebakSkor[jid] = {};
    tebakSkor[jid][sender] = (tebakSkor[jid][sender] || 0) + 30;
    await sock.sendMessage(jid, { text: boardStr(g.board) + "\n\nKamu MENANG! +30 poin" });
    return true;
  }
  if (!g.board.includes(0)) {
    delete tttGame[jid];
    await sock.sendMessage(jid, { text: boardStr(g.board) + "\n\nSERI!" });
    return true;
  }

  const ai = aiMove(g.board);
  g.board[ai] = 2;
  if (checkWin(g.board, 2)) {
    delete tttGame[jid];
    await sock.sendMessage(jid, { text: boardStr(g.board) + "\n\nBot MENANG!\n" + PREFIX + "tictac untuk ulang." });
    return true;
  }
  if (!g.board.includes(0)) {
    delete tttGame[jid];
    await sock.sendMessage(jid, { text: boardStr(g.board) + "\n\nSERI!" });
    return true;
  }

  await sock.sendMessage(jid, { text: boardStr(g.board) + "\n\nGiliran kamu! Pilih (1-9):" });
  return true;
}

// --- CMD: skor ------------------------------------------------
async function cmdSkor(sock, jid, sender) {
  const s = tebakSkor[jid];
  if (!s || !Object.keys(s).length)
    return sock.sendMessage(jid, { text: "Belum ada skor. Main " + PREFIX + "tebak, " + PREFIX + "hangman, atau " + PREFIX + "tictac!" });

  const sorted = Object.entries(s).sort(function(a, b) { return b[1] - a[1]; });
  let msg = "PAPAN SKOR\n\n";
  sorted.forEach(function(entry, i) {
    const num  = entry[0];
    const pts  = entry[1];
    const medal = ["1.", "2.", "3."][i] || "  ";
    msg += medal + " " + num.split("@")[0] + " - " + pts + " poin" + (num === sender ? " (kamu)" : "") + "\n";
  });
  await sock.sendMessage(jid, { text: msg });
}

// --- Message Handler ------------------------------------------
async function handleMsg(sock, msg) {
  if (!msg.message) return;

  const jid    = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  const body = (
    (msg.message.conversation) ||
    (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) ||
    (msg.message.imageMessage && msg.message.imageMessage.caption) || ""
  ).trim();

  // Log semua pesan masuk
  console.log("[MSG] dari=" + sender.split("@")[0] + " jid=" + jid.split("@")[0] + " fromMe=" + msg.key.fromMe + " body=" + (body || "(kosong)"));

  if (!body) return;

  // Jika tidak ada prefix, cek game aktif
  if (!body.startsWith(PREFIX)) {
    if (tebakGame[jid]) {
      return handleTebakJawab(sock, jid, sender, body);
    }
    if (hmGame[jid] && /^[a-zA-Z]$/.test(body)) {
      return handleHangmanHuruf(sock, jid, sender, body);
    }
    if (tttGame[jid] && /^[1-9]$/.test(body)) {
      return handleTictacMove(sock, jid, sender, parseInt(body));
    }
    return;
  }

  const parts  = body.slice(PREFIX.length).trim().split(/\s+/);
  const cmd    = parts[0].toLowerCase();
  const query  = parts.slice(1).join(" ");

  console.log("[CMD] " + (sender.split("@")[0]) + " -> " + PREFIX + cmd + (query ? " " + query : ""));

  if (cmd === "menu" || cmd === "help") {
    return sock.sendMessage(jid, { text: getMenu() });
  }

  if (cmd === "ping") {
    const t = Date.now();
    await sock.sendMessage(jid, { text: "Pong! Bot aktif. Latensi: " + (Date.now() - t) + "ms" });
    return;
  }

  if (cmd === "play" || cmd === "dl") {
    if (!query) return sock.sendMessage(jid, { text: "Contoh: " + PREFIX + "play Shape of You" });
    return cmdPlay(sock, jid, query, false);
  }

  if (cmd === "mp4" || cmd === "video") {
    if (!query) return sock.sendMessage(jid, { text: "Contoh: " + PREFIX + "mp4 Shape of You" });
    return cmdPlay(sock, jid, query, true);
  }

  if (cmd === "cari" || cmd === "search") {
    if (!query) return sock.sendMessage(jid, { text: "Contoh: " + PREFIX + "cari Tulus" });
    return cmdCari(sock, jid, query);
  }

  if (cmd === "info") {
    if (!query) return sock.sendMessage(jid, { text: "Contoh: " + PREFIX + "info Tulus" });
    return cmdInfo(sock, jid, query);
  }

  if (cmd === "lirik" || cmd === "lyrics") {
    if (!query) return sock.sendMessage(jid, { text: "Contoh: " + PREFIX + "lirik Yellow Coldplay" });
    return cmdLirik(sock, jid, query);
  }

  if (cmd === "history" || cmd === "riwayat") {
    return cmdHistory(sock, jid);
  }

  if (cmd === "tebak") {
    return cmdTebak(sock, jid);
  }

  if (cmd === "skip") {
    if (tebakGame[jid]) {
      const ans = tebakGame[jid].title;
      delete tebakGame[jid];
      return sock.sendMessage(jid, { text: "Di-skip! Jawaban: " + ans });
    }
    return sock.sendMessage(jid, { text: "Tidak ada soal aktif." });
  }

  if (cmd === "hangman") {
    return cmdHangman(sock, jid);
  }

  if (cmd === "hhint") {
    if (hmGame[jid]) {
      const g = hmGame[jid];
      const unguessed = g.word.split("").filter(function(c) { return !g.guessed.includes(c); });
      if (unguessed.length) {
        const hint = unguessed[Math.floor(Math.random() * unguessed.length)];
        g.guessed.push(hint);
        g.wrong++;
        const disp = g.word.split("").map(function(c) { return g.guessed.includes(c) ? c : "_"; }).join(" ");
        return sock.sendMessage(jid, { text: "Petunjuk: " + hint.toUpperCase() + " (-1 nyawa)\nKata: " + disp });
      }
    } else {
      return sock.sendMessage(jid, { text: "Tidak ada game hangman aktif." });
    }
    return;
  }

  if (cmd === "hstop") {
    if (hmGame[jid]) { delete hmGame[jid]; return sock.sendMessage(jid, { text: "Hangman dihentikan." }); }
    return;
  }

  if (cmd === "tictac" || cmd === "ttt") {
    return cmdTictac(sock, jid, sender);
  }

  if (cmd === "skor" || cmd === "score") {
    return cmdSkor(sock, jid, sender);
  }

  await sock.sendMessage(jid, { text: "Perintah " + PREFIX + cmd + " tidak dikenal. Ketik " + PREFIX + "menu untuk daftar." });
}

// --- Koneksi WhatsApp -----------------------------------------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version:              version,
    logger:               pino({ level: "silent" }),
    printQRInTerminal:    false,
    auth:                 state,
    browser:              Browsers.macOS("Safari"),
    msgRetryCounterCache: retryCache,
    syncFullHistory:      false,
    connectTimeoutMs:     60000,
    keepAliveIntervalMs:  25000,
  });

  // Pairing code hanya saat pertama
  if (!sock.authState.creds.registered) {
    if (!WA_NUMBER) {
      console.error("Set ENV: WA_NUMBER=62812xxxx");
      process.exit(1);
    }
    try {
      await new Promise(function(r) { setTimeout(r, 3000); });
      const code = await sock.requestPairingCode(WA_NUMBER);
      const fmt  = code.match(/.{1,4}/g).join("-");
      console.log("\n*** PAIRING CODE: " + fmt + " ***");
      console.log("Buka WA > Perangkat Tertaut > Tautkan dengan nomor telepon");
      console.log("Masukkan: " + fmt + "\n");
    } catch (e) {
      console.error("Gagal pairing:", e.message);
    }
  }

  sock.ev.on("connection.update", function(update) {
    const connection    = update.connection;
    const lastDisconnect = update.lastDisconnect;

    if (connection === "close") {
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode : 0;
      console.log("Putus (kode " + code + "), reconnect dalam 5 detik...");
      if (code === DisconnectReason.loggedOut) {
        console.log("Logout - hapus session.");
        fs.removeSync(SESSION_DIR);
      }
      setTimeout(startBot, 5000);
    } else if (connection === "open") {
      console.log(BOT_NAME + " terhubung! Prefix: " + PREFIX);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async function(upsert) {
    if (upsert.type !== "notify") return;
    console.log("[UPSERT] " + upsert.messages.length + " pesan, type=" + upsert.type);
    for (const msg of upsert.messages) {
      // Lewati pesan dari bot sendiri kecuali chat ke diri sendiri (untuk testing)
      const remoteJid  = msg.key.remoteJid || "";
      const isSelfChat = WA_NUMBER && remoteJid.startsWith(WA_NUMBER);
      console.log("[MSG-RAW] remoteJid=" + remoteJid.split("@")[0] + " fromMe=" + msg.key.fromMe + " isSelfChat=" + isSelfChat);
      if (msg.key.fromMe && !isSelfChat) continue;

      try {
        await handleMsg(sock, msg);
      } catch (e) {
        console.error("[ERR]", e.message);
      }
    }
  });
}

console.log("Starting " + BOT_NAME + "...");
startBot().catch(console.error);
