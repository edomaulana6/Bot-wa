/**
 * ╔══════════════════════════════════════════════╗
 * ║     🎵  WA MUSIC BOT v2.0  🎵               ║
 * ║     Koyeb Server Edition                     ║
 * ║     Fitur: Musik + Thumbnail + Games         ║
 * ╚══════════════════════════════════════════════╝
 */

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
const Jimp      = require("jimp");

// ─── Konfigurasi ──────────────────────────────────────────────
const CONFIG = {
  PREFIX:       process.env.PREFIX       || "!",
  BOT_NAME:     process.env.BOT_NAME     || "🎵 MusicBot",
  OWNER_NUMBER: process.env.OWNER_NUMBER || "",
  SESSION_DIR:  process.env.SESSION_DIR  || "./sessions",
  TEMP_DIR:     "./temp",
  MAX_DURATION: parseInt(process.env.MAX_DURATION || "15"),
  MAX_RESULTS:  5,
  PORT:         parseInt(process.env.PORT || "8000"),
  // Nomor WA untuk pairing (set via env, WAJIB)
  WA_NUMBER:    process.env.WA_NUMBER    || "",
};

fs.ensureDirSync(CONFIG.SESSION_DIR);
fs.ensureDirSync(CONFIG.TEMP_DIR);

// ─── Keep-alive HTTP Server (wajib untuk Koyeb) ──────────────
const app = express();
app.get("/",        (_req, res) => res.send(`✅ ${CONFIG.BOT_NAME} aktif!`));
app.get("/health",  (_req, res) => res.json({ status: "ok", bot: CONFIG.BOT_NAME, uptime: process.uptime() }));
app.listen(CONFIG.PORT, () => console.log(`🌐 HTTP server jalan di port ${CONFIG.PORT}`));

// ─── State Global ─────────────────────────────────────────────
const msgRetryCounterCache = new NodeCache();
const history  = {};      // { jid: [{title,url,duration,channel}] }
const tebakNow = {};      // { jid: {answer, attempts, startTime} }
const tebakSkor= {};      // { jid: { number: score } }
const hangman  = {};      // { jid: {word, guessed, wrong, maxWrong} }
const duel     = {};      // { jid: {p1,p2,board,turn} }

// ─── Utilitas ─────────────────────────────────────────────────
const fmt = (s) => { const m=Math.floor(s/60),x=s%60; return `${m}:${String(x).padStart(2,"0")}`; };
const fmtN = (n) => n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(1)+"K":String(n);
const addHist = (jid, item) => {
  if (!history[jid]) history[jid]=[];
  history[jid].unshift(item);
  if (history[jid].length>10) history[jid].pop();
};
const cleanTemp = () => {
  const now=Date.now();
  fs.readdirSync(CONFIG.TEMP_DIR).forEach(f=>{
    const fp=path.join(CONFIG.TEMP_DIR,f);
    if(now-fs.statSync(fp).mtimeMs>10*60*1000) fs.removeSync(fp);
  });
};
setInterval(cleanTemp, 5*60*1000);

// ─── Thumbnail Generator ──────────────────────────────────────
/**
 * Buat thumbnail kartu lagu dari URL thumbnail YouTube
 * Return: Buffer gambar PNG siap kirim
 */
async function makeThumbnail(ytThumbUrl, title, channel, duration) {
  try {
    // Download gambar thumbnail dari YouTube
    const response = await axios.get(ytThumbUrl, { responseType: "arraybuffer", timeout: 8000 });
    const imgBuf   = Buffer.from(response.data);

    // Load dengan Jimp
    const img = await Jimp.read(imgBuf);
    img.resize(640, 360);

    // Overlay gelap di bawah untuk teks
    const overlay = new Jimp(640, 100, 0x000000aa);
    img.composite(overlay, 0, 260);

    // Load font
    const fontLarge  = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontSmall  = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

    // Tulis judul (potong kalau panjang)
    const shortTitle = title.length > 38 ? title.substring(0, 35) + "..." : title;
    img.print(fontLarge, 12, 268, shortTitle);
    img.print(fontSmall, 12, 310, `👤 ${channel}   ⏱ ${duration}`);

    // Tambah badge merah "🎵 MUSIK"
    const badge = new Jimp(90, 28, 0xee1111ff);
    img.composite(badge, 540, 10);
    const fontBadge = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
    img.print(fontBadge, 548, 15, "🎵 MUSIK");

    return await img.getBufferAsync(Jimp.MIME_JPEG);
  } catch (e) {
    console.error("[THUMB ERROR]", e.message);
    return null;
  }
}

