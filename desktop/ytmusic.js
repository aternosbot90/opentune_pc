const { Innertube, UniversalCache } = require('youtubei.js');
const fs = require('fs');
const path = require('path');

let ytInstance = null;
let guestInstance = null;
let currentCookie = '';

function getSessionFilePath() {
  let userDataDir = path.join(__dirname, '.session');
  try {
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      userDataDir = electron.app.getPath('userData');
    }
  } catch (_) {}

  if (!fs.existsSync(userDataDir)) {
    try { fs.mkdirSync(userDataDir, { recursive: true }); } catch (_) {}
  }
  return path.join(userDataDir, 'youtube_session.json');
}

function loadSavedSession() {
  try {
    const file = getSessionFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        cookie: data.cookie || '',
        credentials: data.credentials || null,
        profile: data.profile || null
      };
    }
  } catch (e) {
    console.error('Error loading session file:', e.message);
  }
  return { cookie: '', credentials: null, profile: null };
}

function saveSession({ cookie = '', credentials = null, profile = null } = {}) {
  try {
    const file = getSessionFilePath();
    const existing = loadSavedSession();
    const data = {
      cookie: cookie || existing.cookie || '',
      credentials: credentials || existing.credentials || null,
      profile: profile || existing.profile || null,
      updatedAt: Date.now()
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving session file:', e.message);
  }
}

function clearSavedSession() {
  try {
    const file = getSessionFilePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (e) {
    console.error('Error clearing session:', e.message);
  }
}

async function getGuestInnertube() {
  if (!guestInstance) {
    guestInstance = await Innertube.create({
      cache: new UniversalCache(false)
    });
  }
  return guestInstance;
}

async function getInnertube(cookie = null) {
  if (cookie !== null) {
    currentCookie = cookie;
    saveSession({ cookie: currentCookie, credentials: null });
    ytInstance = await Innertube.create({
      cookie: currentCookie,
      cache: new UniversalCache(false)
    });
    return ytInstance;
  }

  if (!ytInstance) {
    const saved = loadSavedSession();

    if (saved.cookie) {
      currentCookie = saved.cookie;
      try {
        ytInstance = await Innertube.create({
          cookie: currentCookie,
          cache: new UniversalCache(false)
        });
        return ytInstance;
      } catch (err) {
        console.warn('Could not restore saved cookie session:', err.message);
      }
    }

    if (saved.credentials) {
      try {
        ytInstance = await Innertube.create({
          cache: new UniversalCache(false)
        });
        ytInstance.session.on('update-credentials', ({ credentials }) => {
          if (credentials) saveSession({ credentials });
        });
        try {
          await ytInstance.session.signIn(saved.credentials);
        } catch (_) {
          await ytInstance.session.oauth.init(saved.credentials);
        }
        return ytInstance;
      } catch (err) {
        console.warn('Could not restore saved oauth session:', err.message);
      }
    }

    // Default guest instance
    ytInstance = await getGuestInnertube();
  }

  return ytInstance;
}

// Resilient wrapper: if an action fails due to 400/auth error or requests guest fallback, fall back to guest client
async function executeMusicAction(fn) {
  try {
    const yt = await getInnertube();
    const isGuest = !yt.session?.logged_in;
    return await fn(yt, isGuest);
  } catch (err) {
    const infoStr = err && err.info
      ? (typeof err.info === 'string' ? err.info : (err.info.message || err.info.status || ''))
      : '';
    const msgStr = typeof err?.message === 'string' ? err.message : '';
    const shouldFallback = Boolean(err && (
      err.isFallbackToGuest ||
      err.status === 400 ||
      err.status === 401 ||
      err.status === 403 ||
      /400|401|403|INVALID_ARGUMENT|UNAUTHENTICATED|FAILED_PRECONDITION|PERMISSION_DENIED/.test(msgStr) ||
      /INVALID_ARGUMENT|UNAUTHENTICATED|FAILED_PRECONDITION|PERMISSION_DENIED/.test(String(infoStr))
    ));
    if (shouldFallback) {
      console.warn('Authenticated music request failed or returned empty. Falling back to guest client...');
      const guest = await getGuestInnertube();
      return await fn(guest, true);
    }
    throw err;
  }
}

// Google RFC 8628 Device Authorization Flow (for account pairing)
let activeAuthAbort = null;

async function startDeviceAuth(onPending) {
  if (activeAuthAbort) {
    activeAuthAbort();
    activeAuthAbort = null;
  }

  const yt = await Innertube.create({
    cache: new UniversalCache(false)
  });

  return new Promise((resolve, reject) => {
    let isSettled = false;

    const cleanup = () => {
      yt.session.removeAllListeners('auth-pending');
      yt.session.removeAllListeners('auth');
      yt.session.removeAllListeners('auth-error');
      activeAuthAbort = null;
    };

    activeAuthAbort = () => {
      if (!isSettled) {
        isSettled = true;
        cleanup();
        reject(new Error('Google sign-in was cancelled by user.'));
      }
    };

    yt.session.on('auth-pending', (data) => {
      if (!isSettled && typeof onPending === 'function') {
        onPending(data);
      }
    });

    yt.session.once('auth', async ({ credentials }) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      ytInstance = yt;
      ytInstance.session.on('update-credentials', ({ credentials: nextCreds }) => {
        if (nextCreds) saveSession({ credentials: nextCreds });
      });

      currentCookie = '';
      let profile = {
        isLoggedIn: true,
        name: 'Connected Google User',
        email: '',
        avatar: 'assets/icon.png'
      };

      try {
        const info = await yt.account.getInfo();
        if (info && (info.name || info.email)) {
          profile.name = info.name || profile.name;
          profile.email = info.email || '';
          if (info.thumbnails?.[0]?.url) profile.avatar = info.thumbnails[0].url;
        }
      } catch (_) {}

      saveSession({ credentials, profile });
      resolve({ success: true, profile });
    });

    yt.session.once('auth-error', (err) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(err);
    });

    yt.session.signIn().catch((err) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(err);
    });
  });
}

function cancelDeviceAuth() {
  if (activeAuthAbort) {
    activeAuthAbort();
    activeAuthAbort = null;
  }
}

async function signOut() {
  clearSavedSession();
  if (ytInstance?.session?.logged_in) {
    try {
      await ytInstance.session.oauth?.revokeCredentials?.();
    } catch (_) {}
  }
  currentCookie = '';
  ytInstance = await getGuestInnertube();
  return { success: true };
}

