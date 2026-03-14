const axios = require("axios");
module.exports = {
    command: ['a', 'tiktok', 'ig', 'ytmp3', 'ytmp4', 'fb', 'git', 'play', 'twitter', 'mediafire'],
    operate: async (sock, msg, from, args) => {
        if (!args[0]) return sock.sendMessage(from, { text: "Linknya mana?" });
        sock.sendMessage(from, { text: "⏳ Sedang mendownload..." });
        try {
            const res = await axios.get(`https://api.vreden.web.id/api/download/allinone?url=${args[0]}`);
            const data = res.data.result;
            const link = data.download?.url || data.video || data.music;
            await sock.sendMessage(from, { video: { url: link }, caption: "Done!" }, { quoted: msg });
        } catch (e) { sock.sendMessage(from, { text: "Gagal mendownload media." }); }
    }
};
          
