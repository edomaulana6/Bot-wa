/**
 * ╔══════════════════════════════════════════════╗
 * ║     🎵  WA MUSIC BOT v3.0  🎵               ║
 * ║     Koyeb Server Edition                     ║
 * ╚══════════════════════════════════════════════╝
 */

"use strict";

// ─── Import ───────────────────────────────────────────────────
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

// ─── Config ───────────────────────────────────────────────────
const PREFIX      = process.env.PREFIX       || "!";
const BOT_NAME    = process.env.BOT_NAME     || "🎵 MusicBot";
const WA_NUMBER   = process.env.WA_NUMBER    || "";
const SESSION_DIR = process.env.SESSION_DIR  || "./sessions";
const TEMP_DIR    = "./temp";
const MAX_DUR     = parseInt(process.env.MAX_DURATION || "15");
const PORT        = parseInt(process.env.PORT || "8000");

fs.ensureDirSync(SESSION_DIR);
fs.ensureDirSync(TEMP_DIR);

// ─── HTTP Keep-alive (wajib Koyeb) ───────────────────────────
const app = express();
app.get("/",       (_, res) => res.send(`✅ ${BOT_NAME} aktif!`));
app.get("/health", (_, res) => res.json({ status: "ok", uptime: process.uptime() }));
app.listen(PORT, () => console.log(`🌐 HTTP jalan di port ${PORT}`));

// ─── State ────────────────────────────────────────────────────
const retryCache = new NodeCache();
const playHist   = {};   // riwayat putar per jid
const tebakGame  = {};   // tebak lagu per jid
const tebakSkor  = {};   // skor per jid
const hmGame     = {};   // hangman per jid
const tttGame    = {};   // tictactoe per jid

// ─── Helper ───────────────────────────────────────────────────
function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

// Bersihkan temp setiap 5 menit
setInterval(() => {
  const now = Date.now();
  try {
    fs.readdirSync(TEMP_DIR).forEach(f => {
      const fp = path.join(TEMP_DIR, f);
      if (now - fs.statSync(fp).mtimeMs > 600000) fs.removeSync(fp);
    });
  } catch (_) {}
}, 300000);

// ─── Thumbnail (axios + jimp v1) ──────────────────────────────
async function makeThumbnail(videoId, title, channel, dur) {
  try {
    const { Jimp } = require("jimp");
    const url = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 8000 });
    const img = await Jimp.read(Buffer.from(res.data));

    // Resize ke 640x360
    img.resize({ w: 640, h: 360 });

    // Overlay hitam transparan di bawah
    const bar = new Jimp({ width: 640, height: 90, color: 0x000000cc });
    img.composite(bar, 0, 270);

    // Tulis teks pakai print (jimp v1 tanpa loadFont untuk built-in)
    // Jimp v1 tidak punya built-in font rendering tanpa plugin
    // Gunakan jimp bmp overlay sederhana + export buffer
    return await img.getBuffer("image/jpeg");
  } catch (e) {
    console.error("[THUMB]", e.message);
    return null;
  }
}

// ─── Menu ─────────────────────────────────────────────────────
const MENU = `
╔══════════════════════════════════╗
║  🎵  *WA MUSIC BOT v3.0*        ║
╠══════════════════════════════════╣
║  🎧  *MUSIK*                     ║
║  ${PREFIX}play  <judul/link>         ║
║  ${PREFIX}mp4   <judul/link>         ║
║  ${PREFIX}cari  <judul>              ║
║  ${PREFIX}info  <judul>              ║
║  ${PREFIX}lirik <judul>              ║
║  ${PREFIX}history                    ║
╠══════════════════════════════════╣
║  🎮  *PERMAINAN*                 ║
║  ${PREFIX}tebak   — Tebak judul lagu ║
║  ${PREFIX}skip    — Lewati soal      ║
║  ${PREFIX}hangman — Tebak kata       ║
║  ${PREFIX}tictac  — Tic-Tac-Toe      ║
║  ${PREFIX}skor    — Papan skor       ║
╠══════════════════════════════════╣
║  ℹ️   *LAINNYA*                   ║
║  ${PREFIX}menu  — tampilkan ini       ║
║  ${PREFIX}ping  — cek status          ║
╚══════════════════════════════════╝`.trim();

