global.crypto = require('crypto'); 

// --- CONFIG ---
const BOT_NUMBER = "6283894587604"; 
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
    // Menghapus folder lama agar sesi benar-benar segar
    const sessionPath = './session_serika';
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        // Update identitas browser terbaru agar notifikasi muncul
        browser: ["Mac OS", "Chrome", "121.0.6167.184"]
        
    });

    // SISTEM PAIRING
    if (!sock.authState.creds.registered) {
        let phoneNumber = BOT_NUMBER.replace(/[^0-9]/g, '');
        
        console.log(`\n[!] Menunggu koneksi server untuk nomor: ${phoneNumber}...`);
        
        // Jeda 6 detik sangat krusial agar server siap menerima request pairing
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n======================================`);
                console.log(`✅ KODE PAIRING ANDA: ${code}`);
                console.log(`======================================\n`);
                console.log(`Jika notifikasi tidak muncul otomatis:`);
                console.log(`1. Buka WA > Perangkat Tertaut`);
                console.log(`2. Klik Tautkan Perangkat`);
                console.log(`3. Pilih 'Tautkan dengan nomor telepon saja' di bagian bawah.`);
                console.log(`4. Masukkan kode: ${code}`);
            } catch (err) {
                console.error("❌ Gagal mendapatkan kode. Pastikan koneksi internet stabil.");
            }
        }, 6000); 
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'open') {
            console.log("\n✅ BERHASIL TERHUBUNG!");
            sock.sendMessage(OWNER, { text: "Serika AI sudah aktif, Do! 🎉" });
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
            