// High-Resolution Cover Art Helper
function upgradeThumbnail(url, size = 544) {
  if (!url || typeof url !== 'string') return 'assets/icon.png';
  let clean = url.trim();
  if (clean.startsWith('//')) clean = 'https:' + clean;

  // Google CDN (YouTube Music album artwork & artist avatars)
  if (clean.includes('googleusercontent.com') || clean.includes('ggpht.com')) {
    clean = clean
      .replace(/=w\d+-h\d+[^?#]*/, `=w${size}-h${size}-l90-rj`)
      .replace(/=s\d+[^?#]*/, `=s${size}-c`);
    return clean;
  }

  // YouTube video thumbnails
  if (clean.includes('i.ytimg.com')) {
    clean = clean.replace(/\/(default|mqdefault)\.jpg/, '/hqdefault.jpg');
    return clean;
  }

  return clean;
}

// Format helpers
function extractBrowseIdByType(runs, pageTypeMatch, prefixMatch) {
  if (!Array.isArray(runs)) return '';
  for (const run of runs) {
    const browseId = run?.endpoint?.payload?.browseId || '';
    const pageType = run?.endpoint?.payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
    if (browseId && ((pageTypeMatch && pageType.includes(pageTypeMatch)) || (prefixMatch && browseId.startsWith(prefixMatch)))) {
      return browseId;
    }
  }
  return '';
}

function extractThumbnailUrl(item, fallbackId = '') {
  let thumbnail = '';
  if (Array.isArray(item?.thumbnails) && item.thumbnails.length > 0) {
    thumbnail = item.thumbnails[item.thumbnails.length - 1].url;
  } else if (Array.isArray(item?.thumbnail) && item.thumbnail.length > 0) {
    thumbnail = item.thumbnail[item.thumbnail.length - 1].url;
  } else if (Array.isArray(item?.thumbnail?.contents) && item.thumbnail.contents.length > 0) {
    thumbnail = item.thumbnail.contents[item.thumbnail.contents.length - 1].url;
  } else if (Array.isArray(item?.content_image?.image?.sources) && item.content_image.image.sources.length > 0) {
    thumbnail = item.content_image.image.sources[item.content_image.image.sources.length - 1].url;
  } else if (fallbackId) {
    thumbnail = `https://i.ytimg.com/vi/${fallbackId}/hqdefault.jpg`;
  }
  return upgradeThumbnail(thumbnail, 544);
}

function formatSongItem(item, defaultAlbum = '') {
  if (!item) return null;
  const id = item.id || item.videoId || item.video_id || item.content_id || item.endpoint?.payload?.videoId;
  if (!id) return null;

  let title = item.title?.text || (typeof item.title === 'string' ? item.title : '') || item.metadata?.title?.text || 'Unknown Title';
  if (typeof title !== 'string') title = String(title);

  let artists = [];
  const artistLinks = [];
  const pushArtist = (name, channelId = '') => {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName || cleanName === '•' || cleanName === ',' || cleanName === '&') return;
    if (!artists.includes(cleanName)) artists.push(cleanName);
    if (!artistLinks.some(a => a.name === cleanName)) {
      artistLinks.push({ name: cleanName, id: channelId || '' });
    }
  };

  if (Array.isArray(item.artists) && item.artists.length > 0) {
    for (const a of item.artists) {
      pushArtist(a.name || a.text || '', a.channel_id || a.id || a.endpoint?.payload?.browseId || '');
    }
  } else if (Array.isArray(item.authors) && item.authors.length > 0) {
    for (const a of item.authors) {
      pushArtist(a.name || a.text || '', a.channel_id || a.id || a.endpoint?.payload?.browseId || '');
    }
  } else if (item.author) {
    pushArtist(
      item.author.name || item.author.text || (typeof item.author === 'string' ? item.author : ''),
      item.author.channel_id || item.author.id || item.author.endpoint?.payload?.browseId || ''
    );
  } else if (item.artists_description) {
    pushArtist(item.artists_description, '');
  }

  let album = item.album?.name || item.album?.text || (typeof item.album === 'string' ? item.album : '') || defaultAlbum || '';
  if (typeof album !== 'string') album = String(album?.text || album?.name || '');
  let albumId = item.album?.id || item.album?.browseId || item.album?.endpoint?.payload?.browseId || '';
  let year = item.year?.text || (typeof item.year === 'string' ? item.year : '') || '';

  if (Array.isArray(item.flex_columns)) {
    for (let c = 1; c < item.flex_columns.length; c++) {
      const colTitle = item.flex_columns[c]?.title;
      const runs = colTitle?.runs || [];
      if (artistLinks.length === 0 && runs.length > 0) {
        for (const r of runs) {
          const rBrowse = r?.endpoint?.payload?.browseId || '';
          const rPageType = r?.endpoint?.payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
          if (rBrowse && (rPageType.includes('ARTIST') || rBrowse.startsWith('UC'))) {
            pushArtist(r.text || '', rBrowse);
          }
        }
      }
      if (!albumId && runs.length > 0) {
        const albRun = runs.find(r => {
          const b = r?.endpoint?.payload?.browseId || '';
          const pt = r?.endpoint?.payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
          return b && (pt.includes('ALBUM') || b.startsWith('MPRE'));
        });
        if (albRun) {
          albumId = albRun.endpoint.payload.browseId;
          if (!album && albRun.text) album = albRun.text.trim();
        }
      }
      if (artists.length === 0 && colTitle?.text) {
        const subtitleParts = colTitle.text.split('•').map(s => s.trim()).filter(Boolean);
        if (subtitleParts.length > 0) pushArtist(subtitleParts[0], extractBrowseIdByType(runs, 'ARTIST', 'UC'));
      }
      if (!year && colTitle?.text) {
        const yMatch = colTitle.text.match(/\b(19\d{2}|20\d{2})\b/);
        if (yMatch) year = yMatch[1];
      }
    }
  }

  // Fallback menu browse endpoints for artist/album if still missing
  if (Array.isArray(item.menu?.items)) {
    for (const mi of item.menu.items) {
      const bId = mi?.endpoint?.payload?.browseId || '';
      if (!bId) continue;
      const pt = mi?.endpoint?.payload?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
      if ((pt.includes('ALBUM') || bId.startsWith('MPRE')) && !albumId) {
        albumId = bId;
      } else if ((pt.includes('ARTIST') || bId.startsWith('UC')) && artistLinks.length > 0 && !artistLinks[0].id) {
        artistLinks[0].id = bId;
      }
    }
  }

  if (artists.length === 0 && Array.isArray(item.metadata?.metadata?.metadata_rows)) {
    const metaArtist = item.metadata.metadata.metadata_rows[0]?.metadata_parts?.[0]?.text;
    if (metaArtist) pushArtist(metaArtist, '');
  }

  const artist = artists.filter(Boolean).join(', ') || 'Unknown Artist';
  const primaryArtistId = artistLinks.find(a => a.id)?.id || '';
  let duration = item.duration?.text || (typeof item.duration === 'string' ? item.duration : '') || '';
  if (typeof item.duration === 'object' && item.duration?.text) duration = item.duration.text;
  if (!duration && Array.isArray(item.flex_columns)) {
    for (const fc of item.flex_columns) {
      const txt = fc?.title?.text || '';
      const dMatch = txt.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
      if (dMatch) {
        duration = dMatch[1];
        break;
      }
    }
  }

  const thumbnail = extractThumbnailUrl(item, id);

  return {
    id,
    title,
    artist,
    artists,
    artistId: primaryArtistId || undefined,
    artistLinks: artistLinks.length > 0 ? artistLinks : undefined,
    album,
    albumId: albumId || undefined,
    year: year || undefined,
    duration,
    thumbnail
  };
}

function formatAlbumItem(item) {
  if (!item) return null;
  const id = item.id || item.browseId || item.browse_id || item.endpoint?.payload?.browseId || item.on_tap?.payload?.browseId;
  if (!id) return null;

  let title = item.title?.text || (typeof item.title === 'string' ? item.title : '') || 'Untitled Album';
  if (typeof title !== 'string') title = String(title);

  let artist = '';
  let artistId = '';
  let year = '';
  let releaseType = '';

  if (Array.isArray(item.artists) && item.artists.length > 0) {
    artist = item.artists.map(a => a.name || a.text || '').filter(Boolean).join(', ');
    artistId = item.artists.find(a => a.channel_id || a.id)?.channel_id || item.artists.find(a => a.id)?.id || '';
  } else if (item.author?.name) {
    artist = item.author.name;
    artistId = item.author.channel_id || item.author.id || '';
  } else if (item.flex_columns && item.flex_columns[1]?.title?.text) {
    const runs = item.flex_columns[1]?.title?.runs || [];
    artistId = extractBrowseIdByType(runs, 'ARTIST', 'UC');
    const parts = item.flex_columns[1].title.text.split('•').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (/^(Album|Single|EP)$/i.test(part)) releaseType = part;
      else if (/^(19\d{2}|20\d{2})$/.test(part)) year = part;
      else if (!artist) artist = part;
    }
  } else if (item.subtitle?.text) {
    const runs = item.subtitle?.runs || [];
    artistId = extractBrowseIdByType(runs, 'ARTIST', 'UC');
    const parts = item.subtitle.text.split('•').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (/^(Album|Single|EP)$/i.test(part)) releaseType = part;
      else if (/^(19\d{2}|20\d{2})$/.test(part)) year = part;
      else if (!artist) artist = part;
    }
  }

  if (!year && item.year?.text) year = item.year.text;
  const thumbnail = extractThumbnailUrl(item) || 'assets/icon.png';

  return {
    id,
    title,
    artist: artist || releaseType || 'Album',
    artistId: artistId || undefined,
    year: year || '',
    releaseType: releaseType || undefined,
    thumbnail
  };
}

function formatPlaylistItem(item) {
  if (!item) return null;
  const id = item.id || item.playlistId || item.playlist_id || item.endpoint?.payload?.browseId;
  if (!id) return null;

  let title = item.title?.text || (typeof item.title === 'string' ? item.title : '') || 'Untitled Playlist';
  if (typeof title !== 'string') title = String(title);

  let author = item.author?.name || item.authors?.[0]?.name || '';
  let itemCount = item.item_count?.text || item.itemCount || '';

  if (item.flex_columns && item.flex_columns[1]?.title?.text) {
    const parts = item.flex_columns[1].title.text.split('•').map(p => p.trim()).filter(Boolean);
    if (parts.length > 0 && !author) author = parts[0];
    if (parts.length > 1 && !itemCount) itemCount = parts[parts.length - 1];
  } else if (item.subtitle?.text) {
    const parts = item.subtitle.text.split('•').map(p => p.trim()).filter(Boolean);
    if (parts.length > 0 && !author) author = parts[0];
    if (parts.length > 1 && !itemCount) itemCount = parts[parts.length - 1];
  }

  const thumbnail = extractThumbnailUrl(item) || 'assets/icon.png';

  return {
    id,
    title,
    author: author || 'YouTube Music',
    itemCount: itemCount || '',
    thumbnail
  };
}

function formatArtistItem(item) {
  if (!item) return null;
  const id = item.id || item.channelId || item.channel_id || item.endpoint?.payload?.browseId;
  if (!id) return null;

  let name = item.name || item.title?.text || (typeof item.title === 'string' ? item.title : '') || 'Artist';
  if (typeof name !== 'string') name = String(name);

  let subscribers = item.subscribers?.text || '';
  if (!subscribers && item.flex_columns && item.flex_columns[1]?.title?.text) {
    subscribers = item.flex_columns[1].title.text;
  } else if (!subscribers && item.subtitle?.text) {
    subscribers = item.subtitle.text;
  }

  const thumbnail = extractThumbnailUrl(item) || 'assets/icon.png';

  return {
    id,
    name,
    subscribers,
    thumbnail
  };
}

function appendUntypedSearchBuckets(results, buckets) {
  if (!results) return;
  const pushSongs = (arr) => {
    for (const s of (arr || [])) {
      const item = formatSongItem(s);
      if (item && !buckets.songs.some(x => x.id === item.id)) buckets.songs.push(item);
    }
  };
  const pushAlbums = (arr) => {
    for (const a of (arr || [])) {
      const item = formatAlbumItem(a);
      if (item && !buckets.albums.some(x => x.id === item.id)) buckets.albums.push(item);
    }
  };
  const pushArtists = (arr) => {
    for (const ar of (arr || [])) {
      const item = formatArtistItem(ar);
      if (item && !buckets.artists.some(x => x.id === item.id)) buckets.artists.push(item);
    }
  };
  const pushPlaylists = (arr) => {
    for (const p of (arr || [])) {
      const item = formatPlaylistItem(p);
      if (item && !buckets.playlists.some(x => x.id === item.id)) buckets.playlists.push(item);
    }
  };

  if (results.songs?.contents) pushSongs(results.songs.contents);
  if (results.videos?.contents) pushSongs(results.videos.contents);
  if (results.albums?.contents) pushAlbums(results.albums.contents);
  if (results.artists?.contents) pushArtists(results.artists.contents);
  if (results.playlists?.contents) pushPlaylists(results.playlists.contents);

  const shelves = results.results || results.contents || [];
  for (const shelf of shelves) {
    const titleLower = (shelf?.title?.text || shelf?.header?.title?.text || '').toLowerCase();
    const items = shelf?.contents || [];
    if (shelf?.type === 'MusicCardShelf') {
      const tapPayload = shelf.on_tap?.payload || {};
      if (tapPayload.videoId) {
        const song = formatSongItem({
          id: tapPayload.videoId,
          title: shelf.title?.text,
          author: shelf.subtitle?.runs?.[2]?.text || shelf.subtitle?.runs?.[0]?.text || 'Various',
          thumbnail: shelf.thumbnail?.contents?.[0],
          duration: shelf.subtitle?.runs?.[shelf.subtitle.runs.length - 1]?.text
        });
        if (song && !buckets.songs.some(x => x.id === song.id)) buckets.songs.unshift(song);
      } else if (tapPayload.browseId) {
        const bid = String(tapPayload.browseId);
        if (bid.startsWith('UC') || titleLower.includes('artist')) {
          const ar = formatArtistItem(shelf);
          if (ar && !buckets.artists.some(x => x.id === ar.id)) buckets.artists.unshift(ar);
        } else if (bid.startsWith('MPRE')) {
          const al = formatAlbumItem(shelf);
          if (al && !buckets.albums.some(x => x.id === al.id)) buckets.albums.unshift(al);
        }
      }
      continue;
    }
    if (!items.length) continue;
    if (titleLower.includes('song') || titleLower.includes('video')) pushSongs(items);
    else if (titleLower.includes('album')) pushAlbums(items);
    else if (titleLower.includes('artist')) pushArtists(items);
    else if (titleLower.includes('playlist')) pushPlaylists(items);
  }
}

// Search with complete category filters (Songs, Albums, Artists, Playlists, All)
async function search(query, filter = 'song') {
  return executeMusicAction(async (yt, isGuest = false) => {
    if (filter === 'all') {
      const [songsRes, albumsRes, artistsRes, playlistsRes] = await Promise.allSettled([
        yt.music.search(query, { type: 'song' }),
        yt.music.search(query, { type: 'album' }),
        yt.music.search(query, { type: 'artist' }),
        yt.music.search(query, { type: 'playlist' })
      ]);

      const settled = [songsRes, albumsRes, artistsRes, playlistsRes];
      const allRejected = settled.every(r => r.status === 'rejected');
      if (allRejected) {
        const firstErr = settled[0].reason || new Error('Search requests failed');
        if (!isGuest) firstErr.isFallbackToGuest = true;
        throw firstErr;
      }

      const buckets = { songs: [], albums: [], artists: [], playlists: [] };

      if (songsRes.status === 'fulfilled') {
        const rawSongs = songsRes.value.songs?.contents || songsRes.value.contents || songsRes.value.results || [];
        for (const s of rawSongs) {
          const item = formatSongItem(s);
          if (item && !buckets.songs.some(x => x.id === item.id)) buckets.songs.push(item);
        }
      }

      if (albumsRes.status === 'fulfilled') {
        const rawAlbums = albumsRes.value.albums?.contents || albumsRes.value.contents || albumsRes.value.results || [];
        for (const a of rawAlbums) {
          const item = formatAlbumItem(a);
          if (item && !buckets.albums.some(x => x.id === item.id)) buckets.albums.push(item);
        }
      }

      if (artistsRes.status === 'fulfilled') {
        const rawArtists = artistsRes.value.artists?.contents || artistsRes.value.contents || artistsRes.value.results || [];
        for (const ar of rawArtists) {
          const item = formatArtistItem(ar);
          if (item && !buckets.artists.some(x => x.id === item.id)) buckets.artists.push(item);
        }
      }

      if (playlistsRes.status === 'fulfilled') {
        const rawPlaylists = playlistsRes.value.playlists?.contents || playlistsRes.value.contents || playlistsRes.value.results || [];
        for (const p of rawPlaylists) {
          const item = formatPlaylistItem(p);
          if (item && !buckets.playlists.some(x => x.id === item.id)) buckets.playlists.push(item);
        }
      }

      const anyRejected = settled.some(r => r.status === 'rejected');
      const totalCount = buckets.songs.length + buckets.albums.length + buckets.artists.length + buckets.playlists.length;

      // Resilient backup: untyped YTMusic search if typed queries yielded 0 in any bucket
      if (totalCount === 0 || (buckets.songs.length === 0 && buckets.artists.length === 0)) {
        try {
          const untyped = await yt.music.search(query);
          appendUntypedSearchBuckets(untyped, buckets);
        } catch {}
      }

      const finalTotal = buckets.songs.length + buckets.albums.length + buckets.artists.length + buckets.playlists.length;
      if (!isGuest && (finalTotal === 0 || (anyRejected && buckets.songs.length === 0))) {
        throw Object.assign(new Error('Authenticated All search incomplete; retrying with guest client'), {
          isFallbackToGuest: true
        });
      }

      return {
        type: 'all',
        songs: buckets.songs.slice(0, 15),
        albums: buckets.albums.slice(0, 10),
        artists: buckets.artists.slice(0, 10),
        playlists: buckets.playlists.slice(0, 10)
      };
    }

    try {
      if (filter === 'album') {
        const results = await yt.music.search(query, { type: 'album' });
        const raw = results.albums?.contents || results.contents || results.results || [];
        const items = raw.map(formatAlbumItem).filter(Boolean);
        if (!isGuest && items.length === 0) {
          throw Object.assign(new Error('Empty album search; retrying as guest'), { isFallbackToGuest: true });
        }
        return items;
      }

      if (filter === 'artist') {
        const results = await yt.music.search(query, { type: 'artist' });
        const raw = results.artists?.contents || results.contents || results.results || [];
        const items = raw.map(formatArtistItem).filter(Boolean);
        if (!isGuest && items.length === 0) {
          throw Object.assign(new Error('Empty artist search; retrying as guest'), { isFallbackToGuest: true });
        }
        return items;
      }

      if (filter === 'playlist') {
        const results = await yt.music.search(query, { type: 'playlist' });
        const raw = results.playlists?.contents || results.contents || results.results || [];
        const items = raw.map(formatPlaylistItem).filter(Boolean);
        if (!isGuest && items.length === 0) {
          throw Object.assign(new Error('Empty playlist search; retrying as guest'), { isFallbackToGuest: true });
        }
        return items;
      }

      // Default: 'song' or 'video'
      const searchOpts = {};
      if (filter === 'video') searchOpts.type = 'video';
      else searchOpts.type = 'song';

      const results = await yt.music.search(query, searchOpts);
      const items = [];
      const rawList = results.songs?.contents || results.contents || results.results || [];
      for (const item of rawList) {
        if (item.type === 'MusicResponsiveListItem') {
          const song = formatSongItem(item);
          if (song) items.push(song);
        } else if (item.type === 'MusicCardShelf') {
          const song = formatSongItem({
            id: item.on_tap?.payload?.videoId,
            title: item.title?.text,
            author: item.subtitle?.runs?.[1]?.text || 'Various',
            thumbnail: item.thumbnail?.contents?.[0],
            duration: item.subtitle?.runs?.[item.subtitle.runs.length - 1]?.text
          });
          if (song) items.push(song);
        }
      }
      if (!isGuest && items.length === 0) {
        throw Object.assign(new Error('Empty song search; retrying as guest'), { isFallbackToGuest: true });
      }
      return items;
    } catch (err) {
      if (!isGuest && err) err.isFallbackToGuest = true;
      throw err;
    }
  });
}

async function getSearchSuggestions(query) {
  if (!query || query.trim().length === 0) return [];
  try {
    return await executeMusicAction(async (yt) => {
      const suggestions = await yt.music.getSearchSuggestions(query.trim());
      return suggestions.map(s => (typeof s === 'string' ? s : s.text || s.title || '')).filter(Boolean);
    });
  } catch (err) {
    return [];
  }
}

// Album details with tracklist & similar releases
async function getAlbum(albumId) {
  if (!albumId) throw new Error('Album ID is required');

  // If albumId is already a playlist or audio playlist ID (e.g. starting with OLAK, VLOLAK, PL, RD)
  const cleanId = albumId.startsWith('VL') ? albumId.substring(2) : albumId;
  if (cleanId.startsWith('OLAK') || cleanId.startsWith('PL') || cleanId.startsWith('RD')) {
    const pl = await getPlaylist(albumId);
    let albTitle = (pl.title || '').replace(/^Album\s*[-–]\s*/i, '');
    if (!albTitle || albTitle === 'Untitled Playlist' || albTitle === 'Untitled Album') {
      albTitle = pl.tracks?.[0]?.album || 'Album';
    }
    let albArtist = pl.author || '';
    if (!albArtist || albArtist === 'YouTube Music' || albArtist === 'YouTube') {
      albArtist = pl.tracks?.[0]?.artist || 'Various Artists';
    }
    return {
      id: albumId,
      title: albTitle,
      artist: albArtist,
      artistId: pl.tracks?.[0]?.artistId || '',
      year: pl.tracks?.[0]?.year || '',
      releaseType: 'Album',
      duration: pl.duration || '',
      description: pl.description || '',
      thumbnail: pl.thumbnail || pl.tracks?.[0]?.thumbnail || 'assets/icon.png',
      tracks: pl.tracks || [],
      similarAlbums: []
    };
  }

  return executeMusicAction(async (yt) => {
    let details;
    try {
      details = await yt.music.getAlbum(albumId);
    } catch (err) {
      // Graceful fallback: try resolving through getPlaylist if album id fails
      try {
        const pl = await getPlaylist(albumId);
        if (pl && pl.tracks && pl.tracks.length > 0) {
          return {
            id: albumId,
            title: (pl.title || 'Untitled Album').replace(/^Album\s*[-–]\s*/i, ''),
            artist: pl.author || 'Various Artists',
            artistId: pl.tracks[0]?.artistId || '',
            year: pl.tracks[0]?.year || '',
            releaseType: 'Album',
            duration: pl.duration || '',
            description: pl.description || '',
            thumbnail: pl.thumbnail || 'assets/icon.png',
            tracks: pl.tracks,
            similarAlbums: []
          };
        }
      } catch {}
      throw err;
    }

    const title = details.header?.title?.text || details.title || 'Untitled Album';
    const strapRuns = details.header?.strapline_text_one?.runs || [];
    const artist = details.header?.strapline_text_one?.text || details.header?.author?.name || 'Various Artists';
    const artistId = details.header?.strapline_text_one?.endpoint?.payload?.browseId || extractBrowseIdByType(strapRuns, 'ARTIST', 'UC') || '';

    const rawSubtitle = details.header?.subtitle?.text || details.header?.year?.text || '';
    const subParts = rawSubtitle.split('•').map(s => s.trim()).filter(Boolean);
    let releaseType = '';
    let year = '';
    for (const p of subParts) {
      if (/^(19\d{2}|20\d{2})$/.test(p)) year = p;
      else if (/^(Album|Single|EP)$/i.test(p)) releaseType = p;
    }
    if (!year && rawSubtitle) year = rawSubtitle;

    const duration = details.header?.second_subtitle?.text || '';
    const description = details.header?.description?.description?.text || details.header?.description?.text || '';

    let thumbnail = '';
    if (details.header?.thumbnail?.contents?.[0]?.url) {
      thumbnail = details.header.thumbnail.contents[0].url;
    } else if (details.thumbnails?.[0]?.url) {
      thumbnail = details.thumbnails[0].url;
    }
    thumbnail = upgradeThumbnail(thumbnail, 800);

    // Collect all tracks across contents, multi-disc sections, and continuations
    const rawContents = [...(details.contents || [])];

    // Follow continuations if long album / box set
    let page = details;
    let continuationCount = 0;
    while (page && page.has_continuation && continuationCount < 50) {
      try {
        page = await page.getContinuation();
        const nextBatch = page.contents || page.items || [];
        if (nextBatch.length === 0) break;
        rawContents.push(...nextBatch);
        continuationCount++;
      } catch {
        break;
      }
    }

    // Inspect sections for multi-disc shelves (e.g. Disc 1, Disc 2, or MusicShelf) vs similar releases
    const similarAlbums = [];
    const seenSimilar = new Set([albumId]);
    for (const sec of details.sections || []) {
      const secTitle = (sec.title?.text || sec.header?.title?.text || '').toLowerCase();
      const rawSecItems = sec.contents || sec.items || [];
      const isDiscOrTrackSection = sec.type === 'MusicShelf' ||
        secTitle.includes('disc') ||
        secTitle.includes('part') ||
        secTitle.includes('volume') ||
        secTitle.includes('vol') ||
        secTitle.includes('bonus') ||
        secTitle.includes('track');

      if (isDiscOrTrackSection) {
        for (const item of rawSecItems) {
          if (item.type === 'MusicResponsiveListItem' || item.videoId || item.id) {
            rawContents.push(item);
          }
        }
      } else {
        for (const item of rawSecItems) {
          const alb = formatAlbumItem(item);
          if (alb && !seenSimilar.has(alb.id)) {
            seenSimilar.add(alb.id);
            similarAlbums.push(alb);
          }
        }
      }
    }

    const tracks = [];
    const seenTrackIds = new Set();
    for (let i = 0; i < rawContents.length; i++) {
      const item = rawContents[i];
      const song = formatSongItem(item, title);
      if (song && !seenTrackIds.has(song.id)) {
        seenTrackIds.add(song.id);
        if (!song.artist || song.artist === 'Unknown Artist') song.artist = artist;
        if (!song.artistId && artistId) song.artistId = artistId;
        if (!song.albumId) song.albumId = albumId;
        if (!song.album) song.album = title;
        if (!song.year && year) song.year = year;
        if ((!song.thumbnail || song.thumbnail.includes('hqdefault.jpg')) && thumbnail && !thumbnail.includes('icon.png')) {
          song.thumbnail = thumbnail;
        }
        song.trackNumber = tracks.length + 1;
        tracks.push(song);
      }
    }

    // Fallback if rawContents had 0 tracks: retrieve from album audio playlist
    if (tracks.length === 0) {
      const playButton = details.header?.buttons?.find(b => b.type === 'MusicPlayButton' || b.endpoint?.payload?.playlistId);
      const audioPlId = playButton?.endpoint?.payload?.playlistId || details.url?.match(/list=([a-zA-Z0-9_-]+)/)?.[1];
      if (audioPlId) {
        try {
          const pl = await getPlaylist(audioPlId);
          if (pl?.tracks?.length > 0) {
            for (const t of pl.tracks) {
              if (!seenTrackIds.has(t.id)) {
                seenTrackIds.add(t.id);
                tracks.push({
                  ...t,
                  album: title,
                  albumId,
                  trackNumber: tracks.length + 1
                });
              }
            }
          }
        } catch {}
      }
    }

    return {
      id: albumId,
      title,
      artist,
      artistId,
      year,
      releaseType: releaseType || 'Album',
      duration,
      description,
      thumbnail: thumbnail || 'assets/icon.png',
      tracks,
      similarAlbums: similarAlbums.slice(0, 12)
    };
  });
}

// Helpers for YouTube TV / OAuth browse parsing & cloud playlist sync
function collectNodesByKey(obj, targetKey, results = []) {
  if (!obj || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    for (const item of obj) collectNodesByKey(item, targetKey, results);
    return results;
  }
  if (Object.prototype.hasOwnProperty.call(obj, targetKey)) {
    results.push(obj[targetKey]);
  }
  for (const val of Object.values(obj)) {
    collectNodesByKey(val, targetKey, results);
  }
  return results;
}

function findFirstContinuationToken(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const token = findFirstContinuationToken(item);
      if (token) return token;
    }
    return null;
  }
  if (obj.nextContinuationData?.continuation) {
    return obj.nextContinuationData.continuation;
  }
  for (const val of Object.values(obj)) {
    const token = findFirstContinuationToken(val);
    if (token) return token;
  }
  return null;
}