// ─── CMD: play ────────────────────────────────────────────────
async function cmdPlay(sock, jid, query, asVideo = false) {
  await sock.sendMessage(jid, { text: `🔍 Mencari *${query}*...` });

  let vid;
  try {
    const results = await YouTube.search(query, { limit: 1, type: "video" });
    if (!results.length) return sock.sendMessage(jid, { text: "❌ Lagu tidak ditemukan." });
    vid = results[0];
  } catch {
    return sock.sendMessage(jid, { text: "❌ Gagal mencari. Coba lagi." });
  }

  const durSec  = Math.floor((vid.duration || 0) / 1000);
  const durMin  = Math.floor(durSec / 60);
  if (durMin > MAX_DUR)
    return sock.sendMessage(jid, { text: `⚠️ Durasi ${durMin} menit terlalu panjang. Maks ${MAX_DUR} menit.` });

  const title   = vid.title || "Unknown";
  const ytUrl   = `https://www.youtube.com/watch?v=${vid.id}`;
  const dur     = fmtDur(durSec);
  const channel = vid.channel?.name || "Unknown";

  // Kirim thumbnail
  const thumb = await makeThumbnail(vid.id, title, channel, dur);
  if (thumb) {
    await sock.sendMessage(jid, {
      image: thumb,
      caption: `🎵 *${title}*\n👤 ${channel} | ⏱ ${dur}\n\n⬇️ Mengunduh...`,
      mimetype: "image/jpeg",
    });
  } else {
    await sock.sendMessage(jid, { text: `🎵 *${title}*\n👤 ${channel} | ⏱ ${dur}\n\n⬇️ Mengunduh...` });
  }

  const ext = asVideo ? "mp4" : "mp3";
  const tmp = path.join(TEMP_DIR, `${Date.now()}.${ext}`);

  try {
    await new Promise((resolve, reject) => {
      const stream = asVideo
        ? ytdl(ytUrl, { quality: "highestvideo" })
        : ytdl(ytUrl, { quality: "highestaudio", filter: "audioonly" });
      stream.pipe(fs.createWriteStream(tmp))
        .on("finish", resolve)
        .on("error", reject);
    });

    if (asVideo) {
      await sock.sendMessage(jid, {
        video: { url: tmp },
        caption: `🎬 *${title}*\n👤 ${channel} | ⏱ ${dur}`,
        fileName: `${title}.mp4`,
        mimetype: "video/mp4",
      });
    } else {
      await sock.sendMessage(jid, {
        audio: { url: tmp },
        mimetype: "audio/mpeg",
        ptt: false,
        fileName: `${title}.mp3`,
      });
    }

    addHist(jid, { title, dur, channel });
    await sock.sendMessage(jid, {
      text: `✅ Selesai!\n💡 \`${PREFIX}lirik ${title}\` untuk liriknya.`,
    });
  } catch (e) {
    console.error("[PLAY]", e.message);
    fs.removeSync(tmp);
    await sock.sendMessage(jid, { text: "❌ Gagal download. Video mungkin dibatasi." });
  }
}

// ─── CMD: cari ────────────────────────────────────────────────
async function cmdCari(sock, jid, query) {
  await sock.sendMessage(jid, { text: `🔍 Mencari *${query}*...` });
  try {
    const results = await YouTube.search(query, { limit: 5, type: "video" });
    if (!results.length) return sock.sendMessage(jid, { text: "❌ Tidak ada hasil." });

    let msg = `🎵 *Hasil: "${query}"*\n${"─".repeat(30)}\n\n`;
    results.forEach((v, i) => {
      const dur = fmtDur(Math.floor((v.duration || 0) / 1000));
      msg += `*${i + 1}.* ${v.title}\n    👤 ${v.channel?.name || "?"} | ⏱ ${dur}\n\n`;
    });
    msg += `💡 \`${PREFIX}play <judul>\` untuk download.`;
    await sock.sendMessage(jid, { text: msg });
  } catch {
    await sock.sendMessage(jid, { text: "❌ Gagal mencari." });
  }
}

