const {
default: makeWASocket,
useMultiFileAuthState,
DisconnectReason,
fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require('pino');
const fs = require('fs');
const axios = require('axios');
const http = require('http');

// --- KEEP ALIVE SERVER ---
http.createServer((req, res) => {
res.write('Bot Online');
res.end();
}).listen(process.env.PORT || 8080);

// --- DATABASE ---
if (!fs.existsSync('./database.json')) fs.writeFileSync('./database.json', '{}');

let db = JSON.parse(fs.readFileSync('./database.json'));

function saveDB() {
fs.writeFileSync('./database.json', JSON.stringify(db, null, 2));
}

// --- START BOT ---
async function startBot() {
const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
const { version } = await fetchLatestBaileysVersion();

const sock = makeWASocket({  
    version,  
    logger: pino({ level: 'silent' }),  
    printQRInTerminal: false,  
    auth: state,  
    browser: ['Ubuntu', 'Chrome', '20.0']  
});  

// --- PAIRING (UPDATED 30 DETIK) ---
if (!sock.authState.creds.registered) {  
    const phoneNumber = "6283894587604";  

    const generateCode = async () => {  
        try {  
            let code = await sock.requestPairingCode(phoneNumber);  
            code = code?.match(/.{1,4}/g)?.join("-");  
            console.log("=================================");  
            console.log("PAIRING CODE:", code);  
            console.log("=================================");  
        } catch (err) {  
            console.log("Pairing gagal:", err);  
        }  
    };  

    // pertama kali (delay 3 detik)
    setTimeout(generateCode, 3000);  

    // ulang tiap 30 detik
    const interval = setInterval(async () => {  
        if (sock.authState.creds.registered) {  
            clearInterval(interval);  
        } else {  
            await generateCode();  
        }  
    }, 30000);  
}  

sock.ev.on('creds.update', saveCreds);  

// --- CONNECTION ---
sock.ev.on('connection.update', (update) => {  
    const { connection, lastDisconnect } = update;  

    if (connection === 'close') {  
        const shouldReconnect =  
            lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;  

        if (shouldReconnect) {  
            console.log("Reconnect...");  
            setTimeout(() => startBot(), 3000);  
        }  
    }  

    if (connection === 'open') {  
        console.log("✅ Bot connected");  
    }  
});  

// --- MESSAGE HANDLER ---
sock.ev.on('messages.upsert', async ({ messages }) => {  
    try {  
        const m = messages[0];  
        if (!m.message || m.key.fromMe) return;  

        const from = m.key.remoteJid;  
        const sender = m.key.participant || from;  

        const type = Object.keys(m.message)[0];  
        const pushName = m.pushName || "User";  

        const body =  
            type === 'conversation' ? m.message.conversation :  
            type === 'extendedTextMessage' ? m.message.extendedTextMessage.text :  
            type === 'imageMessage' ? m.message.imageMessage.caption :  
            type === 'videoMessage' ? m.message.videoMessage.caption : '';  

        const prefix = '.';  
        const isCmd = body.startsWith(prefix);  
        const command = isCmd ? body.slice(1).trim().split(/ +/)[0].toLowerCase() : '';  
        const args = body.trim().split(/ +/).slice(1);  

        const isGroup = from.endsWith('@g.us');  

        // --- OWNER ---
        const owner = "6283894587604@s.whatsapp.net";  
        const isOwner = sender === owner;  

        // --- USER DB ---
        if (!db[sender]) {  
            db[sender] = {  
                nama: pushName,  
                level: 1,  
                coin: 0,  
                limit: 22,  
                lastMisi: 0,  
                banned: false,  
                isVip: false  
            };  
            saveDB();  
        }  

        const user = db[sender];  
        if (user.banned && !isOwner) return;  

        // --- GROUP ---
        let groupMetadata = isGroup  
            ? await sock.groupMetadata(from).catch(() => null)  
            : null;  

        let participants = isGroup ? groupMetadata?.participants || [] : [];  
        let admins = isGroup  
            ? participants.filter(p => p.admin).map(p => p.id)  
            : [];  

        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';  

        const isAdmin = admins.includes(sender) || isOwner;  
        const isBotAdmin = admins.includes(botNumber);  

        // --- ANTI LINK ---
        if (  
            isGroup &&  
            body.includes('chat.whatsapp.com/') &&  
            !isAdmin &&  
            isBotAdmin &&  
            !isOwner  
        ) {  
            await sock.sendMessage(from, { delete: m.key });  
            await sock.groupParticipantsUpdate(from, [sender], "remove");  
            return;  
        }  

        if (!isCmd) return;  

        // --- COMMAND ---
        switch (command) {  

            case 'menu':  
                await sock.sendMessage(from, {  
                    text: `Halo ${user.nama}

Level: ${user.level}
Coin: ${user.coin}
Limit: ${user.limit}

Command:
.misi
.mancing
.tt <link>
.ping`
                }, { quoted: m });  
                break;  

            case 'ping':  
                await sock.sendMessage(from, { text: 'Pong!' }, { quoted: m });  
                break;  

            case 'misi':  
                const now = Date.now();  

                if (now - user.lastMisi < 86400000) {  
                    return sock.sendMessage(from, {  
                        text: 'Sudah claim hari ini'  
                    }, { quoted: m });  
                }  

                user.coin += 500;  
                user.limit = 22;  
                user.lastMisi = now;  

                saveDB();  

                await sock.sendMessage(from, {  
                    text: 'Berhasil claim +500 coin'  
                }, { quoted: m });  
                break;  

            case 'mancing':  
                if (user.limit <= 0) {  
                    return sock.sendMessage(from, {  
                        text: 'Limit habis'  
                    }, { quoted: m });  
                }  

                user.limit -= 1;  

                const ikan = ['Nila', 'Lele', 'Hiu', 'Sepatu'];  
                const hasil = ikan[Math.floor(Math.random() * ikan.length)];  

                user.coin += 50;  

                saveDB();  

                await sock.sendMessage(from, {  
                    text: `Dapat: ${hasil}\nLimit: ${user.limit}`  
                }, { quoted: m });  
                break;  

            case 'tt':  
                if (!args[0]) {  
                    return sock.sendMessage(from, {  
                        text: 'Masukkan link TikTok'  
                    }, { quoted: m });  
                }  

                await sock.sendMessage(from, { text: 'Processing...' });  

                try {  
                    const res = await axios.get(  
                        `https://api.tiklydown.eu.org/api/download?url=${args[0]}`  
                    );  

                    await sock.sendMessage(from, {  
                        video: { url: res.data.video.noWatermark }  
                    }, { quoted: m });  

                } catch {  
                    await sock.sendMessage(from, {  
                        text: 'Error download'  
                    }, { quoted: m });  
                }  
                break;  
        }  

    } catch (err) {  
        console.log("ERROR:", err);  
    }  
});

}

startBot();