function getTvText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.simpleText) return String(node.simpleText);
  if (Array.isArray(node.runs)) return node.runs.map(r => r.text || '').join('');
  return '';
}

function parseTvPlaylistTile(tile) {
  if (!tile || typeof tile !== 'object') return null;
  const meta = tile.metadata?.tileMetadataRenderer || {};
  const titleText = getTvText(meta.title).trim();
  const navBrowseId = meta.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
    tile.onSelectCommand?.browseEndpoint?.browseId || '';

  let rawId = navBrowseId || tile.playlistId || tile.contentId || '';
  if (!rawId) return null;
  const cleanId = rawId.startsWith('VL') ? rawId.slice(2) : rawId;

  // Must look like a playlist browse/playlist id
  const isPlaylistLike = navBrowseId.startsWith('VL') ||
    cleanId.startsWith('PL') ||
    cleanId.startsWith('RD') ||
    cleanId.startsWith('OLAK') ||
    tile.contentType === 'TILE_CONTENT_TYPE_PLAYLIST';
  if (!isPlaylistLike) return null;

  const lineStrings = (meta.lines || []).map(l =>
    (l.lineRenderer?.items || []).map(i => getTvText(i.lineItemRenderer?.text)).join(' ').trim()
  ).filter(Boolean);

  let author = 'YouTube Music';
  let itemCount = '';
  for (const line of lineStrings) {
    const countMatch = line.match(/(\d[\d,]*\s*(?:track|song|video)s?)/i);
    if (countMatch) itemCount = countMatch[1];
    if (line.includes('•')) {
      const parts = line.split('•').map(s => s.trim()).filter(Boolean);
      const authorPart = parts.find(p => !/playlist|auto playlist|view|track|song|video/i.test(p));
      if (authorPart) author = authorPart;
    } else if (!/playlist|track|song|video|view/i.test(line)) {
      author = line;
    }
  }

  const thumbs = tile.header?.tileHeaderRenderer?.thumbnail?.thumbnails || [];
  let thumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
  thumb = upgradeThumbnail(thumb, 544);

  return {
    id: cleanId,
    browseId: `VL${cleanId}`,
    title: titleText || 'Untitled Playlist',
    author: author || 'YouTube Music',
    itemCount: itemCount || '',
    thumbnail: thumb || 'assets/icon.png',
    isCloudPlaylist: true
  };
}

