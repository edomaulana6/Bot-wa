const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    proto,
    downloadMediaMessage
} = require("@whiskeysockets/baileys");

const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const axios = require('axios');
const http = require('http');
const path = require('path');
const { exec } = require('child_process');
const yts = require('yt-search');
const { downloadAudio, downloadVideo } = require('./lib/ytdlp');

// --- KONFIGURASI ---
const owner = "6283894587604@s.whatsapp.net";
const pairingNumber = "6283894587604";

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

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

const getGroupAdmins = (participants) => {
    let admins = [];
    for (let i of participants) {
        i.admin === "admin" || i.admin === "superadmin" ? admins.push(i.id) : "";
    }
    return admins;
};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Linux', 'Chrome', '121.0.6167.184']
    });

    store.bind(sock.ev);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            let code = await sock.requestPairingCode(pairingNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log("=================================");
            console.log("KODE PAIRING ANDA:", code);
            console.log("=================================");
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.loggedOut) { console.log(`Device Logged Out`); }
            else { startBot(); }
        } else if (connection === 'open') {
            console.log('✅ Tersambung ke WhatsApp');
        }
    });

    let searchResults = {};

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const type = Object.keys(m.message)[0];
            const sender = m.key.participant || m.key.remoteJid;
            const pushName = m.pushName || "User";

            const body = (type === 'conversation') ? m.message.conversation : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type == 'imageMessage') ? m.message.imageMessage.caption : (type == 'videoMessage') ? m.message.videoMessage.caption : '';
            const prefix = /^[./!#?]|/i.test(body) ? body.match(/^[./!#?]|/i)[0] : '';
            const isCmd = body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : '';
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(" ");

            const isGroup = from.endsWith('@g.us');
            const isOwner = sender === owner;

            if (!db[sender]) {
                db[sender] = { nama: pushName, level: 1, coin: 100, limit: 25, lastMisi: 0, banned: false, isVip: false };
                saveDB();
            }
            const user = db[sender];
            if (user.banned && !isOwner) return;

            const groupMetadata = isGroup ? await sock.groupMetadata(from) : '';
            const participants = isGroup ? groupMetadata.participants : [];
            const groupAdmins = isGroup ? getGroupAdmins(participants) : [];
            const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const isBotAdmins = groupAdmins.includes(botNumber) || false;
            const isAdmins = groupAdmins.includes(sender) || isOwner || false;

            const reply = (teks) => sock.sendMessage(from, { text: teks }, { quoted: m });

            // --- FITUR AGRESIF ---
            if (isGroup && isBotAdmins && !isAdmins && (body.includes('chat.whatsapp.com/') || body.includes('wa.me/'))) {
                await sock.sendMessage(from, { delete: m.key });
                await sock.groupParticipantsUpdate(from, [sender], 'remove');
                return reply('Link terdeteksi! Kamu dikeluarkan.');
            }

            if (!isCmd && /^\d+$/.test(body) && searchResults[from] && searchResults[from].sender === sender) {
                const index = parseInt(body) - 1;
                const results = searchResults[from].results;
                if (index >= 0 && index < results.length) {
                    const selected = results[index];
                    reply(`Sedang mendownload: *${selected.title}*\nMohon tunggu...`);
                    try {
                        const audioPath = await downloadAudio(selected.url);
                        await sock.sendMessage(from, { audio: { url: audioPath }, mimetype: 'audio/mp4', fileName: `${selected.title}.mp3` }, { quoted: m });
                        fs.unlinkSync(audioPath);
                        delete searchResults[from];
                    } catch (e) { reply(`Gagal: ${e.message}`); }
                }
                return;
            }

            switch (command) {
                case 'menu':
                case 'help':
                    let menuTeks = `Halo *${pushName}*! 🤖

*DOWNLOADER*
> .play <judul>
> .ytmp3 <link>
> .ytmp4 <link>
> .tiktok <link>
> .igdl <link>
> .fbdl <link>

*GROUP MENU* (Admin Only)
> .kick, .promote, .demote
> .hidetag, .tagall, .group open/close
> .setname, .setdesc, .setpp
> .revoke, .linkgroup

*AI MENU*
> .ai <pertanyaan>

*OWNER MENU*
> .ban, .unban, .setppbot

*MISC*
> .ping, .misi, .khodam, .me
`;
                    reply(menuTeks);
                    break;

                // --- AI ---
                case 'ai':
                    if (!text) return reply('Mau tanya apa?');
                    try {
                        const res = await axios.get(`https://api.vreden.web.id/api/gpt?query=${encodeURIComponent(text)}`);
                        reply(res.data.result);
                    } catch {
                        reply('Maaf, AI sedang sibuk.');
                    }
                    break;

                // --- GROUP ---
                case 'kick':
                case 'promote':
                case 'demote':
                    if (!isGroup || !isAdmins || !isBotAdmins) return reply('Hanya admin!');
                    let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid || (args[0] ? [args[0].replace('@', '') + '@s.whatsapp.net'] : []);
                    if (target.length === 0) return reply('Tag orangnya!');
                    await sock.groupParticipantsUpdate(from, target, command);
                    reply(`Berhasil ${command}.`);
                    break;

                case 'hidetag':
                    if (!isGroup || !isAdmins) return;
                    sock.sendMessage(from, { text: text || '', mentions: participants.map(v => v.id) });
                    break;

                case 'tagall':
                    if (!isGroup || !isAdmins) return;
                    let tAll = `*TAG ALL*\n\n${text}\n\n` + participants.map(v => ` @${v.id.split('@')[0]}`).join('\n');
                    sock.sendMessage(from, { text: tAll, mentions: participants.map(v => v.id) });
                    break;

                case 'group':
                    if (!isGroup || !isAdmins || !isBotAdmins) return;
                    await sock.groupSettingUpdate(from, args[0] === 'open' ? 'not_announcement' : 'announcement');
                    reply(`Grup telah ${args[0] === 'open' ? 'dibuka' : 'ditutup'}.`);
                    break;

                case 'linkgroup':
                    if (!isGroup || !isBotAdmins) return;
                    const code = await sock.groupInviteCode(from);
                    reply(`https://chat.whatsapp.com/${code}`);
                    break;

                // --- DOWNLOADER ---
                case 'play':
                    if (!text) return reply('Cari apa?');
                    const search = await yts(text);
                    const results = search.videos.slice(0, 5);
                    let teksP = `*HASIL PENCARIAN*\n\n` + results.map((v, i) => `*${i + 1}.* ${v.title} (${v.timestamp})`).join('\n') + `\n\nBalas dengan nomor untuk audio.`;
                    searchResults[from] = { sender, results };
                    reply(teksP);
                    break;

                case 'ytmp3':
                case 'ytmp4':
                case 'tiktok':
                case 'igdl':
                case 'fbdl':
                    if (!text) return reply('Mana link-nya?');
                    try {
                        reply('Sedang diproses...');
                        const mediaPath = (command === 'ytmp3') ? await downloadAudio(text) : await downloadVideo(text);
                        const isAudio = command === 'ytmp3';
                        await sock.sendMessage(from, isAudio ? { audio: { url: mediaPath }, mimetype: 'audio/mp4' } : { video: { url: mediaPath } }, { quoted: m });
                        fs.unlinkSync(mediaPath);
                    } catch (e) { reply(`Error: ${e.message}`); }
                    break;

                // --- MISC ---
                case 'me':
                    reply(`*PROFIL KAMU*\n\n> Nama: ${user.nama}\n> Koin: ${user.coin}\n> Limit: ${user.limit}\n> Level: ${user.level}`);
                    break;

                case 'khodam':
                    if (!text) return reply('Namamu siapa?');
                    const k = ['Macan Sakti', 'Kucing Oren', 'Naga Hitam', 'Cacing Tanah', 'Tikus Got', 'Singa Putih', 'Jin Qorin', 'Pocong Racing', 'Kuntilanak Merah'];
                    reply(`Khodam *${text}* adalah: ${k[Math.floor(Math.random() * k.length)]}`);
                    break;

                case 'ping':
                    reply('Pong! 🏓');
                    break;

                case 'misi':
                    const n = Date.now();
                    if (n - user.lastMisi < 86400000) return reply('Besok lagi ya.');
                    user.coin += 100;
                    user.limit = 25;
                    user.lastMisi = n;
                    saveDB();
                    reply('Berhasil! +100 koin & Reset Limit.');
                    break;
            }
        } catch (err) { console.log(err); }
    });
}

startBot();
