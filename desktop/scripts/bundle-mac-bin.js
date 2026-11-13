const fs = require('fs');
const path = require('path');

async function bundleMacBinary() {
  const binDir = path.join(__dirname, '..', 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const targetPath = path.join(binDir, 'yt-dlp_macos');
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 50000) {
    console.log('[bundle-mac-bin] macOS binary already present in bin/yt-dlp_macos');
    try { fs.chmodSync(targetPath, 0o755); } catch (_) {}
    return;
  }

  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  console.log(`[bundle-mac-bin] Downloading official universal macOS binary from ${url}...`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading macOS binary`);

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(targetPath, buf);
  try { fs.chmodSync(targetPath, 0o755); } catch (_) {}
  console.log(`[bundle-mac-bin] Saved universal macOS yt-dlp binary (${buf.length} bytes) to bin/yt-dlp_macos`);
}

bundleMacBinary().catch((err) => {
  console.warn('[bundle-mac-bin] Notice:', err.message);
});

