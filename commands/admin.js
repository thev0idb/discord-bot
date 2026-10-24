
const { ownerId } = require('../config');
const {
  addAdmin,
  removeAdmin,
  getAdmins,
} = require('../utils/admin-list.js');

async function handleAdmin(message, command) {
  if (command === 'adminlist') {
    const admins = getAdmins();
    const lines = admins.length
      ? admins.map((id, i) => `${i + 1}. <@${id}>`)
      : ['Belum ada admin tambahan.'];

    await message.reply(
      `**Owner bot**\n<@${ownerId}>\n\n**Admin bot**\n${lines.join('\n')}`
    );
    return true;
  }

  if (command !== 'admin' && command !== 'unadmin') {
    return false;
  }

  if (message.author.id !== ownerId) {
    await message.reply('Perintah ini hanya bisa digunakan oleh owner bot.');
    return true;
  }

  const target = message.mentions.users.first();

  if (!target) {
    await message.reply(`Gunakan \`!${command} @anggota\`.`);
    return true;
  }

  if (target.bot || target.id === ownerId) {
    await message.reply('Target tidak dapat dijadikan admin tambahan.');
    return true;
  }

  if (command === 'admin') {
    const added = addAdmin(target.id);

    await message.reply(
      added
        ? `${target} sekarang menjadi admin bot.`
        : `${target} sudah menjadi admin bot.`
    );
    return true;
  }

  const removed = removeAdmin(target.id);

  await message.reply(
    removed
      ? `Izin admin bot untuk ${target} sudah dicabut.`
      : `${target} bukan admin bot.`
  );

  return true;
}

module.exports = { handleAdmin };
