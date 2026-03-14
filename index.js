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
    // Pastikan folder session dibersihkan jika ingin pairing ulang
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
        // Gunakan identitas browser yang paling stabil untuk pairing
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // SISTEM PAIRING CODE
    if (!sock.authState.creds.registered) {
        let phoneNumber = process.env.BOT_NUMBER;
        if (phoneNumber) {
            phoneNumber = phoneNumber.replace(/[^0-9]/g, ''); // Bersihkan nomor
            console.log(`\n⏳ Menyiapkan pairing untuk nomor: ${phoneNumber}`);
            await delay(15000); // Jeda agar server Baileys siap
            
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n======================================`);
                console.log(`✅ KODE PAIRING ANDA: ${code}`);
                console.log(`======================================\n`);
                console.log(`Silakan masukkan kode di atas pada WhatsApp Anda.`);
            } catch (err) {
                console.error("❌ Gagal mendapatkan kode pairing. Pastikan nomor benar.");
            }
        } else {
            console.log("❌ ERROR: BOT_NUMBER belum diisi di dashboard Koyeb!");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'open') {
            console.log("\n✅ SERIKA AI BERHASIL TERHUBUNG!");
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Koneksi terputus, mencoba menyambung ulang...");
                startBot();
            } else {
                console.log("🚫 Sesi keluar. Hapus folder session_serika di GitHub untuk pairing ulang.");
            }
        }
    });

    sock.ev.on('messages.upsert', async m => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

            const from = msg.key.remoteJid;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || "";
            
            // Bot hanya merespon pesan yang diawali tanda seru (!)
            if (!body.startsWith("!")) return;

            const command = body.slice(1).trim().split(/ +/)[0].toLowerCase();
            const args = body.trim().split(/ +/).slice(1);
            const pushname = msg.pushName || "User";

            // LOAD SISTEM PLUGINS
            const pluginFolder = path.resolve(__dirname, 'plugins');
            if (!fs.existsSync(pluginFolder)) fs.mkdirSync(pluginFolder);

            const pluginFiles = fs.readdirSync(pluginFolder).filter(file => file.endsWith('.js'));

            for (const file of pluginFiles) {
                try {
                    const pluginPath = path.resolve(pluginFolder, file);
                    // Menghapus cache agar setiap perubahan plugin langsung terasa
                    delete require.cache[require.resolve(pluginPath)];
                    const plugin = require(pluginPath);
                    
                    if (plugin.command.includes(command)) {
                        await sock.readMessages([msg.key]); // Auto Read
                        await plugin.operate(sock, msg, from, args, { pushname, body });
                    }
                } catch (e) {
                    console.error(`❌ Error pada plugin ${file}:`, e.message);
                }
            }
        } catch (err) {
            console.error("❌ Sistem Error:", err.message);
        }
    });
}

// Mulai Bot
startBot().catch(err => console.error("Gagal menjalankan bot:", err));
            