// ─── CMD: info ────────────────────────────────────────────────
async function cmdInfo(sock, jid, query) {
  await sock.sendMessage(jid, { text: `🔍 Mengambil info...` });
  try {
    const results = await YouTube.search(query, { limit: 1, type: "video" });
    if (!results.length) return sock.sendMessage(jid, { text: "❌ Tidak ditemukan." });
    const v   = results[0];
    const dur = fmtDur(Math.floor((v.duration || 0) / 1000));

    const caption =
      `╔══ 🎵 *INFO LAGU* ══╗\n` +
      `║ *Judul:*   ${v.title}\n` +
      `║ *Channel:* ${v.channel?.name || "?"}\n` +
      `║ *Durasi:*  ${dur}\n` +
      `║ *Views:*   ${fmtNum(v.views || 0)}\n` +
      `║ *Link:*    youtu.be/${v.id}\n` +
      `╚═══════════════════╝`;

    const thumb = await makeThumbnail(v.id, v.title, v.channel?.name || "?", dur);
    if (thumb) {
      await sock.sendMessage(jid, { image: thumb, caption, mimetype: "image/jpeg" });
    } else {
      await sock.sendMessage(jid, { text: caption });
    }
  } catch {
    await sock.sendMessage(jid, { text: "❌ Gagal mengambil info." });
  }
}

// ─── CMD: lirik ───────────────────────────────────────────────
async function cmdLirik(sock, jid, query) {
  await sock.sendMessage(jid, { text: `📝 Mencari lirik *${query}*...` });
  try {
    const r = await axios.get(
      `https://lyrist.vercel.app/api/${encodeURIComponent(query)}`,
      { timeout: 10000 }
    );
    if (!r.data?.lyrics) throw new Error("no lyrics");
    const msg =
      `🎤 *${r.data.title || query}*\n👤 ${r.data.artist || "Unknown"}\n${"─".repeat(30)}\n\n` +
      r.data.lyrics.substring(0, 3500) +
      (r.data.lyrics.length > 3500 ? "\n\n_(dipotong)_" : "");
    await sock.sendMessage(jid, { text: msg });
  } catch {
    await sock.sendMessage(jid, {
      text: `❌ Lirik tidak ditemukan.\n💡 Coba tulis judulnya dalam Bahasa Inggris.`,
    });
  }
}

// ─── CMD: history ─────────────────────────────────────────────
async function cmdHistory(sock, jid) {
  const h = playHist[jid];
  if (!h?.length) return sock.sendMessage(jid, { text: "📋 Belum ada riwayat." });
  let msg = `📋 *History Pemutaran*\n${"─".repeat(30)}\n\n`;
  h.forEach((x, i) => { msg += `*${i + 1}.* ${x.title}\n    👤 ${x.channel} | ⏱ ${x.dur}\n\n`; });
  await sock.sendMessage(jid, { text: msg });
}

// ─── GAME: Tebak Lagu ─────────────────────────────────────────
const SONGS = [
  { title: "shape of you",      artist: "Ed Sheeran",       hint: "Lagu pop 2017, ketemu di gym" },
  { title: "bohemian rhapsody", artist: "Queen",             hint: "Rock klasik 1975, ada bagian opera" },
  { title: "blinding lights",   artist: "The Weeknd",        hint: "Synth-pop 2019 nuansa 80-an" },
  { title: "levitating",        artist: "Dua Lipa",          hint: "Disko-pop 2020 tentang terbang" },
  { title: "lantas",            artist: "Juicy Luicy",       hint: "Pop Indonesia tentang rasa belum selesai" },
  { title: "hati-hati di jalan",artist: "Tulus",             hint: "Pop Indonesia, sering jadi OST film" },
  { title: "kangen",            artist: "Dewa 19",           hint: "Rock Indonesia lawas tentang rindu" },
  { title: "stressed out",      artist: "Twenty One Pilots", hint: "Alt hip-hop, nostalgia masa kecil" },
  { title: "dynamite",          artist: "BTS",               hint: "K-Pop 2020, bahasa Inggris penuh energi" },
  { title: "someone like you",  artist: "Adele",             hint: "Piano ballad tentang mantan yang sudah menikah" },
  { title: "riptide",           artist: "Vance Joy",         hint: "Indie pop Australia pakai ukulele" },
  { title: "stay",              artist: "The Kid LAROI",     hint: "Viral TikTok 2021 feat Justin Bieber" },
  { title: "satu",              artist: "Gigi",              hint: "Rock Indonesia era 2000-an" },
  { title: "manusia kuat",      artist: "Tulus",             hint: "Pop Indonesia tentang ketangguhan" },
  { title: "peaches",           artist: "Justin Bieber",     hint: "R&B 2021 tentang California" },
];

