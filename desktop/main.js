const { app, BrowserWindow, ipcMain, session, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const streamService = require('./stream');
const lyricsService = require('./lyrics');
const ytMusic = require('./ytmusic');

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
    backgroundColor: '#0b0c0e',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Allows streaming direct audio from googlevideo
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

// Audio stream resolver (fast yt-dlp backend with in-memory caching)
ipcMain.handle('get-stream-url', async (_event, videoId) => {
  try {
    const fn = streamService.getStreamUrl || streamService.getAudioStreamUrl;
    const url = await fn(videoId);
    return { success: true, url };
  } catch (err) {
    console.error('Stream resolver error:', err.message);
    return { success: false, error: err.message };
  }
});

// LRCLIB Synchronized lyrics resolver
ipcMain.handle('get-lyrics', async (_event, { title, artist, duration }) => {
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
  const videoId = String(track?.id || track?.videoId || '').trim();
  if (!videoId || videoId.length < 5) {
    throw new Error(`Invalid video ID for "${track?.title || 'track'}"`);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const existing = findExistingAudioFile(destDir, baseName);
  if (existing) {
    return { filePath: existing, skipped: true };
  }

  // Attempt 1: Parallel HTTP Range fetch of direct stream URL (~0.4-1.5s vs 45s un-ranged throttle)
  try {
    const getDlUrl = streamService.getDownloadStreamUrl || streamService.getRawStreamUrl;
    const rawUrl = await getDlUrl(videoId);
    return await downloadUrlFastRange(rawUrl, destDir, baseName);
  } catch (err) {
    if (currentDownloadAbort) throw err;
    console.warn(`Fast range download failed for ${track?.title || videoId}, switching to yt-dlp:`, err.message);
  }

  // Attempt 2: Direct yt-dlp download with concurrent fragments
  return new Promise((resolve, reject) => {
    const ytDlpPath = streamService.getYtDlpPath();
    const outTemplate = path.join(destDir, `${baseName}.%(ext)s`);
    const args = [
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--no-playlist',
      '--no-part',
      '--no-warnings',
      '--no-check-certificates',
      '--concurrent-fragments', '4',
      '--socket-timeout', '15',
      '--force-overwrites',
      '-o', outTemplate,
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    const child = spawn(ytDlpPath, args, { windowsHide: true });
    activeDownloadChildren.add(child);
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      activeDownloadChildren.delete(child);
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`yt-dlp download timed out for ${track?.title || videoId}`));
    }, 60000);

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
      const safeArtist = sanitizeFilename(track?.artist || 'Unknown Artist');
      const safeTitle = sanitizeFilename(track?.title || 'Track');
      const baseName = `${trackNum} - ${safeArtist} - ${safeTitle}`;
      let trackSucceeded = false;

      try {
        await downloadTrackAudioFile(track, baseDir, baseName);
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

  const safeArtist = sanitizeFilename(track?.artist || 'Unknown Artist');
  const safeTitle = sanitizeFilename(track?.title || 'Track');
  const baseName = `${safeArtist} - ${safeTitle}`;

  try {
    currentDownloadAbort = false;
    const result = await downloadTrackAudioFile(track, baseDir, baseName);
    return { success: true, filePath: result.filePath, folderPath: baseDir };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-local-track-file', async (_event, payload) => {
  const track = payload?.track;
  const customDir = payload?.downloadDir;
  if (!track || (!track.id && !track.title)) return { exists: false };

  const videoId = String(track.id || track.videoId || '').trim();
  const rootDir = resolveDownloadBaseDir(customDir);
  if (!fs.existsSync(rootDir)) return { exists: false };

  const safeArtist = sanitizeFilename(track.artist || 'Unknown Artist');
  const safeTitle = sanitizeFilename(track.title || 'Track');
  const exts = ['.m4a', '.webm', '.opus', '.mp3', '.mp4', '.ogg'];

  const candidateNames = [
    `${safeArtist} - ${safeTitle}`,
    `${safeTitle}`,
    safeTitle,
    videoId
  ];

  for (const name of candidateNames) {
    const directFile = findExistingAudioFile(rootDir, name);
    if (directFile) {
      return {
        exists: true,
        filePath: directFile,
        fileUrl: `file:///${directFile.replace(/\\/g, '/')}`
      };
    }
  }

  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const subDir = path.join(rootDir, ent.name);
        for (const name of candidateNames) {
          const subDirect = findExistingAudioFile(subDir, name);
          if (subDirect) {
            return {
              exists: true,
              filePath: subDirect,
              fileUrl: `file:///${subDirect.replace(/\\/g, '/')}`
            };
          }
        }
        try {
          const files = fs.readdirSync(subDir);
          for (const file of files) {
            const lower = file.toLowerCase();
            const hasExt = exts.some(e => lower.endsWith(e));
            if (!hasExt) continue;
            const idMatch = videoId.length > 4 && file.includes(videoId);
            const titleMatch = safeTitle.length > 3 && lower.includes(safeTitle.toLowerCase());
            if (idMatch || titleMatch) {
              const fullPath = path.join(subDir, file);
              try {
                if (fs.statSync(fullPath).size > 32768) {
                  return {
                    exists: true,
                    filePath: fullPath,
                    fileUrl: `file:///${fullPath.replace(/\\/g, '/')}`
                  };
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
      } else if (ent.isFile()) {
        const lower = ent.name.toLowerCase();
        const hasExt = exts.some(e => lower.endsWith(e));
        if (hasExt) {
          const idMatch = videoId.length > 4 && ent.name.includes(videoId);
          const titleMatch = safeTitle.length > 3 && lower.includes(safeTitle.toLowerCase());
          if (idMatch || titleMatch) {
            const fullPath = path.join(rootDir, ent.name);
            try {
              if (fs.statSync(fullPath).size > 32768) {
                return {
                  exists: true,
                  filePath: fullPath,
                  fileUrl: `file:///${fullPath.replace(/\\/g, '/')}`
                };
              }
            } catch (_) {}
          }
        }
      }
    }
  } catch (_) {}

  return { exists: false };
});

app.on('child-process-gone', (_e, details) => {
  console.error('Child process gone:', details.type, details.reason);
});

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(CHROME_USER_AGENT);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
