const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    delay 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs');
const axios = require('axios');
const http = require('http');

// --- SERVER UNTUK KOYEB (KEEP ALIVE) ---
// Koyeb mengharuskan aplikasi listen ke port tertentu agar tidak dianggap mati/crash
http.createServer((req, res) => {
  res.write('Bot Zekais is Online!');
  res.end();
}).listen(process.env.PORT || 8080);

// --- DATABASE SYSTEM ---
if (!fs.existsSync('./database.json')) fs.writeFileSync('./database.json', '{}');
let db = JSON.parse(fs.readFileSync('./database.json'));
function saveDB() { fs.writeFileSync('./database.json', JSON.stringify(db, null, 2)); }

async function startZekaisBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Wajib false untuk pairing code
        auth: state,
        browser: ['Chrome (Linux)', 'Chrome', ''] // Wajib untuk pairing code
    });

    // --- LOGIKA PAIRING CODE UNTUK CLOUD (KOYEB) ---
    if (!sock.authState.creds.registered) {
        // GANTI NOMOR DI BAWAH INI DENGAN NOMOR WHATSAPP KAMU (Gunakan format 62xxx)
        const phoneNumber = "6283894587604"; 
        
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("========================================");
                console.log(`KODE PAIRING KAMU: ${code}`);
                console.log("========================================");
            } catch (error) {
                console.error("Gagal mendapatkan pairing code:", error);
            }
        }, 3000); // Jeda 3 detik agar koneksi stabil dulu
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startZekaisBot();
        } else if (connection === 'open') {
            console.log('✅ Berhasil terhubung ke WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const from = m.key.remoteJid;
        const type = Object.keys(m.message)[0];
        const pushName = m.pushName || "User";
        const body = (type === 'conversation') ? m.message.conversation : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type === 'imageMessage') ? m.message.imageMessage.caption : (type === 'videoMessage') ? m.message.videoMessage.caption : '';
        const prefix = '.';
        const isCmd = body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : null;
        const args = body.trim().split(/ +/).slice(1);
        const isGroup = from.endsWith('@g.us');

        // --- OWNER SETTING ---
        const ownerNumber = "6283894587604@s.whatsapp.net"; // GANTI DENGAN NOMOR WA KAMU
        const isOwner = ownerNumber === from || m.key.participant === ownerNumber;

        // --- DATABASE INIT ---
        if (!db[from]) {
            db[from] = { nama: pushName, level: 1, coin: 0, limit: 22, point: 15, lastMisi: 0, banned: false, isVip: false };
            saveDB();
        }
        let user = db[from];
        if (user.banned && !isOwner) return;

        // --- GROUP LOGIC ---
        let groupMetadata = isGroup ? await sock.groupMetadata(from) : null;
        let participants = isGroup ? groupMetadata.participants : [];
        let admins = isGroup ? participants.filter(p => p.admin !== null).map(p => p.id) : [];
        let isAdmin = admins.includes(m.key.participant) || isOwner;
        let isBotAdmin = admins.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net');

        // --- ANTI LINK ---
        if (isGroup && body.includes('chat.whatsapp.com/') && !isAdmin && isBotAdmin) {
            await sock.sendMessage(from, { delete: m.key });
            await sock.groupParticipantsUpdate(from, [m.key.participant], "remove");
            return;
        }

        if (!isCmd) return;

        // --- COMMANDS ---
        switch (command) {
            case 'menu':
            case 'help':
                const menu = `*⬡ ᴢᴇᴋᴀɪꜱ ⊹ ʙ0ᴛ ⬡*

*👤 PROFIL USER*
ID: @${from.split('@')[0]}
Nama: ${user.nama}
Level: ${user.level}
Coin: ${user.coin}
Limit: ${user.limit}/22
Point: ${user.point}/15

*📥 DOWNLOADER*
.tiktok <link>
.yt <link>

*🎮 GAME*
.misi (Claim Harian)
.mancing

*🛠️ TOOLS*
.tr <lang> <teks>
.cuaca <kota>

*👥 GROUP*
.hidetag <teks>
.kick @tag
.closegrup
.opengrup

*💎 VVIP & OWNER*
.rvo (Balas pesan skali lihat)
.addlimit @tag <jumlah>
.ban @tag`;
                await sock.sendMessage(from, { text: menu, mentions: [from] }, { quoted: m });
                break;

            case 'ping':
                await sock.sendMessage(from, { text: 'Pong!' }, { quoted: m });
                break;

            case 'misi':
                const now = Date.now();
                if (now - user.lastMisi < 86400000) {
                    return sock.sendMessage(from, { text: '⏳ Misi sudah diambil hari ini.' }, { quoted: m });
                }
                user.coin += 500;
                user.limit = 22;
                user.lastMisi = now;
                saveDB();
                await sock.sendMessage(from, { text: '🎉 Misi sukses! +500 Coin & Reset Limit.' }, { quoted: m });
                break;

            case 'mancing':
                if (user.limit <= 0) return sock.sendMessage(from, { text: '❌ Limit habis.' });
                user.limit -= 1;
                const ikan = ['🐟 Nila', '🐡 Buntal', '🦈 Hiu', '🥾 Sepatu'];
                const dapat = ikan[Math.floor(Math.random() * ikan.length)];
                user.coin += 50;
                saveDB();
                await sock.sendMessage(from, { text: `🎣 Dapat: *${dapat}*!\nSisa Limit: ${user.limit}` }, { quoted: m });
                break;

            case 'tiktok':
            case 'tt':
                if (!args[0]) return;
                await sock.sendMessage(from, { text: '⏳ Processing...' });
                try {
                    const res = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${args[0]}`);
                    await sock.sendMessage(from, { video: { url: res.data.video.noWatermark }, caption: 'Done!' }, { quoted: m });
                } catch { await sock.sendMessage(from, { text: '❌ Error: Link tidak valid atau server down.' }); }
                break;

            case 'hidetag':
            case 'h':
                if (!isAdmin) return;
                sock.sendMessage(from, { text: args.join(" "), mentions: participants.map(a => a.id) });
                break;
            
            case 'rvo':
                if (!user.isVip) return;
                const q = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const viewOnce = q?.viewOnceMessageV2 || q?.viewOnceMessage;
                if (viewOnce) {
                    await sock.sendMessage(from, { forward: viewOnce.message }, { quoted: m });
                }
                break;
        }
    });
}

startZekaisBot();
        
