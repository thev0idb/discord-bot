const { jamendoClientId } = require('../config');

async function searchTracks(query) {
  const params = new URLSearchParams({
    client_id: jamendoClientId,
    format: 'json',
    limit: '10',
    search: query,
    audioformat: 'mp31',
    type: 'single albumtrack',
  });

const url =
https://api.jamendo.com/v3.0/tracks/?$DIL0;

const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

if (!response.ok) {
throw new Error(Jamendo API HTTP $DIL0);
}

  const data = await response.json();

if (data.headers?.status !== 'success') {
    throw new Error(
      data.headers?.error_message || 'Jamendo API gagal'
    );
  }

return (data.results || []).filter(track =>
typeof track.audio === 'string' &&
track.audio.startsWith('https://') &&
track.name &&
track.artist_name
);
}

module.exports = { searchTracks };