// ─── Teks Menu ────────────────────────────────────────────────
const MENU = `
╔══════════════════════════════════╗
║  🎵  *WA MUSIC BOT v2.0*  🎵    ║
╠══════════════════════════════════╣
║  🎧  *MUSIK*                     ║
║  ${CONFIG.PREFIX}play  <judul/link>         ║
║  ${CONFIG.PREFIX}mp4   <judul/link>         ║
║  ${CONFIG.PREFIX}cari  <judul>              ║
║  ${CONFIG.PREFIX}lirik <judul>              ║
║  ${CONFIG.PREFIX}info  <judul/link>         ║
║  ${CONFIG.PREFIX}history                    ║
╠══════════════════════════════════╣
║  🎮  *PERMAINAN*                 ║
║  ${CONFIG.PREFIX}tebak   — Tebak judul lagu ║
║  ${CONFIG.PREFIX}hangman — Tebak kata musik ║
║  ${CONFIG.PREFIX}tictac  — Tic-Tac-Toe      ║
║  ${CONFIG.PREFIX}skor    — Lihat skormu      ║
╠══════════════════════════════════╣
║  ℹ️   *LAINNYA*                   ║
║  ${CONFIG.PREFIX}menu  — tampilkan ini       ║
║  ${CONFIG.PREFIX}ping  — cek status bot      ║
╚══════════════════════════════════╝
`.trim();

// ─── Command: Play ────────────────────────────────────────────
async function cmdPlay(sock, jid, query, asVideo=false) {
  await sock.sendMessage(jid, { text: `🔍 Mencari *${query}*...` });

  let vid;
  try {
    const res = await YouTube.search(query, { limit:1, type:"video" });
    if (!res.length) return sock.sendMessage(jid, { text:"❌ Lagu tidak ditemukan." });
    vid = res[0];
  } catch { return sock.sendMessage(jid, { text:"❌ Gagal mencari. Coba lagi." }); }

  const durMin = Math.floor((vid.duration||0)/60000);
  if (durMin > CONFIG.MAX_DURATION)
    return sock.sendMessage(jid, { text:`⚠️ Durasi terlalu panjang (${durMin} menit). Maks: *${CONFIG.MAX_DURATION} menit*.` });

  const title   = vid.title || "Unknown";
  const url     = `https://www.youtube.com/watch?v=${vid.id}`;
  const dur     = fmt(Math.floor((vid.duration||0)/1000));
  const channel = vid.channel?.name || "Unknown";
  const thumbUrl= `https://i.ytimg.com/vi/${vid.id}/hqdefault.jpg`;

  // ── Kirim Thumbnail dulu ──────────────────────────────────
  const thumbBuf = await makeThumbnail(thumbUrl, title, channel, dur);
  if (thumbBuf) {
    await sock.sendMessage(jid, {
      image: thumbBuf,
      caption: `🎵 *${title}*\n👤 ${channel} | ⏱ ${dur}\n\n⬇️ Mengunduh, mohon tunggu...`,
      mimetype: "image/jpeg",
    });
  } else {
    await sock.sendMessage(jid, { text:`🎵 *${title}*\n👤 ${channel} | ⏱ ${dur}\n\n⬇️ Mengunduh...` });
  }

  const ext  = asVideo ? "mp4" : "mp3";
  const tmp  = path.join(CONFIG.TEMP_DIR, `${Date.now()}.${ext}`);

  try {
    if (asVideo) {
      await new Promise((res,rej) => ytdl(url,{quality:"highestvideo"}).pipe(fs.createWriteStream(tmp)).on("finish",res).on("error",rej));
      await sock.sendMessage(jid, {
        video: { url: tmp },
        caption: `🎬 *${title}*\n👤 ${channel} | ⏱ ${dur}`,
        fileName: `${title}.mp4`,
        mimetype: "video/mp4",
      });
    } else {
      await new Promise((res,rej) => ytdl(url,{quality:"highestaudio",filter:"audioonly"}).pipe(fs.createWriteStream(tmp)).on("finish",res).on("error",rej));
      await sock.sendMessage(jid, {
        audio: { url: tmp },
        mimetype: "audio/mpeg",
        ptt: false,
        fileName: `${title}.mp3`,
      });
    }
    addHist(jid, { title, url, dur, channel });
    await sock.sendMessage(jid, { text:`✅ Selesai! Ketik \`${CONFIG.PREFIX}lirik ${title}\` untuk liriknya.` });
  } catch(e) {
    console.error("[PLAY ERROR]", e.message);
    fs.removeSync(tmp);
    await sock.sendMessage(jid, { text:"❌ Gagal download. Video mungkin dibatasi." });
  }
}

