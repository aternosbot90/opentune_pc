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

function formatLrc(syncedLines) {
  if (!Array.isArray(syncedLines) || syncedLines.length === 0) return '';
  return syncedLines.map(line => {
    const totalSec = Math.max(0, Number(line.time) || 0);
    const min = Math.floor(totalSec / 60);
    const sec = Math.floor(totalSec % 60);
    const ms = Math.floor((totalSec % 1) * 100);
    const mm = String(min).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    const xx = String(ms).padStart(2, '0');
    return `[${mm}:${ss}.${xx}]${line.text || ''}`;
  }).join('\n');
}

function sanitizeArtist(artistName) {
  if (!artistName || typeof artistName !== 'string') return '';
  return artistName
    .replace(/\s*[-–—:]\s*topic\b/gi, '')
    .replace(/\s*\(topic\)\s*/gi, '')
    .replace(/\bTopic\b/gi, '')
    .replace(/\s+official(?:\s+channel)?\b/gi, '')
    .replace(/\s+records\b/gi, '')
    .replace(/(?:Official|Music|VEVO)$/i, '')
    .replace(/\s+(?:VEVO|Official|Music)\b/gi, '')
    .replace(/,.*|&.*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeTrack(trackName) {
  if (!trackName || typeof trackName !== 'string') return '';
  return trackName
    .replace(/\(.*?\)|\[.*?\]/gi, '')
    .replace(/\s*[-–—]\s*(?:official\s*(?:video|audio|music\s*video)|lyrics?|visualizer|remaster(?:ed)?)\b/gi, '')
    .replace(/\b(?:feat|ft)\b\.?.*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isTrackTitleMatch(queryTitle, candidateTitle) {
  if (!queryTitle || !candidateTitle) return false;
  const q = String(queryTitle).toLowerCase().replace(/[^a-z0-9]/g, '');
  const c = String(candidateTitle).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!q || !c) return false;
  return q.includes(c) || c.includes(q);
}

async function getLyrics(trackName, artistName, durationSec) {
  try {
    const cleanTrack = sanitizeTrack(trackName) || (trackName || '').trim();
    const cleanArtist = sanitizeArtist(artistName) || (artistName || '').trim();

    // 1. Try exact get with sanitized track & artist
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

    // 2. Try search with clean track and clean artist
    const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTrack + ' ' + cleanArtist)}`);
    if (searchRes.ok) {
      const items = await searchRes.json();
      if (Array.isArray(items) && items.length > 0) {
        // Enforce title similarity so unrelated tracks are never returned
        const matching = items.filter(it => isTrackTitleMatch(cleanTrack, it.trackName));
        if (matching.length > 0) {
          let bestItem = matching.find(it => it.syncedLyrics && durationSec && Math.abs((it.duration || 0) - durationSec) <= 6);
          if (!bestItem) bestItem = matching.find(it => it.syncedLyrics) || matching[0];

          if (bestItem && (bestItem.syncedLyrics || bestItem.plainLyrics)) {
            return {
              synced: parseLrc(bestItem.syncedLyrics),
              plain: bestItem.plainLyrics || (bestItem.syncedLyrics ? bestItem.syncedLyrics.replace(/\[\d{2}:\d{2}\.?\d*\]/g, '').trim() : ''),
              source: 'LRCLIB'
            };
          }
        }
      }
    }

    // 3. Fallback search with track title only if artist was complex
    if (cleanTrack) {
      const trackSearchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTrack)}`);
      if (trackSearchRes.ok) {
        const items = await trackSearchRes.json();
        if (Array.isArray(items) && items.length > 0) {
          const matching = items.filter(it => isTrackTitleMatch(cleanTrack, it.trackName));
          if (matching.length > 0) {
            let bestItem = matching.find(it => it.syncedLyrics && durationSec && Math.abs((it.duration || 0) - durationSec) <= 4);
            if (!bestItem) bestItem = matching.find(it => it.syncedLyrics);
            if (bestItem && (bestItem.syncedLyrics || bestItem.plainLyrics)) {
              return {
                synced: parseLrc(bestItem.syncedLyrics),
                plain: bestItem.plainLyrics || (bestItem.syncedLyrics ? bestItem.syncedLyrics.replace(/\[\d{2}:\d{2}\.?\d*\]/g, '').trim() : ''),
                source: 'LRCLIB'
              };
            }
          }
        }
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
  parseLrc,
  formatLrc
};

