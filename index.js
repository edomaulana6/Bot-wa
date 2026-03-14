global.crypto = require('crypto'); // Tambahkan baris ini!

const { 
    default: makeWASocket, 
    // ... sisa kode lainnya tetap sama

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
        browser: ["SerikaAi", "Ubuntu", "20.04"]
    });

    // Pairing via Environment Variable (Koyeb)
    if (!sock.authState.creds.registered) {
        const pairingNumber = process.env.BOT_NUMBER;
        if (pairingNumber) {
            console.log("⏳ Menyiapkan pairing...");
            await delay(10000);
            const code = await sock.requestPairingCode(pairingNumber.replace(/[^0-9]/g, ''));
            console.log(`\n✅ KODE PAIRING: ${code}\n`);
        }
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect } = u;
        if (connection === 'open') console.log("✅ SERIKA AI PLUGIN SYSTEM ONLINE");
        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('messages.upsert', async m => {
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
                const plugin = require(path.join(pluginFolder, file));
                if (plugin.command.includes(command)) {
                    await sock.readMessages([msg.key]);
                    await plugin.operate(sock, msg, from, args, { pushname, body });
                }
            } catch (e) {
                console.error(`Error di plugin ${file}:`, e.message);
            }
        }
    });
}

startBot();
