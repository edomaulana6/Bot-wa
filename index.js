const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require('pino');
const fs = require('fs');
const axios = require('axios');
const http = require('http');

// --- KEEP ALIVE SERVER ---
http.createServer((req, res) => {
    res.write('Bot Online');
    res.end();
}).listen(process.env.PORT || 8080);

// --- DATABASE ---
if (!fs.existsSync('./database.json')) fs.writeFileSync('./database.json', '{}');
let db = JSON.parse(fs.readFileSync('./database.json'));

function saveDB() {
    fs.writeFileSync('./database.json', JSON.stringify(db, null, 2));
}

// --- START BOT ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0']
    });

    // --- PAIRING ---
    if (!sock.authState.creds.registered) {
        const phoneNumber = "6283894587604";
        const generateCode = async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-");
                console.log("=================================");
                console.log("PAIRING CODE:", code);
                console.log("=================================");
            } catch (err) {
                console.log("Pairing gagal:", err);
            }
        };
        setTimeout(generateCode, 3000);
        const interval = setInterval(async () => {
            if (sock.authState.creds.registered) {
                clearInterval(interval);
            } else {
                await generateCode();
            }
        }, 30000);
    }

    sock.ev.on('creds.update', saveCreds);

    // --- CONNECTION ---
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("Reconnect...");
                setTimeout(() => startBot(), 3000);
            }
        }
        if (connection === 'open') console.log("✅ Bot connected");
    });

    // --- MESSAGE HANDLER ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const sender = m.key.participant || from;
            const type = Object.keys(m.message)[0];
            const pushName = m.pushName || "User";

            const body =
                type === 'conversation' ? m.message.conversation :
                type === 'extendedTextMessage' ? m.message.extendedTextMessage.text :
                type === 'imageMessage' ? m.message.imageMessage.caption :
                type === 'videoMessage' ? m.message.videoMessage.caption : '';

            // --- LOGIKA TANPA TITIK ---
            const command = body.trim().split(/ +/)[0].toLowerCase();
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(" ");

            const isGroup = from.endsWith('@g.us');
            const owner = "6283894587604@s.whatsapp.net";
            const isOwner = sender === owner;

            // --- USER DB ---
            if (!db[sender]) {
                db[sender] = { nama: pushName, level: 1, coin: 0, limit: 25, lastMisi: 0, banned: false, isVip: false };
                saveDB();
            }
            const user = db[sender];
            if (user.banned && !isOwner) return;

            // --- GROUP METADATA ---
            let groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
            let participants = isGroup ? groupMetadata?.participants || [] : [];
            let admins = isGroup ? participants.filter(p => p.admin).map(p => p.id) : [];
            const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const isAdmin = admins.includes(sender) || isOwner;
            const isBotAdmin = admins.includes(botNumber);

            // --- ANTI LINK ---
            if (isGroup && body.includes('chat.whatsapp.com/') && !isAdmin && isBotAdmin && !isOwner) {
                await sock.sendMessage(from, { delete: m.key });
                await sock.groupParticipantsUpdate(from, [sender], "remove");
                return;
            }

            const reply = (teks) => sock.sendMessage(from, { text: teks }, { quoted: m });

            // --- COMMAND SWITCH ---
            switch (command) {

                case 'menu':
                case 'help':
                    reply(`Halo *${user.nama}* 🤖

*DOWNLOADER*
1. play (judul lagu)
2. tt (link tiktok)
3. ig (link instagram)
4. ytmp4 (link youtube video)
5. ytmp3 (link youtube audio)
6. git (link github repo)
7. mediafire (link download)

*TOOLS & UTILS*
8. ping (cek speed)
9. kalkulator (angka)
10. ssweb (link web)
11. cuaca (nama kota)
12. info (statistik bot)
13. me (profil kamu)
14. owner (kontak dev)
15. hidetag (teks)
16. tagall (panggil semua)

*HIBURAN & GAME*
17. mancing (cari ikan)
18. misi (claim harian)
19. khodam (nama kamu)
20. apakah (pertanyaan)
21. bisakah (pertanyaan)
22. rate (seberapa besar)
23. tebakangka (game)
24. suit (batu/gunting/kertas)
25. bot (sapaan bot)`);
                    break;

                // --- DOWNLOADER ---
                case 'play':
                    if (!text) return reply('Mau lagu apa?');
                    try {
                        const res = await axios.get(`https://api.vreden.web.id/api/ytplay?query=${text}`);
                        await sock.sendMessage(from, { audio: { url: res.data.result.download.url }, mimetype: 'audio/mp4' }, { quoted: m });
                    } catch { reply('Gagal mencari lagu.'); }
                    break;

                case 'tt':
                    if (!args[0]) return reply('Mana link TikToknya?');
                    try {
                        const res = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${args[0]}`);
                        await sock.sendMessage(from, { video: { url: res.data.video.noWatermark }, caption: 'Nih videonya' }, { quoted: m });
                    } catch { reply('Gagal download.'); }
                    break;

                case 'ig':
                    if (!args[0]) return reply('Mana link Instagram?');
                    try {
                        const res = await axios.get(`https://api.vreden.web.id/api/igdl?url=${args[0]}`);
                        await sock.sendMessage(from, { video: { url: res.data.result[0].url } }, { quoted: m });
                    } catch { reply('Error download IG.'); }
                    break;

                case 'ytmp4':
                    if (!args[0]) return reply('Link mana?');
                    try {
                        const res = await axios.get(`https://api.vreden.web.id/api/ytdl?url=${args[0]}`);
                        await sock.sendMessage(from, { video: { url: res.data.result.video[0].downloadUrl } }, { quoted: m });
                    } catch { reply('Gagal download video.'); }
                    break;

                // --- TOOLS ---
                case 'ping':
                    reply(`Pong! Respon speed: ${Date.now() - m.messageTimestamp * 1000}ms`);
                    break;

                case 'kalkulator':
                    if (!text) return reply('Contoh: kalkulator 10*5');
                    try { reply(`Hasil: ${eval(text.replace(/[^0-9+\-*/().]/g, ''))}`); } catch { reply('Rumus salah.'); }
                    break;

                case 'hidetag':
                    if (!isGroup || !isAdmin) return;
                    sock.sendMessage(from, { text: text ? text : '', mentions: participants.map(v => v.id) });
                    break;

                case 'ssweb':
                    if (!args[0]) return reply('Linknya mana?');
                    await sock.sendMessage(from, { image: { url: `https://api.vreden.web.id/api/ssweb?url=${args[0]}` } }, { quoted: m });
                    break;

                // --- GAME & HIBURAN ---
                case 'mancing':
                    if (user.limit <= 0) return reply('Limit habis!');
                    user.limit -= 1;
                    const ikan = ['Nila', 'Lele', 'Emas', 'Sandat', 'Hiu'];
                    const hasil = ikan[Math.floor(Math.random() * ikan.length)];
                    user.coin += 50;
                    saveDB();
                    reply(`Dapat: ${hasil}\nSisa limit: ${user.limit}`);
                    break;

                case 'misi':
                    const now = Date.now();
                    if (now - user.lastMisi < 86400000) return reply('Sudah claim hari ini.');
                    user.coin += 500;
                    user.limit = 25;
                    user.lastMisi = now;
                    saveDB();
                    reply('Berhasil claim +500 coin & reset limit!');
                    break;

                case 'khodam':
                    if (!text) return reply('Namamu siapa?');
                    const kd = ['Macan Putih', 'Ular Kadut', 'Tutup Panci', 'Singa Depok', 'Jin Tomang'];
                    reply(`Khodam *${text}* adalah: ${kd[Math.floor(Math.random() * kd.length)]}`);
                    break;

                case 'apakah':
                    const jaw = ['Iya', 'Tidak', 'Mungkin', 'Gak tau'];
                    reply(`Pertanyaan: ${text}\nJawaban: *${jaw[Math.floor(Math.random() * jaw.length)]}*`);
                    break;

                case 'owner':
                    reply(`Owner: wa.me/6283894587604`);
                    break;

                case 'bot':
                    reply('Halo kak! Ada yang bisa dibantu? Ketik *menu* ya.');
                    break;
            }

        } catch (err) {
            console.log("ERROR:", err);
        }
    });
}

startBot();
        
