const { prefix } = require('../config');
const { handleGeneral } = require('../commands/general');
const { handleAdmin } = require('../commands/admin');
const { handleMusic } = require('../commands/music');
const { refreshSleep } = require('../music/player');

async function handleMessage(message) {
  if (message.author.bot) return;

// Log aktivitas pesan seperti kode testing awal.
console.log($DIL0 - $DIL1);
console.log(in $DIL2);
console.log(message.content);
console.log('----------');

refreshSleep(message.guild?.id);

try {
    if (await handleGeneral(message, message.content.trim().toLowerCase())) {
      return;
    }

    if (!message.guild) return;
    if (!message.content.startsWith(prefix)) return;

const parts = message.content
      .slice(prefix.length)
      .trim()
      .split(/\s+/);

const command = (parts.shift() || '').toLowerCase();
    const args = parts;

    if (!command) return;

if (await handleGeneral(message, command)) return;
    if (await handleAdmin(message, command)) return;
    if (await handleMusic(message, command, args)) return;
  } catch (error) {
    console.error('[MessageHandler]', error);

await message.reply(
      'Terjadi kesalahan saat memproses pesan.'
    ).catch(() => {});
  }
}

module.exports = { handleMessage };