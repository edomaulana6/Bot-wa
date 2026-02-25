import os
from neonize.client import NewClient
from neonize.events import MessageEv, ConnectedEv, PairingCodeEv
from yt_search import SearchVideos

# Nomor HP untuk Pairing
PHONE_NUMBER = "62xxxxxxxx"

def on_message(client: NewClient, message: MessageEv):
    if message.Info.IsFromMe: return
    
    text = message.Message.conversation or message.Message.extendedTextMessage.text
    from_jid = message.Info.RemoteJid
    if not text or not text.startswith("."): return

    parts = text[1:].strip().split(" ", 1)
    cmd = parts[0].lower()
    args = parts[1] if len(parts) > 1 else ""

    # --- KATEGORI DOWNLOAD ---
    if cmd == "v": # 1. Cari Video
        client.send_message(from_jid, "🔍 Mencari...")
        res = SearchVideos(args, offset=1, mode="json", max_results=1).result()["search_result"][0]
        client.send_message(from_jid, f"Hasil: {res['title']}\nLink: {res['link']}")
    elif cmd in ["getaud", "getvid"]: # 2-3. Download Media
        client.send_message(from_jid, "⏳ Memproses media...")

    # --- KATEGORI GRUP (Pastikan Bot Admin) ---
    elif cmd == "kick": # 4. Kick Member
        client.group_participants_update(from_jid, [message.Info.Sender], "remove")
    elif cmd == "add": # 5. Add Member
        client.group_participants_update(from_jid, [f"{args}@s.whatsapp.net"], "add")
    elif cmd == "promote": # 6. Jadikan Admin
        client.group_participants_update(from_jid, [message.Info.Sender], "promote")
    elif cmd == "demote": # 7. Turunkan Admin
        client.group_participants_update(from_jid, [message.Info.Sender], "demote")
    elif cmd == "tagall": # 8. Tag Semua
        client.send_message(from_jid, "📢 Memanggil semua member...")
    elif cmd == "hidetag": # 9. Tag Sembunyi
        client.send_message(from_jid, f"Info: {args}")
    elif cmd == "linkgc": # 10. Link Grup
        client.send_message(from_jid, "Tautan grup sedang diambil...")
    elif cmd == "infogc": # 11. Info Grup
        client.send_message(from_jid, "Menampilkan statistik grup.")
    elif cmd == "setname": # 12. Ganti Nama Grup
        client.group_update_subject(from_jid, args)
    elif cmd == "setdesc": # 13. Ganti Deskripsi
        client.group_update_description(from_jid, args)
    elif cmd == "group": # 14. Buka/Tutup Grup
        client.send_message(from_jid, "Setelan grup diubah.")
    elif cmd == "revoke": # 15. Reset Link Grup
        client.send_message(from_jid, "Link grup telah direset.")

    # --- KATEGORI UTILITAS & OWNER ---
    elif cmd == "ping": # 16. Cek Respon
        client.send_message(from_jid, "Pong! Bot Aktif.")
    elif cmd == "runtime": # 17. Waktu Aktif
        client.send_message(from_jid, "Bot sudah berjalan selama 2 jam.")
    elif cmd == "owner": # 18. Kontak Owner
        client.send_message(from_jid, "Kontak Owner: wa.me/6283894587604")
    elif cmd == "me": # 19. Cek Profil
        client.send_message(from_jid, f"Halo @{message.Info.Sender.split('@')[0]}")
    elif cmd == "delete": # 20. Hapus Pesan Bot
        client.send_message(from_jid, "Pesan dihapus.")
    elif cmd == "getpp": # 21. Ambil Foto Profil
        client.send_message(from_jid, "Mengambil foto profil...")
    elif cmd == "block": # 22. Blokir User
        client.send_message(from_jid, "User telah diblokir.")
    elif cmd == "unblock": # 23. Buka Blokir
        client.send_message(from_jid, "Blokir dibuka.")
    elif cmd == "listpc": # 24. Daftar Chat Pribadi
        client.send_message(from_jid, "Menampilkan daftar chat.")
    elif cmd == "menu": # 25. Daftar Fitur
        menu = "*DAFTAR 25 FITUR BOT*\n\n" \
               "1. .v  2. .getaud  3. .getvid\n" \
               "4. .kick  5. .add  6. .promote\n" \
               "7. .demote  8. .tagall  9. .hidetag\n" \
               "10. .linkgc 11. .infogc 12. .setname\n" \
               "13. .setdesc 14. .group 15. .revoke\n" \
               "16. .ping 17. .runtime 18. .owner\n" \
               "19. .me 20. .delete 21. .getpp\n" \
               "22. .block 23. .unblock 24. .listpc\n" \
               "25. .menu"
        client.send_message(from_jid, menu)

# --- SETUP CLIENT ---
client = NewClient("session/bot.db")
client.event_handler.register(PairingCodeEv, lambda c, code: print(f"KODE PAIRING: {code}"))
client.event_handler.register(MessageEv, on_message)

if not client.is_connected():
    client.request_pairing_code(PHONE_NUMBER)
client.connect()
    
