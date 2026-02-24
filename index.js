const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore,
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { exec } = require('child_process');
const fs = require('fs');

// --- KONFIGURASI AUDIT ---
const phoneNumber = "628xxxxxxxxxx"; // GANTI NOMOR DISINI
const blockedGroups = [
    "120363000000000000@g.us", // Contoh ID Grup
];

// Pastikan folder download ada
if (!fs.existsSync('./downloads')) fs.mkdirSync('./downloads');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const conn = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.0"]
    });

    // --- PAIRING CODE (ANTI-SPAM DELAY) ---
    if (!conn.authState.creds.registered) {
        console.log("Menyiapkan Pairing Code... Tunggu 10 detik agar aman.");
        await delay(10000); 
        try {
            let code = await conn.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`✅ KODE PAIRING: [ ${code} ]`);
        } catch (error) {
            console.error("Gagal Pairing. Coba lagi nanti.");
        }
    }

    conn.ev.on('creds.update', saveCreds);

    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');

            // 1. CEK BLACKLIST GRUP (Koreksi: Case Sensitive)
            if (isGroup && blockedGroups.includes(from)) return;

            const body = m.message.conversation || m.message.extendedTextMessage?.text || "";
            const participant = m.key.participant || m.key.remoteJid;
            const pushName = m.pushName || "User";

            // Metadata Admin (Koreksi: Tambahkan proteksi jika metadata gagal dimuat)
            let groupMetadata = isGroup ? await conn.groupMetadata(from).catch(() => null) : null;
            if (isGroup && !groupMetadata) return; 

            let participants = isGroup ? groupMetadata.participants : [];
            let botNumber = conn.user.id.split(':')[0] + '@s.whatsapp.net';
            let isBotAdmin = isGroup ? participants.find(u => u.id === botNumber)?.admin : false;
            let isAdmin = isGroup ? participants.find(u => u.id === participant)?.admin : false;

            // --- FITUR SECURITY (ANTI-LINK) ---
            if (isGroup && isBotAdmin && !isAdmin && (body.includes('http') || body.includes('chat.whatsapp.com'))) {
                await delay(500); // Jeda singkat agar server tidak overload
                await conn.sendMessage(from, { delete: m.key });
                await conn.groupParticipantsUpdate(from, [participant], 'remove');
                return;
            }

            // --- DOWNLOADER HANDLER (REPLY 1/2) ---
            conn.userState = conn.userState || {};
            if (conn.userState[participant] && (body === '1' || body === '2')) {
                const state = conn.userState[participant];
                const timestamp = Date.now();
                
                if (body === '1') {
                    const audioFile = `./downloads/audio_${timestamp}.mp3`;
                    await conn.sendMessage(from, { text: `⏳ Memproses Audio...` });
                    exec(`yt-dlp -f bestaudio --extract-audio --audio-format mp3 "${state.url}" -o "${audioFile}"`, async (err) => {
                        if (!err && fs.existsSync(audioFile)) {
                            await conn.sendMessage(from, { audio: { url: audioFile }, mimetype: 'audio/mp4' });
                            fs.unlinkSync(audioFile);
                        }
                    });
                } else {
                    const videoFile = `./downloads/video_${timestamp}.mp4`;
                    await conn.sendMessage(from, { text: `⏳ Memproses Video...` });
                    exec(`yt-dlp -f "best[height<=480]" "${state.url}" -o "${videoFile}"`, async (err) => {
                        if (!err && fs.existsSync(videoFile)) {
                            await conn.sendMessage(from, { video: { url: videoFile }, caption: state.title });
                            fs.unlinkSync(videoFile);
                        }
                    });
                }
                delete conn.userState[participant]; // Clear memory
                return;
            }

            // --- COMMANDS ---
            if (body.startsWith('.menu')) {
                const menu = `*╭── 「 ${pushName.toUpperCase()} 」 ──*
│
*➔ GRUP*
│ .tagall | .hidetag
│ .kick | .add | .id
│ .promote | .demote
│ .group [open/close]
│
*➔ DOWNLOAD*
│ .video [judul]
│ .play [judul]
│
*➔ SYSTEM*
│ .ping | .runtime
│
*➔ SECURITY*
│ Anti-Link: Active
│ Blacklist: ${isGroup && blockedGroups.includes(from) ? 'Ya' : 'Tidak'}
*╰────────────────────*`;
                await conn.sendMessage(from, { text: menu });
            }

            if (body.startsWith('.video')) {
                const query = body.replace('.video', '').trim();
                if (!query) return;
                await conn.sendMessage(from, { text: "🔍 Mencari metadata..." });
                
                exec(`yt-dlp --dump-json --flat-playlist "ytsearch1:${query}"`, async (err, stdout) => {
                    try {
                        const info = JSON.parse(stdout);
                        conn.userState[participant] = { url: info.webpage_url, title: info.title };
                        await conn.sendMessage(from, { 
                            image: { url: info.thumbnail }, 
                            caption: `*Judul:* ${info.title}\n\nKetik *1* (MP3) atau *2* (MP4)`
                        });
                    } catch (e) {
                        conn.sendMessage(from, { text: "❌ Metadata gagal dimuat." });
                    }
                });
            }

            if (body === '.id') {
                await conn.sendMessage(from, { text: `ID Chat: ${from}` });
            }

        } catch (e) {
            console.error("Audit Error:", e);
        }
    });

    conn.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        } else if (connection === 'open') {
            console.log("✅ Audit Sukses: Bot Online");
        }
    });
}

startBot();
        
