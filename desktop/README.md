# OpenTune Desktop 🎵

<div align="center">
  <h3>Next-Generation Cross-Platform YouTube Music Client for Desktop</h3>

  [![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square&logo=electron)](https://www.electronjs.org)
  [![Electron](https://img.shields.io/badge/Electron-v45.2.3-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
  [![License](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square&logo=gnu)](../LICENSE)
</div>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start (Development Mode)](#quick-start-development-mode)
- [Building from Source](#building-from-source)
  - [Windows Build Targets](#windows-build-targets)
  - [macOS Build Targets](#macos-build-targets)
  - [Unpacked Directory Build](#unpacked-directory-build)
- [Deployment & Distribution](#deployment--distribution)
- [Project Structure](#project-structure)
- [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Overview

**OpenTune Desktop** is a modern, high-performance desktop music player powered by Electron, Node.js, and Innertube (`youtubei.js`). It brings the full OpenTune mobile experience to desktop computers (Windows, macOS, and Linux) with high-fidelity streaming, offline downloads, synchronized karaoke lyrics, personalized recommendations, and 7 distinct visual theme systems.

---

## Key Features

- **Ad-Free Music Streaming**: High-quality uninterrupted audio streaming with smart stream extraction.
- **Instant Offline Playback (0ms Latency)**: Automatically detects and plays locally downloaded tracks directly from disk with zero network buffering.
- **Full Artist Catalogs**: Displays complete artist catalogs (100–150+ tracks) with 1-click **All Songs** vs. **Top 10** filter chips.
- **Multi-Disc & Extended Albums**: Seamless tracklist rendering for multi-disc, deluxe, and soundtrack releases without pagination truncation.
- **Synchronized Karaoke Lyrics**: Real-time line-by-line synchronized scrolling with high-contrast text, word-by-word highlights, and manual resync controls.
- **7 UI Themes & Glass Design**:
  - Apple iOS Style Glass (Frosted Acrylic)
  - Pure Glassmorphism
  - Liquid Glass UI
  - Tactile Skeuomorphism (Embossed & Neumorphic)
  - Cyber Neon (Vibrant Glow)
  - Pitch-Black AMOLED (#000000)
  - Material 3 Expressive (Light & Dark)
- **Two-Way Cloud Playlist Sync**: Connect your Google / YouTube Music account to synchronize and manage personal playlists directly from the desktop client.
- **Audio Engine & DSP**: 10-band graphic equalizer, sleep timer, playback speed control (0.5x – 2.0x), and volume normalization.
- **Seamless State Persistence**: Automatically restores playback position, seek time, and active queue upon relaunching the app.

---

## Architecture & Tech Stack

- **Runtime**: [Electron](https://www.electronjs.org/) (Chromium + Node.js)
- **API Engine**: [YouTube.js / Innertube](https://github.com/LuanRT/YouTube.js) for resilient, reverse-engineered YouTube Music API calls.
- **Extraction Backend**: [yt-dlp](https://github.com/yt-dlp/yt-dlp) bundled for audio stream resolution and high-speed batch downloads.
- **Audio Pipeline**: HTML5 Web Audio API + HTMLAudioElement with hardware acceleration.
- **Packaging**: [electron-builder](https://www.electron.build/) with NSIS and Portable Windows targets, and DMG for macOS.

---

## Prerequisites

Before building or running OpenTune Desktop, ensure you have the following installed on your machine:

1. **Node.js**: `v18.0.0` or higher (`v20+` or `v22+` recommended)
   - Verify with: `node -v`
2. **npm**: `v8.0.0` or higher
   - Verify with: `npm -v`
3. **Python** (optional for native rebuilds): `3.8+`
4. **Git**: For version control and repository updates

---

## Quick Start (Development Mode)

To run the application locally without compiling binaries:

```bash
# 1. Navigate to the desktop directory
cd desktop

# 2. Install dependencies
npm install

# 3. Launch OpenTune in development mode
npm start
```

---

## Building from Source

You can build production-ready packages directly from your terminal using the scripts configured in `package.json`.

### Windows Build Targets

Ensure you are inside the `desktop` directory:
```bash
cd desktop
```

#### 1. Portable Executable (Single-File `.exe`)
Builds a standalone executable that runs without installation, perfect for USB drives or quick testing:
```bash
npm run build:portable
```
- **Output artifact**: `dist/OpenTune-Portable-3.0.8.exe`

#### 2. NSIS Setup Installer (`.exe`)
Builds a standard Windows installer wizard with custom install location, desktop shortcut, and start menu entry:
```bash
npm run build:installer
```
- **Output artifact**: `dist/OpenTune Setup 3.0.8.exe`

#### 3. Full Production Build (Both Portable + Installer)
Builds both the portable executable and the installer sequentially:
```bash
npm run build
```

---

### macOS Build Targets

> **Note**: macOS targets (`.dmg`) can be cross-compiled or built natively on macOS. For code signing and notarization, a macOS build environment is recommended.

```bash
# Build Universal DMG (Intel + Apple Silicon)
npm run build:mac

# Build Apple Silicon DMG (M1, M2, M3, M4)
npm run build:mac-arm64

# Build Intel x64 DMG
npm run build:mac-x64
```
- **Output artifact**: `dist/OpenTune-3.0.8-mac.dmg` / `dist/OpenTune-3.0.8-arm64.dmg`

---

### Unpacked Directory Build

To inspect the raw packaged application before archiving into an installer:
```bash
npm run build:dir
```
- **Output folder**: `dist/win-unpacked/` (Executable: `dist/win-unpacked/OpenTune.exe`)

---

## Deployment & Distribution

When releasing a new version of OpenTune Desktop:

1. **Verify Version Number**:
   Ensure `version` in `desktop/package.json` matches your target release (e.g., `3.0.8`).

2. **Run Syntax & Integrity Verification**:
   ```bash
   node -c main.js
   node -c preload.js
   node -c renderer.js
   node -c ytmusic.js
   ```

3. **Execute Clean Build**:
   ```bash
   npm run build
   ```

4. **Generate SHA-256 Checksums** (PowerShell):
   ```powershell
   Get-FileHash dist\OpenTune-Portable-*.exe, "dist\OpenTune Setup *.exe" -Algorithm SHA256 | Format-Table -AutoSize
   ```

5. **Publish Assets**:
   Attach the resulting binaries to your GitHub or Codeberg Release:
   - `OpenTune-Portable-3.0.8.exe` (Portable Windows)
   - `OpenTune Setup 3.0.8.exe` (Windows Installer)
   - `OpenTune-3.0.8.dmg` (macOS DMG, if built)

---

## Project Structure

```
desktop/
├── assets/                  # App icons, splash screens, and default graphics
├── dist/                    # Compiled distribution artifacts (executables, installers)
├── main.js                  # Electron main process & IPC handlers
├── preload.js               # Secure context isolation bridge
├── renderer.js              # UI controller, audio player, lyrics & queue engine
├── index.html               # Main window layout and view hierarchy
├── styles.css               # Core styling, animations, themes & responsive layouts
├── ytmusic.js               # YouTube Music API wrapper (Innertube + OAuth TV)
├── package.json             # NPM metadata and build configurations
└── README.md                # Desktop documentation
```

---

## Troubleshooting & FAQ

#### Q: The build fails with `EBUSY: resource busy or locked`?
**A**: An instance of `OpenTune.exe` is still running in the background. Close the app or terminate it in terminal:
```powershell
Stop-Process -Name "OpenTune" -Force
```

#### Q: On macOS, it says "OpenTune is not verified" or "cannot be opened because Apple cannot check it"?
**A**: This is macOS Gatekeeper protecting against unnotarized open-source apps. You can open it in 3 ways:
1. **Right-Click Open**: In Finder, go to `/Applications`, **Right-click (or Control-click)** `OpenTune.app`, and click **Open**. Click **Open** again in the prompt.
2. **System Settings**: Go to **System Settings** > **Privacy & Security** > scroll to Security > click **"Open Anyway"**.
3. **Terminal**: Run `sudo xattr -cr /Applications/OpenTune.app` to remove the quarantine attribute.

#### Q: How does offline playback work?
**A**: Downloaded songs are saved to your user music folder under `OpenTune/`. OpenTune checks local storage before contacting any remote streaming servers. If the track is downloaded, it plays with 0ms network latency.

#### Q: Can I run OpenTune with my own YouTube Music account?
**A**: Yes! Click **"Connect Account"** in the sidebar or Settings and complete the TV device activation code on `google.com/device`. Your playlists, subscriptions, and history will sync automatically.

