# OpenTune

<div align="center">
  <img src="https://codeberg.org/Arturo254/OpenTune/blob/master/fastlane/metadata/android/en-US/images/featureGraphic.png" alt="OpenTune Banner" width="100%"/>
  
  ### Next-Generation YouTube Music Client with Material Design 3 for Android & Desktop

  [![Latest Release](https://img.shields.io/github/v/release/Arturo254/Open-Tune?style=flat-square&logo=github&color=0D1117&labelColor=161B22)](https://codeberg.org/Arturo254/OpenTune/releases)
  [![License](https://img.shields.io/github/license/Arturo254/Open-Tune?style=flat-square&logo=gnu&color=2B3137&labelColor=161B22)](https://codeberg.org/Arturo254/OpenTune/blob/main/LICENSE)
  [![Translation Status](https://badges.crowdin.net/opentune/localized.svg)](https://crowdin.com/project/opentune)
  [![Android](https://img.shields.io/badge/Platform-Android%206.0+-3DDC84.svg?style=flat-square&logo=android&logoColor=white&labelColor=161B22)](https://www.android.com)
  [![Desktop](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-47848F.svg?style=flat-square&logo=electron&logoColor=white&labelColor=161B22)](desktop/README.md)
  [![Stars](https://img.shields.io/github/stars/Arturo254/Open-Tune?style=flat-square&logo=github&color=yellow&labelColor=161B22&cacheSeconds=21600)](https://codeberg.org/Arturo254/OpenTune/stargazers)
  [![Forks](https://img.shields.io/github/forks/Arturo254/Open-Tune?style=flat-square&logo=github&color=blue&labelColor=161B22&cacheSeconds=21600)](https://codeberg.org/Arturo254/OpenTune/network/members)
</div>

[![Español](https://img.shields.io/badge/readme.md-español-red?style=for-the-badge)](README.es.md)

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Desktop Application (Windows, macOS, Linux)](#desktop-application-windows-macos-linux)
  - [Prerequisites](#desktop-prerequisites)
  - [Development Quick Start](#desktop-development-quick-start)
  - [Building from Source in Terminal](#desktop-building-from-source-in-terminal)
  - [Deploying & Distributing Desktop Builds](#desktop-deploying--distributing-desktop-builds)
- [Android Application](#android-application)
  - [System Requirements](#android-system-requirements)
  - [Installation Methods](#android-installation-methods)
  - [Building from Source](#android-building-from-source)
- [Contributing](#contributing)
- [Support the Project](#support-the-project)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Overview

**OpenTune** is a privacy-first, open-source YouTube Music client built for **Android** and **Desktop** (Windows, macOS, and Linux). Designed with Google's Material Design 3 and modern aesthetic options (including Glassmorphism and Apple iOS Glass), OpenTune delivers high-fidelity audio playback, synchronized lyrics, offline downloads, seamless account synchronization, and complete playlist management without advertising interruptions or tracking.

### Key Benefits

- **Ad-Free Experience**: Uninterrupted audio streaming with smart stream resolution.
- **Instant Offline Mode (0ms Latency)**: Download songs and albums directly to your device for instant offline playback.
- **Privacy-Focused**: Zero data harvesting, telemetry, or invasive analytics.
- **Customizable Interface**: 7 UI theme styles, dynamic color extraction, and responsive multi-window layouts.
- **Two-Way Account Sync**: Connect your YouTube Music account via secure OAuth device activation to sync your personal library, playlists, and recommendations.

> **Note**: OpenTune is an independent community project and is not affiliated with, sponsored, or endorsed by Google or YouTube.

---

## Key Features

### Core Capabilities
| Feature | Android | Desktop | Description |
|:---|:---:|:---:|:---|
| **🎵 Ad-Free Playback** | ✅ | ✅ | Stream songs and podcasts without advertising interruptions |
| **⚡ 0ms Offline Playback** | ✅ | ✅ | Automatically detects local downloads for instant zero-latency playback |
| **🔄 Background Playback** | ✅ | ✅ | Continues playing in the background, minimized, or in Mini-Player / PiP mode |
| **🔍 Search & Suggestions** | ✅ | ✅ | Rapid search across songs, artists, albums, playlists, and categories |
| **👤 Two-Way Cloud Sync** | ✅ | ✅ | Synchronize, create, and manage YouTube Music playlists with OAuth login |
| **📚 Library Management** | ✅ | ✅ | Full management of liked songs, custom playlists, and local downloads |

### Audio Engine & Visual Design
| Feature | Description |
|:---|:---|
| **🎤 Synchronized Karaoke Lyrics** | Smooth line-by-line auto-scrolling with word-level highlights and manual sync offset |
| **🎛️ 10-Band Graphic Equalizer** | DSP presets, manual dB sliders, pre-amp gain, and virtualizer controls |
| **🎨 7 Distinct Visual Themes** | Apple iOS Glass, Glassmorphism, Liquid Glass, Skeuomorphism, Cyber Neon, Pitch-Black AMOLED (#000000), and Material 3 Expressive (Light/Dark) |
| **💿 Full Artist & Album Catalogs** | Displays 100–150+ artist songs with "All Songs" vs "Top 10" toggle, plus multi-disc and soundtrack album support |
| **⚡ Smart Playback Resume** | Automatically saves and restores track position and active queue when restarting the app |
| **⏱️ Sleep Timer & Pitch Control** | Configurable sleep countdown and audio tempo adjustment (0.5x to 2.0x) |

---

## Technology Stack

<div align="center">

| Ecosystem | Core Technologies |
|:---|:---|
| **Desktop Client** | ![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white) ![NodeJS](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black) ![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white) ![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white) |
| **Android Client** | ![Kotlin](https://img.shields.io/badge/Kotlin-7F52FF?style=for-the-badge&logo=kotlin&logoColor=white) ![Jetpack Compose](https://img.shields.io/badge/Jetpack%20Compose-4285F4?style=for-the-badge&logo=jetpackcompose&logoColor=white) ![Material Design 3](https://img.shields.io/badge/Material%20Design%203-757575?style=for-the-badge&logo=materialdesign&logoColor=white) ![Gradle](https://img.shields.io/badge/Gradle-02303A?style=for-the-badge&logo=gradle&logoColor=white) |
| **Extraction Backend** | ![yt-dlp](https://img.shields.io/badge/yt--dlp-FF0000?style=for-the-badge&logo=youtube&logoColor=white) ![YouTube.js](https://img.shields.io/badge/Innertube%20API-FF0000?style=for-the-badge&logo=youtube&logoColor=white) |

</div>

---

## Desktop Application (Windows, macOS, Linux)

Detailed documentation is available in the [Desktop Guide](desktop/README.md).

### Desktop Prerequisites

- **Node.js**: `v18.0.0` or higher (`v20+` recommended)
- **npm**: `v8.0.0` or higher
- **Python**: `3.8+` (optional, for native addon rebuilds)

### Desktop Development Quick Start

Run the application directly in development mode without building installers:

```bash
# 1. Navigate to the desktop directory
cd desktop

# 2. Install dependencies
npm install

# 3. Start development server
npm start
```

### Desktop Building from Source in Terminal

Open a terminal in the project directory:

```bash
cd desktop
```

Choose your desired build command:

#### 1. Portable Windows Executable (`.exe`)
Builds a standalone portable executable that runs immediately without installation:
```bash
npm run build:portable
```
- **Output File**: `desktop/dist/OpenTune-Portable-3.0.8.exe`

#### 2. Windows NSIS Setup Installer (`.exe`)
Builds a full setup wizard installer with start menu and desktop shortcuts:
```bash
npm run build:installer
```
- **Output File**: `desktop/dist/OpenTune Setup 3.0.8.exe`

#### 3. Full Windows Build (Both Portable & Installer)
Builds both portable and setup packages sequentially:
```bash
npm run build
```

#### 4. macOS DMG Packages (`.dmg`)
```bash
# Universal binary (Intel & Apple Silicon)
npm run build:mac

# Apple Silicon (M1/M2/M3/M4)
npm run build:mac-arm64

# Intel x64
npm run build:mac-x64
```
- **Output File**: `desktop/dist/OpenTune-3.0.8-mac.dmg`

#### 5. Unpacked Directory
Unpacks the compiled Electron app without generating an archive, useful for debugging:
```bash
npm run build:dir
```
- **Output Folder**: `desktop/dist/win-unpacked/`

---

### Desktop Deploying & Distributing Desktop Builds

1. **Verify Binary Integrity**:
   Verify the files exist in `desktop/dist/` or project root.
2. **Generate Checksums (SHA-256)**:
   ```powershell
   Get-FileHash desktop\dist\*.exe -Algorithm SHA256 | Format-Table -AutoSize
   ```
3. **Release Assets**:
   Upload the generated `.exe` or `.dmg` files to your GitHub / Codeberg release page:
   - `OpenTune-Portable-3.0.8.exe`
   - `OpenTune Setup 3.0.8.exe`
   - `OpenTune-3.0.8.dmg`

---

## Android Application

### Android System Requirements

| Component | Minimum Requirement | Recommended |
|:----------|:--------------------|:------------|
| Operating System | Android 6.0 (Marshmallow) | Android 10+ |
| Storage Space | 25 MB available | 500 MB+ (for offline caching) |
| RAM | 2 GB | 4 GB+ |

### Android Installation Methods

1. **GitHub / Codeberg Releases**: Download the latest `.apk` from [Releases](https://codeberg.org/Arturo254/OpenTune/releases).
2. **F-Droid**: Available on the [F-Droid repository](https://f-droid.org/es/packages/com.Arturo254.opentune).
3. **OpenApk**: Download verified builds via [OpenApk](https://www.openapk.net/opentune/com.Arturo254.opentune/).

### Android Building from Source

Ensure you have Android Studio and the Android SDK installed:

```bash
# Clone the repository
git clone https://codeberg.org/Arturo254/OpenTune.git
cd OpenTune

# Build release APK
./gradlew assembleRelease

# Build debug APK
./gradlew assembleDebug

# Run unit tests
./gradlew test
```

Compiled APK files will be located in `app/build/outputs/apk/`.

---

## Contributing

We welcome community contributions! Please follow these steps:

1. **Review Issues**: Check [open issues](https://codeberg.org/Arturo254/OpenTune/issues) or submit a new feature request.
2. **Fork & Branch**: Create a descriptive branch (`git checkout -b feature/amazing-feature`).
3. **Test Thoroughly**: Ensure existing features and unit tests pass before submitting.
4. **Pull Request**: Open a PR with a clear summary of your changes.

Please adhere to our [Code of Conduct](https://codeberg.org/Arturo254/OpenTune/blob/master/CODE_OF_CONDUCT.md).

### Translations

Help translate OpenTune on [Crowdin](https://crowdin.com/project/opentune) or [POEditor](https://poeditor.com/join/project/208BwCVazA).

---

## Support the Project

If you enjoy **OpenTune**, consider supporting its active development:

<div align="center">
  
[![GitHub Sponsors](https://img.shields.io/badge/GitHub_Sponsors-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/Arturo254)
[![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](mailto:cervantesarturo254@gmail.com)

</div>

---

## Acknowledgments

- **mostafaalagamy** - MetroList implementation
- **Fabito02** - Continuous support and testing
- **Community Translators & Testers** - Making OpenTune accessible worldwide

---

## License

**Copyright © 2023–2026 Arturo Cervantes & OpenTune Contributors**

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**. See [LICENSE](LICENSE) for full details.

<div align="center">
  
[![GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=for-the-badge&logo=gnu&logoColor=white)](https://www.gnu.org/licenses/gpl-3.0)

</div>
