# OpenTune Desktop — In-App Auto-Update Guide 🚀

This guide explains how the in-app automatic update system works in OpenTune Desktop, and provides step-by-step instructions for building and publishing updates for both **Windows** and **macOS** so your users receive seamless, browser-free updates.

---

## Table of Contents
1. [How It Works](#how-it-works)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Release Workflow](#step-by-step-release-workflow)
   - [Step 1: Bump the Version Number](#step-1-bump-the-version-number)
   - [Step 2: Build the Update Packages](#step-2-build-the-update-packages)
   - [Step 3: Create a GitHub Release](#step-3-create-a-github-release)
   - [Step 4: Upload the Required Files](#step-4-upload-the-required-files)
   - [Step 5: Publish the Release](#step-5-publish-the-release)
4. [Optional: 1-Click Automated CLI Publishing](#optional-1-click-automated-cli-publishing)
5. [User Experience (What Users See)](#user-experience-what-users-see)
6. [Required Files Reference Checklist](#required-files-reference-checklist)
7. [Troubleshooting & Pro Tips](#troubleshooting--pro-tips)

---

## How It Works

OpenTune uses **`electron-updater`** connected to GitHub Releases (`aternosbot90/opentune_pc`).

```
+-----------------------------------------------------------------------------------+
| 1. Developer bumps version (e.g. 3.0.9) and builds Windows / macOS packages        |
| 2. Developer uploads binary files + metadata (latest.yml / latest-mac.yml)         |
| 3. OpenTune Desktop checks GitHub Releases automatically on startup               |
| 4. In-App Floating Banner appears: "Update v3.0.9 Available! [Download]"          |
| 5. User clicks Download -> Live percentage progress downloads inside the app       |
| 6. Download finishes -> Button changes to "[Restart & Install]"                    |
| 7. App closes, silently applies the update, and relaunches into v3.0.9!           |
|    (0 browser visits required!)                                                    |
+-----------------------------------------------------------------------------------+
```

---

## Prerequisites

Before building releases:
- Ensure dependencies are installed in the `desktop` folder:
  ```bash
  cd desktop
  npm install
  ```
- Ensure your GitHub repository remote is set to `https://github.com/aternosbot90/opentune_pc.git` (or your chosen repository configured in `desktop/package.json` under `"build.publish"`).

---

## Step-by-Step Release Workflow

### Step 1: Bump the Version Number

Open [desktop/package.json](package.json) and update the `"version"` field:

```json
{
  "name": "opentune-desktop",
  "productName": "OpenTune",
  "version": "3.0.9",   <--- Change this to your new version
  ...
}
```

> [!IMPORTANT]
> Always use standard Semantic Versioning (`MAJOR.MINOR.PATCH`, e.g. `3.0.9`). The version in `package.json` must match the release tag you create on GitHub (e.g., tag `v3.0.9`).

---

### Step 2: Build the Update Packages

Run the build commands in your terminal from the `desktop/` directory:

#### For Windows (run on Windows):
```bash
cd desktop
npm run build:installer
```
* **Output directory**: `desktop/dist/`
* **Generated update files**:
  1. `OpenTune Setup 3.0.9.exe` (NSIS Installer)
  2. `latest.yml` (Update manifest containing SHA512 hash and file size)

#### For macOS (run on macOS):
```bash
cd desktop
npm run build:mac
```
* **Output directory**: `desktop/dist/`
* **Generated update files**:
  1. `OpenTune-3.0.9-macOS-Universal.dmg` (Disk image for direct manual install)
  2. `OpenTune-3.0.9-macOS-Universal.zip` (Required by electron-updater for in-app updating)
  3. `latest-mac.yml` (Update manifest containing SHA512 hash and file size)

---

### Step 3: Create a GitHub Release

1. Open your browser and navigate to your repository releases page:
   ```
   https://github.com/aternosbot90/opentune_pc/releases/new
   ```
2. Click **"Draft a new release"**.
3. In **"Choose a tag"**, type your new version with a leading `v` (e.g. `v3.0.9`) and click **"Create new tag on publish"**.
4. Set the **Release title** to `OpenTune v3.0.9` (or your version name).
5. Add release notes describing what's new (e.g., Bug fixes, audio improvements, UI refinements).

---

### Step 4: Upload the Required Files

Drag and drop the generated files from `desktop/dist/` into the GitHub release asset upload area:

| Operating System | Files to Upload to the GitHub Release |
| :--- | :--- |
| **Windows** | 1. `OpenTune Setup 3.0.9.exe`<br>2. `latest.yml` |
| **macOS** | 1. `OpenTune-3.0.9-macOS-Universal.zip`<br>2. `OpenTune-3.0.9-macOS-Universal.dmg`<br>3. `latest-mac.yml` |

> [!CAUTION]
> **Do NOT forget `latest.yml` and `latest-mac.yml`!**
> `electron-updater` uses these YAML files to detect that an update exists and to verify the cryptographic SHA-512 checksum of the downloaded file. If you omit the `.yml` files, the in-app updater will not detect the update.

---

### Step 5: Publish the Release

1. Verify that all assets are uploaded.
2. Click **"Publish release"**.
3. That's it! Any user opening OpenTune on Windows or macOS will receive the update automatically.

---

## Optional: 1-Click Automated CLI Publishing (Using GH_TOKEN)

If you prefer not to manually upload files via the GitHub web interface, you can generate a **GitHub Personal Access Token** (`GH_TOKEN`). With this set up, running `npm run publish:win` or `npm run publish:mac` will build, package, create the GitHub release, and upload all files automatically.

### How to Generate Your GitHub Token (`GH_TOKEN`):

1. Go directly to: [https://github.com/settings/tokens/new](https://github.com/settings/tokens/new)
   *(Or click your GitHub Profile Icon -> **Settings** -> Scroll to bottom of left menu -> **Developer settings** -> **Personal access tokens** -> **Tokens (classic)** -> **Generate new token (classic)**)*.
2. Fill in the fields:
   - **Note / Name**: `OpenTune Auto-Updater` (or any description).
   - **Expiration**: Select `90 days`, `1 year`, or `No expiration`.
   - **Select Scopes**: Check the **`repo`** box (this gives full control of private/public repositories and releases).
3. Scroll to the bottom and click the green **Generate token** button.
4. **Copy your token immediately** (it looks like `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`). *GitHub will only show this code once!*

---

### How to Save Your Token (Permanent Setup):

#### On Windows (PowerShell):
To save it permanently so you never have to re-enter it:
```powershell
[Environment]::SetEnvironmentVariable("GH_TOKEN", "ghp_your_token_here", "User")
```
*(Or for just the current terminal session: `$env:GH_TOKEN="ghp_your_token_here"`)*

#### On macOS (Terminal):
To save it permanently in your shell:
```bash
echo 'export GH_TOKEN="ghp_your_token_here"' >> ~/.zshrc
source ~/.zshrc
```

---

### How to Run Automated Publishing:

Once `GH_TOKEN` is set, navigate to `desktop/` and run:

- **On Windows**:
  ```bash
  cd desktop
  npm run publish:win
  ```
- **On macOS**:
  ```bash
  cd desktop
  npm run publish:mac
  ```

`electron-builder` will compile the code, generate the update manifests (`latest.yml` / `latest-mac.yml`), upload the artifacts to your GitHub release matching the version in `package.json`, and publish it automatically!

---

## User Experience (What Users See)

1. **Automatic Detection**:
   - 6 seconds after opening OpenTune, the app silently queries GitHub Releases in the background.
   - Users can also manually check anytime under **Settings > Storage & Data > Software Updates > [Check for Updates]**.
2. **Notification Banner**:
   - A floating Material 3 banner slides up at the bottom:
     > 🚀 **Update v3.0.9 Available!**
     > *A new version of OpenTune is ready to download.*
     > `[Download]` `[×]`
3. **Download with Progress Bar**:
   - When the user clicks **Download**, a real-time progress bar shows download percentage (`Downloading update: 45%...`).
4. **Restart & Install**:
   - Once the download is finished, the button changes to:
     > ✨ **Update v3.0.9 Ready to Install!**
     > *Restart OpenTune to finish applying the update.*
     > `[Restart & Install]`
   - Clicking **Restart & Install** calls `autoUpdater.quitAndInstall()`. OpenTune closes, silently applies the update, and reopens running the new version.

---

## Required Files Reference Checklist

When publishing version `X.Y.Z`:

- [ ] Version updated in `desktop/package.json` (`"version": "X.Y.Z"`)
- [ ] Windows NSIS build run (`npm run build:installer`)
- [ ] Windows files located in `desktop/dist/`:
  - `OpenTune Setup X.Y.Z.exe`
  - `latest.yml`
- [ ] macOS build run (`npm run build:mac`)
- [ ] macOS files located in `desktop/dist/`:
  - `OpenTune-X.Y.Z-macOS-Universal.zip`
  - `OpenTune-X.Y.Z-macOS-Universal.dmg`
  - `latest-mac.yml`
- [ ] GitHub Release created with tag `vX.Y.Z`
- [ ] All 5 files uploaded to the GitHub Release
- [ ] Release is set to **Public** (not draft)

---

## Troubleshooting & Pro Tips

### 1. In-App Updates in Development Mode (`npm start`)
`electron-updater` only performs live downloads and installations when running inside a **packaged application** (installed build). When testing in development (`npm start`), clicking "Check for Updates" will report:
`Auto-updater is not available in development mode`
To test the updater, install a built package (e.g. `v3.0.8`), publish `v3.0.9` on GitHub, and launch the installed app.

### 2. Windows Portable vs. Installer (.exe)
- The **NSIS Installer** (`OpenTune Setup <version>.exe`) fully supports in-app automatic updating and silent background restarts.
- The **Portable** `.exe` runs without an installer, so it cannot self-overwrite its own running executable. For the seamless auto-update experience on Windows, distribute the NSIS installer.

### 3. macOS Code Signing Note
On macOS, Gatekeeper may flag unsigned binaries downloaded from the internet. When building for macOS:
- If you don't have an Apple Developer ID certificate, users who install the app for the first time may need to right-click -> Open, or run:
  ```bash
  xattr -cr /Applications/OpenTune.app
  ```
- In-app updates via the `.zip` archive will unpack directly into `/Applications/OpenTune.app`.

