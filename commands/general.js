const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const { getMenu } = require('../utils/menu');

async function handleGeneral(message, command) {
  if (command === 'ping') {
    await message.channel.send('Pong');
    return true;
  }

  if (command === 'picture') {
    const imagePath = path.join(__dirname, '..', 'fillsquare.png');
    const attachment = new AttachmentBuilder(imagePath);

    await message.channel.send({ files: [attachment] });
    return true;
  }

  if (command === 'menu') {
    await message.channel.send(getMenu());
    return true;
  }

  return false;
}

module.exports = { handleGeneral };
