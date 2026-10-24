const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const { handleMessage } = require('./handlers/message-handler');
const { handleVoiceState } = require('./music/player');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once('ready', () => {
  console.log('================================');
  console.log('Connected!');
  console.log(`Logged in as: ${client.user?.tag}`);
  console.log('================================');
});

client.on('messageCreate', handleMessage);
client.on('voiceStateUpdate', handleVoiceState);

client.on('error', error => {
  console.error('[Discord Client]', error);
});

process.on('unhandledRejection', error => {
  console.error('[Unhandled Rejection]', error);
});

process.on('SIGINT', () => {
  console.log('\nBot dihentikan.');
  client.destroy();
  process.exit(0);
});

client.login(config.token).catch(error => {
  console.error('Gagal login ke Discord:', error.message);
  process.exit(1);
});