function parseTvVideoTile(tile) {
  if (!tile || typeof tile !== 'object') return null;
  const videoId = tile.contentId || tile.onSelectCommand?.watchEndpoint?.videoId || '';
  if (!videoId || videoId.length < 5) return null;
  if (tile.contentType && tile.contentType !== 'TILE_CONTENT_TYPE_VIDEO') return null;

  const meta = tile.metadata?.tileMetadataRenderer || {};
  const title = getTvText(meta.title).trim() || 'Unknown Title';

  let artist = 'Unknown Artist';
  let artistId = '';
  const lines = meta.lines || [];
  if (lines.length > 0) {
    const lineItems = lines[0].lineRenderer?.items || [];
    const firstLineText = lineItems
      .map(i => getTvText(i.lineItemRenderer?.text))
      .join(' ')
      .trim();
    if (firstLineText) artist = firstLineText;
    for (const li of lineItems) {
      const bId = li.lineItemRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';
      if (bId && bId.startsWith('UC')) {
        artistId = bId;
        break;
      }
    }
  }

  let duration = '';
  const overlays = tile.header?.tileHeaderRenderer?.thumbnailOverlays || [];
  for (const ov of overlays) {
    const dText = getTvText(ov.thumbnailOverlayTimeStatusRenderer?.text).trim();
    if (dText && /\d+:\d+/.test(dText)) {
      duration = dText;
      break;
    }
  }

  let setVideoId = '';
  const menuItems = tile.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items || [];
  for (const mi of menuItems) {
    const actions = mi.menuServiceItemRenderer?.serviceEndpoint?.playlistEditEndpoint?.actions || [];
    const removeAct = actions.find(a => a.action === 'ACTION_REMOVE_VIDEO' && a.setVideoId);
    if (removeAct) {
      setVideoId = removeAct.setVideoId;
      break;
    }
  }

  const thumbs = tile.header?.tileHeaderRenderer?.thumbnail?.thumbnails || [];
  let thumb = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  thumb = upgradeThumbnail(thumb, 544);

  return {
    id: videoId,
    setVideoId: setVideoId || undefined,
    title,
    artist,
    artists: [artist],
    artistId: artistId || undefined,
    album: '',
    duration,
    thumbnail: thumb
  };
}

