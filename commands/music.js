const { isAdmin } = require('../utils/admin-list');
const { searchTracks } = require('../music/jamendo');

const {
  enqueue,
  pause,
  resume,
  skip,
  stop,
} = require('../music/player');

async function handleMusic(message, command, args) {
  const guildId = message.guild.id;

if (command === 'play') {
    const query = args.join(' ').trim();

if (!query) {
await message.reply('Contoh: !play chill instrumental');
return true;
}

await message.channel.send(`🔎 Mencari lagu: **${query}** ...`);

try {
      const tracks = await searchTracks(query);

if (!tracks.length) {
        await message.reply(
          'Lagu tidak ditemukan atau URL audio tidak tersedia di Jamendo.'
        );
        return true;
      }

await enqueue(message, tracks[0]);
    } catch (error) {
      console.error('[Jamendo]', error.message);

await message.reply(
        'Gagal mencari lagu di Jamendo. Periksa koneksi internet dan Client ID.'
      );
    }

return true;
  }

  const controls = ['pause', 'resume', 'skip', 'stop'];

  if (!controls.includes(command)) return false;

if (!isAdmin(message.author.id)) {
    await message.reply(
      'Kamu tidak memiliki izin untuk mengontrol musik.'
    );
    return true;
  }

  let success = false;

if (command === 'pause') success = pause(guildId);
  if (command === 'resume') success = resume(guildId);
  if (command === 'skip') success = skip(guildId);
  if (command === 'stop') success = stop(guildId);

const replies = {
    pause: success ? '⏸️ Musik dijeda.' : 'Musik tidak sedang diputar.',
    resume: success ? '▶️ Musik dilanjutkan.' : 'Musik tidak sedang dijeda.',
    skip: success ? '⏭️ Lagu dilewati.' : 'Tidak ada lagu yang sedang diputar.',
    stop: success ? '⏹️ Musik dihentikan dan antrean dikosongkan.' : 'Bot tidak sedang memutar musik.',
  };

await message.reply(replies[command]);
  return true;
}

module.exports = { handleMusic };
