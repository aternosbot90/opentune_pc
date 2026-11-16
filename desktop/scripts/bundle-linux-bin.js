const fs = require('fs');
const path = require('path');

async function bundleLinuxBinary() {
  const binDir = path.join(__dirname, '..', 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const targetPath = path.join(binDir, 'yt-dlp');
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 50000) {
    console.log('[bundle-linux-bin] Linux binary already present in bin/yt-dlp');
    try { fs.chmodSync(targetPath, 0o755); } catch (_) {}
    return;
  }

  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  console.log(`[bundle-linux-bin] Downloading official standalone Linux binary from ${url}...`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading Linux binary`);

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(targetPath, buf);
  try { fs.chmodSync(targetPath, 0o755); } catch (_) {}
  console.log(`[bundle-linux-bin] Saved standalone Linux yt-dlp binary (${buf.length} bytes) to bin/yt-dlp`);
}

bundleLinuxBinary().catch((err) => {
  console.warn('[bundle-linux-bin] Notice:', err.message);
});