async function cmdTebak(sock, jid) {
  if (tebakGame[jid]) {
    const g = tebakGame[jid];
    return sock.sendMessage(jid, {
      text:
        `🎮 Masih ada soal aktif!\n\n` +
        `🎵 *Petunjuk:* ${g.hint}\n` +
        `🎤 *Artis:* ${g.artist}\n\n` +
        `Ketik judul lagu, atau \`${PREFIX}skip\` untuk lewati.`,
    });
  }
  const s = SONGS[Math.floor(Math.random() * SONGS.length)];
  tebakGame[jid] = { ...s, attempts: 0, start: Date.now() };
  await sock.sendMessage(jid, {
    text:
      `🎮 *TEBAK JUDUL LAGU!*\n${"─".repeat(30)}\n\n` +
      `🎵 *Petunjuk:* ${s.hint}\n` +
      `🎤 *Artis:*    ${s.artist}\n\n` +
      `Ketik judul lagunya! (3 kesempatan)\n` +
      `\`${PREFIX}skip\` = lewati`,
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
      text:
        `🎉 *BENAR!* +${skor} poin\n` +
        `🎵 Jawaban: *${g.title}*\n` +
        `Skor kamu: *${tebakSkor[jid][sender]}*\n\n` +
        `\`${PREFIX}tebak\` untuk lanjut!`,
    });
  } else if (g.attempts >= 3) {
    delete tebakGame[jid];
    await sock.sendMessage(jid, {
      text: `😅 Habis! Jawaban: *${g.title}*\n\n\`${PREFIX}tebak\` untuk coba lagi!`,
    });
  } else {
    await sock.sendMessage(jid, {
      text: `❌ Salah! Sisa ${3 - g.attempts} kesempatan.\n💡 ${g.hint}`,
    });
  }
  return true;
}

// ─── GAME: Hangman ────────────────────────────────────────────
const HM_WORDS = [
  "gitar","drum","piano","melodi","lirik","konser","album","single",
  "vokal","bassist","gitaris","drummer","nada","kunci","tempo","ritme",
  "beatbox","rapper","penyanyi","musisi",
];
const HM_FACE = ["😵","😰","😨","😟","😐","🙂","😁"];

async function cmdHangman(sock, jid) {
  if (hmGame[jid]) {
    const g = hmGame[jid];
    const disp = g.word.split("").map(c => g.guessed.includes(c) ? c : "_").join(" ");
    return sock.sendMessage(jid, {
      text:
        `🎮 Hangman masih jalan!\n\n` +
        `${HM_FACE[HM_FACE.length - 1 - g.wrong]} Salah: ${g.wrong}/6\n` +
        `Kata: \`${disp}\`\n` +
        `Huruf: ${g.guessed.join(", ") || "-"}\n\n` +
        `Kirim 1 huruf. \`${PREFIX}hhint\` petunjuk. \`${PREFIX}hstop\` berhenti.`,
    });
  }
  const word = HM_WORDS[Math.floor(Math.random() * HM_WORDS.length)];
  hmGame[jid] = { word, guessed: [], wrong: 0 };
  const disp = word.split("").map(() => "_").join(" ");
  await sock.sendMessage(jid, {
    text:
      `🎮 *HANGMAN MUSIK!*\n${"─".repeat(30)}\n\n` +
      `😁 Salah: 0/6\n` +
      `Kata: \`${disp}\` (${word.length} huruf)\n\n` +
      `Kirim 1 huruf!\n\`${PREFIX}hhint\` = petunjuk | \`${PREFIX}hstop\` = berhenti`,
  });
}

