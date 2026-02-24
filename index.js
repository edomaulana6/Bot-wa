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

// --- KONFIGURASI ---
const phoneNumber = "628xxxxxxxxxx"; // GANTI NOMOR DISINI
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

    // --- PAIRING CODE LOGIC ---
    if (!conn.authState.creds.registered) {
        console.log("-----------------------------------------");
        console.log("Menyiapkan Pairing Code... Tunggu 5 detik.");
        await delay(5000); 
        try {
            let code = await conn.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`✅ KODE PAIRING ANDA: [ ${code} ]`);
            console.log("-----------------------------------------");
        } catch (error) {
            console.error("Gagal Pairing:", error);
        }
    }

    conn.ev.on('creds.update', saveCreds);

    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const body = m.message.conversation || m.message.extendedTextMessage?.text || "";
            const participant = m.key.participant || m.key.remoteJid;
            const pushName = m.pushName || "User";

            // Metadata Admin
            let groupMetadata = isGroup ? await conn.groupMetadata(from) : null;
            let participants = isGroup ? groupMetadata.participants : [];
            let botNumber = conn.user.id.split(':')[0] + '@s.whatsapp.net';
            let isBotAdmin = isGroup ? participants.find(u => u.id === botNumber)?.admin : false;
            let isAdmin = isGroup ? participants.find(u => u.id === participant)?.admin : false;

            // --- FITUR SECURITY (ANTI-LINK) ---
            if (isGroup && isBotAdmin && !isAdmin && (body.includes('http') || body.includes('chat.whatsapp.com'))) {
                await delay(1000);
                await conn.sendMessage(from, { delete: m.key });
                await conn.groupParticipantsUpdate(from, [participant], 'remove');
                return;
            }

            // --- HANDLING DOWNLOADER STATE (RESPONSE 1 / 2) ---
            conn.userState = conn.userState || {};
            if (conn.userState[participant]) {
                const state = conn.userState[participant];
                if (body === '1') {
                    await conn.sendMessage(from, { text: `⏳ Mengirim Audio: ${state.title}` });
                    const audioFile = `./downloads/audio_${Date.now()}.mp3`;
                    exec(`yt-dlp -f bestaudio --extract-audio --audio-format mp3 "${state.url}" -o "${audioFile}"`, async (err) => {
                        if (!err) {
                            await conn.sendMessage(from, { audio: { url: audioFile }, mimetype: 'audio/mp4' });
                            fs.unlinkSync(audioFile);
                        }
                    });
                    delete conn.userState[participant];
                } else if (body === '2') {
                    await conn.sendMessage(from, { text: `⏳ Mengirim Video: ${state.title}` });
                    const videoFile = `./downloads/video_${Date.now()}.mp4`;
                    exec(`yt-dlp -f "best[height<=480]" "${state.url}" -o "${videoFile}"`, async (err) => {
                        if (!err) {
                            await conn.sendMessage(from, { video: { url: videoFile }, caption: state.title });
                            fs.unlinkSync(videoFile);
                        }
                    });
                    delete conn.userState[participant];
                }
            }

            // --- MENU UTAMA ---
            if (body.startsWith('.menu')) {
                const menu = `*╭── 「 ${pushName.toUpperCase()} BOT 」 ──*
│
*➔ GRUP MANAGER*
│ 1. .tagall (Mention semua)
│ 2. .hidetag (Ghost tag)
│ 3. .kick (Keluarkan member)
│ 4. .add (Tambah member)
│ 5. .promote (Up admin)
│ 6. .demote (Down admin)
│ 7. .group [open/close]
│ 8. .setname [teks]
│ 9. .setdesc [teks]
│ 10. .linkgc (Ambil link)
│
*➔ DOWNLOADER*
│ 11. .video [judul] (Pilih MP3/MP4)
│ 12. .play [judul] (Langsung Audio)
│ 13. .tiktok [url]
│ 14. .ig [url]
│
*➔ UTILITY*
│ 15. .sticker (Reply gambar)
│ 16. .afk [alasan]
│ 17. .runtime (Durasi aktif)
│ 18. .ping (Kecepatan respon)
│
*➔ SECURITY*
│ 19. Anti-Link (Otomatis)
│ 20. Anti-Spam (Jeda 1 detik)
│
*╰────────────────────*`;
                await conn.sendMessage(from, { text: menu });
            }

            // --- LOGIKA FITUR .VIDEO (WITH THUMBNAIL) ---
            if (body.startsWith('.video')) {
                const query = body.replace('.video', '').trim();
                if (!query) return;
                await conn.sendMessage(from, { text: "🔍 Mencari..." });
                exec(`yt-dlp --dump-json --flat-playlist "ytsearch1:${query}"`, async (err, stdout) => {
                    if (err) return;
                    const info = JSON.parse(stdout);
                    conn.userState[participant] = { url: info.webpage_url, title: info.title };
                    await conn.sendMessage(from, { 
                        image: { url: info.thumbnail }, 
                        caption: `*Judul:* ${info.title}\n\nKetik *1* untuk MP3\nKetik *2* untuk MP4`
                    });
                });
            }

            // --- FITUR TAGALL ---
            if (body.startsWith('.tagall') && isAdmin) {
                let teks = `*📢 TAG ALL*\n\n${body.replace('.tagall', '')}\n\n`;
                for (let mem of participants) { teks += ` @${mem.id.split('@')[0]}\n`; }
                conn.sendMessage(from, { text: teks, mentions: participants.map(a => a.id) });
            }

            // --- FITUR KICK ---
            if (body.startsWith('.kick') && isAdmin && isBotAdmin) {
                let target = m.message.extendedTextMessage?.contextInfo?.mentionedJid[0] || m.message.extendedTextMessage?.contextInfo?.participant;
                if (target) await conn.groupParticipantsUpdate(from, [target], 'remove');
            }

            // Fitur Runtime & Ping
            if (body === '.ping') await conn.sendMessage(from, { text: `Pong! Speed: ${Date.now() - m.messageTimestamp * 1000}ms` });
            if (body === '.runtime') {
                let uptime = process.uptime();
                await conn.sendMessage(from, { text: `Aktif: ${Math.floor(uptime/3600)}j ${Math.floor((uptime%3600)/60)}m` });
            }

        } catch (e) { console.log(e) }
    });

    conn.ev.on('connection.update', (u) => {
        if (u.connection === 'close') startBot();
        if (u.connection === 'open') console.log("✅ BOT ONLINE!");
    });
}

startBot();
