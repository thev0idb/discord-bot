const { spawn } = require('node:child_process');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} = require('@discordjs/voice');

const { autoSleepMs, maxQueue } = require('../config');

const sessions = new Map();

function getSession(guildId) {
  return sessions.get(guildId);
}

function killAudio(session) {
  const child = session.ffmpeg;
  session.ffmpeg = null;

if (child && child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

function destroySession(guildId, announce = false) {
  const session = getSession(guildId);
  if (!session) return;

session.closing = true;
  clearTimeout(session.sleepTimer);
  session.queue.length = 0;

  killAudio(session);

try {
    session.player.stop(true);
  } catch {}

try {
    session.connection.destroy();
  } catch {}

  sessions.delete(guildId);

if (announce) {
    session.textChannel.send('sleep').catch(() => {});
  }
}

function scheduleSleep(guildId) {
  const session = getSession(guildId);
  if (!session || session.closing) return;

  clearTimeout(session.sleepTimer);

session.sleepTimer = setTimeout(() => {
    const current = getSession(guildId);
    if (!current || current.closing) return;

const channel = current.connection.joinConfig.channelId
      ? current.textChannel.guild.channels.cache.get(
          current.connection.joinConfig.channelId
        )
      : null;

const humansPresent = channel?.members?.some(
      member => !member.user.bot
    ) ?? false;

if (!humansPresent) {
      destroySession(guildId, false);
      return;
    }

if (
      current.queue.length ||
      current.player.state.status !== AudioPlayerStatus.Idle
    ) {
      scheduleSleep(guildId);
      return;
    }

destroySession(guildId, true);
  }, autoSleepMs);
}

function refreshSleep(guildId) {
  const session = getSession(guildId);
  if (session) scheduleSleep(guildId);
}

function playNext(guildId) {
  const session = getSession(guildId);
  if (!session || session.closing) return;

  const track = session.queue.shift();

if (!track) {
    scheduleSleep(guildId);
    return;
  }

  killAudio(session);

const ffmpeg = spawn('ffmpeg', [
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
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  session.ffmpeg = ffmpeg;

ffmpeg.stderr.on('data', data => {
    console.error('[FFmpeg]', data.toString().trim());
  });

ffmpeg.on('error', error => {
    console.error('[FFmpeg]', error.message);
  });

ffmpeg.on('close', () => {
    if (session.ffmpeg === ffmpeg) {
      session.ffmpeg = null;
    }
  });

const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    metadata: track,
  });

  session.player.play(resource);

  session.textChannel.send(
    `🎵 **${track.name}**\n` +
    `👤 ${track.artist_name}\n` +
    `🔗 ${track.shareurl || 'Jamendo'}`
  ).catch(() => {});
}

async function ensureSession(message) {
  const voiceChannel = message.member?.voice?.channel;

if (!voiceChannel) {
    await message.reply(
      'Masuk ke voice channel terlebih dahulu untuk memutar lagu.'
    );
    return null;
  }

  let session = getSession(message.guild.id);

if (session && session.connection.joinConfig.channelId !== voiceChannel.id) {
    await message.reply('Bot sedang berada di voice channel lain.');
    return null;
  }

if (!session) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

const player = createAudioPlayer();
    connection.subscribe(player);

session = {
      connection,
      player,
      queue: [],
      ffmpeg: null,
      sleepTimer: null,
      textChannel: message.channel,
      closing: false,
    };

    sessions.set(message.guild.id, session);

player.on(AudioPlayerStatus.Idle, () => {
      if (session.closing) return;

      killAudio(session);

if (session.queue.length) {
        playNext(message.guild.id);
      } else {
        scheduleSleep(message.guild.id);
      }
    });

player.on('error', error => {
      console.error('[Player]', error.message);
      killAudio(session);
    });

connection.on('error', error => {
      console.error('[Voice]', error.message);
    });

connection.on(VoiceConnectionStatus.Disconnected, () => {
      destroySession(message.guild.id, false);
    });
  }

session.textChannel = message.channel;
  refreshSleep(message.guild.id);

try {
    await entersState(
      session.connection,
      VoiceConnectionStatus.Ready,
      20000
    );
  } catch {
    destroySession(message.guild.id, false);
    await message.reply('Gagal terhubung ke voice channel.');
    return null;
  }

return session;
}

async function enqueue(message, track) {
  const session = await ensureSession(message);
  if (!session) return false;

if (session.queue.length >= maxQueue) {
    await message.reply(`Antrean penuh, maksimal ${maxQueue} lagu.`);
    return false;
}

  session.queue.push(track);

if (session.player.state.status === AudioPlayerStatus.Idle) {
playNext(message.guild.id);
} else {
    await message.reply(`➕ **${track.name}** — ${track.artist_name} ditambahkan ke antrean.`);
}

refreshSleep(message.guild.id);
  return true;
}

function skip(guildId) {
  const session = getSession(guildId);
  if (!session) return false;

if (session.player.state.status === AudioPlayerStatus.Idle) {
    return false;
  }

killAudio(session);
  session.player.stop(true);
  return true;
}

function stop(guildId) {
  const session = getSession(guildId);
  if (!session) return false;

session.queue.length = 0;
  killAudio(session);
  session.player.stop(true);
  scheduleSleep(guildId);

return true;
}

function pause(guildId) {
  return getSession(guildId)?.player.pause() ?? false;
}

function resume(guildId) {
  return getSession(guildId)?.player.unpause() ?? false;
}

function handleVoiceState(oldState, newState) {
  const guildId = oldState.guild.id;
  const session = getSession(guildId);
  if (!session) return;

  const channelId = session.connection.joinConfig.channelId;

const channel =
    oldState.channelId === channelId
      ? oldState.channel
      : newState.channelId === channelId
        ? newState.channel
        : null;

  if (!channel) return;

const humansPresent = channel.members.some(
    member => !member.user.bot
  );

if (!humansPresent) {
    destroySession(guildId, false);
  }
}

module.exports = {
  enqueue,
  getSession,
  refreshSleep,
  pause,
  resume,
  skip,
  stop,
  handleVoiceState,
};
