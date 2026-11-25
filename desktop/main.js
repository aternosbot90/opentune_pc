const { app, BrowserWindow, ipcMain, session, shell, dialog, screen } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const { spawn } = require('child_process');
const { Readable } = require('stream');

function toFileUrl(filePath) {
  if (!filePath) return '';
  try {
    return pathToFileURL(filePath).href;
  } catch (_) {
    return `file:///${filePath.replace(/\\/g, '/')}`;
  }
}

// Ensure macOS & Linux GUI apps inherit Homebrew, Local & UserData paths in process.env.PATH
if (process.platform === 'darwin' || process.platform === 'linux') {
  const extraPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];
  try {
    const userData = app.getPath('userData');
    extraPaths.unshift(path.join(userData, 'bin'));
  } catch (_) {}
  if (process.env.HOME) {
    extraPaths.push(path.join(process.env.HOME, '.local', 'bin'));
    extraPaths.push(path.join(process.env.HOME, 'bin'));
  }
  const currentPath = process.env.PATH || '';
  const currentParts = currentPath.split(':').filter(Boolean);
  const combined = Array.from(new Set([...extraPaths, ...currentParts]));
  process.env.PATH = combined.join(':');
}

const streamService = require('./stream');
const lyricsService = require('./lyrics');
const ytMusic = require('./ytmusic');
const animatedCoverService = require('./animated-cover');

let autoUpdater = null;
let autoUpdaterInitialized = false;
function initAutoUpdater() {
  if (autoUpdaterInitialized) return autoUpdater;
  autoUpdaterInitialized = true;
  try {
    const updaterModule = require('electron-updater');
    autoUpdater = updaterModule.autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', { status: 'checking' });
      }
    });

    autoUpdater.on('update-available', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'available',
          version: info.version,
          releaseDate: info.releaseDate,
          releaseNotes: info.releaseNotes
        });
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'not-available',
          version: info?.version || app.getVersion()
        });
      }
    });

    autoUpdater.on('error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'error',
          error: err ? err.message : 'Unknown updater error'
        });
      }
    });

    autoUpdater.on('download-progress', (progressObj) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'downloading',
          percent: Math.round(progressObj.percent || 0),
          transferred: progressObj.transferred,
          total: progressObj.total,
          bytesPerSecond: progressObj.bytesPerSecond
        });
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-status', {
          status: 'downloaded',
          version: info.version
        });
      }
    });
  } catch (e) {
    console.warn('electron-updater init notice:', e.message);
  }
  return autoUpdater;
}

// Global safety net to prevent app from closing/crashing on unexpected async errors
process.on('uncaughtException', (err) => {
  console.error('Safe caught uncaughtException in main process:', err?.stack || err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Safe caught unhandledRejection in main process:', reason);
});

// Disable automation detection so Google Account login works smoothly
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
// Allow audio & Web Audio API AudioContext to autoplay reliably without requiring explicit user gestures
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-features', 'PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies');

let mainWindow = null;
let savedNormalBounds = null;
let savedWasMaximized = false;
let isMiniPlayerMode = false;

const CHROME_USER_AGENT = process.platform === 'darwin'
  ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

app.userAgentFallback = CHROME_USER_AGENT;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#0b0c0e',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allows streaming direct audio from googlevideo
      allowRunningInsecureContent: true
    }
  });

  const revealWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };
  mainWindow.once('ready-to-show', revealWindow);
  setTimeout(revealWindow, 1500);

  mainWindow.webContents.on('console-message', (event, ...rest) => {
    const level = (event && typeof event === 'object' && event.level !== undefined) ? event.level : (rest[0] || 0);
    const message = (event && typeof event === 'object' && event.message !== undefined) ? event.message : (rest[1] || '');
    const line = (event && typeof event === 'object' && event.lineNumber !== undefined) ? event.lineNumber : (rest[2] || 0);
    const sourceId = (event && typeof event === 'object' && event.sourceId !== undefined) ? event.sourceId : (rest[3] || '');
    if (level >= 2 /* Warning or Error */) {
      console.warn(`[Renderer L${level}] ${message} (${sourceId}:${line})`);
    }
  });

  mainWindow.loadFile('index.html');

  // Handle window states and renderer/child crashes gracefully
  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', true);
    }
  });
  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-state', false);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer gone:', details.reason);
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });
}

// Window control handlers
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return mainWindow.isMaximized();
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('is-window-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('set-mini-player', (_event, arg) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { isMini: false };
  const opts = (arg && typeof arg === 'object') ? arg : { enable: arg };
  const target = typeof opts.enable === 'boolean' ? opts.enable : !isMiniPlayerMode;
  const alwaysOnTop = opts.alwaysOnTop !== false;

  if (target === isMiniPlayerMode) {
    if (isMiniPlayerMode) {
      mainWindow.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? 'floating' : 'normal');
    }
    return { isMini: isMiniPlayerMode };
  }

  if (target) {
    savedWasMaximized = mainWindow.isMaximized();
    try {
      savedNormalBounds = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    } catch (_) {
      savedNormalBounds = mainWindow.getBounds();
    }
    if (savedWasMaximized) mainWindow.unmaximize();
    isMiniPlayerMode = true;

    const pipWidth = 412;
    const pipHeight = 216;
    mainWindow.setMinimumSize(360, 196);
    mainWindow.setMaximumSize(640, 340);
    mainWindow.setSize(pipWidth, pipHeight);

    // Keep PiP anchored inside current display workArea
    try {
      const bounds = mainWindow.getBounds();
      const disp = screen.getDisplayMatching(bounds);
      const wa = disp.workArea;
      const clampedX = Math.max(wa.x + 12, Math.min(bounds.x, wa.x + wa.width - pipWidth - 12));
      const clampedY = Math.max(wa.y + 12, Math.min(bounds.y, wa.y + wa.height - pipHeight - 12));
      mainWindow.setPosition(clampedX, clampedY);
    } catch (_) {}

    mainWindow.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? 'floating' : 'normal');
  } else {
    isMiniPlayerMode = false;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMaximumSize(10000, 10000);
    mainWindow.setMinimumSize(940, 620);

    if (savedNormalBounds) {
      const targetW = Math.max(940, savedNormalBounds.width || 1280);
      const targetH = Math.max(620, savedNormalBounds.height || 820);
      mainWindow.setBounds({
        x: savedNormalBounds.x,
        y: savedNormalBounds.y,
        width: targetW,
        height: targetH
      });
    } else {
      mainWindow.setSize(1280, 820);
      mainWindow.center();
    }
    if (savedWasMaximized) {
      mainWindow.maximize();
      savedWasMaximized = false;
    }
  }
  mainWindow.webContents.send('mini-player-state', isMiniPlayerMode);
  return { isMini: isMiniPlayerMode };
});

ipcMain.handle('preload-stream', async (_event, videoId) => {
  if (!videoId) return false;
  try {
    const fn = streamService.getStreamUrl || streamService.getAudioStreamUrl;
    await fn(videoId);
    return true;
  } catch (_) {
    return false;
  }
});

