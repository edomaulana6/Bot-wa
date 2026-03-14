module.exports = {
    command: ['alay', 'cekmati', 'halu', 'truth', 'dare', 'apakah', 'siapakah', 'kapankah', 'quotes', 'owner'],
    operate: async (sock, msg, from, args, { pushname }) => {
        const replies = ["Ya", "Tidak", "Mungkin", "Bisa jadi"];
        const rand = replies[Math.floor(Math.random() * replies.length)];
        await sock.sendMessage(from, { text: `Pertanyaan: ${args.join(" ")}\nJawaban: ${rand}` });
    }
};
