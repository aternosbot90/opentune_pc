const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Readable } = require('stream');

let electronApp = null;
try {
  const electron = require('electron');
  electronApp = electron.app || null;
} catch (_) {}

function getUserDataBinDir() {
  if (electronApp) {
    try {
      return path.join(electronApp.getPath('userData'), 'bin');
    } catch (_) {}
  }
  return null;
}

const streamCache = new Map(); // cacheKey -> { url, expireAt }
const inflightExtractions = new Map(); // cacheKey -> Promise<string>
let proxyServer = null;
let proxyPort = 0;
let proxyInitPromise = null;
let ytDlpProvisionPromise = null;

function clearStreamCache() {
  streamCache.clear();
  inflightExtractions.clear();
}

function getYtDlpPath() {
  const candidates = process.platform === 'win32'
    ? ['yt-dlp.exe', 'yt-dlp']
    : (process.platform === 'darwin' ? ['yt-dlp_macos', 'yt-dlp'] : ['yt-dlp']);

  // 1. Check user-data bin directory (auto-provisioned or updated binaries)
  const userBinDir = getUserDataBinDir();
  if (userBinDir) {
    for (const binName of candidates) {
      const userBin = path.join(userBinDir, binName);
      if (fs.existsSync(userBin)) {
        try { fs.chmodSync(userBin, 0o755); } catch (_) {}
        return userBin;
      }
    }
  }

  // 2. Check packaged application resources (e.g. OpenTune.app/Contents/Resources/bin)
  if (process.resourcesPath) {
    for (const binName of candidates) {
      const packagedBin = path.join(process.resourcesPath, 'bin', binName);
      if (fs.existsSync(packagedBin)) {
        try { fs.chmodSync(packagedBin, 0o755); } catch (_) {}
        return packagedBin;
      }
    }
  }

  // 3. Check local source bin directory
  for (const binName of candidates) {
    const localBin = path.join(__dirname, 'bin', binName);
    if (fs.existsSync(localBin)) {
      try { fs.chmodSync(localBin, 0o755); } catch (_) {}
      return localBin;
    }
  }

  // 4. Check standard macOS & Linux system installation paths
  if (process.platform === 'darwin') {
    const home = process.env.HOME || '';
    const macPaths = [
      '/opt/homebrew/bin/yt-dlp',
      '/opt/homebrew/sbin/yt-dlp',
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp',
      path.join(home, '.local', 'bin', 'yt-dlp'),
      path.join(home, 'bin', 'yt-dlp')
    ];
    for (const macPath of macPaths) {
      if (fs.existsSync(macPath)) {
        try { fs.chmodSync(macPath, 0o755); } catch (_) {}
        return macPath;
      }
    }
  } else if (process.platform === 'linux') {
    const home = process.env.HOME || '';
    const linuxPaths = [
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp',
      path.join(home, '.local', 'bin', 'yt-dlp'),
      path.join(home, 'bin', 'yt-dlp')
    ];
    for (const linuxPath of linuxPaths) {
      if (fs.existsSync(linuxPath)) {
        try { fs.chmodSync(linuxPath, 0o755); } catch (_) {}
        return linuxPath;
      }
    }
  }

  return 'yt-dlp';
}

function testBinaryExecutable(binPath) {
  return new Promise((resolve) => {
    try {
      const child = spawn(binPath, ['--version'], { windowsHide: true, env: process.env });
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; try { child.kill('SIGKILL'); } catch (_) {} resolve(false); }
      }, 3500);
      child.on('error', () => {
        if (!done) { done = true; clearTimeout(timer); resolve(false); }
      });
      child.on('close', (code) => {
        if (!done) { done = true; clearTimeout(timer); resolve(code === 0); }
      });
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Ensures a working yt-dlp binary is available on the machine.
 * If missing, automatically downloads the official standalone executable into userData/bin.
 */
async function ensureYtDlpBinary() {
  const current = getYtDlpPath();
  if (fs.existsSync(current)) {
    try { fs.chmodSync(current, 0o755); } catch (_) {}
    return current;
  }

  const isWorking = await testBinaryExecutable(current);
  if (isWorking) return current;

  if (ytDlpProvisionPromise) return ytDlpProvisionPromise;

  ytDlpProvisionPromise = (async () => {
    const userBinDir = getUserDataBinDir();
    if (!userBinDir) return current;

    try {
      fs.mkdirSync(userBinDir, { recursive: true });
    } catch (_) {}

    let binName = 'yt-dlp';
    let dlUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    if (process.platform === 'win32') {
      binName = 'yt-dlp.exe';
      dlUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    } else if (process.platform === 'darwin') {
      binName = 'yt-dlp_macos';
      dlUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
    }

    const targetPath = path.join(userBinDir, binName);
    if (fs.existsSync(targetPath)) {
      try { fs.chmodSync(targetPath, 0o755); } catch (_) {}
      return targetPath;
    }

    console.log(`[OpenTune] yt-dlp binary not found. Auto-provisioning ${binName} from ${dlUrl}...`);
    try {
      const resp = await fetch(dlUrl, {
        headers: { 'User-Agent': 'OpenTune-Desktop/3.0.9' }
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arrayBuf = await resp.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      if (buf.length < 50000) throw new Error(`Incomplete binary download (${buf.length} bytes)`);

      const tempFile = `${targetPath}.tmp-${Date.now()}`;
      await fs.promises.writeFile(tempFile, buf);
      try { fs.chmodSync(tempFile, 0o755); } catch (_) {}
      await fs.promises.rename(tempFile, targetPath);
      try { fs.chmodSync(targetPath, 0o755); } catch (_) {}
      console.log(`[OpenTune] Successfully installed yt-dlp binary at ${targetPath}`);
      return targetPath;
    } catch (dlErr) {
      console.warn('[OpenTune] Could not auto-download yt-dlp binary:', dlErr.message);
      return current;
    }
  })().finally(() => {
    ytDlpProvisionPromise = null;
  });

  return ytDlpProvisionPromise;
}

// Background auto-provision check on startup
ensureYtDlpBinary().catch(() => {});

/**
 * Resolves raw stream URL using yt-dlp with caching
 */
async function extractStreamUrlWithFormat(videoId, formatSelector = 'bestaudio', cachePrefix = 'play') {
  const now = Date.now();
  const cacheKey = `${cachePrefix}:${videoId}`;
  if (streamCache.has(cacheKey)) {
    const cached = streamCache.get(cacheKey);
    if (cached.expireAt > now) {
      return cached.url;
    }
  }

  if (inflightExtractions.has(cacheKey)) {
    return inflightExtractions.get(cacheKey);
  }

  const job = (async () => {
    const ytDlpPath = await ensureYtDlpBinary();
    return new Promise((resolve, reject) => {
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const args = ['-g', '-f', formatSelector, '--no-playlist', '--no-warnings', '--no-check-certificates', '--socket-timeout', '12', videoUrl];

      const child = spawn(ytDlpPath, args, { windowsHide: true, env: process.env });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`Stream extraction timed out for ${videoId}`));
      }, 25000);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        if (code === 0) {
          const url = stdout.trim().split('\n')[0].trim();
          if (url && url.startsWith('http')) {
            streamCache.set(cacheKey, { url, expireAt: Date.now() + 4 * 3600 * 1000 });
            resolve(url);
            return;
          }
        }
        reject(new Error(`Failed to extract audio stream for ${videoId}: ${stderr || 'Unknown error'}`));
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        reject(new Error(`Error launching yt-dlp (${ytDlpPath}): ${err.message}`));
      });
    });
  })().finally(() => {
    if (inflightExtractions.get(cacheKey) === job) {
      inflightExtractions.delete(cacheKey);
    }
  });

  inflightExtractions.set(cacheKey, job);
  return job;
}