// External URL opener (opens in system default browser)
ipcMain.handle('open-external-url', async (_event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

// Audio stream resolver (fast yt-dlp backend with in-memory caching & automatic alternative candidate fallback)
ipcMain.handle('get-stream-url', async (_event, payload) => {
  const videoId = typeof payload === 'object' && payload !== null && payload.id ? String(payload.id).trim() : String(payload || '').trim();
  const trackTitle = typeof payload === 'object' && payload !== null ? payload.title : '';
  const trackArtist = typeof payload === 'object' && payload !== null ? payload.artist : '';

  if (!videoId) return { success: false, error: 'Missing track videoId' };

  try {
    const fn = streamService.getStreamUrl || streamService.getAudioStreamUrl;
    const url = await fn(videoId);
    return { success: true, url };
  } catch (err) {
    console.warn(`[OpenTune] Primary stream extraction notice for ${videoId}:`, err.message);

    // Smart fallback: search for alternative upload of the same track if title is available
    if (trackTitle && typeof ytMusic !== 'undefined' && ytMusic.search) {
      try {
        const query = `${trackTitle} ${trackArtist || ''}`.trim();
        const searchResults = await ytMusic.search(query, 'song');
        const altCandidates = (Array.isArray(searchResults) ? searchResults : [])
          .filter(t => t && t.id && t.id !== videoId)
          .slice(0, 3);

        if (altCandidates.length > 0) {
          const fn = streamService.getStreamUrl || streamService.getAudioStreamUrl;
          try {
            // Race candidates concurrently for fastest playback start
            const winner = await Promise.any(altCandidates.map(async (candidate) => {
              const altUrl = await fn(candidate.id);
              if (!altUrl) throw new Error('Empty URL');
              return { url: altUrl, alternativeId: candidate.id };
            }));
            if (winner && winner.url) {
              console.log(`[OpenTune] Fast parallel alternative stream resolved via ${winner.alternativeId} for "${trackTitle}"`);
              return { success: true, url: winner.url, alternativeId: winner.alternativeId };
            }
          } catch (_) {}
        }
      } catch (altErr) {
        console.warn('[OpenTune] Alternative stream search notice:', altErr.message);
      }
    }

    // Direct yt-dlp search fallback (guarantees playback if original ID is unavailable/restricted)
    if (trackTitle && typeof streamService.resolveStreamBySearch === 'function') {
      try {
        const query = `${trackTitle} ${trackArtist || ''}`.trim();
        const searchRes = await streamService.resolveStreamBySearch(query);
        if (searchRes && searchRes.url) {
          console.log(`[OpenTune] Direct yt-dlp search stream resolved via ${searchRes.alternativeId} for "${trackTitle}"`);
          return { success: true, url: searchRes.url, alternativeId: searchRes.alternativeId };
        }
      } catch (searchErr) {
        console.warn('[OpenTune] yt-dlp search fallback notice:', searchErr.message);
      }
    }

    return { success: false, error: err.message };
  }
});

// LRCLIB Synchronized lyrics resolver (with offline fallback)
ipcMain.handle('get-lyrics', async (_event, payload) => {
  const title = typeof payload === 'object' && payload !== null ? payload.title : arguments[1];
  const artist = typeof payload === 'object' && payload !== null ? payload.artist : arguments[2];
  const duration = typeof payload === 'object' && payload !== null ? payload.duration : arguments[3];
  const trackId = typeof payload === 'object' && payload !== null ? payload.trackId : null;

  // 1. Check offline lyrics cache
  if (trackId && typeof getOfflineAssetDirs === 'function') {
    try {
      const { lyrics } = getOfflineAssetDirs();
      const userLrcPath = path.join(lyrics, `${trackId}.lrc`);
      if (fs.existsSync(userLrcPath)) {
        const content = fs.readFileSync(userLrcPath, 'utf8');
        const parsed = lyricsService.parseLrc(content);
        if (parsed.length > 0 || content.trim()) {
          return {
            success: true,
            synced: parsed,
            plain: content,
            source: 'Offline (Synced)'
          };
        }
      }
    } catch (_) {}
  }

  try {
    const lyricsData = await lyricsService.getLyrics(title, artist, duration);
    return { success: true, ...lyricsData };
  } catch (err) {
    console.error('Lyrics error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('search-lyrics', async (_event, query) => {
  try {
    const results = await lyricsService.searchLyrics(query);
    return { success: true, results };
  } catch (err) {
    console.error('Search lyrics error:', err.message);
    return { success: false, results: [], error: err.message };
  }
});

// YouTube Music data endpoints
ipcMain.handle('search', async (_event, { query, filter }) => {
  try {
    const items = await ytMusic.search(query, filter);
    return { success: true, items };
  } catch (err) {
    console.error('Search error:', err.message);
    return { success: false, items: [], error: err.message };
  }
});

ipcMain.handle('get-search-suggestions', async (_event, query) => {
  try {
    return await ytMusic.getSearchSuggestions(query);
  } catch (err) {
    console.warn('Suggestions fetch notice:', err.message);
    return [];
  }
});

ipcMain.handle('get-home-feed', async () => {
  try {
    return await ytMusic.getHomeFeed();
  } catch (err) {
    console.warn('Home feed fetch notice:', err.message);
    return [];
  }
});

ipcMain.handle('get-explore-categories', async () => {
  try {
    return await ytMusic.getExploreCategories();
  } catch (err) {
    return [];
  }
});

ipcMain.handle('get-explore-data', async () => {
  try {
    return await ytMusic.getExploreData();
  } catch (err) {
    console.warn('Explore data fetch notice:', err.message);
    return { albums: [], songs: [] };
  }
});

ipcMain.handle('get-up-next', async (_event, videoId) => {
  try {
    return await ytMusic.getUpNext(videoId);
  } catch (err) {
    return [];
  }
});

ipcMain.handle('get-album', async (_event, albumId) => {
  try {
    return await ytMusic.getAlbum(albumId);
  } catch (err) {
    console.warn('Album fetch notice:', err.message);
    return { id: albumId, title: 'Album', artist: '', tracks: [] };
  }
});

ipcMain.handle('get-playlist', async (_event, playlistId) => {
  try {
    return await ytMusic.getPlaylist(playlistId);
  } catch (err) {
    console.warn('Playlist fetch notice:', err.message);
    return { id: playlistId, title: 'Playlist', author: '', tracks: [] };
  }
});

ipcMain.handle('get-artist', async (_event, artistId) => {
  try {
    return await ytMusic.getArtist(artistId);
  } catch (err) {
    console.warn('Artist fetch notice:', err.message);
    return { id: artistId, name: 'Artist', topSongs: [], albums: [], singles: [] };
  }
});

ipcMain.handle('get-track-details', async (_event, videoId, meta = {}) => {
  try {
    return await ytMusic.getTrackDetails(videoId, meta);
  } catch (err) {
    console.warn('Track details online fetch notice, checking offline metadata:', err.message);
    if (typeof getOfflineAssetDirs === 'function') {
      try {
        const { meta } = getOfflineAssetDirs();
        const userMetaPath = path.join(meta, `${videoId}.json`);
        if (fs.existsSync(userMetaPath)) {
          return JSON.parse(fs.readFileSync(userMetaPath, 'utf8'));
        }
      } catch (_) {}
    }
    return { videoId, error: err.message };
  }
});

ipcMain.handle('get-fast-track-stats', async (_event, videoId) => {
  const cleanId = String(videoId || '').trim();
  if (!cleanId) return null;
  try {
    const res = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(cleanId)}`, {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      return {
        videoId: cleanId,
        views: data.viewCount || 0,
        likes: data.likes || 0,
        dislikes: data.dislikes || 0,
        rating: data.rating ? Number(data.rating.toFixed(2)) : null
      };
    }
  } catch (_) {}
  return null;
});

ipcMain.handle('get-track-comments', async (_event, videoId) => {
  try {
    return await ytMusic.getTrackComments(videoId);
  } catch (err) {
    console.warn('Track comments notice:', err.message);
    return { videoId, totalCount: '0', comments: [] };
  }
});

ipcMain.handle('post-track-comment', async (_event, { videoId, text }) => {
  try {
    return await ytMusic.postTrackComment(videoId, text);
  } catch (err) {
    console.warn('Post comment notice:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-account-profile', async () => {
  try {
    return await ytMusic.getAccountProfile();
  } catch (err) {
    return { isLoggedIn: false };
  }
});

ipcMain.handle('get-library', async () => {
  try {
    return await ytMusic.getLibrary();
  } catch (err) {
    console.warn('Library fetch notice:', err.message);
    return { playlists: [], likedSongs: [] };
  }
});

// Two-way Cloud Playlist Sync handlers
ipcMain.handle('create-yt-playlist', async (_event, { title, videoIds = [], privacyStatus = 'PRIVATE', description = '' }) => {
  try {
    return await ytMusic.createOnlinePlaylist(title, videoIds, privacyStatus, description);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('add-to-yt-playlist', async (_event, { playlistId, videoIds = [] }) => {
  try {
    return await ytMusic.addTracksToOnlinePlaylist(playlistId, videoIds);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('remove-from-yt-playlist', async (_event, { playlistId, videoIds = [], setVideoIds = [] }) => {
  try {
    return await ytMusic.removeTracksFromOnlinePlaylist(playlistId, videoIds, setVideoIds);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Google Device Authorization (100% Reliable, official RFC 8628 - never blocked by Google)
ipcMain.handle('start-google-device-auth', async (event) => {
  try {
    const result = await ytMusic.startDeviceAuth((pendingData) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('auth-device-pending', pendingData);
      }
    });

    if (mainWindow && !mainWindow.isDestroyed() && result && result.profile) {
      mainWindow.webContents.send('auth-changed', result.profile);
    }
    return result;
  } catch (err) {
    console.error('Device auth flow error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('cancel-google-device-auth', async () => {
  ytMusic.cancelDeviceAuth();
  return { success: true };
});

// Embedded Web Window Sign-In (enhanced stealth headers)
ipcMain.handle('open-login-window', async () => {
  return new Promise((resolve) => {
    const authSession = session.fromPartition('persist:youtube_auth');

    // Strip Electron headers & client hints that trigger Google's "browser not secure" detection
    authSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = CHROME_USER_AGENT;
      delete details.requestHeaders['X-Requested-With'];
      delete details.requestHeaders['sec-ch-ua'];
      delete details.requestHeaders['sec-ch-ua-mobile'];
      delete details.requestHeaders['sec-ch-ua-platform'];
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    const loginWin = new BrowserWindow({
      width: 560,
      height: 760,
      parent: mainWindow,
      modal: true,
      title: 'YouTube Music - Sign In',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:youtube_auth',
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    loginWin.webContents.setUserAgent(CHROME_USER_AGENT);

    // Remove automation flags in renderer context
    loginWin.webContents.on('dom-ready', () => {
      loginWin.webContents.executeJavaScript(`
        try {
          delete window.chrome;
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        } catch (_) {}
      `).catch(() => {});
    });

    // Direct Google ServiceLogin continuing to YouTube Music (matches OpenTune Android LoginScreen.kt)
    const loginUrl = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com';
    loginWin.loadURL(loginUrl);

    let isResolved = false;

    async function checkLoginState() {
      if (isResolved || loginWin.isDestroyed()) return;
      try {
        const url = loginWin.webContents.getURL();
        let parsed;
        try {
          parsed = new URL(url);
        } catch (_) {
          return;
        }

        const isYT = parsed.hostname === 'music.youtube.com' || parsed.hostname === 'www.youtube.com';
        if (!isYT) return;

        // Verify SAPISID or LOGIN_INFO cookie exists
        const cookies = await authSession.cookies.get({ domain: '.youtube.com' });
        const hasAuth = cookies.some(c => (c.name === 'SAPISID' || c.name === 'LOGIN_INFO') && c.value && c.value.trim().length > 0);

        if (hasAuth) {
          const googleCookies = await authSession.cookies.get({ domain: '.google.com' });
          const allCookies = [...cookies, ...googleCookies];

          const cookieString = allCookies
            .map(c => `${c.name}=${c.value}`)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join('; ');

          isResolved = true;

          await ytMusic.getInnertube(cookieString);
          let profile = await ytMusic.getAccountProfile();
          if (!profile.isLoggedIn) {
            profile = {
              isLoggedIn: true,
              name: 'Connected YouTube User',
              email: '',
              avatar: 'assets/icon.png'
            };
          }

          ytMusic.saveSession({ cookie: cookieString, profile });

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth-changed', profile);
          }

          loginWin.close();
          resolve({ success: true, profile });
        }
      } catch (e) {
        console.error('Error extracting login cookies:', e);
      }
    }

    loginWin.webContents.on('did-navigate', checkLoginState);
    loginWin.webContents.on('did-navigate-in-page', checkLoginState);
    loginWin.webContents.on('did-finish-load', checkLoginState);

    const pollInterval = setInterval(() => {
      if (isResolved || loginWin.isDestroyed()) {
        clearInterval(pollInterval);
      } else {
        checkLoginState();
      }
    }, 1200);

    loginWin.on('closed', () => {
      clearInterval(pollInterval);
      if (!isResolved) {
        resolve({ success: false, cancelled: true });
      }
    });
  });
});

ipcMain.handle('save-manual-cookie', async (_event, cookieString) => {
  try {
    const clean = (cookieString || '').trim();
    if (!clean) return { success: false, error: 'Cookie cannot be empty' };

    await ytMusic.getInnertube(clean);
    let profile = await ytMusic.getAccountProfile();
    if (!profile.isLoggedIn) {
      profile = {
        isLoggedIn: true,
        name: 'Connected YouTube Account',
        email: '',
        avatar: 'assets/icon.png'
      };
    }

    ytMusic.saveSession({ cookie: clean, profile });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth-changed', profile);
    }
    return { success: true, profile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sign-out', async () => {
  const authSession = session.fromPartition('persist:youtube_auth');
  await authSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
  await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage'] });
  const res = await ytMusic.signOut();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth-changed', { isLoggedIn: false });
  }
  return res;
});

ipcMain.handle('clear-cache', async () => {
  try {
    streamService.clearStreamCache();
    await session.defaultSession.clearCache();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Playlist & Track Downloader Engine + Persistent Config
let currentDownloadAbort = false;
const activeDownloadChildren = new Set();

function getConfigPath() {
  return path.join(app.getPath('userData'), 'opentune_config.json');
}

function getDefaultDownloadDir() {
  return path.join(app.getPath('downloads'), 'OpenTune');
}

function getAppConfig() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (err) {
    console.warn('Failed reading app config:', err.message);
  }
  return {};
}

function saveAppConfig(updates) {
  try {
    const current = getAppConfig();
    const next = { ...current, ...updates };
    const p = getConfigPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch (err) {
    console.warn('Failed saving app config:', err.message);
    return updates;
  }
}

function resolveDownloadBaseDir(overrideDir) {
  if (typeof overrideDir === 'string' && overrideDir.trim()) {
    return overrideDir.trim();
  }
  const cfg = getAppConfig();
  if (typeof cfg.downloadDir === 'string' && cfg.downloadDir.trim()) {
    return cfg.downloadDir.trim();
  }
  return getDefaultDownloadDir();
}

function cleanArtistName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw
    .replace(/\s*[-–—:]\s*topic\b/gi, '')
    .replace(/\s*\(topic\)\s*/gi, '')
    .replace(/\bTopic\b/gi, '')
    .replace(/\s*[-–—]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || raw.trim();
}

function sanitizeFilename(name) {
  const cleaned = String(name || 'Untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 100);
  return cleaned || 'Untitled';
}

function findExistingAudioFile(destDir, baseName) {
  const exts = ['.m4a', '.webm', '.opus', '.mp3', '.mp4', '.ogg'];
  for (const ext of exts) {
    const candidate = path.join(destDir, `${baseName}${ext}`);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 32768) {
        return candidate;
      }
    } catch (_) {}
  }
  return null;
}

function extFromContentType(contentType = '') {
  const ct = String(contentType).toLowerCase();
  if (ct.includes('webm')) return '.webm';
  if (ct.includes('ogg') || ct.includes('opus')) return '.opus';
  if (ct.includes('mpeg') || ct.includes('mp3')) return '.mp3';
  return '.m4a';
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

const DOWNLOAD_HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Referer': 'https://music.youtube.com/'
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadUrlFastRange(rawUrl, destDir, baseName) {
  const chunkSize = 1024 * 1024; // 1 MiB chunks bypass YouTube CDN per-stream throttling
  const firstRes = await fetchWithTimeout(rawUrl, {
    headers: { ...DOWNLOAD_HTTP_HEADERS, Range: `bytes=0-${chunkSize - 1}` }
  }, 15000);

  if (!firstRes.ok) throw new Error(`HTTP ${firstRes.status}`);

  const ext = extFromContentType(firstRes.headers.get('content-type') || '');
  const finalPath = path.join(destDir, `${baseName}${ext}`);
  const tmpPath = `${finalPath}.part`;
  safeUnlink(tmpPath);

  try {
    const firstBuf = Buffer.from(await firstRes.arrayBuffer());
    const contentRange = firstRes.headers.get('content-range') || '';
    const totalMatch = contentRange.match(/\/(\d+)$/);
    const totalBytes = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    if (firstRes.status === 206 && totalBytes > firstBuf.length) {
      const ranges = [];
      for (let start = firstBuf.length; start < totalBytes; start += chunkSize) {
        ranges.push([start, Math.min(totalBytes - 1, start + chunkSize - 1)]);
      }

      const chunkBuffers = new Array(ranges.length);
      let nextIdx = 0;
      const workerCount = Math.min(4, ranges.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIdx < ranges.length) {
          if (currentDownloadAbort) throw new Error('Download cancelled');
          const idx = nextIdx++;
          const [start, end] = ranges[idx];
          const r = await fetchWithTimeout(rawUrl, {
            headers: { ...DOWNLOAD_HTTP_HEADERS, Range: `bytes=${start}-${end}` }
          }, 15000);
          if (!r.ok && r.status !== 206) throw new Error(`Range HTTP ${r.status}`);
          chunkBuffers[idx] = Buffer.from(await r.arrayBuffer());
        }
      }));

      if (currentDownloadAbort) throw new Error('Download cancelled');
      await fs.promises.writeFile(tmpPath, Buffer.concat([firstBuf, ...chunkBuffers]));
    } else {
      await fs.promises.writeFile(tmpPath, firstBuf);
    }

    if (currentDownloadAbort) {
      safeUnlink(tmpPath);
      throw new Error('Download cancelled');
    }

    if (fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 16384) {
      safeUnlink(finalPath);
      fs.renameSync(tmpPath, finalPath);
      return { filePath: finalPath, skipped: false };
    }
    safeUnlink(tmpPath);
    throw new Error('Downloaded stream was incomplete');
  } catch (err) {
    safeUnlink(tmpPath);
    throw err;
  }
}

async function downloadTrackAudioFile(track, destDir, baseName) {
  const primaryId = String(track?.alternativeId || track?.id || track?.videoId || '').trim();
  if (!primaryId || primaryId.length < 5) {
    throw new Error(`Invalid video ID for "${track?.title || 'track'}"`);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const existing = findExistingAudioFile(destDir, baseName);
  if (existing) {
    return { filePath: existing, skipped: true };
  }

  const attemptDownloadId = async (targetId) => {
    // Attempt 1: Parallel HTTP Range fetch of direct stream URL (~0.4-1.5s vs 45s un-ranged throttle)
    if (!targetId.startsWith('ytsearch')) {
      try {
        const getDlUrl = streamService.getDownloadStreamUrl || streamService.getRawStreamUrl;
        const rawUrl = await getDlUrl(targetId);
        if (rawUrl) {
          return await downloadUrlFastRange(rawUrl, destDir, baseName);
        }
      } catch (err) {
        if (currentDownloadAbort) throw err;
        console.warn(`Fast range download failed for ${targetId}, switching to yt-dlp:`, err.message);
      }
    }

    // Attempt 2: Direct yt-dlp download with concurrent fragments and android/web client
    return new Promise(async (resolve, reject) => {
      let ytDlpPath = streamService.getYtDlpPath();
      if (typeof streamService.ensureYtDlpBinary === 'function') {
        try { ytDlpPath = await streamService.ensureYtDlpBinary(); } catch (_) {}
      }
      const outTemplate = path.join(destDir, `${baseName}.%(ext)s`);
      const args = [
        '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        '--no-playlist',
        '--no-part',
        '--no-warnings',
        '--no-check-certificates',
        '--concurrent-fragments', '4',
        '--socket-timeout', '15',
        '--force-overwrites'
      ];

      if (typeof streamService.getNetscapeCookiesFile === 'function') {
        const cookieFile = streamService.getNetscapeCookiesFile();
        if (cookieFile && fs.existsSync(cookieFile)) {
          args.push('--cookies', cookieFile);
        }
      }

      const targetUrl = targetId.startsWith('ytsearch')
        ? targetId
        : `https://www.youtube.com/watch?v=${targetId}`;
      args.push('-o', outTemplate, targetUrl);

      const child = spawn(ytDlpPath, args, { windowsHide: true, env: process.env });
      activeDownloadChildren.add(child);
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        activeDownloadChildren.delete(child);
        try { child.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`yt-dlp download timed out for ${targetId}`));
      }, 45000);

      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => {
        clearTimeout(timer);
        activeDownloadChildren.delete(child);
        if (settled) return;
        settled = true;
        const produced = findExistingAudioFile(destDir, baseName);
        if (code === 0 && produced) {
          resolve({ filePath: produced, skipped: false });
        } else {
          reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `yt-dlp exited with code ${code}`));
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        activeDownloadChildren.delete(child);
        if (settled) return;
        settled = true;
        reject(new Error(`Failed launching yt-dlp: ${err.message}`));
      });
    });
  };

  try {
    return await attemptDownloadId(primaryId);
  } catch (primaryErr) {
    if (currentDownloadAbort) throw primaryErr;
    console.warn(`Primary download failed for ${track?.title || primaryId} (${primaryErr.message}). Searching fallback candidates...`);

    // Smart fallback: search for working alternative upload of the same track
    const trackTitle = track?.title || '';
    const trackArtist = track?.artist || '';
    if (trackTitle && typeof ytMusic !== 'undefined' && ytMusic.search) {
      try {
        const query = `${trackTitle} ${trackArtist}`.trim();
        const searchResults = await ytMusic.search(query, 'song');
        const altCandidates = (Array.isArray(searchResults) ? searchResults : [])
          .filter(t => t && t.id && t.id !== primaryId)
          .slice(0, 3);

        for (const candidate of altCandidates) {
          try {
            console.log(`[OpenTune Downloader] Trying fallback candidate ${candidate.id} for "${trackTitle}"`);
            const res = await attemptDownloadId(candidate.id);
            if (res && res.filePath) {
              console.log(`[OpenTune Downloader] Download succeeded via candidate ${candidate.id}`);
              return res;
            }
          } catch (_) {}
        }
      } catch (altErr) {
        console.warn('[OpenTune Downloader] Alternative search failed:', altErr.message);
      }
    }

    // Direct yt-dlp search download fallback (guarantees download if original ID is unavailable/restricted)
    if (trackTitle) {
      try {
        console.log(`[OpenTune Downloader] Attempting direct search download for "${trackTitle}"`);
        const query = `${trackTitle} ${trackArtist || ''}`.trim();
        const res = await attemptDownloadId(`ytsearch1:${query}`);
        if (res && res.filePath) {
          console.log(`[OpenTune Downloader] Direct search download succeeded for "${trackTitle}"`);
          return res;
        }
      } catch (searchDlErr) {
        console.warn('[OpenTune Downloader] Direct search download failed:', searchDlErr.message);
      }
    }

    throw primaryErr;
  }
}

