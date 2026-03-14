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
    // Membaca sesi dari folder session_serika
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
        // Ini kunci agar notifikasi pairing muncul di HP (Menyamar sebagai Chrome)
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // SISTEM AUTO-DETEKSI NOMOR (MEMANCING NOTIFIKASI WA)
    if (!sock.authState.creds.registered) {
        // GANTI DENGAN NOMOR WA KAMU DI SINI
        let phoneNumber = "62‎83894587604‎"; 

        if (phoneNumber) {
            phoneNumber = phoneNumber.replace(/[^0-9]/g, ''); // Membersihkan karakter non-angka
            
            console.log(`⏳ Menghubungkan ke WA: ${phoneNumber}...`);
            await delay(10000); // Jeda 10 detik agar server siap mengirim notif
            
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n======================================`);
                console.log(`✅ KODE PAIRING KAMU: ${code}`);
                console.log(`======================================\n`);
                console.log(`Cek notifikasi di HP kamu sekarang, Do!`);
            } catch (err) {
                console.error("❌ Gagal mengirim pairing. Pastikan nomor benar atau tunggu sebentar.");
            }
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'open') {
            console.log("\n✅ SERIKA AI ONLINE! Sudah terhubung dengan WA kamu.");
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Koneksi putus, mencoba menyambung ulang...");
                startBot();
            } else {
                console.log("🚫 Sesi keluar. Hapus folder session_serika untuk pairing ulang.");
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

            // LOAD SISTEM PLUGINS
            const pluginFolder = path.resolve(__dirname, 'plugins');
            if (!fs.existsSync(pluginFolder)) fs.mkdirSync(pluginFolder);

            const pluginFiles = fs.readdirSync(pluginFolder).filter(file => file.endsWith('.js'));

            for (const file of pluginFiles) {
                try {
                    const pluginPath = path.resolve(pluginFolder, file);
                    delete require.cache[require.resolve(pluginPath)];
                    const plugin = require(pluginPath);
                    
                    if (plugin.command.includes(command)) {
                        await sock.readMessages([msg.key]);
                        await plugin.operate(sock, msg, from, args, { pushname, body });
                    }
                } catch (e) {
                    console.error(`❌ Error plugin ${file}:`, e.message);
                }
            }
        } catch (err) {
            console.error("❌ Sistem Error:", err.message);
        }
    });
}

startBot().catch(err => console.error("Gagal menjalankan bot:", err));
            
