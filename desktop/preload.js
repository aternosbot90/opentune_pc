const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('is-window-maximized'),
  onMaximizedChange: (callback) => ipcRenderer.on('window-maximized-state', (_event, state) => callback(state)),
  setMiniPlayer: (enable) => ipcRenderer.invoke('set-mini-player', enable),
  onMiniPlayerChange: (callback) => ipcRenderer.on('mini-player-state', (_event, isMini) => callback(isMini)),

  // System & external links
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  // YouTube Music APIs
  search: (query, filter = 'song') => ipcRenderer.invoke('search', { query, filter }),
  getSearchSuggestions: (query) => ipcRenderer.invoke('get-search-suggestions', query),
  getHomeFeed: () => ipcRenderer.invoke('get-home-feed'),
  getExploreCategories: () => ipcRenderer.invoke('get-explore-categories'),
  getExploreData: () => ipcRenderer.invoke('get-explore-data'),
  getUpNext: (videoId) => ipcRenderer.invoke('get-up-next', videoId),
  getAlbum: (albumId) => ipcRenderer.invoke('get-album', albumId),
  getPlaylist: (playlistId) => ipcRenderer.invoke('get-playlist', playlistId),
  getArtist: (artistId) => ipcRenderer.invoke('get-artist', artistId),
  getLibrary: () => ipcRenderer.invoke('get-library'),
  getTrackDetails: (videoId, meta = {}) => ipcRenderer.invoke('get-track-details', videoId, meta),
  getTrackComments: (videoId) => ipcRenderer.invoke('get-track-comments', videoId),
  postTrackComment: (videoId, text) => ipcRenderer.invoke('post-track-comment', { videoId, text }),

  // Playback & Lyrics
  getStreamUrl: (videoId) => ipcRenderer.invoke('get-stream-url', videoId),
  preloadStream: (videoId) => ipcRenderer.invoke('preload-stream', videoId),
  getLyrics: (title, artist, duration, trackId) => {
    if (typeof title === 'object' && title !== null) {
      return ipcRenderer.invoke('get-lyrics', title);
    }
    return ipcRenderer.invoke('get-lyrics', { title, artist, duration, trackId });
  },
  searchLyrics: (query) => ipcRenderer.invoke('search-lyrics', query),

  // Auth / Login methods
  startGoogleDeviceAuth: () => ipcRenderer.invoke('start-google-device-auth'),
  cancelGoogleDeviceAuth: () => ipcRenderer.invoke('cancel-google-device-auth'),
  onAuthDevicePending: (callback) => ipcRenderer.on('auth-device-pending', (_event, data) => callback(data)),
  openLoginWindow: () => ipcRenderer.invoke('open-login-window'),
  saveManualCookie: (cookie) => ipcRenderer.invoke('save-manual-cookie', cookie),
  signOut: () => ipcRenderer.invoke('sign-out'),
  getAccountProfile: () => ipcRenderer.invoke('get-account-profile'),
  onAuthChanged: (callback) => ipcRenderer.on('auth-changed', (_event, profile) => callback(profile)),
  clearCache: () => ipcRenderer.invoke('clear-cache'),

  // Downloads Engine & Sync
  checkLocalTrackFile: (track, downloadDir) => ipcRenderer.invoke('check-local-track-file', { track, downloadDir }),
  downloadPlaylist: (playlist) => ipcRenderer.invoke('download-playlist', playlist),
  cancelPlaylistDownload: () => ipcRenderer.invoke('cancel-playlist-download'),
  onDownloadProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('download-playlist-progress', listener);
    return () => ipcRenderer.removeListener('download-playlist-progress', listener);
  },
  openDownloadFolder: (folderPath) => ipcRenderer.invoke('open-download-folder', folderPath),
  downloadSingleTrack: (payload) => ipcRenderer.invoke('download-single-track', payload),
  getDownloadConfig: () => ipcRenderer.invoke('get-download-config'),
  setDownloadConfig: (cfg) => ipcRenderer.invoke('set-download-config', cfg),
  chooseDownloadFolder: () => ipcRenderer.invoke('choose-download-folder'),
  syncOfflineTracks: (tracks) => ipcRenderer.invoke('sync-offline-tracks', tracks),
  cacheMissingOfflineAssets: (tracks) => ipcRenderer.invoke('cache-missing-offline-assets', tracks),

  // YouTube Music Playlist Cloud Sync
  createYtPlaylist: (payload) => ipcRenderer.invoke('create-yt-playlist', payload),
  addToYtPlaylist: (payload) => ipcRenderer.invoke('add-to-yt-playlist', payload),
  removeFromYtPlaylist: (payload) => ipcRenderer.invoke('remove-from-yt-playlist', payload),

  // In-App Auto Updates (Windows & macOS)
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdateNow: () => ipcRenderer.invoke('install-update-now'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  }
});
