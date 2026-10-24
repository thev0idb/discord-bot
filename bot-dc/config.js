require('dotenv').config();

const config = {
  token: process.env.DISCORD_TOKEN,
  jamendoClientId: process.env.JAMENDO_CLIENT_ID,
  ownerId: process.env.OWNER_ID,

  prefix: '!',
  maxQueue: 10,
  autoSleepMs: 5 * 60 * 1000,
};

if (!config.token || !config.jamendoClientId || !config.ownerId) {
  throw new Error(
    'Periksa DISCORD_TOKEN, JAMENDO_CLIENT_ID, dan OWNER_ID di .env'
  );
}

module.exports = config;
