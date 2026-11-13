const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// 1. Load .env file from desktop/.env if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        val = val.replace(/^['"](.*)['"]$/, '$1').trim();
        if (val && !process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  } catch (_) {}
}

// 2. Fallback check for Windows User Environment Variable
if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const regOutput = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'GH_TOKEN\', \'User\')"', { encoding: 'utf8' }).trim();
      if (regOutput) process.env.GH_TOKEN = regOutput;
    }
  } catch (_) {}
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error('\n❌ ERROR: GitHub Personal Access Token (GH_TOKEN) not found.');
  console.error('Please make sure desktop/.env contains: GH_TOKEN=ghp_your_token_here\n');
  process.exit(1);
}

process.env.GH_TOKEN = token;
process.env.GITHUB_TOKEN = token;

const targetPlatform = process.argv[2] || 'win';
let builderArgs = [];

if (targetPlatform === 'mac') {
  // If running mac, first bundle mac bin
  try {
    require('./bundle-mac-bin.js');
  } catch (_) {}
  builderArgs = ['--mac', 'dmg', 'zip', '--universal', '--publish', 'always'];
} else {
  builderArgs = ['--win', 'nsis', '--x64', '--publish', 'always'];
}

console.log(`\n🚀 Initializing electron-builder publish for ${targetPlatform.toUpperCase()}...`);
console.log(`🔑 GH_TOKEN detected (length: ${token.length}). Authenticating with GitHub Releases...\n`);

const isWin = process.platform === 'win32';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

const child = spawn(npxCmd, ['electron-builder', ...builderArgs], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
  stdio: 'inherit',
  shell: true
});

child.on('close', (code) => {
  process.exit(code || 0);
});