function ensureStreamProxy() {
  if (proxyPort > 0) return Promise.resolve(proxyPort);
  if (proxyInitPromise) return proxyInitPromise;

  proxyInitPromise = new Promise((resolve) => {
    proxyServer = http.createServer(async (req, res) => {
      try {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
          });
          return res.end();
        }

        const match = req.url.match(/\/stream\/([a-zA-Z0-9_-]+)/);
        if (!match) {
          res.writeHead(404);
          return res.end('Not found');
        }

        const videoId = match[1];
        const rawUrl = await getRawStreamUrl(videoId);
        const range = req.headers.range || 'bytes=0-';

        const gvRes = await fetch(rawUrl, {
          headers: {
            'Range': range,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            'Referer': 'https://music.youtube.com/'
          }
        });

        const headers = {
          'Content-Type': gvRes.headers.get('content-type') || 'audio/webm',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
        };

        if (gvRes.headers.has('content-length')) {
          headers['Content-Length'] = gvRes.headers.get('content-length');
        }
        if (gvRes.headers.has('content-range')) {
          headers['Content-Range'] = gvRes.headers.get('content-range');
        }

        res.writeHead(gvRes.status, headers);

        if (gvRes.body) {
          const nodeStream = Readable.fromWeb(gvRes.body);

          nodeStream.on('error', (streamErr) => {
            console.warn('Audio upstream stream notice (handled):', streamErr.message);
            try { res.destroy(); } catch (_) {}
          });

          res.on('error', (resErr) => {
            console.warn('Audio client stream notice (handled):', resErr.message);
            try { nodeStream.destroy(); } catch (_) {}
          });

          req.on('close', () => {
            try { nodeStream.destroy(); } catch (_) {}
          });

          nodeStream.pipe(res);
        } else {
          if (!res.writableEnded) res.end();
        }
      } catch (err) {
        console.error('Audio proxy stream error (handled):', err.message);
        if (!res.headersSent) {
          try { res.writeHead(500); } catch (_) {}
        }
        if (!res.writableEnded) res.end();
      }
    });

    proxyServer.on('error', (err) => {
      console.warn('Audio proxy server notice (handled):', err.message);
    });

    proxyServer.on('clientError', (err, socket) => {
      console.warn('Audio proxy client connection notice (handled):', err.message);
      try { socket.destroy(); } catch (_) {}
    });

    proxyServer.listen(0, '127.0.0.1', () => {
      proxyPort = proxyServer.address().port;
      resolve(proxyPort);
    });
  });

  return proxyInitPromise;
}

// Start proxy server
ensureStreamProxy();

async function getRawStreamUrl(videoId) {
  return extractStreamUrlWithFormat(videoId, 'bestaudio', 'play');
}

async function getDownloadStreamUrl(videoId) {
  const now = Date.now();
  const cachedPlay = streamCache.get(`play:${videoId}`);
  if (cachedPlay && cachedPlay.expireAt > now) {
    return cachedPlay.url;
  }
  return extractStreamUrlWithFormat(videoId, 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio', 'dl');
}

async function getStreamUrl(videoId) {
  const [port, rawUrl] = await Promise.all([
    ensureStreamProxy(),
    getRawStreamUrl(videoId)
  ]);

  if (port > 0) {
    return `http://127.0.0.1:${port}/stream/${videoId}`;
  }

  return rawUrl;
}

module.exports = {
  getStreamUrl,
  getAudioStreamUrl: getStreamUrl,
  getRawStreamUrl,
  getDownloadStreamUrl,
  clearStreamCache,
  getYtDlpPath,
  ensureYtDlpBinary
};
