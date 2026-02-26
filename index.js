const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const axios = require("axios");
const readline = require("readline");

// Database Sederhana Permanen
let db = { blacklist: [], antilink: false };
if (fs.existsSync("./database.json")) db = JSON.parse(fs.readFileSync("./database.json"));
const saveDB = () => fs.writeFileSync("./database.json", JSON.stringify(db, null, 2));

const question = (text) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(text, (answer) => { rl.close(); resolve(answer); }));
};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "120.0.0.0"],
        logger: pino({ level: "fatal" }),
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = await question("Masukkan Nomor WA (628xxx): ");
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(`\nKODE PAIRING ANDA: ${code}\n`);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const body = (m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || "");

            if (db.blacklist.includes(from)) return;

            // ANTI-LINK KETAT
            if (isGroup && db.antilink && body.includes('chat.whatsapp.com/')) {
                const groupMetadata = await sock.groupMetadata(from);
                const isAdmin = groupMetadata.participants.find(p => p.id === m.key.participant)?.admin;
                if (!isAdmin) {
                    await sock.groupParticipantsUpdate(from, [m.key.participant], "remove");
                    return;
                }
            }

            const prefix = '.';
            const isCmd = body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(' ')[0].toLowerCase() : '';
            const q = body.slice(prefix.length + command.length).trim();

            if (isCmd) {
                switch (command) {
                    case 'menu':
                        let menu = `*--- ALL-PLATFORM DOWNLOADER ---*\n\n` +
                                   `*📥 DOWNLOADER*\n` +
                                   `• .tiktok [url]\n• .ig [url]\n• .fb [url]\n• .twit [url]\n` +
                                   `• .ytmp4 [url]\n• .ytmp3 [url]\n\n` +
                                   `*🛡️ GROUP KETAT*\n` +
                                   `• .antilink on/off\n• .tagall / .kick @tag\n\n` +
                                   `*🚫 BLACKLIST*\n• .addbl / .delbl / .listbl`;
                        await sock.sendMessage(from, { text: menu }, { quoted: m });
                        break;

                    case 'tiktok':
                    case 'tt':
                        if (!q) return;
                        try {
                            const res = await axios.get(`https://api.vreden.web.id/api/tiktok?url=${q}`);
                            await sock.sendMessage(from, { video: { url: res.data.result.video[0] }, caption: "Sukses TikTok" }, { quoted: m });
                        } catch { await sock.sendMessage(from, { text: "Gagal TikTok." }); }
                        break;

                    case 'ig':
                        if (!q) return;
                        try {
                            const res = await axios.get(`https://api.vreden.web.id/api/igdownload?url=${q}`);
                            await sock.sendMessage(from, { video: { url: res.data.result[0].url } }, { quoted: m });
                        } catch { await sock.sendMessage(from, { text: "Gagal Instagram." }); }
                        break;

                    case 'fb':
                        if (!q) return;
                        try {
                            const res = await axios.get(`https://api.vreden.web.id/api/fbdown?url=${q}`);
                            await sock.sendMessage(from, { video: { url: res.data.result.normal } }, { quoted: m });
                        } catch { await sock.sendMessage(from, { text: "Gagal Facebook." }); }
                        break;

                    case 'twit':
                    case 'twitter':
                        if (!q) return;
                        try {
                            const res = await axios.get(`https://api.vreden.web.id/api/twitter?url=${q}`);
                            await sock.sendMessage(from, { video: { url: res.data.result.video } }, { quoted: m });
                        } catch { await sock.sendMessage(from, { text: "Gagal Twitter/X." }); }
                        break;

                    case 'ytmp4':
                        if (!q) return;
                        try {
                            const res = await axios.get(`https://api.vreden.web.id/api/ytmp4?url=${q}`);
                            await sock.sendMessage(from, { video: { url: res.data.result.download }, caption: res.data.result.title }, { quoted: m });
                        } catch { await sock.sendMessage(from, { text: "Gagal YouTube Video." }); }
                        break;

                    case 'ytmp3':
                        if (!q) return;
                        try {
                            const res = await axios.get(`https://api.vreden.web.id/api/ytmp3?url=${q}`);
                            await sock.sendMessage(from, { audio: { url: res.data.result.download }, mimetype: 'audio/mp4' }, { quoted: m });
                        } catch { await sock.sendMessage(from, { text: "Gagal YouTube Audio." }); }
                        break;

                    case 'antilink':
                        if (!isGroup) return;
                        db.antilink = q === 'on';
                        saveDB();
                        await sock.sendMessage(from, { text: `Anti-Link: ${db.antilink ? 'AKTIF' : 'MATI'}` });
                        break;

                    case 'addbl':
                        if (!db.blacklist.includes(from)) { db.blacklist.push(from); saveDB(); }
                        await sock.sendMessage(from, { text: "ID Terblokir." });
                        break;

                    case 'tagall':
                        if (!isGroup) return;
                        const meta = await sock.groupMetadata(from);
                        sock.sendMessage(from, { text: q || 'Panggilan', mentions: meta.participants.map(a => a.id) });
                        break;
                }
            }
        } catch (e) { console.error(e); }
    });

    sock.ev.on("connection.update", (u) => { if (u.connection === "close") startBot(); });
}
startBot();
