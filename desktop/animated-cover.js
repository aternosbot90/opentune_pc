// Resolves looping H.264 MP4 animated album covers from Apple Music motion artwork.

const resolvedCoverCache = new Map();
const inflightLookups = new Map();

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

function cleanQueryText(raw = '') {
  return String(raw || '')
    .replace(/\((?:official|lyric|audio|music|hd|4k|explicit|remaster(?:ed)?|feat\.?[^)]*|ft\.?[^)]*)[^)]*\)/gi, '')
    .replace(/\[(?:official|lyric|audio|music|hd|4k|explicit|remaster(?:ed)?)[^\]]*\]/gi, '')
    .replace(/\b(?:feat\.?|ft\.?)\s+[^-|/]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function primaryArtistName(artist = '') {
  return cleanQueryText(String(artist || '').split(/,|&|•|\bx\b/i)[0] || '');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pickBestItunesHit(results, cleanTitle, cleanArtist, cleanAlbum) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const targetArtist = cleanArtist.toLowerCase();
  const targetAlbum = cleanAlbum.toLowerCase();
  const targetTitle = cleanTitle.toLowerCase();

  let best = null;
  let bestScore = -1;

  for (const item of results) {
    if (!item?.collectionViewUrl) continue;
    let score = 0;
    const itemArtist = String(item.artistName || '').toLowerCase();
    const itemAlbum = String(item.collectionName || '').toLowerCase();
    const itemTrack = String(item.trackName || '').toLowerCase();

    if (targetArtist && (itemArtist.includes(targetArtist) || targetArtist.includes(itemArtist))) {
      score += 4;
    }
    if (targetAlbum && targetAlbum !== 'single' && (itemAlbum.includes(targetAlbum) || targetAlbum.includes(itemAlbum))) {
      score += 3;
    }
    if (targetTitle && (itemTrack.includes(targetTitle) || itemAlbum.includes(targetTitle))) {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore > 0 ? best : results.find(r => r?.collectionViewUrl) || null;
}

function extractMasterM3u8FromHtml(html = '') {
  if (!html) return null;
  // Prefer motionDetailSquare / motionSquareVideo1x1 editorialVideo blocks
  const squareBlock = html.match(/"motion(?:DetailSquare|SquareVideo1x1)"\s*:\s*\{[^}]*"video"\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/i);
  if (squareBlock?.[1]) {
    return squareBlock[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
  }
  const anyMvod = html.match(/https:\/\/mvod\.itunes\.apple\.com\/[^"'\\\s]+\.m3u8[^"'\\\s]*/i);
  return anyMvod ? anyMvod[0] : null;
}

function pickSquareAvcVariant(masterPlaylistText = '', masterUrl = '') {
  const lines = masterPlaylistText.split(/\r?\n/);
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const nextUri = (lines[i + 1] || '').trim();
    if (!nextUri || nextUri.startsWith('#') || nextUri.includes('iframes')) continue;

    const codecsMatch = line.match(/CODECS="([^"]+)"/i);
    const codecs = codecsMatch ? codecsMatch[1] : '';
    if (!/avc1/i.test(codecs)) continue; // H.264 plays natively in Chromium across all OSes

    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const w = resMatch ? parseInt(resMatch[1], 10) : 0;
    const h = resMatch ? parseInt(resMatch[2], 10) : 0;
    if (!w || Math.abs(w - h) > 16) continue; // Square 1:1 cover

    try {
      candidates.push({ width: w, url: new URL(nextUri, masterUrl).href });
    } catch (_) {}
  }

  if (candidates.length === 0) return null;
  // Prefer crisp 768x768 (or closest <= 1080x1080) to balance quality and fast download/startup
  const preferred = candidates
    .filter(c => c.width >= 480 && c.width <= 1080)
    .sort((a, b) => Math.abs(768 - a.width) - Math.abs(768 - b.width));
  if (preferred.length > 0) return preferred[0].url;

  candidates.sort((a, b) => b.width - a.width);
  return candidates[0].url;
}

async function resolveMp4FromMasterM3u8(masterUrl) {
  const masterRes = await fetchWithTimeout(masterUrl, { headers: HTTP_HEADERS }, 8000);
  if (!masterRes.ok) return null;
  const masterText = await masterRes.text();

  const variantUrl = pickSquareAvcVariant(masterText, masterUrl);
  if (!variantUrl) return null;

  const varRes = await fetchWithTimeout(variantUrl, { headers: HTTP_HEADERS }, 8000);
  if (!varRes.ok) return null;
  const varText = await varRes.text();

  const mp4Line = varText
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l && !l.startsWith('#') && /\.mp4(?:$|\?)/i.test(l));

  if (!mp4Line) return null;
  return new URL(mp4Line, variantUrl).href;
}

async function lookupAnimatedCoverUrl({ title = '', artist = '', album = '' } = {}) {
  const cleanTitle = cleanQueryText(title);
  const cleanArtist = primaryArtistName(artist);
  const cleanAlbum = cleanQueryText(album);
  if (!cleanTitle && !cleanAlbum) return null;

  const searches = [];
  if (cleanAlbum && cleanAlbum.toLowerCase() !== 'single') {
    searches.push({ term: `${cleanArtist} ${cleanAlbum}`.trim(), entity: 'album' });
  }
  searches.push({ term: `${cleanArtist} ${cleanTitle}`.trim(), entity: 'song' });
  if (!cleanAlbum || cleanAlbum.toLowerCase() === 'single') {
    searches.push({ term: `${cleanArtist} ${cleanTitle}`.trim(), entity: 'album' });
  }

  for (const q of searches) {
    if (!q.term) continue;
    try {
      const apiUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q.term)}&entity=${q.entity}&limit=4`;
      const res = await fetchWithTimeout(apiUrl, { headers: HTTP_HEADERS }, 7000);
      if (!res.ok) continue;
      const json = await res.json();
      const hit = pickBestItunesHit(json?.results, cleanTitle, cleanArtist, cleanAlbum);
      if (!hit?.collectionViewUrl) continue;

      const pageRes = await fetchWithTimeout(hit.collectionViewUrl, { headers: HTTP_HEADERS }, 9000);
      if (!pageRes.ok) continue;
      const html = await pageRes.text();
      const masterM3u8 = extractMasterM3u8FromHtml(html);
      if (!masterM3u8) continue;

      const mp4Url = await resolveMp4FromMasterM3u8(masterM3u8);
      if (mp4Url) return mp4Url;
    } catch (_) {}
  }

  return null;
}

async function resolveAnimatedCoverUrl(track = {}) {
  const title = String(track?.title || '').trim();
  const artist = String(track?.artist || '').trim();
  const album = String(track?.album || '').trim();
  const cacheKey = `${cleanQueryText(artist).toLowerCase()}|${cleanQueryText(album).toLowerCase()}|${cleanQueryText(title).toLowerCase()}`;
  if (!title && !album) return null;

  if (resolvedCoverCache.has(cacheKey)) {
    return resolvedCoverCache.get(cacheKey);
  }
  if (inflightLookups.has(cacheKey)) {
    return await inflightLookups.get(cacheKey);
  }

  const task = lookupAnimatedCoverUrl({ title, artist, album })
    .then((url) => {
      resolvedCoverCache.set(cacheKey, url || null);
      if (resolvedCoverCache.size > 400) {
        const firstKey = resolvedCoverCache.keys().next().value;
        resolvedCoverCache.delete(firstKey);
      }
      return url || null;
    })
    .catch(() => null)
    .finally(() => {
      inflightLookups.delete(cacheKey);
    });

  inflightLookups.set(cacheKey, task);
  return await task;
}

module.exports = {
  resolveAnimatedCoverUrl
};

