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
const { spawn } = require('child_process');
const yts = require('yt-search');
const { downloadAudio, downloadVideo } = require('./lib/ytdlp');

// --- KONFIGURASI (Gunakan Env jika ada) ---
const owner = process.env.OWNER_NUMBER || "6283894587604@s.whatsapp.net";
const pairingNumber = (process.env.BOT_NUMBER || "6283894587604").replace(/[^0-9]/g, '');

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
        browser: ["Mac OS", "Chrome", "121.0.6167.184"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        fireInitQueries: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    store.bind(sock.ev);

    // --- PAIRING CODE LOGIC ---
    if (!sock.authState.creds.registered) {
        let isAskingCode = false;
        const requestPairing = async () => {
            if (isAskingCode || sock.authState.creds.registered) return;
            isAskingCode = true;
            try {
                let code = await sock.requestPairingCode(pairingNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n=================================");
                console.log("KODE PAIRING ANDA:", code);
                console.log("Masukkan kode ini di menu 'Perangkat Tertaut' WA");
                console.log("=================================\n");
            } catch (err) {
                console.log("Gagal pairing:", err.message);
            } finally {
                isAskingCode = false;
            }
        };

        setTimeout(() => {
            if (!sock.authState.creds.registered) requestPairing();
        }, 5000);

        setInterval(async () => {
            if (!sock.authState.creds.registered) await requestPairing();
        }, 120000);
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
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ BOT TERHUBUNG');
        }
    });

    // --- AUTO WELCOME & ANTI-DELETE ---
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            let metadata = await sock.groupMetadata(anu.id);
            for (let num of anu.participants) {
                if (anu.action == 'add') {
                    sock.sendMessage(anu.id, { text: `Halo @${num.split('@')[0]}! Selamat datang di grup *${metadata.subject}*!`, mentions: [num] });
                } else if (anu.action == 'remove') {
                    sock.sendMessage(anu.id, { text: `Selamat jalan @${num.split('@')[0]}, beban grup berkurang satu.`, mentions: [num] });
                }
            }
        } catch {}
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
                    await sock.sendMessage(key.remoteJid, { text: `*ANTI DELETE*\n\n@${key.participant.split('@')[0]} menghapus pesan:\n\n${msg.body || 'Media'}`, mentions: [key.participant] });
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
                db[sender] = { nama: pushName, coin: 100, limit: 25, lastMisi: 0 };
                saveDB();
            }
            const user = db[sender];

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

            // Selection Selection
            if (!isCmd && /^\d+$/.test(body) && searchResults[from] && searchResults[from].sender === sender) {
                const choice = parseInt(body);
                const results = searchResults[from].results;
                if (choice >= 1 && choice <= 5) {
                    const sel = results[choice - 1];
                    if (!sel) return;
                    reply(`Mendownload: ${sel.title}`);
                    const path = await downloadAudio(sel.url);
                    await sock.sendMessage(from, { audio: { url: path }, mimetype: 'audio/mp4' }, { quoted: m });
                    fs.unlinkSync(path);
                } else if (choice >= 6 && choice <= 10) {
                    const sel = results[choice - 6];
                    if (!sel) return;
                    reply(`Mendownload Video: ${sel.title}`);
                    const path = await downloadVideo(sel.url);
                    await sock.sendMessage(from, { video: { url: path } }, { quoted: m });
                    fs.unlinkSync(path);
                }
                delete searchResults[from];
                return;
            }

            switch (command) {
                case 'menu':
                case 'help':
                    reply(`Halo *${pushName}*! 🤖

*DOWNLOADER*
> .play <judul>
> .ytmp3 <link>
> .ytmp4 <link>
> .tiktok <link>

*GROUP MENU*
> .kick, .promote, .demote
> .hidetag, .tagall
> .group open/close
> .linkgroup, .revoke

*AI MENU*
> .ai <pertanyaan>

*MISC*
> .ping, .me, .misi, .khodam`);
                    break;

                case 'play':
                    if (!text) return reply('Judul?');
                    const search = await yts(text);
                    const results = search.videos.slice(0, 5);
                    let teksP = `*HASIL PENCARIAN*\n\n` + results.map((v, i) => `*${i + 1}.* ${v.title}`).join('\n') + `\n\n1-5: Audio\n6-10: Video`;
                    searchResults[from] = { sender, results };
                    reply(teksP);
                    break;

                case 'ytmp3':
                case 'ytmp4':
                case 'tiktok':
                    if (!text) return reply('Link?');
                    try {
                        reply('Proses...');
                        const media = (command === 'ytmp3') ? await downloadAudio(text) : await downloadVideo(text);
                        await sock.sendMessage(from, (command === 'ytmp3') ? { audio: { url: media }, mimetype: 'audio/mp4' } : { video: { url: media } }, { quoted: m });
                        fs.unlinkSync(media);
                    } catch (e) { reply(`Gagal: ${e.message}`); }
                    break;

                case 'ai':
                    if (!text) return reply('Tanya?');
                    const res = await axios.get(`https://api.vreden.web.id/api/gpt?query=${encodeURIComponent(text)}`);
                    reply(res.data.result);
                    break;

                case 'ping': reply('Pong! 🏓'); break;

                case 'hidetag':
                    if (isGroup && isAdmins) sock.sendMessage(from, { text: text || '', mentions: participants.map(v => v.id) });
                    break;

                case 'tagall':
                    if (isGroup && isAdmins) {
                        let t = `*TAG ALL*\n\n${text}\n\n` + participants.map(v => ` @${v.id.split('@')[0]}`).join('\n');
                        sock.sendMessage(from, { text: t, mentions: participants.map(v => v.id) });
                    }
                    break;

                case 'kick':
                case 'promote':
                case 'demote':
                    if (!isGroup || !isAdmins || !isBotAdmins) return;
                    let t = m.message.extendedTextMessage?.contextInfo?.mentionedJid || (args[0] ? [args[0].replace('@', '') + '@s.whatsapp.net'] : []);
                    await sock.groupParticipantsUpdate(from, t, command);
                    reply(`Berhasil ${command}.`);
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

                case 'me':
                    reply(`*PROFIL*\nNama: ${user.nama}\nKoin: ${user.coin}`);
                    break;

                case 'misi':
                    const n = Date.now();
                    if (n - user.lastMisi < 86400000) return reply('Besok.');
                    user.coin += 100; user.lastMisi = n;
                    saveDB();
                    reply('Sukses! +100 koin.');
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
