module.exports = {
    command: ['kick', 'add', 'promote', 'demote', 'hidetag', 'tagall', 'group', 'setname', 'setdesc', 'linkgc', 'setppgc', 'revoke', 'ephemeral', 'infogc', 'leave'],
    operate: async (sock, msg, from, args) => {
        const isGroup = from.endsWith('@g.us');
        if (!isGroup) return;
        const cmd = msg.message.conversation || msg.message.extendedTextMessage.text;
        const command = cmd.slice(1).split(' ')[0];
        const meta = await sock.groupMetadata(from);
        const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid[0] || (args[0] ? args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net" : null);

        switch (command) {
            case 'kick': await sock.groupParticipantsUpdate(from, [target], "remove"); break;
            case 'promote': await sock.groupParticipantsUpdate(from, [target], "promote"); break;
            case 'hidetag': 
                sock.sendMessage(from, { text: args.join(" ") || "Panggilan!", mentions: meta.participants.map(a => a.id) });
                break;
            case 'linkgc':
                const code = await sock.groupInviteCode(from);
                sock.sendMessage(from, { text: `https://chat.whatsapp.com/${code}` });
                break;
            case 'leave': await sock.groupLeave(from); break;
        }
    }
};
          