// ─── Command: Search ──────────────────────────────────────────
async function cmdSearch(sock, jid, query) {
  await sock.sendMessage(jid, { text:`🔍 Mencari *${query}*...` });
  try {
    const res = await YouTube.search(query, { limit:CONFIG.MAX_RESULTS, type:"video" });
    if (!res.length) return sock.sendMessage(jid, { text:"❌ Tidak ada hasil." });

    let msg = `🎵 *Hasil: "${query}"*\n${"─".repeat(32)}\n\n`;
    for (let i=0;i<res.length;i++) {
      const v   = res[i];
      const dur = fmt(Math.floor((v.duration||0)/1000));
      msg += `*${i+1}.* ${v.title}\n    👤 ${v.channel?.name||"?"} | ⏱ ${dur}\n\n`;
    }
    msg += `💡 \`${CONFIG.PREFIX}play <judul>\` untuk download.`;
    await sock.sendMessage(jid, { text:msg });
  } catch { await sock.sendMessage(jid, { text:"❌ Gagal mencari." }); }
}

// ─── Command: Info ────────────────────────────────────────────
async function cmdInfo(sock, jid, query) {
  await sock.sendMessage(jid, { text:`🔍 Mengambil info *${query}*...` });
  try {
    const res = await YouTube.search(query, { limit:1, type:"video" });
    if (!res.length) return sock.sendMessage(jid, { text:"❌ Tidak ditemukan." });
    const v   = res[0];
    const dur = fmt(Math.floor((v.duration||0)/1000));
    const thumbBuf = await makeThumbnail(`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, v.title, v.channel?.name||"?", dur);

    const caption =
      `╔══ 🎵 *INFO LAGU* ══╗\n` +
      `║ *Judul:*   ${v.title}\n` +
      `║ *Channel:* ${v.channel?.name||"?"}\n` +
      `║ *Durasi:*  ${dur}\n` +
      `║ *Views:*   ${fmtN(v.views||0)}\n` +
      `║ *URL:*     https://youtu.be/${v.id}\n` +
      `╚══════════════════════╝`;

    if (thumbBuf) {
      await sock.sendMessage(jid, { image:thumbBuf, caption, mimetype:"image/jpeg" });
    } else {
      await sock.sendMessage(jid, { text:caption });
    }
  } catch { await sock.sendMessage(jid, { text:"❌ Gagal mengambil info." }); }
}

// ─── Command: Lirik ───────────────────────────────────────────
async function cmdLyrics(sock, jid, query) {
  await sock.sendMessage(jid, { text:`📝 Mencari lirik *${query}*...` });
  try {
    const enc = encodeURIComponent(query);
    const r   = await axios.get(`https://lyrist.vercel.app/api/${enc}`, { timeout:10000 });
    if (!r.data?.lyrics) throw new Error("no lyrics");
    const msg =
      `🎤 *${r.data.title||query}*\n👤 ${r.data.artist||"Unknown"}\n${"─".repeat(30)}\n\n` +
      r.data.lyrics.substring(0,3500) +
      (r.data.lyrics.length>3500 ? "\n\n_(lirik dipotong)_" : "");
    await sock.sendMessage(jid, { text:msg });
  } catch {
    await sock.sendMessage(jid, { text:`❌ Lirik *${query}* tidak ditemukan.\n💡 Coba judul dalam Bahasa Inggris.` });
  }
}

// ─── Command: History ─────────────────────────────────────────
async function cmdHistory(sock, jid) {
  const h = history[jid];
  if (!h?.length) return sock.sendMessage(jid, { text:"📋 Belum ada riwayat pemutaran." });
  let msg = `📋 *History Pemutaran*\n${"─".repeat(30)}\n\n`;
  h.forEach((x,i) => { msg+=`*${i+1}.* ${x.title}\n    👤 ${x.channel} | ⏱ ${x.dur}\n\n`; });
  msg += `💡 \`${CONFIG.PREFIX}play <judul>\` untuk memutar ulang.`;
  await sock.sendMessage(jid, { text:msg });
}

// ─── GAME: Tebak Lagu ─────────────────────────────────────────
const SONG_POOL = [
  { title:"Shape of You",    artist:"Ed Sheeran",    hint:"Lagu pop Inggris 2017 tentang bertemu seseorang di gym" },
  { title:"Bohemian Rhapsody",artist:"Queen",        hint:"Lagu rock klasik 1975, ada bagian opera di tengahnya" },
  { title:"Blinding Lights", artist:"The Weeknd",    hint:"Lagu synth-pop 2019 dengan nuansa 80-an" },
  { title:"Levitating",      artist:"Dua Lipa",      hint:"Lagu disko-pop 2020 tentang terbang bersama seseorang" },
  { title:"Lantas",          artist:"Juicy Luicy",   hint:"Lagu pop Indonesia tentang rasa yang belum selesai" },
  { title:"Hati-Hati di Jalan",artist:"Tulus",       hint:"Lagu pop Indonesia yang sering jadi OST film" },
  { title:"Kangen",          artist:"Dewa 19",       hint:"Lagu rock Indonesia lawas tentang rindu" },
  { title:"Manusia Kuat",    artist:"Tulus",         hint:"Lagu pop Indonesia tentang ketangguhan" },
  { title:"Satu",            artist:"Gigi",          hint:"Lagu rock Indonesia tahun 2000-an" },
  { title:"Stressed Out",    artist:"Twenty One Pilots",hint:"Lagu alternative hip-hop tentang nostalgia masa kecil" },
  { title:"Dynamite",        artist:"BTS",           hint:"Lagu K-Pop 2020 berbahasa Inggris penuh energi" },
  { title:"Stay",            artist:"The Kid LAROI ft. Justin Bieber",hint:"Lagu pop 2021 yang sangat viral di TikTok" },
  { title:"Peaches",         artist:"Justin Bieber", hint:"Lagu R&B 2021 tentang buah persik dan California" },
  { title:"Riptide",         artist:"Vance Joy",     hint:"Lagu indie pop Australia dengan ukulele" },
  { title:"Someone Like You",artist:"Adele",         hint:"Ballad piano Adele tentang mantan yang menikah" },
];

async function cmdTebak(sock, jid) {
  if (tebakNow[jid]) {
    const t = tebakNow[jid];
    return sock.sendMessage(jid, {
      text:
        `🎮 Kamu masih punya tebakan aktif!\n\n` +
        `🎵 *Petunjuk:* ${t.hint}\n` +
        `🎤 *Artis:* ${t.artist}\n\n` +
        `Ketik judul lagunya untuk menjawab!\n` +
        `Atau \`${CONFIG.PREFIX}skip\` untuk lewati.`,
    });
  }
  const song = SONG_POOL[Math.floor(Math.random() * SONG_POOL.length)];
  tebakNow[jid] = { answer:song.title.toLowerCase(), hint:song.hint, artist:song.artist, attempts:0, startTime:Date.now() };
  await sock.sendMessage(jid, {
    text:
      `🎮 *TEBAK JUDUL LAGU!*\n${"─".repeat(30)}\n\n` +
      `🎵 *Petunjuk:* ${song.hint}\n` +
      `🎤 *Artis:*    ${song.artist}\n\n` +
      `Ketik judul lagunya!\n` +
      `Punya 3 kesempatan.\n\`${CONFIG.PREFIX}skip\` = lewati`,
  });
}

async function cmdTebakAnswer(sock, jid, sender, text) {
  const game = tebakNow[jid];
  if (!game) return;

  game.attempts++;
  const jawaban = text.trim().toLowerCase();
  const correct = game.answer;

  // Hitung skor makin cepat makin tinggi
  const elapsedSec = Math.floor((Date.now() - game.startTime) / 1000);
  const baseScore  = Math.max(10, 100 - elapsedSec);

  if (jawaban === correct || jawaban.includes(correct) || correct.includes(jawaban)) {
    if (!tebakSkor[jid]) tebakSkor[jid] = {};
    tebakSkor[jid][sender] = (tebakSkor[jid][sender] || 0) + baseScore;
    delete tebakNow[jid];
    await sock.sendMessage(jid, {
      text:
        `🎉 *BENAR!* +${baseScore} poin\n\n` +
        `🎵 Jawaban: *${game.answer}*\n` +
        `⏱ Waktu: ${elapsedSec} detik\n\n` +
        `Skor kamu: *${tebakSkor[jid][sender]}*\n\n` +
        `Ketik \`${CONFIG.PREFIX}tebak\` untuk lanjut!`,
    });
  } else if (game.attempts >= 3) {
    delete tebakNow[jid];
    await sock.sendMessage(jid, {
      text:
        `😅 Kesempatan habis!\n\n` +
        `🎵 Jawaban: *${game.answer}*\n\n` +
        `Ketik \`${CONFIG.PREFIX}tebak\` untuk coba lagi!`,
    });
  } else {
    const sisa = 3 - game.attempts;
    await sock.sendMessage(jid, {
      text: `❌ Salah! Sisa ${sisa} kesempatan.\n💡 Petunjuk: ${game.hint}`,
    });
  }
}

// ─── GAME: Hangman ────────────────────────────────────────────
const HANGMAN_POOL = [
  "gitar","drum","piano","melodi","lirik","konser","album","single",
  "vokal","bassist","gitaris","drummer","nada","kunci","tempo","ritme",
  "beatbox","rapper","penyanyi","musisi",
];
const HM_STATES = ["😵","😰","😨","😟","😐","🙂","😁"];

async function cmdHangman(sock, jid) {
  if (hangman[jid]) {
    const g = hangman[jid];
    const disp = g.word.split("").map(c=> g.guessed.includes(c)?c:"_").join(" ");
    return sock.sendMessage(jid, {
      text:
        `🎮 Game hangman masih berjalan!\n\n` +
        `${HM_STATES[HM_STATES.length-1-g.wrong]} Salah: ${g.wrong}/${g.maxWrong}\n` +
        `Kata: \`${disp}\`\n` +
        `Huruf ditebak: ${g.guessed.join(", ")||"-"}\n\n` +
        `Kirim 1 huruf untuk menebak. \`${CONFIG.PREFIX}hhint\` untuk petunjuk.`,
    });
  }
  const word = HANGMAN_POOL[Math.floor(Math.random()*HANGMAN_POOL.length)];
  hangman[jid] = { word, guessed:[], wrong:0, maxWrong:6 };
  const disp = word.split("").map(()=>"_").join(" ");
  await sock.sendMessage(jid, {
    text:
      `🎮 *HANGMAN MUSIK!*\n${"─".repeat(30)}\n\n` +
      `😁 Salah: 0/6\n` +
      `Kata: \`${disp}\`\n` +
      `Panjang: ${word.length} huruf\n\n` +
      `Kirim 1 huruf untuk menebak!\n` +
      `\`${CONFIG.PREFIX}hhint\` = petunjuk | \`${CONFIG.PREFIX}hstop\` = berhenti`,
  });
}

async function cmdHangmanGuess(sock, jid, sender, letter) {
  const g = hangman[jid];
  if (!g) return;

  const l = letter.toLowerCase();
  if (!/^[a-z]$/.test(l)) return sock.sendMessage(jid, { text:"⚠️ Kirim 1 huruf saja (a-z)." });
  if (g.guessed.includes(l)) return sock.sendMessage(jid, { text:`⚠️ Huruf *${l.toUpperCase()}* sudah ditebak.` });

  g.guessed.push(l);
  const correct = g.word.includes(l);
  if (!correct) g.wrong++;

  const disp  = g.word.split("").map(c=>g.guessed.includes(c)?c:"_").join(" ");
  const state = HM_STATES[Math.max(0, HM_STATES.length-1-g.wrong)];
  const done  = !disp.includes("_");
  const dead  = g.wrong >= g.maxWrong;

  if (done) {
    if (!tebakSkor[jid]) tebakSkor[jid]={};
    tebakSkor[jid][sender] = (tebakSkor[jid][sender]||0) + 50;
    delete hangman[jid];
    return sock.sendMessage(jid, {
      text:`🎉 *BENAR SEMUA!* +50 poin\n\n🎵 Kata: *${g.word.toUpperCase()}*\n\nKetik \`${CONFIG.PREFIX}hangman\` lagi!`,
    });
  }
  if (dead) {
    delete hangman[jid];
    return sock.sendMessage(jid, {
      text:`💀 *GAME OVER!*\n\n🎵 Kata yang benar: *${g.word.toUpperCase()}*\n\nKetik \`${CONFIG.PREFIX}hangman\` untuk coba lagi!`,
    });
  }

  await sock.sendMessage(jid, {
    text:
      `${correct?"✅ Benar!":"❌ Salah!"}\n\n` +
      `${state} Salah: ${g.wrong}/${g.maxWrong}\n` +
      `Kata: \`${disp}\`\n` +
      `Huruf: ${g.guessed.join(", ")}`,
  });
}

async function cmdHangmanHint(sock, jid) {
  const g = hangman[jid];
  if (!g) return sock.sendMessage(jid, { text:`❌ Tidak ada game hangman aktif. \`${CONFIG.PREFIX}hangman\` untuk mulai.` });
  const unguessed = g.word.split("").filter(c=>!g.guessed.includes(c));
  if (!unguessed.length) return;
  const hint = unguessed[Math.floor(Math.random()*unguessed.length)];
  g.guessed.push(hint);
  g.wrong++;
  const disp = g.word.split("").map(c=>g.guessed.includes(c)?c:"_").join(" ");
  await sock.sendMessage(jid, {
    text:`💡 Petunjuk: huruf *${hint.toUpperCase()}*\n(-1 nyawa)\n\nKata: \`${disp}\``,
  });
}

// ─── GAME: Tic-Tac-Toe ────────────────────────────────────────
function renderBoard(b) {
  const sym = x => x===0?"⬜":x===1?"❌":"⭕";
  return (
    `${sym(b[0])}${sym(b[1])}${sym(b[2])}\n` +
    `${sym(b[3])}${sym(b[4])}${sym(b[5])}\n` +
    `${sym(b[6])}${sym(b[7])}${sym(b[8])}`
  );
}
function checkWinner(b, p) {
  const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  return wins.some(w=>w.every(i=>b[i]===p));
}
function aiMove(b) {
  // Minimax sederhana: coba menang, block lawan, random
  for(let p of [2,1]) {
    for(let i=0;i<9;i++) {
      if(b[i]===0){b[i]=p;if(checkWinner(b,p)){b[i]=0;return i;}b[i]=0;}
    }
  }
  const free=b.map((v,i)=>v===0?i:-1).filter(i=>i>=0);
  if(b[4]===0) return 4;
  return free[Math.floor(Math.random()*free.length)];
}

async function cmdTicTac(sock, jid, sender) {
  duel[jid] = { board:Array(9).fill(0), player:sender, turn:1 };
  await sock.sendMessage(jid, {
    text:
      `🎮 *TIC-TAC-TOE vs BOT*\n${"─".repeat(28)}\n\n` +
      renderBoard(duel[jid].board) + "\n\n" +
      `Kamu: ❌  |  Bot: ⭕\n\n` +
      `Pilih posisi (1-9):\n` +
      `1️⃣2️⃣3️⃣\n4️⃣5️⃣6️⃣\n7️⃣8️⃣9️⃣`,
  });
}

async function cmdTicTacMove(sock, jid, sender, num) {
  const g = duel[jid];
  if (!g || g.player!==sender) return;
  const idx = num - 1;
  if (g.board[idx]!==0) return sock.sendMessage(jid, { text:"⚠️ Posisi sudah terisi! Pilih lain." });

  g.board[idx] = 1;
  if (checkWinner(g.board,1)) {
    delete duel[jid];
    if (!tebakSkor[jid]) tebakSkor[jid]={};
    tebakSkor[jid][sender]=(tebakSkor[jid][sender]||0)+30;
    return sock.sendMessage(jid, {
      text:`${renderBoard(g.board)}\n\n🎉 *Kamu MENANG!* +30 poin`,
    });
  }
  if (!g.board.includes(0)) {
    delete duel[jid];
    return sock.sendMessage(jid, { text:`${renderBoard(g.board)}\n\n🤝 *SERI!*` });
  }

  // Giliran bot
  const ai = aiMove(g.board);
  g.board[ai] = 2;
  if (checkWinner(g.board,2)) {
    delete duel[jid];
    return sock.sendMessage(jid, { text:`${renderBoard(g.board)}\n\n🤖 *Bot MENANG!* Coba lagi \`${CONFIG.PREFIX}tictac\`` });
  }
  if (!g.board.includes(0)) {
    delete duel[jid];
    return sock.sendMessage(jid, { text:`${renderBoard(g.board)}\n\n🤝 *SERI!*` });
  }

  await sock.sendMessage(jid, {
    text:`${renderBoard(g.board)}\n\nGiliran kamu! Pilih posisi (1-9):`,
  });
}

// ─── Command: Skor ────────────────────────────────────────────
async function cmdSkor(sock, jid, sender) {
  const s = tebakSkor[jid];
  if (!s || !Object.keys(s).length)
    return sock.sendMessage(jid, { text:`🏆 Belum ada skor. Main \`${CONFIG.PREFIX}tebak\`, \`${CONFIG.PREFIX}hangman\`, atau \`${CONFIG.PREFIX}tictac\`!` });

  const sorted = Object.entries(s).sort((a,b)=>b[1]-a[1]);
  let msg = `🏆 *PAPAN SKOR*\n${"─".repeat(28)}\n\n`;
  sorted.forEach(([num,pts],i)=>{
    const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":"  ";
    const tag   = num===sender?" ← kamu":"";
    msg+=`${medal} ${num.split("@")[0]} — *${pts} poin*${tag}\n`;
  });
  await sock.sendMessage(jid, { text:msg });
}

// ─── Router Utama ─────────────────────────────────────────────
async function handleMessage(sock, msg) {
  if (!msg.message) return;

  const jid    = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const body   = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption || ""
  ).trim();

  if (!body) return;

  const P = CONFIG.PREFIX;

  // ── Handler game tanpa prefix (jawaban tebak/hangman/tictac) ──
  if (tebakNow[jid] && !body.startsWith(P)) {
    return cmdTebakAnswer(sock, jid, sender, body);
  }
  if (hangman[jid] && !body.startsWith(P) && /^[a-zA-Z]$/.test(body)) {
    return cmdHangmanGuess(sock, jid, sender, body);
  }
  if (duel[jid] && !body.startsWith(P) && /^[1-9]$/.test(body)) {
    return cmdTicTacMove(sock, jid, sender, parseInt(body));
  }

  if (!body.startsWith(P)) return;

  const [rawCmd, ...args] = body.slice(P.length).trim().split(/\s+/);
  const cmd   = rawCmd.toLowerCase();
  const query = args.join(" ");

  console.log(`[CMD] ${sender} → ${P}${cmd} ${query}`);

  switch(cmd) {
    case "menu": case "help":
      await sock.sendMessage(jid, { text: MENU }); break;

    case "play": case "dl": case "download":
      if (!query) return sock.sendMessage(jid, { text:`⚠️ Format: \`${P}play <judul>\`` });
      await cmdPlay(sock, jid, query, false); break;

    case "mp4": case "video":
      if (!query) return sock.sendMessage(jid, { text:`⚠️ Format: \`${P}mp4 <judul>\`` });
      await cmdPlay(sock, jid, query, true); break;

    case "cari": case "search":
      if (!query) return sock.sendMessage(jid, { text:`⚠️ Format: \`${P}cari <judul>\`` });
      await cmdSearch(sock, jid, query); break;

    case "info":
      if (!query) return sock.sendMessage(jid, { text:`⚠️ Format: \`${P}info <judul>\`` });
      await cmdInfo(sock, jid, query); break;

    case "lirik": case "lyrics":
      if (!query) return sock.sendMessage(jid, { text:`⚠️ Format: \`${P}lirik <judul>\`` });
      await cmdLyrics(sock, jid, query); break;

    case "history": case "riwayat":
      await cmdHistory(sock, jid); break;

    case "ping":
      const t = Date.now();
      await sock.sendMessage(jid, { text:"🏓 Pong!" });
      await sock.sendMessage(jid, { text:`✅ *Bot aktif!*\n⚡ Latensi: *${Date.now()-t}ms*` }); break;

    // ── Games ──────────────────────────────────────────────────
    case "tebak":
      await cmdTebak(sock, jid); break;

    case "skip":
      if (tebakNow[jid]) {
        const ans = tebakNow[jid].answer;
        delete tebakNow[jid];
        await sock.sendMessage(jid, { text:`⏭️ Di-skip!\n🎵 Jawaban: *${ans}*` });
      } break;

    case "hangman":
      await cmdHangman(sock, jid); break;

    case "hhint":
      await cmdHangmanHint(sock, jid); break;

    case "hstop":
      if (hangman[jid]) { delete hangman[jid]; await sock.sendMessage(jid,{text:"🛑 Game hangman dihentikan."}); } break;

    case "tictac": case "ttt":
      await cmdTicTac(sock, jid, sender); break;

    case "skor": case "score":
      await cmdSkor(sock, jid, sender); break;

    default:
      await sock.sendMessage(jid, { text:`❓ Perintah *${P}${cmd}* tidak dikenal.\nKetik \`${P}menu\` untuk daftar perintah.` });
  }
}

