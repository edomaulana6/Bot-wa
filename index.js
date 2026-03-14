const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const axios = require("axios");

// Variable global untuk menyimpan data owner secara dinamis
let OWNER_NUMBER = "";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_serika');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        browser: ["SerikaAi", "Safari", "1.0"],
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        getMessage: async (key) => { return { conversation: 'SerikaAi' } }
    });

    // Otomatis deteksi nomor kamu saat koneksi terbuka
    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'open') {
            // Mengambil nomor dari ID user yang login (pairing)
            OWNER_NUMBER = sock.user.id.split(':')[0] + "@s.whatsapp.net";
            console.log("\n✅ SERIKA AI ONLINE");
            console.log(`📌 Detected Owner: ${OWNER_NUMBER}`);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    // Pairing Logic (Tetap butuh input nomor sekali di terminal untuk pairing awal)
    if (!sock.authState.creds.registered) {
        const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        const question = (text) => new Promise((resolve) => readline.question(text, resolve));
        
        console.log("⏳ Menunggu sistem...");
        await delay(3000);
        const stelahNomor = await question('Masukkan Nomor WA Bot (contoh: 628xxx): ');
        const code = await sock.requestPairingCode(stelahNomor.trim());
        console.log(`\n✅ KODE PAIRING ANDA: \x1b[32m${code}\x1b[0m\n`);
        readline.close();
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        try {
            const msg = m.messages[0];
            if (!msg.message) return;

            const from = msg.key.remoteJid;
            const type = Object.keys(msg.message)[0];
            if (['protocolMessage', 'senderKeyDistributionMessage'].includes(type)) return;

            const isGroup = from.endsWith('@g.us');
            const sender = isGroup ? msg.key.participant : from;
            const pushname = msg.pushName || "User";

            let body = (type === 'conversation') ? msg.message.conversation : 
                       (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : 
                       (type === 'imageMessage') ? msg.message.imageMessage.caption : 
                       (type === 'videoMessage') ? msg.message.videoMessage.caption : '';
            
            if (!body) return;

            const cleanBody = body.trim();
            if (!cleanBody.startsWith('!')) return;
            
            const command = cleanBody.slice(1).trim().split(/ +/)[0].toLowerCase();
            const args = cleanBody.trim().split(/ +/).slice(1);
            const fullArgs = args.join(" ");

            // Respon jika chat dari owner (otomatis terdeteksi)
            if (msg.key.fromMe && !cleanBody.startsWith('!')) return;

            console.log(`\n📩 [EXE] !${command} | Dari: ${pushname}`);
            await sock.readMessages([msg.key]);

            switch (command) {
                case 'a':
                case 'tiktok':
                case 'ig':
                case 'ytmp3':
                case 'ytmp4':
                    if (!args[0]) return sock.sendMessage(from, { text: "Linknya mana?" });
                    await sock.sendMessage(from, { text: "⏳ Sedang memproses link..." });
                    try {
                        const res = await axios.get(`https://api.vreden.web.id/api/download/allinone?url=${args[0]}`);
                        const result = res.data.result;
                        if (command === 'ytmp3' || fullArgs.includes('mp3')) {
                            await sock.sendMessage(from, { audio: { url: result.download?.url || result.video }, mimetype: 'audio/mp4' }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { video: { url: result.download?.url || result.video }, caption: "✅ Berhasil didownload!" }, { quoted: msg });
                        }
                    } catch (e) { await sock.sendMessage(from, { text: "❌ Gagal download." }); }
                    break;

                case 'kick':
                    if (!isGroup) return;
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0] + "@s.whatsapp.net";
                    await sock.groupParticipantsUpdate(from, [target], "remove");
                    break;

                case 'hidetag':
                    if (!isGroup) return;
                    const meta = await sock.groupMetadata(from);
                    await sock.sendMessage(from, { text: fullArgs || 'Panggilan!', mentions: meta.participants.map(a => a.id) });
                    break;

                case 'leave':
                    if (sender !== OWNER_NUMBER) return; // Menggunakan OWNER_NUMBER dinamis
                    await sock.groupLeave(from);
                    break;

                case 'ping': await sock.sendMessage(from, { text: "Pong! SerikaAi Aktif 🚀" }); break;
                
                case 'owner':
                    const vcard = 'BEGIN:VCARD\n' + 'VERSION:3.0\n' + `FN:${pushname}\n` + `TEL;type=CELL;type=VOICE;waid=${OWNER_NUMBER.split('@')[0]}:+${OWNER_NUMBER.split('@')[0]}\n` + 'END:VCARD';
                    await sock.sendMessage(from, { contacts: { displayName: pushname, contacts: [{ vcard }] } });
                    break;

                case 'menu':
                    const menu = `🌙 *SERIKA AI - 25 FEATURES*\n\n` +
                        `*DOWNLOADER*\n1. !a [link]\n2. !tiktok\n3. !ig\n4. !ytmp3/4\n\n` +
                        `*GROUP*\n5. !kick\n6. !hidetag\n7. !leave\n8. !block\n9. !group\n\n` +
                        `*TOOLS*\n10. !ping\n11. !runtime\n12. !spam\n13. !sticker\n14. !quotes\n15. !ai\n16. !nulis\n17. !remin\n\n` +
                        `*INFO*\n18. !gempa\n19. !cuaca\n20. !jadwalsholat\n21. !news\n\n` +
                        `*FUN*\n22. !alay\n23. !cekmati\n24. !halu\n25. !owner`;
                    await sock.sendMessage(from, { text: menu });
                    break;
                // ... fitur lainnya tetap sama ...
            }
        } catch (e) { console.log("Error:", e.message); }
    });
}

startBot();
                    