async function handleHangmanHuruf(sock, jid, sender, letter) {
  const g = hmGame[jid];
  if (!g) return false;
  if (!/^[a-z]$/i.test(letter)) return false;

  const l = letter.toLowerCase();
  if (g.guessed.includes(l)) {
    await sock.sendMessage(jid, { text: `⚠️ Huruf *${l.toUpperCase()}* sudah ditebak.` });
    return true;
  }

  g.guessed.push(l);
  if (!g.word.includes(l)) g.wrong++;

  const disp = g.word.split("").map(c => g.guessed.includes(c) ? c : "_").join(" ");
  const done = !disp.includes("_");
  const dead = g.wrong >= 6;

  if (done) {
    if (!tebakSkor[jid]) tebakSkor[jid] = {};
    tebakSkor[jid][sender] = (tebakSkor[jid][sender] || 0) + 50;
    delete hmGame[jid];
    await sock.sendMessage(jid, {
      text: `🎉 *BENAR SEMUA!* +50 poin\n🎵 Kata: *${g.word.toUpperCase()}*\n\n\`${PREFIX}hangman\` lagi!`,
    });
  } else if (dead) {
    delete hmGame[jid];
    await sock.sendMessage(jid, {
      text: `💀 *GAME OVER!*\n🎵 Kata: *${g.word.toUpperCase()}*\n\n\`${PREFIX}hangman\` untuk coba lagi!`,
    });
  } else {
    await sock.sendMessage(jid, {
      text:
        `${g.word.includes(l) ? "✅ Benar!" : "❌ Salah!"}\n\n` +
        `${HM_FACE[HM_FACE.length - 1 - g.wrong]} Salah: ${g.wrong}/6\n` +
        `Kata: \`${disp}\`\n` +
        `Huruf: ${g.guessed.join(", ")}`,
    });
  }
  return true;
}

