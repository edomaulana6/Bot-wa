const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore, 
    DisconnectReason,
    Browsers,
    generateWAMessageFromContent,
    proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const yts = require('yt-search');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const phoneNumber = "6283894587604"; // Nomor Anda

    const conn = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS("Desktop")
    });

    // --- Logika Pairing Code ---
    if (!conn.authState.creds.registered) {
        let success = false;
        while (!success) {
            try {
                console.log("Menyiapkan Pairing Code...");
                await delay(5000); 
                let code = await conn.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n>>> KODE PAIRING ANDA: ${code} <<<`);
                success = true;
            } catch (err) {
                console.error(`Gagal meminta kode: ${err.message}`);
                await delay(30000);
            }
        }
    }

    conn.ev.on('creds.update', saveCreds);

    // --- Message Handler (Fitur Utama) ---
    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const type = Object.keys(m.message)[0];
            const body = (type === 'conversation') ? m.message.conversation : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type === 'imageMessage') ? m.message.imageMessage.caption : (type === 'videoMessage') ? m.message.videoMessage.caption : '';
            
            const prefix = '.';
            const isCmd = body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(/\s+/).shift().toLowerCase() : null;
            const args = body.trim().split(/\s+/).slice(1);
            const text = args.join(" ");
            const isGroup = from.endsWith('@g.us');

            if (!isCmd) return;

            switch (command) {
                // --- 1. Fitur Downloader (Request Anda) ---
                case 'v': {
                    if (!text) return conn.sendMessage(from, { text: "Contoh: .v Die With A Smile" });
                    conn.sendMessage(from, { text: "🔍 Mencari file... Mohon tunggu sebentar." });
                    
                    const search = await yts(text);
                    const vid = search.videos[0];
                    if (!vid) return conn.sendMessage(from, { text: "Video tidak ditemukan." });

                    let caption = `*YOUTUBE DOWNLOADER*\n\n` +
                                 `📝 Judul: ${vid.title}\n` +
                                 `⏱️ Durasi: ${vid.timestamp}\n` +
                                 `👁️ Views: ${vid.views}\n\n` +
                                 `Ketik *.getaud* untuk MP3 atau *.getvid* untuk MP4 (Disertai link di bawah).`;
                    
                    await conn.sendMessage(from, { 
                        image: { url: vid.thumbnail }, 
                        caption: caption + `\n\nLink: ${vid.url}` 
                    });
                }
                break;

                case 'getaud': {
                    if (!text) return;
                    conn.sendMessage(from, { audio: { url: text }, mimetype: 'audio/mp4' });
                }
                break;

                case 'getvid': {
                    if (!text) return;
                    conn.sendMessage(from, { video: { url: text }, caption: "Berhasil diunduh!" });
                }
                break;

                // --- 2. Fitur Grup & Administrasi (25 Fitur) ---
                case 'kick':
                    if (!isGroup) return;
                    await conn.groupParticipantsUpdate(from, [m.message.extendedTextMessage.contextInfo.participant], "remove");
                    break;

                case 'add':
                    if (!isGroup) return;
                    await conn.groupParticipantsUpdate(from, [text + "@s.whatsapp.net"], "add");
                    break;

                case 'promote':
                    await conn.groupParticipantsUpdate(from, [m.message.extendedTextMessage.contextInfo.participant], "promote");
                    break;

                case 'tagall': {
                    if (!isGroup) return;
                    const meta = await conn.groupMetadata(from);
                    let teks = `*TAG ALL MEMBERS*\n\n`;
                    for (let x of meta.participants) teks += ` @${x.id.split('@')[0]}\n`;
                    conn.sendMessage(from, { text: teks, mentions: meta.participants.map(a => a.id) });
                }
                break;

                case 'hidetag': {
                    if (!isGroup) return;
                    const meta = await conn.groupMetadata(from);
                    conn.sendMessage(from, { text: text, mentions: meta.participants.map(a => a.id) });
                }
                break;

                case 'ping':
                    conn.sendMessage(from, { text: 'Bot Aktif! Respon: Cepat' });
                    break;

                case 'infogc': {
                    if (!isGroup) return;
                    const gMeta = await conn.groupMetadata(from);
                    conn.sendMessage(from, { text: `Grup: ${gMeta.subject}\nMember: ${gMeta.participants.length}` });
                }
                break;

                case 'menu':
                    const listMenu = `*BOT MENU LIST*\n\n` +
                        `*Download:* .v (Judul/Link)\n` +
                        `*Grup:* .kick, .add, .promote, .demote, .tagall, .hidetag, .linkgc, .infogc, .setname, .setdesc\n` +
                        `*Utilitas:* .ping, .runtime, .owner, .me, .delete, .getpp, .block\n\n` +
                        `*Chief Financial Analyst Precision Model*`;
                    conn.sendMessage(from, { text: listMenu });
                    break;

                // Tambahkan case fitur lainnya di sini mengikuti pola yang sama...
            }
        } catch (err) {
            console.error("Error Handler:", err);
        }
    });

    // --- Koneksi Status ---
    conn.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') console.log("\n✅ BOT TERHUBUNG KE WHATSAPP!");
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });
}

startBot();
            
