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
const { exec, spawn } = require('child_process');
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
        if (i.admin === "admin" || i.admin === "superadmin") admins.push(i.id);
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
        browser: ['Linux', 'Chrome', '121.0.6167.184'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    store.bind(sock.ev);

    // --- PAIRING CODE LOGIC ---
    if (!sock.authState.creds.registered) {
        console.log("Mempersiapkan permintaan kode pairing...");
        const requestPairing = async () => {
            if (sock.authState.creds.registered) return;
            try {
                await new Promise(resolve => setTimeout(resolve, 10000));
                let code = await sock.requestPairingCode(pairingNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("=================================");
                console.log("KODE PAIRING ANDA:", code);
                console.log("Update tiap 30 detik untuk keamanan");
                console.log("=================================");
            } catch (err) {
                console.log("Gagal mengambil kode pairing (Mencoba lagi...):", err.message);
            }
        };

        requestPairing();

        const pairingInterval = setInterval(async () => {
            if (sock.authState.creds.registered) {
                clearInterval(pairingInterval);
            } else {
                await requestPairing();
            }
        }, 40000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                fs.rmSync('./auth_info', { recursive: true, force: true });
                startBot();
            } else {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ BERHASIL TERHUBUNG KE WHATSAPP');
        }
    });

    sock.ev.on('group-participants.update', async (anu) => {
        try {
            let metadata = await sock.groupMetadata(anu.id);
            let participants = anu.participants;
            for (let num of participants) {
                if (anu.action == 'add') {
                    sock.sendMessage(anu.id, { text: `Selamat datang @${num.split('@')[0]} di grup *${metadata.subject}*!`, mentions: [num] });
                } else if (anu.action == 'remove') {
                    sock.sendMessage(anu.id, { text: `Selamat jalan @${num.split('@')[0]}, beban grup berkurang satu.`, mentions: [num] });
                }
            }
        } catch (err) { console.log(err); }
    });

    let searchResults = {};
    let antiDelete = {};

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message) return;

            // Anti Delete
            if (m.message.protocolMessage && m.message.protocolMessage.type === 0) {
                const key = m.message.protocolMessage.key;
                const msg = antiDelete[key.id];
                if (msg) {
                    await sock.sendMessage(key.remoteJid, { text: `*ANTI DELETE TERDETEKSI!*\n\n*Pengirim:* @${key.participant.split('@')[0]}\n*Pesan:* ${msg.body || 'Media/Lainnya'}`, mentions: [key.participant] });
                }
                return;
            }

            if (m.key.fromMe) return;

            const from = m.key.remoteJid;
            const type = Object.keys(m.message)[0];
            const sender = m.key.participant || m.key.remoteJid;
            const pushName = m.pushName || "User";

            const body = (type === 'conversation') ? m.message.conversation : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type == 'imageMessage') ? m.message.imageMessage.caption : (type == 'videoMessage') ? m.message.videoMessage.caption : '';

            antiDelete[m.key.id] = { body, sender };

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

            const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => ({})) : {};
            const participants = isGroup ? groupMetadata.participants || [] : [];
            const groupAdmins = isGroup ? getGroupAdmins(participants) : [];
            const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const isBotAdmins = groupAdmins.includes(botNumber) || false;
            const isAdmins = groupAdmins.includes(sender) || isOwner || false;

            const reply = (teks) => sock.sendMessage(from, { text: teks }, { quoted: m });

            // Anti Link
            if (isGroup && isBotAdmins && !isAdmins && (body.includes('chat.whatsapp.com/') || body.includes('wa.me/'))) {
                await sock.sendMessage(from, { delete: m.key });
                await sock.groupParticipantsUpdate(from, [sender], 'remove');
                return reply('Link terdeteksi! Kamu dikeluarkan.');
            }

            // Paging Selection
            if (!isCmd && /^\d+$/.test(body) && searchResults[from] && searchResults[from].sender === sender) {
                const choice = parseInt(body);
                const results = searchResults[from].results;

                if (choice >= 1 && choice <= 5) {
                    const selected = results[choice - 1];
                    if (!selected) return reply('Pilihan tidak valid.');
                    reply(`Mengunduh Audio: *${selected.title}*...`);
                    try {
                        const audioPath = await downloadAudio(selected.url);
                        await sock.sendMessage(from, { audio: { url: audioPath }, mimetype: 'audio/mp4', fileName: `${selected.title}.mp3` }, { quoted: m });
                        fs.unlinkSync(audioPath);
                    } catch (e) { reply(`Gagal: ${e.message}`); }
                } else if (choice >= 6 && choice <= 10) {
                    const selected = results[choice - 6];
                    if (!selected) return reply('Pilihan tidak valid.');
                    reply(`Mengunduh Video: *${selected.title}*...`);
                    try {
                        const videoPath = await downloadVideo(selected.url);
                        await sock.sendMessage(from, { video: { url: videoPath }, caption: selected.title }, { quoted: m });
                        fs.unlinkSync(videoPath);
                    } catch (e) { reply(`Gagal: ${e.message}`); }
                }
                delete searchResults[from];
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

*GROUP MENU*
> .kick, .promote, .demote
> .hidetag, .tagall, .group open/close
> .linkgroup, .setpp, .revoke

*AI MENU*
> .ai <pertanyaan>

*MISC*
> .ping, .misi, .khodam, .me
`;
                    reply(menuTeks);
                    break;

                case 'play':
                    if (!text) return reply('Judul?');
                    const search = await yts(text);
                    const results = search.videos.slice(0, 5);
                    if (results.length === 0) return reply('Kosong.');
                    let teksP = `*HASIL PENCARIAN*\n\n`;
                    results.forEach((v, i) => { teksP += `*${i + 1}.* ${v.title} (${v.timestamp})\n`; });
                    teksP += `\n*PILIH NOMOR:*\n- 1 s/d 5 untuk *AUDIO*\n- 6 s/d 10 untuk *VIDEO*`;
                    searchResults[from] = { sender, results };
                    reply(teksP);
                    break;

                case 'ytmp3':
                case 'ytmp4':
                case 'tiktok':
                case 'igdl':
                    if (!text) return reply('Link?');
                    try {
                        reply('Proses...');
                        const mediaPath = (command === 'ytmp3') ? await downloadAudio(text) : await downloadVideo(text);
                        const mediaType = (command === 'ytmp3') ? { audio: { url: mediaPath }, mimetype: 'audio/mp4' } : { video: { url: mediaPath } };
                        await sock.sendMessage(from, mediaType, { quoted: m });
                        fs.unlinkSync(mediaPath);
                    } catch (e) { reply(`Error: ${e.message}`); }
                    break;

                case 'ai':
                    if (!text) return reply('Tanya?');
                    try {
                        const res = await axios.get(`https://api.vreden.web.id/api/gpt?query=${encodeURIComponent(text)}`);
                        reply(res.data.result);
                    } catch { reply('AI error.'); }
                    break;

                case 'ping':
                    reply('Pong! 🏓');
                    break;

                case 'me':
                    reply(`*PROFIL*\n\n> Nama: ${user.nama}\n> Koin: ${user.coin}\n> Limit: ${user.limit}`);
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

                case 'kick':
                case 'promote':
                case 'demote':
                    if (!isGroup || !isAdmins || !isBotAdmins) return;
                    let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid || (args[0] ? [args[0].replace('@', '') + '@s.whatsapp.net'] : []);
                    await sock.groupParticipantsUpdate(from, target, command);
                    break;

                case 'group':
                    if (!isGroup || !isAdmins || !isBotAdmins) return;
                    await sock.groupSettingUpdate(from, args[0] === 'open' ? 'not_announcement' : 'announcement');
                    reply(`Grup ${args[0]}.`);
                    break;

                case 'linkgroup':
                    if (!isGroup || !isBotAdmins) return;
                    reply(`https://chat.whatsapp.com/${await sock.groupInviteCode(from)}`);
                    break;

                case 'revoke':
                    if (!isGroup || !isAdmins || !isBotAdmins) return;
                    await sock.groupRevokeInvite(from);
                    reply('Link reset.');
                    break;

                case 'setpp':
                    if (!isGroup || !isAdmins || !isBotAdmins) return;
                    if (type === 'imageMessage' || m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        let media = await downloadMediaMessage(m, 'buffer', {}, { logger: pino() });
                        await sock.updateProfilePicture(from, media);
                        reply('Update PP.');
                    }
                    break;

                case 'misi':
                    const n = Date.now();
                    if (n - user.lastMisi < 86400000) return reply('Besok.');
                    user.coin += 100; user.limit = 25; user.lastMisi = n;
                    saveDB();
                    reply('Sukses!');
                    break;

                case 'khodam':
                    if (!text) return reply('Nama?');
                    const k = ['Macan Sakti', 'Kucing Oren', 'Naga Hitam', 'Cacing Tanah', 'Tikus Got', 'Singa Putih', 'Jin Qorin'];
                    reply(`Khodam *${text}*: ${k[Math.floor(Math.random() * k.length)]}`);
                    break;
            }
        } catch (err) { console.log(err); }
    });
}

startBot();