// ─── GAME: Tic-Tac-Toe ────────────────────────────────────────
function boardStr(b) {
  const s = i => b[i] === 0 ? "⬜" : b[i] === 1 ? "❌" : "⭕";
  return `${s(0)}${s(1)}${s(2)}\n${s(3)}${s(4)}${s(5)}\n${s(6)}${s(7)}${s(8)}`;
}
function checkWin(b, p) {
  return [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
    .some(w => w.every(i => b[i] === p));
}
function aiMove(b) {
  for (const p of [2, 1]) {
    for (let i = 0; i < 9; i++) {
      if (b[i] === 0) { b[i] = p; if (checkWin(b, p)) { b[i] = 0; return i; } b[i] = 0; }
    }
  }
  if (b[4] === 0) return 4;
  const free = b.map((v, i) => v === 0 ? i : -1).filter(i => i >= 0);
  return free[Math.floor(Math.random() * free.length)];
}

async function cmdTictac(sock, jid, sender) {
  tttGame[jid] = { board: Array(9).fill(0), player: sender };
  await sock.sendMessage(jid, {
    text:
      `🎮 *TIC-TAC-TOE vs BOT*\n${"─".repeat(28)}\n\n` +
      boardStr(tttGame[jid].board) +
      `\n\nKamu ❌ vs Bot ⭕\n\nPilih posisi (1-9):\n1️⃣2️⃣3️⃣\n4️⃣5️⃣6️⃣\n7️⃣8️⃣9️⃣`,
  });
}

async function handleTictacMove(sock, jid, sender, num) {
  const g = tttGame[jid];
  if (!g || g.player !== sender) return false;
  if (isNaN(num) || num < 1 || num > 9) return false;

  const idx = num - 1;
  if (g.board[idx] !== 0) {
    await sock.sendMessage(jid, { text: "⚠️ Posisi sudah terisi! Pilih lain." });
    return true;
  }

  g.board[idx] = 1;
  if (checkWin(g.board, 1)) {
    delete tttGame[jid];
    if (!tebakSkor[jid]) tebakSkor[jid] = {};
    tebakSkor[jid][sender] = (tebakSkor[jid][sender] || 0) + 30;
    await sock.sendMessage(jid, { text: `${boardStr(g.board)}\n\n🎉 *Kamu MENANG!* +30 poin` });
    return true;
  }
  if (!g.board.includes(0)) {
    delete tttGame[jid];
    await sock.sendMessage(jid, { text: `${boardStr(g.board)}\n\n🤝 *SERI!*` });
    return true;
  }

  const ai = aiMove(g.board);
  g.board[ai] = 2;
  if (checkWin(g.board, 2)) {
    delete tttGame[jid];
    await sock.sendMessage(jid, { text: `${boardStr(g.board)}\n\n🤖 *Bot MENANG!*\n\`${PREFIX}tictac\` untuk ulang.` });
    return true;
  }
  if (!g.board.includes(0)) {
    delete tttGame[jid];
    await sock.sendMessage(jid, { text: `${boardStr(g.board)}\n\n🤝 *SERI!*` });
    return true;
  }

  await sock.sendMessage(jid, {
    text: `${boardStr(g.board)}\n\nGiliran kamu! Pilih (1-9):`,
  });
  return true;
}

// ─── CMD: skor ────────────────────────────────────────────────
async function cmdSkor(sock, jid, sender) {
  const s = tebakSkor[jid];
  if (!s || !Object.keys(s).length)
    return sock.sendMessage(jid, { text: `🏆 Belum ada skor. Main \`${PREFIX}tebak\`, \`${PREFIX}hangman\`, atau \`${PREFIX}tictac\`!` });

  const sorted = Object.entries(s).sort((a, b) => b[1] - a[1]);
  let msg = `🏆 *PAPAN SKOR*\n${"─".repeat(28)}\n\n`;
  sorted.forEach(([num, pts], i) => {
    const medal = ["🥇", "🥈", "🥉"][i] || "  ";
    msg += `${medal} ${num.split("@")[0]} — *${pts} poin*${num === sender ? " ← kamu" : ""}\n`;
  });
  await sock.sendMessage(jid, { text: msg });
}

// ─── Message Handler ──────────────────────────────────────────
async function handleMsg(sock, msg) {
  if (!msg.message) return;

  const jid    = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const body   = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption || ""
  ).trim();

  if (!body) return;

  // ── Cek game aktif (jawaban tanpa prefix) ─────────────────
  if (!body.startsWith(PREFIX)) {
    if (tebakGame[jid]) {
      await handleTebakJawab(sock, jid, sender, body);
      return;
    }
    if (hmGame[jid] && /^[a-zA-Z]$/.test(body)) {
      await handleHangmanHuruf(sock, jid, sender, body);
      return;
    }
    if (tttGame[jid] && /^[1-9]$/.test(body)) {
      await handleTictacMove(sock, jid, sender, parseInt(body));
      return;
    }
    return;
  }

  // ── Parse command ─────────────────────────────────────────
  const [rawCmd, ...args] = body.slice(PREFIX.length).trim().split(/\s+/);
  const cmd   = rawCmd.toLowerCase();
  const query = args.join(" ");

  console.log(`[CMD] ${sender.split("@")[0]} → ${PREFIX}${cmd} ${query}`);

  switch (cmd) {
    case "menu":
    case "help":
      await sock.sendMessage(jid, { text: MENU });
      break;

    case "ping": {
      const t = Date.now();
      await sock.sendMessage(jid, { text: "🏓 Pong!" });
      await sock.sendMessage(jid, { text: `✅ *Bot aktif!*\n⚡ Latensi: *${Date.now() - t}ms*` });
      break;
    }

    case "play":
    case "dl":
      if (!query) return sock.sendMessage(jid, { text: `⚠️ Contoh: \`${PREFIX}play Shape of You\`` });
      await cmdPlay(sock, jid, query, false);
      break;

    case "mp4":
    case "video":
      if (!query) return sock.sendMessage(jid, { text: `⚠️ Contoh: \`${PREFIX}mp4 Shape of You\`` });
      await cmdPlay(sock, jid, query, true);
      break;

    case "cari":
    case "search":
      if (!query) return sock.sendMessage(jid, { text: `⚠️ Contoh: \`${PREFIX}cari Tulus\`` });
      await cmdCari(sock, jid, query);
      break;

    case "info":
      if (!query) return sock.sendMessage(jid, { text: `⚠️ Contoh: \`${PREFIX}info Tulus\`` });
      await cmdInfo(sock, jid, query);
      break;

    case "lirik":
    case "lyrics":
      if (!query) return sock.sendMessage(jid, { text: `⚠️ Contoh: \`${PREFIX}lirik Yellow Coldplay\`` });
      await cmdLirik(sock, jid, query);
      break;

    case "history":
    case "riwayat":
      await cmdHistory(sock, jid);
      break;

    case "tebak":
      await cmdTebak(sock, jid);
      break;

    case "skip":
      if (tebakGame[jid]) {
        const ans = tebakGame[jid].title;
        delete tebakGame[jid];
        await sock.sendMessage(jid, { text: `⏭️ Di-skip! Jawaban: *${ans}*` });
      } else {
        await sock.sendMessage(jid, { text: "❌ Tidak ada soal aktif." });
      }
      break;

    case "hangman":
      await cmdHangman(sock, jid);
      break;

    case "hhint":
      if (hmGame[jid]) {
        const g = hmGame[jid];
        const unguessed = g.word.split("").filter(c => !g.guessed.includes(c));
        if (unguessed.length) {
          const hint = unguessed[Math.floor(Math.random() * unguessed.length)];
          g.guessed.push(hint);
          g.wrong++;
          const disp = g.word.split("").map(c => g.guessed.includes(c) ? c : "_").join(" ");
          await sock.sendMessage(jid, { text: `💡 Huruf: *${hint.toUpperCase()}* (-1 nyawa)\nKata: \`${disp}\`` });
        }
      } else {
        await sock.sendMessage(jid, { text: `❌ Tidak ada game hangman aktif.` });
      }
      break;

    case "hstop":
      if (hmGame[jid]) {
        delete hmGame[jid];
        await sock.sendMessage(jid, { text: "🛑 Hangman dihentikan." });
      }
      break;

    case "tictac":
    case "ttt":
      await cmdTictac(sock, jid, sender);
      break;

    case "skor":
    case "score":
      await cmdSkor(sock, jid, sender);
      break;

    default:
      await sock.sendMessage(jid, {
        text: `❓ Perintah *${PREFIX}${cmd}* tidak dikenal.\nKetik \`${PREFIX}menu\` untuk daftar.`,
      });
  }
}

