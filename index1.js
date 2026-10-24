
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');


const TOKEN = process.env.DISCORD_TOKEN;
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID;

const PREFIX = '!';
const AUTO_SLEEP_MS = 5 * 60 * 1000;
const MAX_QUEUE = 10;

const ADMIN_FILE = path.join(__dirname, 'bot-admins.json');

if (!TOKEN || !JAMENDO_CLIENT_ID || !OWNER_ID) {
  console.error(
    'ERROR: Periksa DISCORD_TOKEN, JAMENDO_CLIENT_ID, dan OWNER_ID di .env'
  );
  process.exit(1);
}


function loadAdmins() {
  try {
    const data = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let botAdmins = loadAdmins();

function saveAdmins() {
  fs.writeFileSync(
    ADMIN_FILE,
    JSON.stringify(botAdmins, null, 2),
    'utf8'
  );
}

function isBotAdmin(userId) {
  return userId === OWNER_ID || botAdmins.includes(userId);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const guildSessions = new Map();

async function searchJamendo(query) {
  const params = new URLSearchParams({
    client_id: JAMENDO_CLIENT_ID,
    format: 'json',
    limit: '10',
    search: query,
    audioformat: 'mp31',
    type: 'single albumtrack',
  });

  const url = `https://api.jamendo.com/v3.0/tracks/?${params}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Jamendo API HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.headers?.status !== 'success') {
    throw new Error(
      data.headers?.error_message || 'Jamendo API gagal'
    );
  }

  return (data.results || []).filter(
    track =>
      typeof track.audio === 'string' &&
      track.audio.startsWith('https://') &&
      track.name &&
      track.artist_name
  );
}

function getSession(guildId) {
  return guildSessions.get(guildId);
}

function createSession(message, voiceChannel) {
  const guildId = message.guild.id;

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: message.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  const player = createAudioPlayer();

  connection.subscribe(player);

  const session = {
    connection,
    player,
    queue: [],
    currentProcess: null,
    textChannel: message.channel,
    voiceChannelId: voiceChannel.id,
    idleTimer: null,
    closing: false,
  };

  guildSessions.set(guildId, session);

  connection.on('stateChange', (oldState, newState) => {
    if (
      newState.status === VoiceConnectionStatus.Disconnected &&
      !session.closing
    ) {
      entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        .catch(() => {
          if (guildSessions.get(guildId) === session) {
            shutdownGuild(guildId, false);
          }
        });
    }
  });

  connection.on('error', error => {
    console.error('Voice connection error:', error.message);
  });

  player.on('error', error => {
    console.error('Audio player error:', error.message);
    killCurrentProcess(session);
  });

  player.on(AudioPlayerStatus.Idle, () => {
    if (session.closing) return;

    killCurrentProcess(session);

    if (session.queue.length > 0) {
      playNext(guildId);
    } else {
      scheduleIdleSleep(guildId);
    }
  });

  return session;
}

async function getOrCreateSession(message) {
  const member = message.member;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    await message.reply(
      'Masuk ke voice channel terlebih dahulu, lalu gunakan `!play judul lagu`.'
    );
    return null;
  }

  let session = getSession(message.guild.id);

  if (session && session.voiceChannelId !== voiceChannel.id) {
    await message.reply(
      'Bot sedang berada di voice channel lain di server ini.'
    );
    return null;
  }

  if (!session) {
    session = createSession(message, voiceChannel);
  }

  session.textChannel = message.channel;
  refreshIdleTimer(message.guild.id);

  try {
    await entersState(
      session.connection,
      VoiceConnectionStatus.Ready,
      20000
    );
  } catch {
    shutdownGuild(message.guild.id, false);
    await message.reply(
      'Gagal terhubung ke voice channel. Coba lagi beberapa saat.'
    );
    return null;
  }

  return session;
}

function killCurrentProcess(session) {
  const child = session.currentProcess;
  session.currentProcess = null;

  if (child && !child.killed) {
    child.kill('SIGKILL');
  }
}

function shutdownGuild(guildId, announce = false) {
  const session = getSession(guildId);
  if (!session) return;

  session.closing = true;
  clearTimeout(session.idleTimer);
  session.queue.length = 0;

  killCurrentProcess(session);

  try {
    session.player.stop(true);
  } catch {}

  try {
    session.connection.destroy();
  } catch {}

  guildSessions.delete(guildId);

  if (announce && session.textChannel) {
    session.textChannel.send('sleep').catch(() => {});
  }
}

function scheduleIdleSleep(guildId) {
  const session = getSession(guildId);
  if (!session || session.closing) return;

  clearTimeout(session.idleTimer);

  session.idleTimer = setTimeout(() => {
    const current = getSession(guildId);
    if (!current || current.closing) return;

    const voiceChannel = client.channels.cache.get(
      current.voiceChannelId
    );

    const humansPresent =
      voiceChannel?.members?.some(member => !member.user.bot) ?? false;

    if (!humansPresent) {
      shutdownGuild(guildId, false);
      return;
    }

    if (
      current.player.state.status === AudioPlayerStatus.Playing ||
      current.queue.length > 0
    ) {
      scheduleIdleSleep(guildId);
      return;
    }

    shutdownGuild(guildId, true);
  }, AUTO_SLEEP_MS);
}

function refreshIdleTimer(guildId) {
  const session = getSession(guildId);
  if (!session || session.closing) return;

  scheduleIdleSleep(guildId);
}

client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = oldState.guild.id;
  const session = getSession(guildId);

  if (!session) return;

  const channel =
    oldState.channelId === session.voiceChannelId
      ? oldState.channel
      : newState.channelId === session.voiceChannelId
        ? newState.channel
        : null;

  if (!channel) return;

  const humansPresent = channel.members.some(
    member => !member.user.bot
  );

  if (!humansPresent) {
    shutdownGuild(guildId, false);
  }
});

function playNext(guildId) {
  const session = getSession(guildId);
  if (!session || session.closing) return;

  const track = session.queue.shift();

  if (!track) {
    scheduleIdleSleep(guildId);
    return;
  }

  killCurrentProcess(session);

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', track.audio,
    '-vn',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ];

  let ffmpeg;

  try {
    ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.error('FFmpeg gagal dijalankan:', error.message);
    session.textChannel
      .send('Gagal memulai FFmpeg. Periksa instalasi FFmpeg.')
      .catch(() => {});
    playNext(guildId);
    return;
  }

  session.currentProcess = ffmpeg;

  ffmpeg.stderr.on('data', data => {
    console.error('FFmpeg:', data.toString().trim());
  });

  ffmpeg.on('error', error => {
    console.error('FFmpeg process error:', error.message);
  });

  ffmpeg.on('close', () => {
    if (session.currentProcess === ffmpeg) {
      session.currentProcess = null;
    }
  });

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    metadata: track,
  });

  session.player.play(resource);

  session.textChannel
    .send(
      `🎵 **Sedang diputar:** ${track.name}\n` +
      `👤 Artis: ${track.artist_name}\n` +
      `🔗 ${track.shareurl || 'Jamendo'}`
    )
    .catch(() => {});
}


function getMenu() {
  return [
    '**🎵 MENU BOT MUSIK**',
    '',
    '`!play <judul>` — cari dan putar lagu',
    '`!pause` — jeda lagu',
    '`!resume` — lanjutkan lagu',
    '`!skip` — lewati lagu',
    '`!stop` — hentikan musik dan kosongkan antrean',
    '`!menu` — tampilkan menu ini',
    '',
    '**👑 ADMIN BOT**',
    '`!admin @anggota` — beri izin admin bot (owner)',
    '`!unadmin @anggota` — cabut izin admin bot (owner)',
    '`!adminlist` — daftar admin bot',
    '',
    'Bot keluar setelah 5 menit tidak aktif ketika musik tidak diputar.',
    'Jika voice channel kosong, bot langsung keluar tanpa pesan.',
  ].join('\n');
}


client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();
  const args = parts;
  const guildId = message.guild.id;

  if (!command) return;

  refreshIdleTimer(guildId);

  try {
    if (command === 'menu') {
      await message.reply(getMenu());
      return;
    }

    if (command === 'admin' || command === 'unadmin') {
      if (message.author.id !== OWNER_ID) {
        await message.reply(
          'Perintah ini hanya bisa digunakan oleh owner bot.'
        );
        return;
      }

      const target = message.mentions.users.first();

      if (!target) {
        await message.reply(
          `Gunakan \`!${command} @anggota\` dengan mention anggota.`
        );
        return;
      }

      if (target.bot) {
        await message.reply('Akun bot tidak bisa ditambahkan sebagai admin.');
        return;
      }

      if (target.id === OWNER_ID) {
        await message.reply('Owner sudah memiliki akses penuh ke bot.');
        return;
      }

      if (command === 'admin') {
        if (botAdmins.includes(target.id)) {
          await message.reply(`${target} sudah menjadi admin bot.`);
          return;
        }

        botAdmins.push(target.id);
        saveAdmins();

        await message.reply(`${target} sekarang menjadi admin bot.`);
        return;
      }

      if (!botAdmins.includes(target.id)) {
        await message.reply(`${target} bukan admin bot.`);
        return;
      }

      botAdmins = botAdmins.filter(id => id !== target.id);
      saveAdmins();

      await message.reply(`Izin admin bot untuk ${target} sudah dicabut.`);
      return;
    }

    if (command === 'adminlist') {
      const list = botAdmins.length
        ? botAdmins.map((id, i) => `${i + 1}. <@${id}>`).join('\n')
        : 'Belum ada admin tambahan.';

      await message.reply(
        `**OWNER**\n<@${OWNER_ID}>\n\n**ADMIN BOT**\n${list}`
      );
      return;
    }

    if (command === 'play') {
      const query = args.join(' ');

      if (!query) {
        await message.reply('Contoh: `!play chill instrumental`');
        return;
      }

      const session = await getOrCreateSession(message);
      if (!session) return;

      await message.channel.send(`🔎 Mencari lagu: **${query}** ...`);

      const results = await searchJamendo(query);

      if (!results.length) {
        await message.reply(
          'Lagu tidak ditemukan atau tidak tersedia untuk diputar di Jamendo.'
        );
        return;
      }

      if (session.queue.length >= MAX_QUEUE) {
        await message.reply(
          `Antrean penuh. Maksimal ${MAX_QUEUE} lagu menunggu.`
        );
        return;
      }

      const track = results[0];
      session.queue.push(track);

      if (session.player.state.status === AudioPlayerStatus.Idle) {
        playNext(guildId);
      } else {
        await message.reply(
          `➕ **${track.name}** — ${track.artist_name} ditambahkan ke antrean.`
        );
      }

      refreshIdleTimer(guildId);
      return;
    }

    const controlCommands = [
      'pause',
      'resume',
      'skip',
      'stop',
    ];

    if (controlCommands.includes(command)) {
      if (!isBotAdmin(message.author.id)) {
        await message.reply(
          'Kamu tidak memiliki izin untuk mengontrol pemutaran musik.'
        );
        return;
      }

      const session = getSession(guildId);

      if (!session) {
        await message.reply('Bot tidak sedang berada di voice channel.');
        return;
      }

      if (command === 'pause') {
        const success = session.player.pause();

        await message.reply(
          success ? '⏸️ Musik dijeda.' : 'Musik tidak sedang diputar.'
        );
        return;
      }

      if (command === 'resume') {
        const success = session.player.unpause();

        await message.reply(
          success ? '▶️ Musik dilanjutkan.' : 'Musik tidak sedang dijeda.'
        );
        return;
      }

      if (command === 'skip') {
        if (
          session.player.state.status === AudioPlayerStatus.Idle
        ) {
          await message.reply('Tidak ada lagu yang sedang diputar.');
          return;
        }

        killCurrentProcess(session);
        session.player.stop(true);

        await message.reply('⏭️ Lagu dilewati.');
        return;
      }

      if (command === 'stop') {
        session.queue.length = 0;
        killCurrentProcess(session);
        session.player.stop(true);

        scheduleIdleSleep(guildId);

        await message.reply(
          '⏹️ Musik dihentikan dan antrean dikosongkan.'
        );
        return;
      }
    }
  } catch (error) {
    console.error('Command error:', error);

    await message.reply(
      'Terjadi kesalahan saat menjalankan perintah. ' +
      'Periksa log Termux untuk mengetahui penyebabnya.'
    ).catch(() => {});
  }
});

client.once('ready', () => {
  console.log('================================');
  console.log(`Bot online: ${client.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
  console.log('Host: Termux / Android');
  console.log('Sumber musik: Jamendo API');
  console.log('================================');
});

client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('SIGINT', () => {
  console.log('\nMenutup bot...');

  for (const guildId of guildSessions.keys()) {
    shutdownGuild(guildId, false);
  }

  client.destroy();
  process.exit(0);
});

client.login(TOKEN);