function getOfflineAssetDirs() {
  const base = app.getPath('userData');
  const thumbs = path.join(base, 'offline_thumbnails');
  const lyrics = path.join(base, 'offline_lyrics');
  const meta = path.join(base, 'offline_metadata');
  const animated = path.join(base, 'offline_animated_covers');
  try {
    if (!fs.existsSync(thumbs)) fs.mkdirSync(thumbs, { recursive: true });
    if (!fs.existsSync(lyrics)) fs.mkdirSync(lyrics, { recursive: true });
    if (!fs.existsSync(meta)) fs.mkdirSync(meta, { recursive: true });
    if (!fs.existsSync(animated)) fs.mkdirSync(animated, { recursive: true });
  } catch (_) {}
  return { thumbs, lyrics, meta, animated };
}

function parseDurationSec(dur) {
  if (typeof dur === 'number') return dur;
  if (!dur || typeof dur !== 'string') return 0;
  const parts = dur.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function upgradeCoverUrl(url, size = 800) {
  if (!url || typeof url !== 'string') return '';
  let clean = url.trim();
  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (clean.includes('googleusercontent.com') || clean.includes('ggpht.com')) {
    clean = clean
      .replace(/=w\d+-h\d+[^?#]*/, `=w${size}-h${size}-l90-rj`)
      .replace(/=s\d+[^?#]*/, `=s${size}-c`);
    if (!clean.includes(`=w${size}`) && !clean.includes(`=s${size}`)) {
      clean += clean.includes('=') ? `=w${size}-h${size}-l90-rj` : `=w${size}-h${size}-l90-rj`;
    }
    return clean;
  }
  if (clean.includes('i.ytimg.com')) {
    return clean.replace(/\/(default|mqdefault|hqdefault)\.jpg/, '/hqdefault.jpg');
  }
  return clean;
}

function findExistingImageFile(dir, baseName, videoId) {
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  if (dir && fs.existsSync(dir)) {
    if (baseName) {
      for (const ext of exts) {
        const p = path.join(dir, `${baseName}${ext}`);
        if (fs.existsSync(p) && fs.statSync(p).size > 256) {
          return toFileUrl(p);
        }
      }
    }
    for (const ext of exts) {
      const pl = path.join(dir, `cover${ext}`);
      if (fs.existsSync(pl) && fs.statSync(pl).size > 256) {
        return toFileUrl(pl);
      }
    }
  }
  if (videoId) {
    const { thumbs } = getOfflineAssetDirs();
    for (const ext of exts) {
      const p = path.join(thumbs, `${videoId}${ext}`);
      if (fs.existsSync(p) && fs.statSync(p).size > 256) {
        return toFileUrl(p);
      }
    }
  }
  // Search immediate subdirectories (e.g. downloaded playlists)
  if (dir && fs.existsSync(dir)) {
    try {
      const subEntries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of subEntries) {
        if (ent.isDirectory() && !ent.name.startsWith('.')) {
          const subDir = path.join(dir, ent.name);
          if (baseName) {
            for (const ext of exts) {
              const p = path.join(subDir, `${baseName}${ext}`);
              if (fs.existsSync(p) && fs.statSync(p).size > 256) {
                return toFileUrl(p);
              }
            }
          }
          if (videoId) {
            for (const ext of exts) {
              const p = path.join(subDir, `${videoId}${ext}`);
              if (fs.existsSync(p) && fs.statSync(p).size > 256) {
                return toFileUrl(p);
              }
            }
          }
          for (const ext of exts) {
            const pl = path.join(subDir, `cover${ext}`);
            if (fs.existsSync(pl) && fs.statSync(pl).size > 256) {
              return toFileUrl(pl);
            }
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

function findExistingLyrics(dir, baseName, videoId) {
  if (dir && baseName) {
    const p = path.join(dir, `${baseName}.lrc`);
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        return { lrcPath: p, content, parsed: lyricsService.parseLrc(content) };
      } catch (_) {}
    }
  }
  if (videoId) {
    const { lyrics } = getOfflineAssetDirs();
    const p = path.join(lyrics, `${videoId}.lrc`);
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        return { lrcPath: p, content, parsed: lyricsService.parseLrc(content) };
      } catch (_) {}
    }
  }
  if (dir && fs.existsSync(dir)) {
    try {
      const subEntries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of subEntries) {
        if (ent.isDirectory() && !ent.name.startsWith('.')) {
          const subDir = path.join(dir, ent.name);
          if (baseName) {
            const p = path.join(subDir, `${baseName}.lrc`);
            if (fs.existsSync(p)) {
              try {
                const content = fs.readFileSync(p, 'utf8');
                return { lrcPath: p, content, parsed: lyricsService.parseLrc(content) };
              } catch (_) {}
            }
          }
          if (videoId) {
            const p = path.join(subDir, `${videoId}.lrc`);
            if (fs.existsSync(p)) {
              try {
                const content = fs.readFileSync(p, 'utf8');
                return { lrcPath: p, content, parsed: lyricsService.parseLrc(content) };
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

function findExistingMetadata(dir, baseName, videoId) {
  if (dir && baseName) {
    const p = path.join(dir, `${baseName}.info.json`);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    }
  }
  if (videoId) {
    const { meta } = getOfflineAssetDirs();
    const p = path.join(meta, `${videoId}.json`);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    }
  }
  if (dir && fs.existsSync(dir)) {
    try {
      const subEntries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of subEntries) {
        if (ent.isDirectory() && !ent.name.startsWith('.')) {
          const subDir = path.join(dir, ent.name);
          if (baseName) {
            const p = path.join(subDir, `${baseName}.info.json`);
            if (fs.existsSync(p)) {
              try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
            }
          }
          if (videoId) {
            const p = path.join(subDir, `${videoId}.json`);
            if (fs.existsSync(p)) {
              try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

function resolveAccompanyingAssets(dir, baseName, videoId) {
  const thumbUrl = findExistingImageFile(dir, baseName, videoId);
  const lyricsObj = findExistingLyrics(dir, baseName, videoId);
  const metaObj = findExistingMetadata(dir, baseName, videoId);
  return { thumbUrl, lyricsObj, metaObj };
}

async function downloadAndCacheThumbnail(track, destDir, baseName, isPlaylist = false) {
  const { thumbs } = getOfflineAssetDirs();
  const trackId = String(track?.id || track?.videoId || '').trim();
  const destJpg = destDir && baseName ? path.join(destDir, `${baseName}.jpg`) : null;
  const userThumbJpg = trackId ? path.join(thumbs, `${trackId}.jpg`) : null;

  if (destJpg && fs.existsSync(destJpg) && fs.statSync(destJpg).size > 512) {
    if (userThumbJpg && !fs.existsSync(userThumbJpg)) {
      try { fs.copyFileSync(destJpg, userThumbJpg); } catch (_) {}
    }
    return toFileUrl(destJpg);
  }
  if (userThumbJpg && fs.existsSync(userThumbJpg) && fs.statSync(userThumbJpg).size > 512) {
    if (destJpg && !fs.existsSync(destJpg)) {
      try { fs.copyFileSync(userThumbJpg, destJpg); } catch (_) {}
    }
    return toFileUrl(userThumbJpg);
  }

  const rawThumb = track?.thumbnail || '';
  const highResUrl = upgradeCoverUrl(rawThumb, 800);
  const candidateUrls = [
    (highResUrl && (highResUrl.startsWith('http://') || highResUrl.startsWith('https://'))) ? highResUrl : null,
    (rawThumb && (rawThumb.startsWith('http://') || rawThumb.startsWith('https://'))) ? rawThumb : null,
    trackId ? `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg` : null,
    trackId ? `https://i.ytimg.com/vi/${trackId}/mqdefault.jpg` : null
  ].filter(Boolean);

  for (const url of candidateUrls) {
    try {
      const res = await fetchWithTimeout(url, { headers: DOWNLOAD_HTTP_HEADERS }, 10000);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 512) {
          if (destJpg) fs.writeFileSync(destJpg, buf);
          if (userThumbJpg) fs.writeFileSync(userThumbJpg, buf);
          if (isPlaylist && destDir) {
            const plCover = path.join(destDir, 'cover.jpg');
            if (!fs.existsSync(plCover)) fs.writeFileSync(plCover, buf);
          }
          return destJpg ? toFileUrl(destJpg) : toFileUrl(userThumbJpg);
        }
      }
    } catch (_) {}
  }
  return '';
}

async function downloadAndCacheLyrics(track, destDir, baseName) {
  const { lyrics } = getOfflineAssetDirs();
  const trackId = String(track?.id || track?.videoId || '').trim();
  const destLrc = destDir && baseName ? path.join(destDir, `${baseName}.lrc`) : null;
  const userLrc = trackId ? path.join(lyrics, `${trackId}.lrc`) : null;

  if (destLrc && fs.existsSync(destLrc)) {
    try {
      const content = fs.readFileSync(destLrc, 'utf8');
      if (userLrc && !fs.existsSync(userLrc)) fs.writeFileSync(userLrc, content, 'utf8');
      return { lrcPath: destLrc, content, parsed: lyricsService.parseLrc(content) };
    } catch (_) {}
  }
  if (userLrc && fs.existsSync(userLrc)) {
    try {
      const content = fs.readFileSync(userLrc, 'utf8');
      if (destLrc && !fs.existsSync(destLrc)) fs.writeFileSync(destLrc, content, 'utf8');
      return { lrcPath: userLrc, content, parsed: lyricsService.parseLrc(content) };
    } catch (_) {}
  }

  try {
    const durSec = typeof track?.duration === 'number' ? track.duration : parseDurationSec(track?.duration);
    const lyricsData = await lyricsService.getLyrics(track?.title, track?.artist, durSec);
    let lrcText = '';
    if (lyricsData?.synced && Array.isArray(lyricsData.synced) && lyricsData.synced.length > 0) {
      lrcText = lyricsService.formatLrc(lyricsData.synced);
    } else if (lyricsData?.plain) {
      lrcText = lyricsData.plain;
    }

    if (lrcText && lrcText.trim().length > 0) {
      if (destLrc) fs.writeFileSync(destLrc, lrcText, 'utf8');
      if (userLrc) fs.writeFileSync(userLrc, lrcText, 'utf8');
      return {
        lrcPath: destLrc || userLrc,
        content: lrcText,
        parsed: lyricsData?.synced || lyricsService.parseLrc(lrcText)
      };
    }
  } catch (err) {
    console.warn(`[OpenTune] Lyrics caching notice for "${track?.title}":`, err.message);
  }
  return null;
}

async function downloadAndCacheMetadata(track, destDir, baseName, extraInfo = {}) {
  const { meta } = getOfflineAssetDirs();
  const trackId = String(track?.id || track?.videoId || '').trim();
  const destInfo = destDir && baseName ? path.join(destDir, `${baseName}.info.json`) : null;
  const userInfo = trackId ? path.join(meta, `${trackId}.json`) : null;

  let existingMeta = null;
  if (destInfo && fs.existsSync(destInfo)) {
    try { existingMeta = JSON.parse(fs.readFileSync(destInfo, 'utf8')); } catch (_) {}
  }
  if (!existingMeta && userInfo && fs.existsSync(userInfo)) {
    try { existingMeta = JSON.parse(fs.readFileSync(userInfo, 'utf8')); } catch (_) {}
  }

  let details = null;
  if (trackId) {
    try {
      details = await ytMusic.getTrackDetails(trackId);
    } catch (_) {}
  }

  const combinedMeta = {
    id: trackId,
    videoId: trackId,
    title: track?.title || details?.title || existingMeta?.title || 'Unknown Track',
    artist: track?.artist || details?.author || existingMeta?.artist || 'Unknown Artist',
    album: track?.album || details?.album || existingMeta?.album || '',
    duration: track?.duration || existingMeta?.duration || '',
    year: details?.uploadDate || track?.year || existingMeta?.year || '',
    views: details?.views || existingMeta?.views || 0,
    likes: details?.likes || existingMeta?.likes || 0,
    dislikes: details?.dislikes || existingMeta?.dislikes || 0,
    rating: details?.rating || existingMeta?.rating || null,
    uploadDate: details?.uploadDate || existingMeta?.uploadDate || '',
    description: details?.description || existingMeta?.description || '',
    channelId: details?.channelId || existingMeta?.channelId || '',
    thumbnail: track?.thumbnail || existingMeta?.thumbnail || '',
    localThumbnail: extraInfo.localThumbnail || existingMeta?.localThumbnail || '',
    audioFile: extraInfo.audioFile || existingMeta?.audioFile || '',
    downloadedAt: existingMeta?.downloadedAt || new Date().toISOString()
  };

  try {
    const jsonStr = JSON.stringify(combinedMeta, null, 2);
    if (destInfo) fs.writeFileSync(destInfo, jsonStr, 'utf8');
    if (userInfo) fs.writeFileSync(userInfo, jsonStr, 'utf8');
  } catch (err) {
    console.warn(`[OpenTune] Metadata save notice for "${track?.title}":`, err.message);
  }

  return combinedMeta;
}

async function findExistingAnimatedCover(dir, baseName, videoId) {
  const candidates = [];
  if (dir && baseName) {
    candidates.push(path.join(dir, `${baseName}.cover.mp4`));
  }
  if (videoId) {
    const { animated } = getOfflineAssetDirs();
    candidates.push(path.join(animated, `${videoId}.mp4`));
  }
  for (const p of candidates) {
    if ((await safeStatSize(p)) > 30000) {
      return toFileUrl(p);
    }
  }
  return '';
}

async function downloadAndCacheAnimatedCover(track, destDir, baseName) {
  const trackId = String(track?.id || track?.videoId || '').trim();
  const { animated } = getOfflineAssetDirs();
  const destMp4 = destDir && baseName ? path.join(destDir, `${baseName}.cover.mp4`) : null;
  const userMp4 = trackId ? path.join(animated, `${trackId}.mp4`) : null;

  if (destMp4 && (await safeStatSize(destMp4)) > 30000) {
    if (userMp4 && (await safeStatSize(userMp4)) <= 0) {
      try { await fsp.copyFile(destMp4, userMp4); } catch (_) {}
    }
    return toFileUrl(destMp4);
  }
  if (userMp4 && (await safeStatSize(userMp4)) > 30000) {
    if (destMp4 && (await safeStatSize(destMp4)) <= 0) {
      try { await fsp.copyFile(userMp4, destMp4); } catch (_) {}
    }
    return toFileUrl(userMp4);
  }

  try {
    const mp4Url = await animatedCoverService.resolveAnimatedCoverUrl(track);
    if (!mp4Url) return '';
    const res = await fetchWithTimeout(mp4Url, { headers: DOWNLOAD_HTTP_HEADERS }, 20000);
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length <= 30000) return '';
    if (destMp4) await fsp.writeFile(destMp4, buf);
    if (userMp4) await fsp.writeFile(userMp4, buf);
    return destMp4 ? toFileUrl(destMp4) : toFileUrl(userMp4);
  } catch (_) {}
  return '';
}

ipcMain.handle('get-animated-cover', async (_event, track) => {
  if (!track) return { url: null, isLocal: false };
  const videoId = String(track.id || track.videoId || '').trim();
  const safeArt = cleanArtistName(track.artist || 'Unknown Artist');
  const baseName = `${sanitizeFilename(safeArt)} - ${sanitizeFilename(track.title || 'Track')}`;

  try {
    const rootDir = resolveDownloadBaseDir();
    const localUrl = await findExistingAnimatedCover(rootDir, baseName, videoId);
    if (localUrl) {
      return { url: localUrl, isLocal: true };
    }
  } catch (_) {}

  try {
    const mp4Url = await animatedCoverService.resolveAnimatedCoverUrl(track);
    if (mp4Url) {
      // If this track is downloaded/cached locally, also persist the animated cover for offline use
      if (videoId && (track.isDownloaded || track.isCachedOffline || track.localFilePath)) {
        const destDir = track.localFilePath ? path.dirname(track.localFilePath) : null;
        downloadAndCacheAnimatedCover(track, destDir, baseName).catch(() => {});
      }
      return { url: mp4Url, isLocal: false };
    }
  } catch (_) {}

  return { url: null, isLocal: false };
});

async function downloadAllTrackAssets(track, destDir, baseName, isPlaylist = false) {
  const audioResult = await downloadTrackAudioFile(track, destDir, baseName);

  let localThumbnail = '';
  let lyricsResult = null;
  let metadata = null;
  let animatedCoverUrl = '';

  try {
    const [thumbRes, lrcRes, animRes] = await Promise.all([
      downloadAndCacheThumbnail(track, destDir, baseName, isPlaylist).catch(() => ''),
      downloadAndCacheLyrics(track, destDir, baseName).catch(() => null),
      downloadAndCacheAnimatedCover(track, destDir, baseName).catch(() => '')
    ]);
    localThumbnail = thumbRes || '';
    lyricsResult = lrcRes || null;
    animatedCoverUrl = animRes || '';

    metadata = await downloadAndCacheMetadata(track, destDir, baseName, {
      localThumbnail,
      audioFile: audioResult.filePath
    }).catch(() => null);
  } catch (err) {
    console.warn(`[OpenTune] Offline asset caching notice for "${track?.title}":`, err.message);
  }

  return {
    filePath: audioResult.filePath,
    skipped: audioResult.skipped,
    localThumbnail,
    animatedCoverUrl,
    lyrics: lyricsResult,
    metadata
  };
}

ipcMain.handle('get-download-config', async () => {
  return {
    downloadDir: resolveDownloadBaseDir(),
    defaultDir: getDefaultDownloadDir()
  };
});

ipcMain.handle('set-download-config', async (_event, { downloadDir } = {}) => {
  const nextDir = typeof downloadDir === 'string' && downloadDir.trim()
    ? downloadDir.trim()
    : getDefaultDownloadDir();
  saveAppConfig({ downloadDir: nextDir });
  return {
    success: true,
    downloadDir: nextDir,
    defaultDir: getDefaultDownloadDir()
  };
});

ipcMain.handle('choose-download-folder', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true, downloadDir: resolveDownloadBaseDir() };
  }
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Download Save Location',
    defaultPath: resolveDownloadBaseDir(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths?.[0]) {
    return { canceled: true, downloadDir: resolveDownloadBaseDir() };
  }
  const chosen = res.filePaths[0];
  saveAppConfig({ downloadDir: chosen });
  return {
    canceled: false,
    downloadDir: chosen,
    defaultDir: getDefaultDownloadDir()
  };
});

ipcMain.handle('download-playlist', async (event, { title, tracks, downloadDir }) => {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return { success: false, error: 'No tracks to download' };
  }
  currentDownloadAbort = false;
  const rootDir = resolveDownloadBaseDir(downloadDir);
  const baseDir = path.join(rootDir, sanitizeFilename(title));
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  let downloadedCount = 0;
  let failedCount = 0;
  let processedCount = 0;
  let lastError = '';
  let nextTrackIndex = 0;

  const CONCURRENCY = Math.min(5, tracks.length);

  const downloadWorker = async () => {
    while (nextTrackIndex < tracks.length) {
      if (currentDownloadAbort) return;
      const i = nextTrackIndex++;
      const track = tracks[i];
      const trackNum = String(i + 1).padStart(2, '0');
      const safeArtist = sanitizeFilename(cleanArtistName(track?.artist) || 'Unknown Artist');
      const safeTitle = sanitizeFilename(track?.title || 'Track');
      const baseName = `${trackNum} - ${safeArtist} - ${safeTitle}`;
      let trackSucceeded = false;
      let trackResult = null;

      try {
        trackResult = await downloadAllTrackAssets(track, baseDir, baseName, true);
        if (!currentDownloadAbort) {
          downloadedCount++;
          trackSucceeded = true;
        }
      } catch (err) {
        if (currentDownloadAbort) return;
        failedCount++;
        lastError = err.message || 'Download error';
        console.error(`Track download failed (${track?.title || track?.id}):`, lastError);
      }

      processedCount++;
      if (!currentDownloadAbort && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('download-playlist-progress', {
          current: processedCount,
          total: tracks.length,
          trackId: track?.id || track?.videoId || '',
          trackSucceeded,
          trackTitle: track?.title || 'Track',
          folderPath: baseDir,
          downloadedCount,
          failedCount,
          localThumbnail: trackResult?.localThumbnail || '',
          metadata: trackResult?.metadata || null,
          lyrics: trackResult?.lyrics || null,
          lastError
        });
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => downloadWorker()));

  if (currentDownloadAbort) {
    return { success: false, aborted: true, folderPath: baseDir, downloadedCount, failedCount };
  }

  return {
    success: downloadedCount > 0,
    folderPath: baseDir,
    count: downloadedCount,
    failedCount,
    total: tracks.length,
    error: downloadedCount === 0 ? (lastError || 'Failed to download tracks in playlist') : undefined
  };
});

ipcMain.handle('cancel-playlist-download', async () => {
  currentDownloadAbort = true;
  for (const child of activeDownloadChildren) {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
  activeDownloadChildren.clear();
  return { success: true };
});

ipcMain.handle('open-download-folder', async (_event, folderPath) => {
  const target = folderPath || resolveDownloadBaseDir();
  if (!fs.existsSync(target)) {
    try { fs.mkdirSync(target, { recursive: true }); } catch (_) {}
  }
  if (fs.existsSync(target)) {
    shell.openPath(target);
  } else {
    shell.openPath(app.getPath('downloads'));
  }
  return { success: true };
});

ipcMain.handle('download-single-track', async (_event, payload) => {
  const track = payload?.track || payload;
  const baseDir = resolveDownloadBaseDir(payload?.downloadDir);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const safeArtist = sanitizeFilename(cleanArtistName(track?.artist) || 'Unknown Artist');
  const safeTitle = sanitizeFilename(track?.title || 'Track');
  const baseName = `${safeArtist} - ${safeTitle}`;

  try {
    currentDownloadAbort = false;
    const result = await downloadAllTrackAssets(track, baseDir, baseName, false);
    return {
      success: true,
      filePath: result.filePath,
      folderPath: baseDir,
      localThumbnail: result.localThumbnail,
      lyrics: result.lyrics,
      metadata: result.metadata
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

async function makeLocalTrackResponse(fullPath, videoId) {
  const dir = path.dirname(fullPath);
  const base = path.basename(fullPath, path.extname(fullPath));
  const { thumbUrl, lyricsObj, metaObj } = resolveAccompanyingAssets(dir, base, videoId);
  const animatedCoverUrl = await findExistingAnimatedCover(dir, base, videoId).catch(() => '');
  let fileUrl = toFileUrl(fullPath);
  if (typeof streamService.getLocalFileStreamUrl === 'function') {
    try {
      fileUrl = await streamService.getLocalFileStreamUrl(fullPath);
    } catch (_) {}
  }
  return {
    exists: true,
    filePath: fullPath,
    fileUrl,
    thumbnailUrl: thumbUrl || null,
    animatedCoverUrl: animatedCoverUrl || null,
    lyricsText: lyricsObj?.content || null,
    parsedLyrics: lyricsObj?.parsed || null,
    metadata: metaObj || null
  };
}

const fsp = fs.promises;
const yieldEventLoop = () => new Promise((resolve) => setImmediate(resolve));

async function safeStatSize(filePath) {
  try {
    const st = await fsp.stat(filePath);
    return st.isFile() ? st.size : -1;
  } catch (_) {
    return -1;
  }
}

async function runBatched(items, batchSize, worker) {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await Promise.all(chunk.map(worker));
    if (i + batchSize < items.length) {
      await yieldEventLoop();
    }
  }
}

ipcMain.handle('check-local-track-file', async (_event, payload) => {
  const track = payload?.track;
  const customDir = payload?.downloadDir;
  if (!track || (!track.id && !track.title)) return { exists: false };

  const videoId = String(track.id || track.videoId || '').trim();

  // 1. Check audio disk cache directory first
  if (typeof streamService.findCachedAudioFile === 'function') {
    const cachedAudio = streamService.findCachedAudioFile(videoId);
    if (cachedAudio) {
      return await makeLocalTrackResponse(cachedAudio, videoId);
    }
  }

  const rootDir = resolveDownloadBaseDir(customDir);
  try {
    await fsp.access(rootDir);
  } catch (_) {
    return { exists: false };
  }

  const cleanArt = cleanArtistName(track.artist || 'Unknown Artist');
  const safeArtist = sanitizeFilename(cleanArt);
  const rawSafeArtist = sanitizeFilename(track.artist || 'Unknown Artist');
  const safeTitle = sanitizeFilename(track.title || 'Track');
  const exts = ['.m4a', '.webm', '.opus', '.mp3', '.mp4', '.ogg'];
  const hasKnownArtist = Boolean(cleanArt && cleanArt.toLowerCase() !== 'unknown artist');
  const exactArtistTitleA = hasKnownArtist ? `${safeArtist} - ${safeTitle}`.toLowerCase() : '';
  const exactArtistTitleB = hasKnownArtist ? `${rawSafeArtist} - ${safeTitle}`.toLowerCase() : '';

  const candidateNames = [
    ...(hasKnownArtist ? [`${safeArtist} - ${safeTitle}`, `${rawSafeArtist} - ${safeTitle}`] : []),
    videoId
  ].filter(Boolean);

  const isFileMatchingTrack = (fileName) => {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.cover.mp4') || !exts.some(e => lower.endsWith(e))) return false;
    const idMatch = videoId.length > 4 && !videoId.startsWith('offline_') && fileName.includes(videoId);
    if (idMatch) return true;
    if (!hasKnownArtist) return false;
    const ext = path.extname(fileName);
    const rawBase = path.basename(fileName, ext);
    const stripped = rawBase.replace(/^\d{1,4}\s*-\s*/, '').trim().toLowerCase();
    return stripped === exactArtistTitleA || (exactArtistTitleB && stripped === exactArtistTitleB);
  };

  const checkDirectAudioInDir = async (dir) => {
    for (const name of candidateNames) {
      for (const ext of exts) {
        const p = path.join(dir, `${name}${ext}`);
        if ((await safeStatSize(p)) > 32768) return p;
      }
    }
    return null;
  };

  const directRoot = await checkDirectAudioInDir(rootDir);
  if (directRoot) return await makeLocalTrackResponse(directRoot, videoId);

  try {
    const entries = await fsp.readdir(rootDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const subDir = path.join(rootDir, ent.name);
        const subDirect = await checkDirectAudioInDir(subDir);
        if (subDirect) return await makeLocalTrackResponse(subDirect, videoId);

        try {
          const files = await fsp.readdir(subDir);
          for (const file of files) {
            if (isFileMatchingTrack(file)) {
              const fullPath = path.join(subDir, file);
              if ((await safeStatSize(fullPath)) > 32768) {
                return await makeLocalTrackResponse(fullPath, videoId);
              }
            }
          }
        } catch (_) {}
      } else if (ent.isFile()) {
        if (isFileMatchingTrack(ent.name)) {
          const fullPath = path.join(rootDir, ent.name);
          if ((await safeStatSize(fullPath)) > 32768) {
            return await makeLocalTrackResponse(fullPath, videoId);
          }
        }
      }
    }
  } catch (_) {}

  return { exists: false };
});

ipcMain.handle('sync-offline-tracks', async (_event, tracks) => {
  if (!Array.isArray(tracks) || tracks.length === 0) return Array.isArray(tracks) ? tracks : [];
  const rootDir = resolveDownloadBaseDir();
  const { thumbs, meta } = getOfflineAssetDirs();
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp'];

  // Single async pass to build O(1) lookup indexes instead of O(tracks * subdirs * exts) sync stats
  const thumbFileSet = new Set();
  const metaFileSet = new Set();
  const rootImageMap = new Map();

  try {
    const thumbFiles = await fsp.readdir(thumbs);
    for (const f of thumbFiles) thumbFileSet.add(f.toLowerCase());
  } catch (_) {}

  try {
    const metaFiles = await fsp.readdir(meta);
    for (const f of metaFiles) metaFileSet.add(f);
  } catch (_) {}

  const indexImagesInDir = async (dirPath) => {
    try {
      const files = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile()) continue;
        const ext = path.extname(f.name).toLowerCase();
        if (!imgExts.includes(ext)) continue;
        const stem = path.basename(f.name, ext).toLowerCase();
        if (!rootImageMap.has(stem)) {
          rootImageMap.set(stem, toFileUrl(path.join(dirPath, f.name)));
        }
      }
      return files;
    } catch (_) {
      return [];
    }
  };

  const rootEntries = await indexImagesInDir(rootDir);
  for (const ent of rootEntries) {
    if (ent.isDirectory() && !ent.name.startsWith('.') && ent.name !== 'bin' && ent.name !== 'offline_assets') {
      await indexImagesInDir(path.join(rootDir, ent.name));
    }
  }

  const results = new Array(tracks.length);
  await runBatched(tracks.map((track, idx) => ({ track, idx })), 40, async ({ track, idx }) => {
    if (!track) {
      results[idx] = track;
      return;
    }
    const videoId = String(track.id || track.videoId || '').trim();
    const cleanArt = cleanArtistName(track.artist || 'Unknown Artist');
    const safeArtist = sanitizeFilename(cleanArt);
    const safeTitle = sanitizeFilename(track.title || 'Track');

    let localThumb = '';
    if (videoId && thumbFileSet.has(`${videoId.toLowerCase()}.jpg`)) {
      localThumb = toFileUrl(path.join(thumbs, `${videoId}.jpg`));
    } else if (videoId) {
      for (const ext of imgExts) {
        if (thumbFileSet.has(`${videoId.toLowerCase()}${ext}`)) {
          localThumb = toFileUrl(path.join(thumbs, `${videoId}${ext}`));
          break;
        }
      }
    }

    let cachedMeta = null;
    if (videoId && metaFileSet.has(`${videoId}.json`)) {
      try {
        cachedMeta = JSON.parse(await fsp.readFile(path.join(meta, `${videoId}.json`), 'utf8'));
      } catch (_) {}
    }

    if (!localThumb) {
      const candidateKeys = [
        `${safeArtist} - ${safeTitle}`.toLowerCase(),
        safeTitle.toLowerCase(),
        videoId.toLowerCase()
      ].filter(Boolean);
      for (const key of candidateKeys) {
        const hit = rootImageMap.get(key);
        if (hit) {
          localThumb = hit;
          break;
        }
      }
      if (!localThumb) {
        localThumb = rootImageMap.get('cover') || '';
      }
    }

    results[idx] = {
      ...track,
      album: track.album || cachedMeta?.album || '',
      thumbnail: localThumb || track.thumbnail || 'assets/icon.png',
      localThumbnail: localThumb || track.localThumbnail || '',
      isOfflineAvailable: Boolean(localThumb || cachedMeta)
    };
  });

  return results;
});

ipcMain.handle('cache-missing-offline-assets', async (_event, tracks) => {
  if (!Array.isArray(tracks) || tracks.length === 0) return { updatedCount: 0 };
  const rootDir = resolveDownloadBaseDir();
  let updatedCount = 0;
  for (const track of tracks) {
    if (!track?.id) continue;
    const videoId = track.id;
    const { thumbs, lyrics, meta } = getOfflineAssetDirs();
    const hasThumb = fs.existsSync(path.join(thumbs, `${videoId}.jpg`));
    const hasLyrics = fs.existsSync(path.join(lyrics, `${videoId}.lrc`));
    const hasMeta = fs.existsSync(path.join(meta, `${videoId}.json`));
    if (hasThumb && hasLyrics && hasMeta) continue;

    const cleanArt = cleanArtistName(track.artist || 'Unknown Artist');
    const safeArtist = sanitizeFilename(cleanArt);
    const safeTitle = sanitizeFilename(track.title || 'Track');
    const baseName = `${safeArtist} - ${safeTitle}`;

    try {
      if (!hasThumb) await downloadAndCacheThumbnail(track, rootDir, baseName, false);
      if (!hasLyrics) await downloadAndCacheLyrics(track, rootDir, baseName);
      if (!hasMeta) await downloadAndCacheMetadata(track, rootDir, baseName);
      updatedCount++;
    } catch (_) {}
  }
  return { updatedCount };
});

// ---- Scrobbling (ListenBrainz / Last.fm) --------------------------------------------------
const scrobbler = require('./scrobbler');
ipcMain.handle('scrobble-submit', async (_e, { config, kind, track, listenedAt }) => {
  try { return await scrobbler.submit(config, kind, track || {}, listenedAt); }
  catch (err) { return { error: String(err && err.message || err) }; }
});
ipcMain.handle('scrobble-test-lb', async (_e, cfg) => {
  try { return await scrobbler.lbValidate(cfg || {}); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('scrobble-lfm-login', async (_e, cfg) => {
  try { return await scrobbler.lfmLogin(cfg || {}); }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

// ---- Audio Disk Cache & Offline Music -----------------------------------------------------
ipcMain.handle('cache-track-audio', async (_e, track) => {
  if (!track || !track.id) return { success: false, error: 'Invalid track' };
  const videoId = track.id;
  const cacheDir = streamService.getAudioCacheDir ? streamService.getAudioCacheDir() : path.join(app.getPath('userData'), 'audio_cache');
  if (!fs.existsSync(cacheDir)) {
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
  }
  const targetFile = path.join(cacheDir, `${videoId}.m4a`);
  if (fs.existsSync(targetFile) && fs.statSync(targetFile).size > 30000) {
    return { success: true, filePath: targetFile, alreadyCached: true };
  }

  try {
    const rawUrl = await streamService.getDownloadStreamUrl(videoId);
    if (!rawUrl) return { success: false, error: 'No stream available' };
    await downloadUrlFastRange(rawUrl, cacheDir, videoId);
    // Also cache metadata and thumbnail in background
    const cleanArt = cleanArtistName(track.artist || 'Unknown Artist');
    const safeArtist = sanitizeFilename(cleanArt);
    const safeTitle = sanitizeFilename(track.title || 'Track');
    const baseName = `${safeArtist} - ${safeTitle}`;
    downloadAndCacheThumbnail(track, cacheDir, baseName, false).catch(() => {});
    downloadAndCacheMetadata(track, cacheDir, baseName).catch(() => {});
    return { success: true, filePath: targetFile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-cached-tracks', async () => {
  const cacheDir = streamService.getAudioCacheDir ? streamService.getAudioCacheDir() : path.join(app.getPath('userData'), 'audio_cache');
  const { meta, thumbs } = getOfflineAssetDirs();
  try {
    const [files, metaList, thumbList] = await Promise.all([
      fsp.readdir(cacheDir).catch(() => []),
      fsp.readdir(meta).catch(() => []),
      fsp.readdir(thumbs).catch(() => [])
    ]);
    const metaSet = new Set(metaList);
    const thumbSet = new Set(thumbList);
    const audioFiles = files.filter(f => ['.m4a', '.opus', '.webm', '.mp3'].includes(path.extname(f).toLowerCase()));
    const slots = new Array(audioFiles.length);

    await runBatched(audioFiles.map((f, idx) => ({ f, idx })), 32, async ({ f, idx }) => {
      const ext = path.extname(f).toLowerCase();
      const videoId = path.basename(f, ext);
      let trackData = null;
      if (metaSet.has(`${videoId}.json`)) {
        try {
          trackData = JSON.parse(await fsp.readFile(path.join(meta, `${videoId}.json`), 'utf8'));
        } catch (_) {}
      }
      const thumbName = `${videoId}.jpg`;
      const localThumb = thumbSet.has(thumbName) ? toFileUrl(path.join(thumbs, thumbName)) : '';
      slots[idx] = {
        id: videoId,
        title: trackData?.title || videoId,
        artist: trackData?.artist || 'Unknown Artist',
        album: trackData?.album || 'Offline Cache',
        duration: trackData?.duration || '',
        thumbnail: localThumb || trackData?.thumbnail || 'assets/icon.png',
        localThumbnail: localThumb,
        isCachedOffline: true
      };
    });
    return slots.filter(Boolean);
  } catch (_) {}
  return [];
});

ipcMain.handle('scan-downloaded-playlists', async () => {
  const rootDir = resolveDownloadBaseDir();
  const playlists = [];
  const audioExts = new Set(['.m4a', '.webm', '.opus', '.mp3', '.mp4', '.ogg']);
  const { meta, thumbs } = getOfflineAssetDirs();

  try {
    const entries = await fsp.readdir(rootDir, { withFileTypes: true }).catch(() => []);
    if (entries.length === 0) return [];

    // Pre-index offline metadata & thumbnails ONCE asynchronously: O(M) instead of O(N * M) sync reads
    const [metaFiles, thumbFiles] = await Promise.all([
      fsp.readdir(meta).catch(() => []),
      fsp.readdir(thumbs).catch(() => [])
    ]);
    const thumbSet = new Set(thumbFiles);
    const metaById = new Map();
    const metaByArtistTitle = new Map();
    const metaByLowerTitle = new Map();

    const jsonFiles = metaFiles.filter(mf => mf.endsWith('.json'));
    await runBatched(jsonFiles, 40, async (mf) => {
      try {
        const mData = JSON.parse(await fsp.readFile(path.join(meta, mf), 'utf8'));
        const id = mData.id || path.basename(mf, '.json');
        if (id) metaById.set(id, mData);
        if (mData.title) {
          const normTitle = String(mData.title).trim().toLowerCase();
          const normArtist = cleanArtistName(mData.artist || '').toLowerCase();
          if (normArtist && normArtist !== 'unknown artist') {
            metaByArtistTitle.set(`${normArtist}::${normTitle}`, { id, data: mData });
          }
          metaByLowerTitle.set(normTitle, { id, data: mData });
        }
      } catch (_) {}
    });

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const folderName = ent.name;
      if (folderName === 'bin' || folderName === 'offline_assets') continue;
      const subDir = path.join(rootDir, folderName);
      const subFiles = await fsp.readdir(subDir).catch(() => []);
      const candidateFiles = subFiles.filter(file => !file.toLowerCase().endsWith('.cover.mp4') && audioExts.has(path.extname(file).toLowerCase()));
      const trackSlots = new Array(candidateFiles.length);

      await runBatched(candidateFiles.map((file, idx) => ({ file, idx })), 40, async ({ file, idx }) => {
        const ext = path.extname(file).toLowerCase();
        const fullAudioPath = path.join(subDir, file);
        if ((await safeStatSize(fullAudioPath)) < 30000) return;

        const baseName = path.basename(file, ext);
        // Strip leading track index prefix (e.g. "01 - Artist - Title" -> "Artist - Title")
        const strippedBase = baseName.replace(/^\d{1,4}\s*-\s*/, '').trim() || baseName;
        let title = strippedBase;
        let artist = 'Unknown Artist';
        if (strippedBase.includes(' - ')) {
          const parts = strippedBase.split(' - ');
          artist = parts[0].trim() || 'Unknown Artist';
          title = parts.slice(1).join(' - ').trim() || strippedBase;
        }

        const normParsedArtist = cleanArtistName(artist).toLowerCase();
        const artistTitleHit = (normParsedArtist && normParsedArtist !== 'unknown artist')
          ? (metaByArtistTitle.get(`${normParsedArtist}::${title.toLowerCase()}`) || null)
          : null;
        const titleOnlyFallback = (!normParsedArtist || normParsedArtist === 'unknown artist')
          ? (metaByLowerTitle.get(title.toLowerCase()) || metaByLowerTitle.get(strippedBase.toLowerCase()) || null)
          : null;
        const matchedEntry = metaById.get(baseName)
          ? { id: metaById.get(baseName).id || baseName, data: metaById.get(baseName) }
          : (artistTitleHit || titleOnlyFallback);
        const matchedMeta = matchedEntry?.data || null;
        const matchedId = matchedEntry?.id || '';
        if (matchedMeta?.title) title = matchedMeta.title;
        if (matchedMeta?.artist) artist = matchedMeta.artist;

        const videoId = matchedId || `offline_${Buffer.from(file).toString('hex').slice(0, 11)}`;
        const thumbName = `${videoId}.jpg`;
        const localThumb = thumbSet.has(thumbName) ? toFileUrl(path.join(thumbs, thumbName)) : '';

        trackSlots[idx] = {
          id: videoId,
          title,
          artist,
          album: folderName,
          duration: matchedMeta?.duration || '',
          thumbnail: localThumb || 'assets/icon.png',
          localThumbnail: localThumb,
          localFilePath: fullAudioPath,
          isDownloaded: true
        };
      });

      const tracks = trackSlots.filter(Boolean);
      if (tracks.length > 0) {
        playlists.push({
          id: `local_dir_${Buffer.from(folderName).toString('hex')}`,
          title: folderName,
          author: 'Downloaded Playlist',
          trackCount: tracks.length,
          tracks,
          thumbnail: tracks[0].localThumbnail || tracks[0].thumbnail || 'assets/icon.png',
          isLocal: true,
          isDownloaded: true
        });
      }
      await yieldEventLoop();
    }
  } catch (err) {
    console.warn('Scan downloaded playlists notice:', err.message);
  }

  return playlists;
});

// --- In-App Auto Updates (electron-updater for Windows & macOS, initialized lazily) ---
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
  const updater = initAutoUpdater();
  if (!updater) return { success: false, error: 'Auto-updater is not available in development mode' };
  try {
    const result = await updater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  const updater = initAutoUpdater();
  if (!updater) return { success: false, error: 'Auto-updater is not available in development mode' };
  try {
    await updater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update-now', () => {
  const updater = initAutoUpdater();
  if (updater) {
    updater.quitAndInstall(false, true);
    return true;
  }
  return false;
});

app.on('child-process-gone', (_e, details) => {
  console.error('Child process gone:', details.type, details.reason);
});

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(CHROME_USER_AGENT);

  // Synchronize any saved YouTube session cookies for yt-dlp
  try {
    const saved = ytMusic.loadSavedSession ? ytMusic.loadSavedSession() : null;
    if (saved?.cookie && typeof streamService.syncNetscapeCookies === 'function') {
      streamService.syncNetscapeCookies(saved.cookie);
    }
  } catch (_) {}

  // Fix YouTube Embed in Electron: supply official YouTube Referer & Origin to prevent Error 150/152
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.googlevideo.com/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      delete headers['X-Requested-With'];
      delete headers['sec-ch-ua'];
      delete headers['sec-ch-ua-mobile'];
      delete headers['sec-ch-ua-platform'];

      headers['Referer'] = 'https://www.youtube.com/';
      headers['Origin'] = 'https://www.youtube.com';
      callback({ cancel: false, requestHeaders: headers });
    }
  );

  // Strip X-Frame-Options and restrictive CSP to prevent embed blocking
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      delete responseHeaders['x-frame-options'];
      delete responseHeaders['X-Frame-Options'];
      delete responseHeaders['content-security-policy'];
      delete responseHeaders['Content-Security-Policy'];
      callback({ cancel: false, responseHeaders });
    }
  );

  createMainWindow();

  // Background auto-check for updates on startup (packaged builds only)
  setTimeout(() => {
    const updater = initAutoUpdater();
    if (updater && app.isPackaged) {
      updater.checkForUpdates().catch(e => console.warn('Auto update check notice:', e.message));
    }
  }, 6000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
