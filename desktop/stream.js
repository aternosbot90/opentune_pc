const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Readable } = require('stream');

const streamCache = new Map(); // cacheKey -> { url, expireAt }
const inflightExtractions = new Map(); // cacheKey -> Promise<string>
let proxyServer = null;
let proxyPort = 0;
let proxyInitPromise = null;

function clearStreamCache() {
  streamCache.clear();
  inflightExtractions.clear();
}

function getYtDlpPath() {
  const candidates = process.platform === 'win32'
    ? ['yt-dlp.exe', 'yt-dlp']
    : (process.platform === 'darwin' ? ['yt-dlp_macos', 'yt-dlp'] : ['yt-dlp']);

  if (process.resourcesPath) {
    for (const binName of candidates) {
      const packagedBin = path.join(process.resourcesPath, 'bin', binName);
      if (fs.existsSync(packagedBin)) {
        return packagedBin;
      }
    }
  }

  for (const binName of candidates) {
    const localBin = path.join(__dirname, 'bin', binName);
    if (fs.existsSync(localBin)) {
      return localBin;
    }
  }

  if (process.platform === 'darwin') {
    for (const macPath of ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']) {
      if (fs.existsSync(macPath)) return macPath;
    }
  } else if (process.platform === 'linux') {
    for (const linuxPath of ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']) {
      if (fs.existsSync(linuxPath)) return linuxPath;
    }
  }

  return 'yt-dlp';
}

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

  const job = new Promise((resolve, reject) => {
    const ytDlpPath = getYtDlpPath();
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const args = ['-g', '-f', formatSelector, '--no-playlist', '--no-warnings', '--no-check-certificates', '--socket-timeout', '12', videoUrl];

    const child = spawn(ytDlpPath, args, { windowsHide: true });
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
  }).finally(() => {
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
  getYtDlpPath
};