async function fetchTvPlaylistBrowse(yt, browseId, maxPages = 60) {
  const res = await yt.actions.execute('/browse', { browseId, client: 'TV' });
  const headerMeta = collectNodesByKey(res.data, 'entityMetadataRenderer')[0];
  const title = getTvText(headerMeta?.title).trim() || 'Untitled Playlist';
  const description = getTvText(headerMeta?.description).trim() || '';

  const tracks = [];
  const seenKeys = new Set();
  const pushTiles = (data) => {
    const tiles = collectNodesByKey(data, 'tileRenderer');
    for (const t of tiles) {
      const song = parseTvVideoTile(t);
      if (song) {
        const key = song.setVideoId || `${song.id}:${tracks.length}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          song.trackNumber = tracks.length + 1;
          tracks.push(song);
        }
      }
    }
  };

  pushTiles(res.data);

  let cont = findFirstContinuationToken(res.data);
  let pageCount = 1;
  while (cont && pageCount < maxPages) {
    try {
      const nextRes = await yt.actions.execute('/browse', { continuation: cont, client: 'TV' });
      const beforeCount = tracks.length;
      pushTiles(nextRes.data);
      if (tracks.length === beforeCount) break;
      cont = findFirstContinuationToken(nextRes.data);
      pageCount++;
    } catch (e) {
      console.warn('TV playlist continuation notice:', e.message);
      break;
    }
  }

  const thumb = upgradeThumbnail(tracks[0]?.thumbnail || '', 800) || 'assets/icon.png';
  const isEditable = tracks.some(t => Boolean(t.setVideoId));

  return {
    id: browseId.startsWith('VL') ? browseId.slice(2) : browseId,
    title,
    author: 'YouTube Music',
    description,
    duration: '',
    thumbnail: thumb,
    itemCount: tracks.length,
    isEditable,
    tracks
  };
}

// Online YouTube Music Playlist with tracklist (with complete continuation pagination)
async function getPlaylist(playlistId) {
  const cleanId = playlistId.startsWith('VL') ? playlistId.substring(2) : playlistId;
  const saved = loadSavedSession();
  const isOAuthOnly = !currentCookie && !saved.cookie && Boolean(saved.credentials?.access_token);

  // For OAuth TV device-auth sessions, query via client: 'TV' first so private playlists & setVideoIds work!
  if (isOAuthOnly) {
    try {
      const yt = await getInnertube();
      if (yt?.session?.logged_in) {
        const tvPl = await fetchTvPlaylistBrowse(yt, `VL${cleanId}`, 80);
        if (tvPl && (tvPl.tracks.length > 0 || tvPl.title !== 'Untitled Playlist')) {
          return { ...tvPl, id: playlistId };
        }
      }
    } catch (tvErr) {
      console.warn('TV playlist browse fallback note:', tvErr.message);
    }
  }

  return executeMusicAction(async (yt) => {
    let title = 'Untitled Playlist';
    let author = 'YouTube Music';
    let description = '';
    let duration = '';
    let thumbnail = '';
    let rawItems = [];

    try {
      const res = await yt.music.getPlaylist(cleanId);
      title = res.header?.title?.text || res.title || title;
      author = res.header?.author?.name || res.header?.strapline_text_one?.text || author;
      description = res.header?.description?.description?.text || '';
      duration = res.header?.second_subtitle?.text || '';

      if (res.header?.thumbnail?.contents?.[0]?.url) {
        thumbnail = res.header.thumbnail.contents[0].url;
      } else if (res.thumbnails?.[0]?.url) {
        thumbnail = res.thumbnails[0].url;
      }

      rawItems = [...(res.items || res.contents || [])];
      let page = res;
      let continuationCount = 0;
      while (page && page.has_continuation && continuationCount < 100) {
        try {
          page = await page.getContinuation();
          const nextBatch = page.items || page.contents || [];
          if (nextBatch.length === 0) break;
          rawItems.push(...nextBatch);
          continuationCount++;
        } catch (err) {
          console.warn('Playlist continuation fetch note:', err.message);
          break;
        }
      }
    } catch (musicErr) {
      console.warn('yt.music.getPlaylist failed, will try standard yt.getPlaylist fallback:', musicErr.message);
    }

    // Fallback to standard YouTube playlist API (handles regular YT playlists & LockupView items)
    if (rawItems.length === 0) {
      const ytRes = await yt.getPlaylist(cleanId);
      title = ytRes.info?.title || title;
      author = ytRes.info?.author?.name || 'YouTube';
      description = ytRes.info?.description || description;
      if (!thumbnail && ytRes.info?.thumbnails?.[0]?.url) {
        thumbnail = ytRes.info.thumbnails[0].url;
      }

      rawItems = [...(ytRes.items || ytRes.videos || [])];
      let ytPage = ytRes;
      let continuationCount = 0;
      while (ytPage && ytPage.has_continuation && continuationCount < 100) {
        try {
          ytPage = await ytPage.getContinuation();
          const nextBatch = ytPage.items || ytPage.videos || [];
          if (nextBatch.length === 0) break;
          rawItems.push(...nextBatch);
          continuationCount++;
        } catch (err) {
          console.warn('Standard playlist continuation fetch note:', err.message);
          break;
        }
      }
    }

    thumbnail = upgradeThumbnail(thumbnail, 800);

    const tracks = [];
    for (let i = 0; i < rawItems.length; i++) {
      const song = formatSongItem(rawItems[i]);
      if (song) {
        song.trackNumber = tracks.length + 1;
        tracks.push(song);
      }
    }

    return {
      id: playlistId,
      title,
      author,
      description,
      duration,
      thumbnail: thumbnail || 'assets/icon.png',
      itemCount: tracks.length,
      tracks
    };
  });
}

// Artist discography, top tracks, related artists, and featured playlists
async function getArtist(artistId) {
  return executeMusicAction(async (yt, isGuest = false) => {
    let res;
    try {
      res = await yt.music.getArtist(artistId);
    } catch (err) {
      if (!isGuest && err) err.isFallbackToGuest = true;
      throw err;
    }

    const name = res.header?.title?.text || res.name || 'Artist';
    const description = res.header?.description?.text || res.header?.description?.description?.text || '';
    let subscribers = res.header?.subscription_button?.subscribe?.subscriber_count_text?.text
      || res.header?.subscription_button?.subscriber_count_text?.text
      || res.header?.subscriber_count?.text
      || res.header?.subtitle?.text
      || '';
    if (!subscribers) {
      const a11yLabel = res.header?.subscription_button?.subscribe_accessibility_label
        || res.header?.subscription_button?.unsubscribe_accessibility_label
        || '';
      const subMatch = String(a11yLabel).match(/(\d[\d.,]*\s*(?:million|billion|thousand|[KMB])?)/i);
      if (subMatch && subMatch[1]) {
        subscribers = `${subMatch[1].trim()} subscribers`;
      }
    }

    let thumbnail = '';
    if (res.header?.thumbnail?.contents?.length > 0) {
      thumbnail = res.header.thumbnail.contents[res.header.thumbnail.contents.length - 1].url;
    } else if (Array.isArray(res.header?.thumbnail?.thumbnails) && res.header.thumbnail.thumbnails.length > 0) {
      thumbnail = res.header.thumbnail.thumbnails[res.header.thumbnail.thumbnails.length - 1].url;
    } else if (Array.isArray(res.header?.thumbnail) && res.header.thumbnail.length > 0) {
      thumbnail = res.header.thumbnail[res.header.thumbnail.length - 1].url;
    }
    thumbnail = upgradeThumbnail(thumbnail, 800);

    const topSongs = [];
    const albums = [];
    const singles = [];
    const relatedArtists = [];
    const featuredOn = [];
    let songsBrowseId = '';

    for (const sec of res.sections || []) {
      const secTitle = (sec.title?.text || sec.header?.title?.text || '').toLowerCase();
      const raw = sec.contents || sec.items || [];

      if (secTitle.includes('top song') || secTitle === 'songs') {
        songsBrowseId = sec.endpoint?.payload?.browseId || sec.bottom_button?.endpoint?.payload?.browseId || '';
        for (const item of raw) {
          const song = formatSongItem(item);
          if (song) {
            if (!song.artistId) song.artistId = artistId;
            if (!song.artist || song.artist === 'Unknown Artist') song.artist = name;
            topSongs.push(song);
          }
        }
      } else if (secTitle.includes('album')) {
        for (const item of raw) {
          const alb = formatAlbumItem(item);
          if (alb) {
            if (!alb.artist || alb.artist === 'Album') alb.artist = name;
            if (!alb.artistId) alb.artistId = artistId;
            albums.push(alb);
          }
        }
      } else if (secTitle.includes('single') || secTitle.includes('ep')) {
        for (const item of raw) {
          const sgl = formatAlbumItem(item);
          if (sgl) {
            if (!sgl.artist || sgl.artist === 'Album') sgl.artist = name;
            if (!sgl.artistId) sgl.artistId = artistId;
            singles.push(sgl);
          }
        }
      } else if (secTitle.includes('fans might') || secTitle.includes('similar') || secTitle.includes('related')) {
        for (const item of raw) {
          const rel = formatArtistItem(item);
          if (rel && rel.id !== artistId) relatedArtists.push(rel);
        }
      } else if (secTitle.includes('featured') || secTitle.includes('playlist')) {
        for (const item of raw) {
          const pl = formatPlaylistItem(item);
          if (pl) featuredOn.push(pl);
        }
      }
    }

    // If artist has a full songs browse playlist endpoint (VLOLAK...), fetch the complete catalog (100+ songs!)
    if (songsBrowseId) {
      try {
        const fullPlaylist = await getPlaylist(songsBrowseId);
        if (fullPlaylist?.tracks?.length > 0) {
          const seen = new Set();
          const merged = [];
          for (const t of fullPlaylist.tracks) {
            if (!seen.has(t.id)) {
              seen.add(t.id);
              merged.push({
                ...t,
                artist: t.artist || name,
                artistId: t.artistId || artistId
              });
            }
          }
          if (merged.length > topSongs.length) {
            topSongs.length = 0;
            topSongs.push(...merged);
          }
        }
      } catch (err) {
        console.warn('Artist full songs browse note:', err.message);
      }
    }

    // Additional fallback: If topSongs is still sparse (< 15 tracks), search for more songs by this artist
    if (topSongs.length < 15 && name && name !== 'Artist') {
      try {
        const searchResults = await search(`${name}`, 'song');
        const seen = new Set(topSongs.map(s => s.id));
        for (const s of searchResults) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            topSongs.push({
              ...s,
              artist: s.artist || name,
              artistId: s.artistId || artistId
            });
            if (topSongs.length >= 60) break;
          }
        }
      } catch (searchErr) {
        console.warn('Artist search fallback note:', searchErr.message);
      }
    }

    return {
      id: artistId,
      name,
      subscribers,
      description,
      thumbnail: thumbnail || 'assets/icon.png',
      topSongs, // full catalog of songs (no artificial 20-track cap)
      albums: albums.slice(0, 25),
      singles: singles.slice(0, 25),
      relatedArtists: relatedArtists.slice(0, 15),
      featuredOn: featuredOn.slice(0, 15)
    };
  });
}

// Home feed (resilient with zero infinite spinner guarantee)
async function getHomeFeed() {
  try {
    const feed = await executeMusicAction(async (yt) => yt.music.getHomeFeed());
    const sections = [];

    const rawSections = feed.sections || feed.contents || [];
    for (const sec of rawSections) {
      const title = sec.title?.text || sec.header?.title?.text || '';
      if (!title) continue;

      const items = [];
      const rawItems = sec.contents || sec.items || [];
      for (const item of rawItems) {
        const song = formatSongItem(item);
        if (song) items.push(song);
      }

      if (items.length > 0) {
        sections.push({ title, items });
      }
    }

    if (sections.length > 0) {
      return sections;
    }
  } catch (err) {
    console.warn('Home feed fetch warning, generating fallback hits:', err.message);
  }

  // Guaranteed fallback so Home is NEVER blank or spinning
  const [trending, chill] = await Promise.all([
    search('Top Trending Global Hits 2026', 'song').catch(() => []),
    search('Chill Acoustic Hits', 'song').catch(() => [])
  ]);

  return [
    { title: 'Quick Picks', items: (trending.length > 0 ? trending : []).slice(0, 20) },
    { title: 'Trending Hits', items: (chill.length > 0 ? chill : trending).slice(0, 15) }
  ];
}

async function getExploreCategories() {
  return [
    { title: 'Chill & Relax', query: 'Chill Acoustic Vibes Songs', color: '#06D6A0' },
    { title: 'Workout Energy', query: 'Gym Workout Motivation Music', color: '#E63946' },
    { title: 'Focus & Study', query: 'Deep Focus Ambient Study Music', color: '#457B9D' },
    { title: 'Party & Dance', query: 'EDM Club Party Dance Hits', color: '#9B5DE5' },
    { title: 'Rock & Metal', query: 'Classic Rock Alternative Metal Hits', color: '#D00000' },
    { title: 'Hip-Hop & Rap', query: 'Hip Hop Rap Hits', color: '#F77F00' },
    { title: 'Pop & Viral', query: 'Top Pop Viral Music', color: '#00BBF9' },
    { title: 'Romance & Love', query: 'Romantic Love Songs Acoustic', color: '#F15BB5' },
    { title: 'Sleep & Night', query: 'Deep Sleep Calm Night Waves', color: '#1D3557' },
    { title: 'Indie & Alt', query: 'Indie Folk Rock Vibes', color: '#2A9D8F' }
  ];
}

async function getAccountProfile() {
  try {
    const saved = loadSavedSession();
    if (saved.profile && saved.profile.isLoggedIn) {
      return saved.profile;
    }

    if (currentCookie || saved.cookie) {
      const yt = await getInnertube();
      try {
        const info = await yt.account.getInfo();
        if (info && (info.name || info.email)) {
          return {
            isLoggedIn: true,
            name: info.name || 'YouTube User',
            email: info.email || '',
            avatar: info.thumbnails?.[0]?.url || 'assets/icon.png'
          };
        }
      } catch (_) {}

      return {
        isLoggedIn: true,
        name: 'Connected YouTube User',
        email: '',
        avatar: 'assets/icon.png'
      };
    }
  } catch (err) {
    console.warn('Account profile lookup note:', err.message);
  }
  return { isLoggedIn: false };
}

async function getLibrary() {
  const saved = loadSavedSession();
  const hasCookie = Boolean(currentCookie || saved.cookie);
  const hasOAuth = Boolean(saved.credentials && (saved.credentials.access_token || saved.credentials.refresh_token));

  if (!hasCookie && !hasOAuth) {
    return { playlists: [], likedSongs: [] };
  }

  const EXCLUDED_SYSTEM_IDS = new Set(['LM', 'VLLM', 'LL', 'VLLL', 'WL', 'VLWL', 'SE', 'VLSE']);

  try {
    const yt = await getInnertube();
    let likedSongs = [];
    const playlistsMap = new Map();

    const addPlaylist = (pl) => {
      if (!pl || !pl.id) return;
      const cleanId = pl.id.startsWith('VL') ? pl.id.slice(2) : pl.id;
      if (!cleanId || EXCLUDED_SYSTEM_IDS.has(cleanId) || EXCLUDED_SYSTEM_IDS.has(pl.id)) return;
      if (!playlistsMap.has(cleanId)) {
        playlistsMap.set(cleanId, { ...pl, id: cleanId });
      }
    };

    if (hasCookie) {
      try {
        const liked = await yt.music.getPlaylist('LM');
        let rawLiked = [...(liked.items || liked.contents || [])];
        let page = liked;
        let continuationCount = 0;
        while (page && page.has_continuation && continuationCount < 50) {
          try {
            page = await page.getContinuation();
            const nextBatch = page.items || page.contents || [];
            if (nextBatch.length === 0) break;
            rawLiked.push(...nextBatch);
            continuationCount++;
          } catch (_) {
            break;
          }
        }
        likedSongs = rawLiked.map(item => formatSongItem(item)).filter(Boolean);
      } catch (e) {
        console.warn('Liked songs fetch info:', e.message);
      }

      try {
        const lib = await yt.music.getLibrary();
        const raw = lib.playlists?.contents || lib.playlists || lib.sections?.[0]?.contents || [];
        for (const p of raw) {
          addPlaylist(formatPlaylistItem(p));
        }
      } catch (e) {
        console.warn('YouTube Music library playlists fetch note:', e.message);
      }

      if (playlistsMap.size === 0) {
        try {
          const mainLib = await yt.getLibrary();
          const raw = mainLib.playlists?.contents || mainLib.playlists || [];
          for (const p of raw) {
            addPlaylist(formatPlaylistItem(p));
          }
        } catch (e) {
          console.warn('Main YouTube library playlists fetch note:', e.message);
        }
      }
    }

    // OAuth TV Device Auth (or fallback): fetch via client 'TV' which accepts TV OAuth credentials cleanly
    if (!hasCookie || playlistsMap.size === 0) {
      for (const browseId of ['FEmusic_liked_playlists', 'FElibrary', 'FEplaylist_aggregation']) {
        try {
          const tvRes = await yt.actions.execute('/browse', { browseId, client: 'TV' });
          const tiles = collectNodesByKey(tvRes.data, 'tileRenderer');
          for (const t of tiles) {
            addPlaylist(parseTvPlaylistTile(t));
          }
        } catch (e) {
          console.warn(`TV ${browseId} fetch note:`, e.message);
        }
      }
    }

    if ((!hasCookie || likedSongs.length === 0) && yt?.session?.logged_in) {
      try {
        const vllmPl = await fetchTvPlaylistBrowse(yt, 'VLLM', 20);
        if (vllmPl && Array.isArray(vllmPl.tracks) && vllmPl.tracks.length > 0) {
          likedSongs = vllmPl.tracks;
        }
      } catch (e) {
        console.warn('TV Liked Music (VLLM) fetch note:', e.message);
      }
    }

    return { playlists: Array.from(playlistsMap.values()), likedSongs };
  } catch (err) {
    console.error('Error fetching library:', err.message);
    return { playlists: [], likedSongs: [] };
  }
}

async function executeCloudPlaylistRequest(yt, apiPath, body) {
  const saved = loadSavedSession();
  const isOAuthOnly = !currentCookie && !saved.cookie && Boolean(saved.credentials?.access_token);
  const payload = isOAuthOnly ? { ...body, client: 'TV' } : body;
  return await yt.actions.execute(apiPath, payload);
}

async function createOnlinePlaylist(title, videoIds = [], privacyStatus = 'PRIVATE', description = '') {
  const saved = loadSavedSession();
  const hasAuth = Boolean(currentCookie || saved.cookie || saved.credentials?.access_token);
  if (!hasAuth) {
    return { success: false, error: 'Please sign in to Google / YouTube Music first.' };
  }
  const yt = await getInnertube();
  if (!yt?.session?.logged_in && !currentCookie && !saved.cookie) {
    return { success: false, error: 'Session is not authenticated.' };
  }

  const cleanIds = (Array.isArray(videoIds) ? videoIds : []).map(id => String(id || '').trim()).filter(Boolean);
  const initialBatch = cleanIds.slice(0, 50);
  const remaining = cleanIds.slice(50);

  const reqBody = {
    title: String(title || 'OpenTune Playlist').trim(),
    privacyStatus: privacyStatus || 'PRIVATE'
  };
  if (description) reqBody.description = String(description);
  if (initialBatch.length > 0) reqBody.videoIds = initialBatch;

  const res = await executeCloudPlaylistRequest(yt, '/playlist/create', reqBody);
  const playlistId = res.data?.playlistId || '';
  if (!playlistId) {
    return { success: false, error: 'YouTube did not return a playlist ID.' };
  }

  if (remaining.length > 0) {
    await addTracksToOnlinePlaylist(playlistId, remaining);
  }

  return { success: true, playlistId };
}

async function addTracksToOnlinePlaylist(playlistId, videoIds = []) {
  const cleanPlId = String(playlistId || '').replace(/^VL/, '').trim();
  const cleanIds = (Array.isArray(videoIds) ? videoIds : []).map(id => String(id || '').trim()).filter(Boolean);
  if (!cleanPlId || cleanIds.length === 0) {
    return { success: false, error: 'Missing playlistId or videoIds.' };
  }

  const yt = await getInnertube();
  for (let i = 0; i < cleanIds.length; i += 50) {
    const chunk = cleanIds.slice(i, i + 50);
    await executeCloudPlaylistRequest(yt, '/browse/edit_playlist', {
      playlistId: cleanPlId,
      actions: chunk.map(id => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: id }))
    });
  }
  return { success: true, playlistId: cleanPlId, added: cleanIds.length };
}

async function removeTracksFromOnlinePlaylist(playlistId, videoIds = [], setVideoIds = []) {
  const cleanPlId = String(playlistId || '').replace(/^VL/, '').trim();
  if (!cleanPlId) return { success: false, error: 'Missing playlistId.' };

  let targetSetIds = (Array.isArray(setVideoIds) ? setVideoIds : []).map(s => String(s || '').trim()).filter(Boolean);
  const cleanVids = (Array.isArray(videoIds) ? videoIds : []).map(id => String(id || '').trim()).filter(Boolean);

  if (targetSetIds.length === 0 && cleanVids.length > 0) {
    const remotePl = await getPlaylist(`VL${cleanPlId}`);
    const vidSet = new Set(cleanVids);
    targetSetIds = (remotePl?.tracks || [])
      .filter(t => vidSet.has(t.id) && t.setVideoId)
      .map(t => t.setVideoId);
  }

  if (targetSetIds.length === 0) {
    return { success: false, error: 'Matching track setVideoId not found on remote playlist.' };
  }

  const yt = await getInnertube();
  for (let i = 0; i < targetSetIds.length; i += 50) {
    const chunk = targetSetIds.slice(i, i + 50);
    await executeCloudPlaylistRequest(yt, '/browse/edit_playlist', {
      playlistId: cleanPlId,
      actions: chunk.map(sid => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: sid }))
    });
  }
  return { success: true, playlistId: cleanPlId, removed: targetSetIds.length };
}

async function getUpNext(videoId) {
  try {
    return await executeMusicAction(async (yt) => {
      const next = await yt.music.getUpNext(videoId);
      const items = [];
      const raw = Array.isArray(next) ? next : (next.contents || []);
      for (const item of raw) {
        const song = formatSongItem(item);
        if (song) items.push(song);
      }
      return items;
    });
  } catch (err) {
    console.warn('getUpNext error:', err.message);
    return [];
  }
}

async function getExploreData() {
  try {
    return await executeMusicAction(async (yt) => {
      const explore = await yt.music.getExplore();
      const result = {
        trending: [],
        newReleases: [],
        moods: []
      };

      for (const sec of explore.sections || []) {
        const title = ((sec.header ? sec.header.title.text : sec.title?.text) || '').toLowerCase();
        const rawItems = sec.contents || sec.items || [];

        if (title.includes('trending') || title.includes('videos') || title.includes('charts')) {
          for (const item of rawItems) {
            const song = formatSongItem(item);
            if (song) result.trending.push(song);
          }
        } else if (title.includes('new') || title.includes('album') || title.includes('single')) {
          for (const item of rawItems) {
            const alb = formatAlbumItem(item);
            if (alb) result.newReleases.push(alb);
          }
        } else if (title.includes('mood') || title.includes('genre')) {
          for (const item of rawItems) {
            if (item.title?.text) {
              result.moods.push({
                title: item.title.text,
                query: `${item.title.text} playlist`,
                color: item.color || '#ED5564'
              });
            }
          }
        }
      }

      if (result.trending.length === 0) {
        result.trending = (await search('Trending Global Hits 2026', 'song')).slice(0, 20);
      }
      if (result.newReleases.length === 0) {
        result.newReleases = (await search('New Music Releases 2026', 'album')).slice(0, 15);
      }
      if (result.moods.length === 0) {
        result.moods = await getExploreCategories();
      }

      return result;
    });
  } catch (err) {
    console.warn('Explore fetch fallback:', err.message);
    const [trending, newReleases] = await Promise.all([
      search('Top Trending Global Hits 2026', 'song').catch(() => []),
      search('New Music Releases 2026', 'album').catch(() => [])
    ]);

    return {
      trending: trending.slice(0, 20),
      newReleases: newReleases.slice(0, 15),
      moods: await getExploreCategories()
    };
  }
}

module.exports = {
  getInnertube,
  getGuestInnertube,
  loadSavedSession,
  saveSession,
  clearSavedSession,
  startDeviceAuth,
  cancelDeviceAuth,
  signOut,
  search,
  getSearchSuggestions,
  getAlbum,
  getPlaylist,
  getArtist,
  getHomeFeed,
  getExploreCategories,
  getExploreData,
  getUpNext,
  getAccountProfile,
  getLibrary,
  createOnlinePlaylist,
  addTracksToOnlinePlaylist,
  removeTracksFromOnlinePlaylist
};
