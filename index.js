global.crypto = require('crypto'); 

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
        // Browser identitas agar lebih stabil di server
        browser: ["SerikaAi", "Ubuntu", "20.04"]
    });

    // Pairing via Environment Variable (Koyeb Dashboard)
    if (!sock.authState.creds.registered) {
        const pairingNumber = process.env.BOT_NUMBER;
        if (pairingNumber) {
            console.log("⏳ Menyiapkan pairing untuk nomor: " + pairingNumber);
            await delay(10000); // Tunggu 10 detik agar koneksi stabil
            try {
                const code = await sock.requestPairingCode(pairingNumber.replace(/[^0-9]/g, ''));
                console.log(`\n\x1b[32m✅ KODE PAIRING ANDA: ${code}\x1b[0m\n`);
            } catch (err) {
                console.error("❌ Gagal meminta kode pairing:", err.message);
            }
        } else {
            console.log("❌ ERROR: Isi variabel BOT_NUMBER di Dashboard Koyeb!");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'open') {
            console.log("\n✅ SERIKA AI PLUGIN SYSTEM ONLINE");
            console.log("📌 Bot siap digunakan!");
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Koneksi terputus, mencoba menyambung ulang...");
                startBot();
            } else {
                console.log("🚫 Sesi keluar. Hapus folder session_serika dan pairing ulang.");
            }
        }
    });

    sock.ev.on('messages.upsert', async m => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

            const from = msg.key.remoteJid;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || "";
            
            if (!body.startsWith("!")) return;

            const command = body.slice(1).trim().split(/ +/)[0].toLowerCase();
            const args = body.trim().split(/ +/).slice(1);
            const pushname = msg.pushName || "User";

            // Load Plugins Secara Dinamis
            const pluginFolder = path.join(__dirname, 'plugins');
            if (!fs.existsSync(pluginFolder)) fs.mkdirSync(pluginFolder);

            const pluginFiles = fs.readdirSync(pluginFolder).filter(file => file.endsWith('.js'));

            for (const file of pluginFiles) {
                try {
                    // Gunakan path.resolve agar tidak ada masalah path di Linux/Koyeb
                    const pluginPath = path.resolve(pluginFolder, file);
                    const plugin = require(pluginPath);
                    
                    if (plugin.command.includes(command)) {
                        await sock.readMessages([msg.key]); // Mark as read
                        await plugin.operate(sock, msg, from, args, { pushname, body });
                    }
                } catch (e) {
                    console.error(`❌ Error di plugin ${file}:`, e.message);
                }
            }
        } catch (err) {
            console.error("❌ Pesan Error:", err.message);
        }
    });
}

// Jalankan bot dengan penanganan error awal
startBot().catch(err => console.error("Gagal menjalankan bot:", err));
                    