// ─── Koneksi WhatsApp ─────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.SESSION_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger:            pino({ level:"silent" }),
    printQRInTerminal: false,
    auth:              state,
    browser:           Browsers.ubuntu("Chrome"),
    msgRetryCounterCache,
    syncFullHistory:   false,
  });

  // ── Pairing Code (hanya jika belum terdaftar) ────────────────
  if (!sock.authState.creds.registered) {
    const number = CONFIG.WA_NUMBER;
    if (!number) {
      console.error("❌ Set env WA_NUMBER=6281234567890 untuk pairing!");
      process.exit(1);
    }
    try {
      // Tunggu sebentar agar socket siap
      await new Promise(r => setTimeout(r, 3000));
      const code = await sock.requestPairingCode(number);
      const fmt8 = code.match(/.{1,4}/g).join("-");
      console.log(`\n╔══════════════════════════════╗`);
      console.log(`║  🔑  PAIRING CODE:  ${fmt8}  ║`);
      console.log(`╚══════════════════════════════╝`);
      console.log(`\n➡️  Buka WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon`);
      console.log(`    Masukkan kode: ${fmt8}\n`);
    } catch(e) {
      console.error("❌ Gagal pairing:", e.message);
    }
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("🔴 Koneksi putus. Reconnect:", reconnect);
      if (reconnect) setTimeout(startBot, 5000);
    } else if (connection === "open") {
      console.log(`🟢 ${CONFIG.BOT_NAME} terhubung! Prefix: ${CONFIG.PREFIX}`);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      await handleMessage(sock, msg).catch(e => console.error("[MSG ERR]", e.message));
    }
  });
}

console.log(`\n🎵 Starting ${CONFIG.BOT_NAME}...\n`);
startBot().catch(console.error);
