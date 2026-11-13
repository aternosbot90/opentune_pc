/**
 * LRCLIB synced lyrics service
 */

function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\](.*)/;

  for (const line of lines) {
    const match = timeRegex.exec(line.trim());
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0, 3), 10) : 0;
      const totalSeconds = minutes * 60 + seconds + ms / 1000;
      const text = match[4].trim();
      if (text) {
        result.push({ time: totalSeconds, text });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

async function getLyrics(trackName, artistName, durationSec) {
  try {
    const cleanTrack = (trackName || '').replace(/\(.*?\)|\[.*?\]|feat\..*|ft\..*/gi, '').trim();
    const cleanArtist = (artistName || '')
      .replace(/\s*[-–—]\s*topic\b/gi, '')
      .replace(/\s*\(topic\)\s*/gi, '')
      .replace(/,.*|&.*/gi, '')
      .trim();

    // 1. Try exact get
    const query = new URLSearchParams({
      track_name: cleanTrack,
      artist_name: cleanArtist
    });
    if (durationSec && Number(durationSec) > 0) {
      query.set('duration', Math.round(Number(durationSec)));
    }

    let res = await fetch(`https://lrclib.net/api/get?${query.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics || data.plainLyrics) {
        return {
          synced: parseLrc(data.syncedLyrics),
          plain: data.plainLyrics || data.syncedLyrics.replace(/\[\d{2}:\d{2}\.?\d*\]/g, '').trim(),
          source: 'LRCLIB'
        };
      }
    }

    // 2. Fallback search
    const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTrack + ' ' + cleanArtist)}`);
    if (searchRes.ok) {
      const items = await searchRes.json();
      if (Array.isArray(items) && items.length > 0) {
        const item = items[0];
        return {
          synced: parseLrc(item.syncedLyrics),
          plain: item.plainLyrics || (item.syncedLyrics ? item.syncedLyrics.replace(/\[\d{2}:\d{2}\.?\d*\]/g, '').trim() : ''),
          source: 'LRCLIB'
        };
      }
    }
  } catch (err) {
    console.warn('Lyrics fetch warning:', err.message);
  }

  return { synced: [], plain: '', source: null };
}

async function searchLyrics(query) {
  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const items = await res.json();
      if (Array.isArray(items)) {
        return items.map(item => ({
          id: item.id,
          trackName: item.trackName || '',
          artistName: item.artistName || '',
          albumName: item.albumName || '',
          duration: item.duration || 0,
          hasSynced: !!item.syncedLyrics,
          syncedLyrics: item.syncedLyrics || '',
          plainLyrics: item.plainLyrics || (item.syncedLyrics ? item.syncedLyrics.replace(/\[\d{2}:\d{2}\.?\d*\]/g, '').trim() : '')
        }));
      }
    }
  } catch (err) {
    console.warn('Lyrics search error:', err.message);
  }
  return [];
}

module.exports = {
  getLyrics,
  searchLyrics,
  parseLrc
};

