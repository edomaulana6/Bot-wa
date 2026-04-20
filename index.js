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

// --- KONFIGURASI ---
const owner = "6283894587604@s.whatsapp.net";
const pairingNumber = "6283894587604";

// --- DATABASE ---
if (!fs.existsSync('./database.json')) fs.writeFileSync('./database.json', '{}');
let db = JSON.parse(fs.readFileSync('./database.json'));
function saveDB() { fs.writeFileSync('./database.json', JSON.stringify(db, null, 2)); }

// --- KEEP ALIVE ---
http.createServer((req, res) => { res.write('Bot Online'); res.end(); }).listen(process.env.PORT || 8080);

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
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
    });

    store.bind(sock.ev);

    // --- PAIRING CODE ---
    if (!sock.authState.creds.registered) {
        console.log(`\n[[[ PERHATIAN: MENYIAPKAN KODE PAIRING ]]]`);
        console.log(`TARGET NOMOR: ${pairingNumber}`);
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(pairingNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n=================================");
                console.log("KODE PAIRING ANDA:", code);
                console.log("NOMOR TARGET:", pairingNumber);
                console.log("=================================");
            } catch (err) { console.log("Gagal pairing:", err.message); }
        }, 15000);
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
            console.log('✅ BOT ONLINE');
        }
    });

    // --- WELCOME ---
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            let metadata = await sock.groupMetadata(anu.id);
            for (let num of anu.participants) {
                if (anu.action == 'add') {
                    sock.sendMessage(anu.id, { text: `Halo @${num.split('@')[0]}! Selamat datang di *${metadata.subject}*`, mentions: [num] });
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
                    await sock.sendMessage(key.remoteJid, { text: `*ANTI DELETE*\n@${key.participant.split('@')[0]} menghapus: ${msg.body}`, mentions: [key.participant] });
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
            const reply = (teks) => sock.sendMessage(from, { text: teks }, { quoted: m });

            if (!db[sender]) { db[sender] = { nama: pushName, coin: 100 }; saveDB(); }

            const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => ({})) : {};
            const participants = isGroup ? groupMetadata.participants || [] : [];
            const admins = isGroup ? getGroupAdmins(participants) : [];
            const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const isBotAdmins = admins.includes(botNumber);
            const isAdmins = admins.includes(sender) || isOwner;

            // Anti Link
            if (isGroup && isBotAdmins && !isAdmins && (body.includes('chat.whatsapp.com/') || body.includes('wa.me/'))) {
                await sock.sendMessage(from, { delete: m.key });
                await sock.groupParticipantsUpdate(from, [sender], 'remove');
                return;
            }

            // Selection
            if (!isCmd && /^\d+$/.test(body) && searchResults[from] && searchResults[from].sender === sender) {
                const num = parseInt(body);
                const res = searchResults[from].results;
                if (num >= 1 && num <= 5) {
                    const sel = res[num - 1];
                    if (!sel) return;
                    reply(`Mendownload: ${sel.title}`);
                    const path = await downloadAudio(sel.url);
                    await sock.sendMessage(from, { audio: { url: path }, mimetype: 'audio/mp4' }, { quoted: m });
                    fs.unlinkSync(path);
                } else if (num >= 6 && num <= 10) {
                    const sel = res[num - 6];
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
> .igdl <link>

*GROUP MENU*
> .kick, .promote, .demote
> .hidetag, .tagall, .group open/close
> .linkgroup, .revoke

*AI MENU*
> .ai <pertanyaan>

*MISC*
> .ping, .me, .misi, .khodam`);
                    break;

                case 'play':
                    if (!text) return reply('Judul?');
                    const s = await yts(text);
                    const results = s.videos.slice(0, 5);
                    let teks = `*HASIL PENCARIAN*\n\n` + results.map((v, i) => `*${i + 1}.* ${v.title}`).join('\n') + `\n\n1-5: Audio\n6-10: Video`;
                    searchResults[from] = { sender, results };
                    reply(teks);
                    break;

                case 'ytmp3':
                case 'ytmp4':
                case 'tiktok':
                case 'igdl':
                    if (!text) return reply('Link?');
                    try {
                        reply('Proses...');
                        const path = (command === 'ytmp3') ? await downloadAudio(text) : await downloadVideo(text);
                        await sock.sendMessage(from, (command === 'ytmp3') ? { audio: { url: path }, mimetype: 'audio/mp4' } : { video: { url: path } }, { quoted: m });
                        fs.unlinkSync(path);
                    } catch (e) { reply(`Gagal: ${e.message}`); }
                    break;

                case 'kick':
                case 'promote':
                case 'demote':
                    if (!isGroup || !isAdmins || !isBotAdmins) return;
                    let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid || (args[0] ? [args[0].replace('@', '') + '@s.whatsapp.net'] : []);
                    await sock.groupParticipantsUpdate(from, target, command);
                    break;

                case 'hidetag':
                    if (isGroup && isAdmins) sock.sendMessage(from, { text: text || '', mentions: participants.map(v => v.id) });
                    break;

                case 'ai':
                    if (!text) return reply('Tanya?');
                    const res = await axios.get(`https://api.vreden.web.id/api/gpt?query=${encodeURIComponent(text)}`);
                    reply(res.data.result);
                    break;

                case 'ping': reply('Pong! 🏓'); break;
            }
        } catch (err) { console.log(err); }
    });
}

startBot();