// ─── Koneksi WhatsApp ─────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger:               pino({ level: "silent" }),
    printQRInTerminal:    false,
    auth:                 state,
    browser:              Browsers.macOS("Safari"),
    msgRetryCounterCache: retryCache,
    syncFullHistory:      false,
    connectTimeoutMs:     60000,
    keepAliveIntervalMs:  25000,
  });

  // Pairing code (hanya saat pertama kali)
  if (!sock.authState.creds.registered) {
    if (!WA_NUMBER) {
      console.error("❌ Set ENV: WA_NUMBER=62812xxxx");
      process.exit(1);
    }
    try {
      await new Promise(r => setTimeout(r, 3000));
      const code = await sock.requestPairingCode(WA_NUMBER);
      const fmt  = code.match(/.{1,4}/g).join("-");
      console.log(`\n╔══════════════════════════════╗`);
      console.log(`║  🔑  PAIRING CODE:  ${fmt}  ║`);
      console.log(`╚══════════════════════════════╝`);
      console.log(`\n➡️  WA > Perangkat Tertaut > Tautkan dengan nomor telepon`);
      console.log(`   Masukkan: ${fmt}\n`);
    } catch (e) {
      console.error("❌ Gagal pairing:", e.message);
    }
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log(`🔴 Putus (${code}), reconnect dalam 5 detik...`);
      if (code === DisconnectReason.loggedOut) {
        console.log("🗑️  Session dihapus (logout).");
        fs.removeSync(SESSION_DIR);
      }
      setTimeout(startBot, 5000);
    } else if (connection === "open") {
      console.log(`🟢 ${BOT_NAME} terhubung! Prefix: ${PREFIX}`);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      // Skip pesan dari bot sendiri KECUALI di chat "Saya (Anda)"
      const jid = msg.key.remoteJid;
      const isSelfChat = jid && jid.includes(WA_NUMBER.replace(/[^0-9]/g, ""));
      if (msg.key.fromMe && !isSelfChat) continue;
      await handleMsg(sock, msg).catch(e => console.error("[ERR]", e.message));
    }
  });
}

// ─── Start ────────────────────────────────────────────────────
console.log(`\n🎵 Starting ${BOT_NAME}...\n`);
startBot().catch(console.error);
