import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import cors from "cors";
import pino from "pino";
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

async function startServer() {
    const app = express();
    const PORT = 3000;

    // Pastikan folder sessions ada
    const sessionsDir = path.join(process.cwd(), 'sessions');
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    app.use(cors());
    app.use(express.json());

    const logger = pino({ level: 'silent' });
    const activeSockets = new Map();

    // ENDPOINT UNTUK MENDAPATKAN KODE PAIRING (LOGIKA UTAMA KAMU)
    app.post("/api/get-pairing-code", async (req, res) => {
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            return res.status(400).json({ error: "Nomor telepon wajib diisi!" });
        }

        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        const sessionPath = path.join(sessionsDir, `session_${cleanNumber}`);

        // Bersihkan socket lama jika ada untuk nomor yang sama
        if (activeSockets.has(cleanNumber)) {
            try {
                const oldSock = activeSockets.get(cleanNumber);
                oldSock.end(undefined);
            } catch (e) {
                console.error("Gagal menutup socket lama:", e);
            }
            activeSockets.delete(cleanNumber);
        }

        try {
            // Gunakan folder sesi spesifik per nomor
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                logger,
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                // Identitas browser agar notifikasi pairing muncul (Update terbaru)
                browser: ["Ubuntu", "Chrome", "110.0.5481.178"],
                connectTimeoutMs: 60000,
            });

            activeSockets.set(cleanNumber, sock);

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    console.log(`[${cleanNumber}] Koneksi terputus:`, statusCode);
                    
                    if (!shouldReconnect) {
                        activeSockets.delete(cleanNumber);
                        if (fs.existsSync(sessionPath)) {
                            fs.rmSync(sessionPath, { recursive: true, force: true });
                        }
                    }
                } else if (connection === 'open') {
                    console.log(`[${cleanNumber}] Bot berhasil terhubung!`);
                    // Opsional: Kirim pesan ke nomor bot sendiri saat berhasil login
                    await sock.sendMessage(`${cleanNumber}@s.whatsapp.net`, { text: "Serika AI Pairing Hub Berhasil Terhubung! 🎉" });
                }
            });

            // LOGIKA MEMANCING KODE PAIRING
            if (!sock.authState.creds.registered) {
                setTimeout(async () => {
                    try {
                        if (activeSockets.has(cleanNumber)) {
                            const code = await sock.requestPairingCode(cleanNumber);
                            console.log(`[${cleanNumber}] Generated Pairing Code: ${code}`);
                            if (!res.headersSent) {
                                res.json({ code });
                            }
                        }
                    } catch (err) {
                        console.error(`[${cleanNumber}] Gagal minta kode pairing:`, err);
                        if (!res.headersSent) {
                            res.status(500).json({ error: "Gagal meminta kode pairing. Coba lagi." });
                        }
                    }
                }, 6000); // Jeda 6 detik agar socket stabil
            } else {
                if (!res.headersSent) {
                    res.status(400).json({ error: "Nomor ini sudah terdaftar/login." });
                }
            }

        } catch (error) {
            console.error("Server error:", error);
            if (!res.headersSent) {
                res.status(500).json({ error: "Terjadi kesalahan pada server." });
            }
        }
    });

    // --- SISANYA ADALAH KONFIGURASI VITE (SAMA SEPERTI KODE KAMU) ---
    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server jalan di http://localhost:${PORT}`);
    });
}

startServer();
        
