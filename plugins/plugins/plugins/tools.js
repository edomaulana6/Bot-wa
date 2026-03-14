const axios = require("axios");
module.exports = {
    command: ['ai', 'google', 'resep', 'kalkulator', 'kbbi', 'translate', 'cuaca', 'gempa', 'sholat', 'news', 'runtime', 'ping', 'nulis', 'ssweb', 'shorten'],
    operate: async (sock, msg, from, args) => {
        const command = args[0]; // Logic placeholder
        try {
            if (args.length === 0 && !['ping', 'runtime', 'gempa'].includes(msg.body)) return;
            // Contoh AI
            const res = await axios.get(`https://api.vreden.web.id/api/ai/blackbox?text=${args.join(" ")}`);
            await sock.sendMessage(from, { text: res.data.result });
        } catch (e) { console.log(e); }
    }
};
