// index.js - Tahap 1: Kerangka Dasar Baileys
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function startBot() {
    // Menyimpan sesi agar tidak perlu scan/login ulang terus menerus
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }), // Menyembunyikan log yang tidak perlu
        printQRInTerminal: true, // Ganti ke false jika nanti ingin fokus pakai pairing code
        auth: state,
        browser: ['Zekais Bot', 'Safari', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    // Membaca pesan masuk
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Ekstraksi teks dari pesan
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const sender = msg.key.remoteJid;
        const pushName = msg.pushName || "Pengguna";

        // Memisahkan command dan argumen
        const command = text.trim().split(" ")[0].toLowerCase();

        // ----------------- DAFTAR PERINTAH -----------------
        switch (command) {
            case '.menu':
            case '.help':
                const menuText = `⬡ ᴢᴇᴋᴀɪꜱ ⊹ ʙ0ᴛ ⬡

> ⚠️ BOT ini *GRATIS* masuk Grupmu!
> Dilarang Keras *MENYEWAKAN* bot ini ⚠️

╭─「 👤 *ᴘʀᴏꜰɪʟ ᴜꜱᴇʀ* 」
│  🏷️  *Nama* ⟫  ${pushName}
│  🎚️  *Level* ⟫  1
│  💰  *Coin* ⟫  0
│  🎫  *Limit* ⟫  22 / 22
│  🎮  *Point* ⟫  15 / 15
╰──⊷

_Hai Ka_ @${sender.split('@')[0]} 👋
_Aku BOT Game Pokemon & Mancing_ 🐾🐟

Ketik *.ping* untuk cek status bot.
*(Sisa menu akan ditambahkan di tahap selanjutnya)*`;
                
                await sock.sendMessage(sender, { text: menuText, mentions: [sender] }, { quoted: msg });
                break;

            case '.ping':
                await sock.sendMessage(sender, { text: 'Bot Zekais aktif dan merespon dengan cepat! 🚀' }, { quoted: msg });
                break;
        }
    });
}

startBot();
               
