# 🎵 WA Music Bot v2.0 — Koyeb Edition

Bot WhatsApp musik + games, siap deploy ke **Koyeb** via GitHub.

---

## 🚀 Deploy ke Koyeb (Step by Step)

### 1. Push ke GitHub
```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/USERNAMU/wa-music-bot.git
git push -u origin main
```

### 2. Deploy di Koyeb
1. Buka [app.koyeb.com](https://app.koyeb.com) → **Create Service**
2. Pilih **GitHub** → pilih repo `wa-music-bot`
3. Koyeb akan otomatis detect **Dockerfile**
4. Set **Environment Variables** (wajib!):

| Variabel | Nilai | Keterangan |
|---|---|---|
| `WA_NUMBER` | `6281234567890` | Nomormu (wajib!) |
| `PORT` | `8000` | Port HTTP |
| `PREFIX` | `!` | Prefix perintah |
| `BOT_NAME` | `🎵 MusicBot` | Nama bot |
| `MAX_DURATION` | `15` | Maks durasi lagu (menit) |

5. Klik **Deploy**

### 3. Ambil Pairing Code
Setelah deploy, buka **Logs** di Koyeb:
```
╔══════════════════════════════╗
║  🔑  PAIRING CODE:  ABCD-EFGH  ║
╚══════════════════════════════╝
```
Masukkan kode itu di WhatsApp:
> **Perangkat Tertaut → Tautkan dengan nomor telepon**

---

## 🎮 Daftar Perintah

### 🎧 Musik
| Perintah | Fungsi |
|---|---|
| `!play <judul>` | Download & kirim lagu MP3 + **thumbnail** |
| `!mp4 <judul>` | Download & kirim video MP4 + **thumbnail** |
| `!cari <judul>` | Cari lagu di YouTube |
| `!info <judul>` | Info detail + **thumbnail** |
| `!lirik <judul>` | Ambil lirik lagu |
| `!history` | Riwayat 10 lagu terakhir |

### 🎮 Permainan
| Perintah | Fungsi |
|---|---|
| `!tebak` | Tebak judul lagu dari petunjuk |
| `!skip` | Lewati soal tebak lagu |
| `!hangman` | Tebak kata bertema musik |
| `!hhint` | Minta petunjuk huruf (hangman) |
| `!hstop` | Hentikan game hangman |
| `!tictac` | Main Tic-Tac-Toe vs Bot |
| `!skor` | Lihat papan skor |

### ℹ️ Lainnya
| Perintah | Fungsi |
|---|---|
| `!menu` | Tampilkan semua perintah |
| `!ping` | Cek status & latensi bot |

---

## ✨ Fitur Baru v2.0

- 🖼️ **Thumbnail otomatis** — setiap lagu disertai gambar cover dari YouTube
- 🎮 **3 mini game** — Tebak Lagu, Hangman Musik, Tic-Tac-Toe vs Bot
- 🏆 **Sistem skor** — poin terakumulasi per group/chat
- 🌐 **HTTP health check** — endpoint `/health` untuk Koyeb monitoring
- 🔁 **Auto-reconnect** — jika terputus, bot otomatis reconnect
- ⚙️ **Semua config via ENV** — tidak perlu edit kode

---

## 📁 Struktur
```
wa-music-bot/
├── index.js        ← Kode utama (702 baris)
├── package.json    ← Dependencies
├── Dockerfile      ← Build config untuk Koyeb
├── .gitignore      ← Abaikan folder sensitif
├── README.md       ← Panduan ini
├── sessions/       ← Session WA (di-ignore git)
└── temp/           ← File sementara (di-ignore git)
```

---

## ❓ Troubleshooting

| Masalah | Solusi |
|---|---|
| Kode pairing tidak muncul di logs | Pastikan `WA_NUMBER` sudah diset di ENV |
| Deploy gagal | Cek apakah Dockerfile terdetect |
| Bot tidak reply | Cek prefix di ENV `PREFIX` |
| Download gagal | Video age-restricted / region-lock |
| Session hilang setelah redeploy | Koyeb tidak persist storage — pairing ulang |

> 💡 **Tips:** Kalau mau session permanen, gunakan **Koyeb Persistent Volume** dan mount ke `/app/sessions`

---

Made with ❤️ for Koyeb
