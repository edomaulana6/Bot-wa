global.crypto = require('crypto'); 

// --- CONFIG ---
const BOT_NUMBER = "6283894587604"; // Masukkan nomor WA kamu di sini (Tanpa + atau spasi)
const OWNER = BOT_NUMBER + "@s.whatsapp.net";

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

async function startBot() {
    // 1. Hapus folder session_serika di Github dulu agar ini jalan!
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
        // Identitas agar notifikasi pairing muncul otomatis
        browser: ["Mac OS", "Chrome", "121.0.6167.184"]

    });

    // 2. SISTEM AUTO-PAIRING KE NOMOR CONFIG
    if (!sock.authState.creds.registered) {
        let phoneNumber = BOT_NUMBER.replace(/[^0-9]/g, '');
        
        console.log(`⏳ Memancing notifikasi pairing ke: ${phoneNumber}...`);
        await delay(10000); // Tunggu server siap
        
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`\n======================================`);
            console.log(`✅ KODE PAIRING KAMU: ${code}`);
            console.log(`======================================\n`);
            console.log(`Cek notifikasi di HP kamu, Do!`);
        } catch (err) {
            console.error("❌ Gagal mengirim pairing. Coba hapus folder session_serika dan push lagi.");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'open') {
            console.log("\n✅ SERIKA AI ONLINE!");
            sock.sendMessage(OWNER, { text: "Bot berhasil terhubung! 🎉" });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async m => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

            const from = msg.key.remoteJid;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            
            if (!body.startsWith("!")) return;

            const command = body.slice(1).trim().split(/ +/)[0].toLowerCase();
            const args = body.trim().split(/ +/).slice(1);

            // LOAD SISTEM PLUGINS
            const pluginFolder = path.resolve(__dirname, 'plugins');
            if (fs.existsSync(pluginFolder)) {
                const pluginFiles = fs.readdirSync(pluginFolder).filter(file => file.endsWith('.js'));
                for (const file of pluginFiles) {
                    const plugin = require(path.resolve(pluginFolder, file));
                    if (plugin.command && plugin.command.includes(command)) {
                        await plugin.operate(sock, msg, from, args, { body });
                    }
                }
            }
        } catch (err) {
            console.error("Error:", err.message);
        }
    });
}

startBot().catch(err => console.error(err));
                
