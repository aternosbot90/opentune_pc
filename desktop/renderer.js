// OpenTune PC Desktop Renderer
// Full parity with OpenTune Android (Material 3 Expressive, Lyrics, History, Stats, Playlists, Sleep Timer, Radio)

// Global safety net to prevent any UI or rendering error from crashing the window
window.onerror = function (message, source, lineno, colno, error) {
  console.warn('Safely recovered renderer error:', message, error);
  return true;
};
window.addEventListener('unhandledrejection', function (event) {
  console.warn('Safely recovered unhandled rejection in renderer:', event.reason);
  event.preventDefault();
});

// State
// High-Resolution Cover Art Helper
function cleanArtistName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw
    .replace(/\s*[-–—:]\s*topic\b/gi, '')
    .replace(/\s*\(topic\)\s*/gi, '')
    .replace(/\bTopic\b/gi, '')
    .replace(/\s+official(?:\s+channel)?\b/gi, '')
    .replace(/\s+records\b/gi, '')
    .replace(/(?:Official|Music|VEVO)$/i, '')
    .replace(/\s+(?:VEVO|Official|Music)\b/gi, '')
    .replace(/\s*[-–—]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || raw.trim();
}

function upgradeCover(url, size = 544) {
  if (!url || typeof url !== 'string') return 'assets/icon.png';
  let clean = url.trim();
  if (clean.startsWith('//')) clean = 'https:' + clean;

  if (clean.includes('googleusercontent.com') || clean.includes('ggpht.com')) {
    clean = clean
      .replace(/=w\d+-h\d+[^?#]*/, `=w${size}-h${size}-l90-rj`)
      .replace(/=s\d+[^?#]*/, `=s${size}-c`);
    if (!clean.includes(`=w${size}`) && !clean.includes(`=s${size}`)) {
      if (clean.includes('=')) {
        clean = clean.split('=')[0] + `=w${size}-h${size}-l90-rj`;
      } else {
        clean += `=w${size}-h${size}-l90-rj`;
      }
    }
    return clean;
  }

  if (clean.includes('i.ytimg.com')) {
    clean = clean.replace(/\/(default|mqdefault)\.jpg/, '/hqdefault.jpg');
    return clean;
  }

  return clean;
}

const state = {
  currentTrack: null,
  queue: [],
  queueIndex: -1,
  shuffleBag: [],
  shuffleHistory: [],
  shuffleForwardStack: [],
  priorityNextIndices: [],
  queueEditing: false,
  npQueueEditing: false,
  showPlayedInQueue: false,
  playRequestToken: 0,
  searchRequestToken: 0,
  isPlaying: false,
  isShuffle: false,
  repeatMode: 'none', // 'none' | 'all' | 'one'
  volume: 0.8,
  isMuted: false,
  previousVolume: 0.8,
  likedSongs: new Set(),
  likedSongsData: [],
  currentLyrics: [],
  rawLyricsText: '',
  lyricsSource: null,
  lyricsOffset: 0,
  activeLyricsIndex: -1,
  activePanel: null, // null | 'lyrics' | 'queue'
  history: ['home'],
  historyIndex: 0,
  userProfile: null,
  selectedContextTrack: null,
  activePlaylistId: null
};

function showToast(message, type = 'info', durationMs = 3600, action = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  if (action && typeof action.onClick === 'function' && action.label) {
    const actBtn = document.createElement('button');
    actBtn.className = 'toast-action-btn';
    actBtn.type = 'button';
    actBtn.textContent = action.label;
    actBtn.addEventListener('click', () => {
      action.onClick();
      toast.remove();
    });
    toast.appendChild(actBtn);
  }

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    setTimeout(() => toast.remove(), 220);
  }, durationMs);
}

// DOM Elements
const audio = document.getElementById('audio-player');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const suggestionsDropdown = document.getElementById('suggestions-dropdown');

// Window control & responsive navigation elements
document.getElementById('win-min')?.addEventListener('click', () => window.api.minimize());
document.getElementById('win-max')?.addEventListener('click', () => window.api.maximize());
document.getElementById('win-close')?.addEventListener('click', () => window.api.close());

const sidebarEl = document.querySelector('.sidebar');
const sidebarBackdropEl = document.getElementById('sidebar-backdrop');
function setMobileSidebarOpen(open) {
  if (sidebarEl) sidebarEl.classList.toggle('mobile-open', open);
  if (sidebarBackdropEl) sidebarBackdropEl.classList.toggle('active', open);
}
document.getElementById('mobile-nav-toggle')?.addEventListener('click', () => {
  setMobileSidebarOpen(!sidebarEl?.classList.contains('mobile-open'));
});
sidebarBackdropEl?.addEventListener('click', () => setMobileSidebarOpen(false));

// Mini-Player Toggle Integration
async function toggleMiniPlayerMode(forceState = null) {
  if (!window.api?.setMiniPlayer) return;
  try {
    const res = await window.api.setMiniPlayer({
      enable: forceState,
      alwaysOnTop: settings?.pipAlwaysOnTop !== false
    });
    applyMiniPlayerClass(!!res?.isMini);
  } catch (err) {
    console.warn('Mini player toggle error:', err);
  }
}

function applyMiniPlayerClass(isMini) {
  document.body.classList.toggle('mini-player-mode', isMini);
  if (isMini) {
    if (typeof closeNowPlaying === 'function') closeNowPlaying();
    if (typeof closeDrawer === 'function' && state.activePanel) closeDrawer();
  }
  const miniHeaderBtn = document.getElementById('header-mini-btn');
  if (miniHeaderBtn) {
    miniHeaderBtn.title = isMini ? 'Restore Full Window' : 'Toggle Mini-Player';
    miniHeaderBtn.classList.toggle('active', isMini);
  }
  const npMiniBtn = document.getElementById('np-mini-btn');
  if (npMiniBtn) npMiniBtn.classList.toggle('active', isMini);
  const plMiniBtn = document.getElementById('player-mini-btn');
  if (plMiniBtn) plMiniBtn.classList.toggle('active', isMini);
  if (typeof refreshVisualFrame === 'function') {
    setTimeout(() => {
      if (typeof invalidateWaveMetrics === 'function') invalidateWaveMetrics();
      refreshVisualFrame(true);
    }, 80);
  }
}

document.getElementById('sidebar-collapse-btn')?.addEventListener('click', () => {
  settings.compactSidebar = !settings.compactSidebar;
  saveSettings();
});

document.getElementById('player-mini-btn')?.addEventListener('click', () => toggleMiniPlayerMode());
document.getElementById('header-mini-btn')?.addEventListener('click', () => toggleMiniPlayerMode());
document.getElementById('np-mini-btn')?.addEventListener('click', () => toggleMiniPlayerMode(true));
window.api?.onMiniPlayerChange?.((isMini) => applyMiniPlayerClass(!!isMini));

// Sidebar Navigation
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view-section');

function navigateTo(viewName, addToHistory = true) {
  setMobileSidebarOpen(false);
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  views.forEach(view => {
    view.classList.toggle('active', view.id === `view-${viewName}`);
  });

  if (addToHistory) {
    if (state.history[state.historyIndex] !== viewName) {
      state.history = state.history.slice(0, state.historyIndex + 1);
      state.history.push(viewName);
      state.historyIndex++;
    }
  }
  updateHistoryButtons();

  if (viewName === 'home') {
    if (document.getElementById('home-trending-list').children.length === 0) loadHomeFeed();
  } else if (viewName === 'explore') {
    loadExplore();
  } else if (viewName === 'charts') {
    loadCharts();
  } else if (viewName === 'search') {
    if (!currentSearchQuery) renderSearchDiscovery();
  } else if (viewName === 'liked') {
    renderLikedSongs();
  } else if (viewName === 'playlists') {
    loadPlaylists();
  } else if (viewName === 'history') {
    loadHistory();
  } else if (viewName === 'stats') {
    loadStats();
  }
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    navigateTo(item.dataset.view);
  });
});

// History Navigation (< >)
const navBack = document.getElementById('nav-back');
const navForward = document.getElementById('nav-forward');

function updateHistoryButtons() {
  if (navBack) navBack.disabled = state.historyIndex <= 0;
  if (navForward) navForward.disabled = state.historyIndex >= state.history.length - 1;
}

navBack?.addEventListener('click', () => {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    navigateTo(state.history[state.historyIndex], false);
  }
});

navForward?.addEventListener('click', () => {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    navigateTo(state.history[state.historyIndex], false);
  }
});

// Player Controls
const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const progressTrack = document.getElementById('progress-track');
const progressFill = document.getElementById('progress-fill');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const volumeTrack = document.getElementById('volume-track');
const volumeFill = document.getElementById('volume-fill');
const btnMute = document.getElementById('btn-mute');

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function parseDurationToSeconds(dur) {
  if (!dur) return 180;
  const parts = dur.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 180;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Recently';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function parseColorToRgb(colorStr) {
  if (!colorStr || typeof colorStr !== 'string') return [237, 85, 100];
  const hexMatch = colorStr.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgbMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  }
  return [237, 85, 100];
}

function clampThemeRgbForMode(r, g, b) {
  const isLight = typeof settings !== 'undefined' && settings.darkMode === 'light';
  let rr = Math.max(0, Math.min(255, r));
  let gg = Math.max(0, Math.min(255, g));
  let bb = Math.max(0, Math.min(255, b));

  // Gently boost chroma if too gray/muted so dynamic accents look vivid
  const avg = (rr + gg + bb) / 3;
  const maxDiff = Math.max(Math.abs(rr - avg), Math.abs(gg - avg), Math.abs(bb - avg));
  if (maxDiff > 4 && maxDiff < 38) {
    const boost = 38 / maxDiff;
    rr = Math.max(0, Math.min(255, Math.round(avg + (rr - avg) * boost)));
    gg = Math.max(0, Math.min(255, Math.round(avg + (gg - avg) * boost)));
    bb = Math.max(0, Math.min(255, Math.round(avg + (bb - avg) * boost)));
  }

  const lum = (rr * 299 + gg * 587 + bb * 114) / 1000;
  if (isLight && lum > 142) {
    const scale = 132 / Math.max(1, lum);
    rr = Math.round(rr * scale);
    gg = Math.round(gg * scale);
    bb = Math.round(bb * scale);
  } else if (!isLight && lum < 105) {
    const lift = lum < 20 ? 115 : (120 - lum);
    rr = Math.min(255, Math.round(rr + lift));
    gg = Math.min(255, Math.round(gg + lift));
    bb = Math.min(255, Math.round(bb + lift));
  }
  return [rr, gg, bb];
}

function applyThemeRgbAccent(r, g, b, isDynamic = false) {
  const [cr, cg, cb] = clampThemeRgbForMode(r, g, b);
  const isLight = typeof settings !== 'undefined' && settings.darkMode === 'light';
  const accentColor = `rgb(${cr}, ${cg}, ${cb})`;
  const accentGlow = `rgba(${cr}, ${cg}, ${cb}, ${isLight ? 0.34 : 0.45})`;
  const accentContainer = `rgba(${cr}, ${cg}, ${cb}, ${isLight ? 0.16 : 0.22})`;
  const onContainer = isLight
    ? `rgb(${Math.round(cr * 0.48)}, ${Math.round(cg * 0.48)}, ${Math.round(cb * 0.48)})`
    : `rgb(${Math.min(255, Math.round(cr + (255 - cr) * 0.72))}, ${Math.min(255, Math.round(cg + (255 - cg) * 0.72))}, ${Math.min(255, Math.round(cb + (255 - cb) * 0.72))})`;

  document.documentElement.style.setProperty('--accent', accentColor);
  document.documentElement.style.setProperty('--accent-glow', accentGlow);
  document.documentElement.style.setProperty('--accent-container', accentContainer);
  document.documentElement.style.setProperty('--accent-on-container', onContainer);

  const b1 = document.getElementById('ambient-blob-1');
  const b2 = document.getElementById('ambient-blob-2');
  const blobAlpha1 = isLight ? 0.28 : 0.42;
  const blobAlpha2 = isLight ? 0.2 : 0.32;
  if (b1) b1.style.background = `radial-gradient(circle, rgba(${cr}, ${cg}, ${cb}, ${blobAlpha1}) 0%, transparent 70%)`;
  if (b2) b2.style.background = `radial-gradient(circle, rgba(${Math.min(255, cr + 36)}, ${Math.max(0, cg - 16)}, ${Math.min(255, cb + 44)}, ${blobAlpha2}) 0%, transparent 70%)`;
}

// Dynamic Ambient Color Extractor (matches OpenTune Android PlayerColorExtractor.kt)
function extractAlbumColors(imgUrl) {
  if (!imgUrl || !settings.dynamicTheme) return;
  const img = new Image();
  img.crossOrigin = 'Anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        if (brightness > 28 && brightness < 238) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
      }
      if (count > 0) {
        applyThemeRgbAccent(Math.round(r / count), Math.round(g / count), Math.round(b / count), true);
      }
    } catch (_) {}
  };
  img.onerror = () => {};
  img.src = imgUrl;
}

// Listening History & Analytics Tracking Engine
function recordSongPlay(track) {
  if (!track || !track.id) return;

  // History record
  if (!settings.pauseHistory) {
    try {
      let history = JSON.parse(localStorage.getItem('opentune_history') || '[]');
      history = history.filter(t => t.id !== track.id);
      history.unshift({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album || '',
        duration: track.duration || '',
        thumbnail: track.thumbnail || '',
        timestamp: Date.now()
      });
      if (history.length > 100) history = history.slice(0, 100);
      localStorage.setItem('opentune_history', JSON.stringify(history));
    } catch (_) {}
  }

  // Stats record
  try {
    let stats = { totalPlays: 0, totalSeconds: 0, songs: {}, artists: {} };
    const saved = localStorage.getItem('opentune_stats');
    if (saved) stats = { ...stats, ...JSON.parse(saved) };

    stats.totalPlays = (stats.totalPlays || 0) + 1;
    const sec = parseDurationToSeconds(track.duration);
    stats.totalSeconds = (stats.totalSeconds || 0) + sec;

    stats.songs = stats.songs || {};
    if (!stats.songs[track.id]) {
      stats.songs[track.id] = { ...track, playCount: 0 };
    }
    stats.songs[track.id].playCount++;

    stats.artists = stats.artists || {};
    if (track.artist) {
      stats.artists[track.artist] = (stats.artists[track.artist] || 0) + 1;
    }

    localStorage.setItem('opentune_stats', JSON.stringify(stats));
  } catch (_) {}
}

// Fisher-Yates Shuffle Bag & Queue Integrity Helpers
function rebuildShuffleBag(excludeIndex = state.queueIndex) {
  const prioritySet = new Set(state.priorityNextIndices || []);
  const indices = [];
  for (let i = 0; i < state.queue.length; i++) {
    if (i !== excludeIndex && !prioritySet.has(i)) indices.push(i);
  }
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  state.shuffleBag = indices;
}

function getNextShuffleIndex() {
  if (state.queue.length <= 1) return state.queue.length === 1 ? 0 : -1;
  state.shuffleBag = (state.shuffleBag || []).filter(i => i >= 0 && i < state.queue.length && i !== state.queueIndex);
  if (state.shuffleBag.length === 0) {
    rebuildShuffleBag(state.queueIndex);
  }
  return state.shuffleBag.length > 0 ? state.shuffleBag.shift() : -1;
}

function shiftQueueTrackingIndices(fromIdx, delta) {
  const shiftArr = (arr) => (arr || [])
    .map(i => (i >= fromIdx ? i + delta : i))
    .filter(i => i >= 0 && i < state.queue.length);
  state.priorityNextIndices = shiftArr(state.priorityNextIndices);
  state.shuffleBag = shiftArr(state.shuffleBag);
  state.shuffleHistory = shiftArr(state.shuffleHistory);
  state.shuffleForwardStack = shiftArr(state.shuffleForwardStack);
}

function removeIndexFromTracking(idx) {
  state.priorityNextIndices = (state.priorityNextIndices || []).filter(i => i !== idx);
  state.shuffleBag = (state.shuffleBag || []).filter(i => i !== idx);
  state.shuffleHistory = (state.shuffleHistory || []).filter(i => i !== idx);
  state.shuffleForwardStack = (state.shuffleForwardStack || []).filter(i => i !== idx);
}

function remapIndexOnMove(idx, fromIndex, toIndex) {
  if (idx === fromIndex) return toIndex;
  if (fromIndex < toIndex) {
    return (idx > fromIndex && idx <= toIndex) ? idx - 1 : idx;
  }
  return (idx >= toIndex && idx < fromIndex) ? idx + 1 : idx;
}

function getOrderedUpcomingIndices() {
  const len = state.queue.length;
  if (len === 0) return [];
  const seen = new Set();
  if (state.queueIndex >= 0 && state.queueIndex < len) {
    seen.add(state.queueIndex);
  }
  const ordered = [];

  (state.priorityNextIndices || []).forEach((idx) => {
    if (typeof idx === 'number' && idx >= 0 && idx < len && !seen.has(idx)) {
      seen.add(idx);
      ordered.push(idx);
    }
  });

  if (state.isShuffle) {
    const fwd = state.shuffleForwardStack || [];
    for (let i = fwd.length - 1; i >= 0; i--) {
      const idx = fwd[i];
      if (typeof idx === 'number' && idx >= 0 && idx < len && !seen.has(idx)) {
        seen.add(idx);
        ordered.push(idx);
      }
    }
    (state.shuffleBag || []).forEach((idx) => {
      if (typeof idx === 'number' && idx >= 0 && idx < len && !seen.has(idx)) {
        seen.add(idx);
        ordered.push(idx);
      }
    });
    const historySet = new Set(state.shuffleHistory || []);
    for (let i = 0; i < len; i++) {
      if (!seen.has(i) && !historySet.has(i)) {
        seen.add(i);
        ordered.push(i);
      }
    }
  } else {
    const startIdx = state.queueIndex >= 0 ? state.queueIndex + 1 : 0;
    for (let i = startIdx; i < len; i++) {
      if (!seen.has(i)) {
        seen.add(i);
        ordered.push(i);
      }
    }
    if (state.repeatMode === 'all' && state.queueIndex > 0) {
      for (let i = 0; i < state.queueIndex; i++) {
        if (!seen.has(i)) {
          seen.add(i);
          ordered.push(i);
        }
      }
    }
  }
  return ordered;
}

function preloadAdjacentTracks() {
  if (!window.api?.preloadStream || state.queue.length <= 1) return;
  const candidates = [];
  const upcoming = getOrderedUpcomingIndices();
  if (upcoming.length > 0 && state.queue[upcoming[0]]) {
    candidates.push(state.queue[upcoming[0]].id);
  }
  if (state.queueIndex > 0 && state.queue[state.queueIndex - 1]) {
    candidates.push(state.queue[state.queueIndex - 1].id);
  }
  candidates.filter(Boolean).forEach(vid => {
    window.api.preloadStream(vid).catch(() => {});
  });
}

async function openArtistByNameOrId(artistId, artistName, onBeforeNavigate = null) {
  if (typeof onBeforeNavigate === 'function') {
    try { onBeforeNavigate(); } catch {}
  }

  const cleanId = typeof artistId === 'string' ? artistId.trim() : '';
  if (cleanId) {
    return openArtistDetail(cleanId);
  }

  const rawName = cleanArtistName(typeof artistName === 'string' ? artistName.trim() : '');
  if (!rawName || rawName === 'Unknown Artist' || rawName === 'Ready to play' || rawName === 'Various Artists') {
    return;
  }

  navigateTo('artist-detail');
  const titleEl = document.getElementById('artist-detail-name');
  const subsEl = document.getElementById('artist-detail-subs');
  const descEl = document.getElementById('artist-detail-desc');
  const avatarEl = document.getElementById('artist-detail-avatar');
  const songsList = document.getElementById('artist-detail-songs-list');
  const albumsSec = document.getElementById('artist-detail-albums-section');
  const singlesSec = document.getElementById('artist-detail-singles-section');
  const relatedSec = document.getElementById('artist-detail-related-section');
  const featuredSec = document.getElementById('artist-detail-featured-section');

  if (titleEl) titleEl.textContent = rawName;
  if (subsEl) subsEl.textContent = 'Resolving artist profile...';
  if (descEl) { descEl.textContent = ''; descEl.style.display = 'none'; }
  if (avatarEl) avatarEl.src = 'assets/icon.png';
  if (albumsSec) albumsSec.style.display = 'none';
  if (singlesSec) singlesSec.style.display = 'none';
  if (relatedSec) relatedSec.style.display = 'none';
  if (featuredSec) featuredSec.style.display = 'none';
  if (songsList) {
    songsList.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;"><div class="spinner"></div></td></tr>';
  }

  try {
    let candidates = await window.api.search(rawName, 'artist');
    let queryUsed = rawName;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      const primaryName = rawName.split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bx\b)\s*/i)[0]?.trim();
      if (primaryName && primaryName.toLowerCase() !== rawName.toLowerCase()) {
        queryUsed = primaryName;
        candidates = await window.api.search(primaryName, 'artist');
      }
    }

    if (Array.isArray(candidates) && candidates.length > 0) {
      const targetLower = queryUsed.toLowerCase();
      const exactMatch = candidates.find(a => (a?.name || '').trim().toLowerCase() === targetLower && a?.id);
      const chosen = exactMatch || candidates.find(a => a?.id);
      if (chosen?.id) {
        return openArtistDetail(chosen.id);
      }
    }
  } catch (err) {
    console.warn('Artist lookup failed, falling back to search:', err?.message || err);
  }

  if (searchInput) searchInput.value = rawName;
  executeSearch(rawName, 'all');
}

function navigateToArtistFromTrack(track, onBeforeNavigate = null) {
  if (!track) return;
  const linkedArtist = Array.isArray(track.artistLinks) ? track.artistLinks.find(a => a.id) : null;
  const resolvedId = track.artistId || linkedArtist?.id || '';
  const resolvedName = linkedArtist?.name || track.artist || '';
  openArtistByNameOrId(resolvedId, resolvedName, onBeforeNavigate);
}

function navigateToAlbumFromTrack(track) {
  if (!track) return;
  if (track.albumId) {
    openAlbumDetail(track.albumId);
  } else if (track.album) {
    searchInput.value = track.album;
    executeSearch(track.album, 'album');
  }
}

function splitArtistNamesBySetting(rawArtistStr) {
  const text = cleanArtistName(String(rawArtistStr || '')).trim();
  if (!text) return ['Unknown Artist'];
  const rawSymbols = (typeof settings !== 'undefined' && settings.artistSplitSymbols)
    ? settings.artistSplitSymbols
    : ', & feat. ft. x /';
  const tokens = rawSymbols.split(/\s+/).map(s => s.trim()).filter(Boolean);
  if (tokens.length === 0) return [text];
  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Split on symbol tokens (words need whitespace boundary so "x" doesn't split inside names)
  const parts = escaped.map(tok => (/^[a-zA-Z0-9.]+$/.test(tok) ? `\\s+${tok}\\s+` : `\\s*${tok}\\s*`));
  const regex = new RegExp(parts.join('|'), 'gi');
  const split = text.split(regex).map(s => s.trim()).filter(Boolean);
  return split.length > 0 ? split : [text];
}

function renderArtistLinksHtml(track) {
  if (Array.isArray(track?.artistLinks) && track.artistLinks.length > 0) {
    return track.artistLinks.map((a, idx) => {
      const cleanName = cleanArtistName(a.name);
      const idAttr = a.id ? `data-artist-id="${String(a.id).replace(/"/g, '&quot;')}"` : '';
      return `<span class="clickable-artist-link" ${idAttr} data-artist-name="${String(cleanName).replace(/"/g, '&quot;')}">${cleanName}</span>${idx < track.artistLinks.length - 1 ? ', ' : ''}`;
    }).join('');
  }
  const cleanTrackArtist = cleanArtistName(track?.artist || 'Unknown Artist');
  const names = splitArtistNamesBySetting(cleanTrackArtist);
  return names.map((name, idx) => {
    const cleanName = cleanArtistName(name);
    const idAttr = (idx === 0 && track?.artistId && names.length === 1)
      ? `data-artist-id="${String(track.artistId).replace(/"/g, '&quot;')}"`
      : '';
    return `<span class="clickable-artist-link" ${idAttr} data-artist-name="${String(cleanName).replace(/"/g, '&quot;')}">${cleanName}</span>`;
  }).join(', ');
}

function bindArtistLinksInContainer(container, fallbackTrack, onBeforeNavigate = null) {
  if (!container) return;
  container.querySelectorAll('.clickable-artist-link').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const artistId = el.dataset.artistId || '';
      const artistName = cleanArtistName(el.dataset.artistName || fallbackTrack?.artist || '');
      const resolvedId = artistId || ((fallbackTrack?.artistId && artistName === fallbackTrack.artist) ? fallbackTrack.artistId : '');
      openArtistByNameOrId(resolvedId, artistName, onBeforeNavigate);
    });
  });
}

function updateShuffleRepeatUI() {
  btnShuffle?.classList.toggle('active', state.isShuffle);
  document.getElementById('np-shuffle-btn')?.classList.toggle('active', state.isShuffle);

  const npRepeat = document.getElementById('np-repeat-btn');
  const repeatTitle = state.repeatMode === 'one' ? 'Repeat: One' : (state.repeatMode === 'all' ? 'Repeat: All' : 'Repeat: Off');
  if (btnRepeat) {
    btnRepeat.classList.toggle('active', state.repeatMode !== 'none');
    btnRepeat.dataset.repeat = state.repeatMode;
    btnRepeat.title = repeatTitle;
  }
  if (npRepeat) {
    npRepeat.classList.toggle('active', state.repeatMode !== 'none');
    npRepeat.dataset.repeat = state.repeatMode;
    npRepeat.title = repeatTitle;
  }
}

function syncPlayerTrackMetadataUI(track) {
  const thumbEl = document.getElementById('player-thumb');
  const titleEl = document.getElementById('player-title');
  const artistEl = document.getElementById('player-artist');
  const albumEl = document.getElementById('player-album');
  const sepEl = document.getElementById('player-meta-sep');

  if (thumbEl) {
    const thumbSrc = upgradeCover(track.thumbnail, 800);
    thumbEl.src = thumbSrc;
    thumbEl.classList.toggle('yt-crop-letterbox', /i\.ytimg\.com\/vi\/[^/]+\/(hqdefault|sddefault|0)\.jpg/i.test(thumbSrc));
  }
  if (titleEl) titleEl.textContent = track.title || 'Unknown Title';

  if (artistEl) {
    artistEl.innerHTML = renderArtistLinksHtml(track);
    bindArtistLinksInContainer(artistEl, track);
  }

  if (albumEl && sepEl) {
    const albText = track.album ? (track.year ? `${track.album} (${track.year})` : track.album) : (track.year || '');
    if (albText) {
      albumEl.textContent = albText;
      albumEl.style.display = 'inline';
      sepEl.style.display = 'inline';
      albumEl.onclick = (e) => {
        e.stopPropagation();
        navigateToAlbumFromTrack(track);
      };
    } else {
      albumEl.style.display = 'none';
      sepEl.style.display = 'none';
      albumEl.onclick = null;
    }
  }
}

const sessionDownloadedIds = new Set();

function updateNpDownloadButtonState(trackId) {
  const npDlBtn = document.getElementById('np-download-btn');
  if (!npDlBtn) return;
  const isDone = Boolean(trackId && sessionDownloadedIds.has(trackId));
  npDlBtn.classList.toggle('is-downloaded', isDone);
  npDlBtn.title = isDone ? 'Downloaded Offline' : 'Download Song for Offline';
  npDlBtn.innerHTML = isDone
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
}

function persistDownloadedTrack(track) {
  if (!track?.id) return;
  sessionDownloadedIds.add(track.id);
  try {
    const saved = JSON.parse(localStorage.getItem('opentune_downloaded_tracks') || '[]');
    const filtered = Array.isArray(saved) ? saved.filter(t => t && t.id !== track.id) : [];
    filtered.unshift({
      id: track.id,
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Unknown Artist',
      album: track.album || '',
      duration: track.duration || '',
      thumbnail: track.thumbnail || ''
    });
    localStorage.setItem('opentune_downloaded_tracks', JSON.stringify(filtered.slice(0, 1000)));
  } catch (_) {}
  updateLibraryBentoCounts?.();
}

function hydrateDownloadedTrackSet() {
  try {
    const saved = JSON.parse(localStorage.getItem('opentune_downloaded_tracks') || '[]');
    if (Array.isArray(saved)) {
      saved.forEach(t => { if (t?.id) sessionDownloadedIds.add(t.id); });
    }
  } catch (_) {}
}
hydrateDownloadedTrackSet();

async function downloadTrackWithFeedback(track, triggerBtn = null) {
  if (!track || !track.id) return;
  if (triggerBtn) triggerBtn.disabled = true;
  showToast(`Downloading "${track.title}"...`, 'info', 2500);
  try {
    const res = await window.api.downloadSingleTrack({
      track,
      downloadDir: settings.downloadPath || ''
    });
    if (res.success) {
      persistDownloadedTrack(track);
      if (state.currentTrack?.id === track.id) updateNpDownloadButtonState(track.id);
      showToast(`Downloaded "${track.title}"`, 'success', 5500, {
        label: 'Open Folder',
        onClick: () => window.api.openDownloadFolder(res.folderPath)
      });
    } else {
      showToast(`Could not download track: ${res.error}`, 'error', 5000);
    }
  } catch (err) {
    showToast(`Could not download track: ${err?.message || err}`, 'error', 5000);
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

function appendTracksToQueue(tracks, label = 'tracks') {
  if (!Array.isArray(tracks) || tracks.length === 0) return;
  state.queue.push(...tracks);
  state.shuffleForwardStack = [];
  if (state.isShuffle) rebuildShuffleBag(state.queueIndex);
  renderQueue();
  savePersistentQueue();
  preloadAdjacentTracks();
  showToast(`Added ${tracks.length} ${label} to queue`, 'success');
}

async function startRadioFromTrack(track) {
  if (!track || !track.id) return;
  showToast(`Starting radio mix from "${track.title}"...`, 'info', 2200);
  try {
    const radio = await window.api.getUpNext(track.id);
    if (radio && radio.length > 0) {
      playTrack(track, [track, ...radio], 0);
    } else {
      playTrack(track);
    }
  } catch (_) {
    playTrack(track);
  }
}

async function playTrack(track, queue = null, explicitIndex = null, options = {}) {
  if (!track || !track.id) return;
  if (track.artist) track.artist = cleanArtistName(track.artist);
  if (Array.isArray(track.artists)) track.artists = track.artists.map(cleanArtistName);
  if (Array.isArray(track.artistLinks)) {
    track.artistLinks.forEach(a => { if (a && a.name) a.name = cleanArtistName(a.name); });
  }
  const requestToken = ++state.playRequestToken;

  // Immediately silence previous audio without destroying the HTMLMediaElement pipeline
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (_) {}
  const wasPlaying = Boolean(state.isPlaying || options?.autoplay !== false);
  state.isPlaying = wasPlaying;
  updatePlayPauseUI();

  state.currentTrack = track;

  if (queue) {
    state.queue = [...queue];
    state.queueIndex = (explicitIndex !== null && explicitIndex >= 0 && explicitIndex < state.queue.length)
      ? explicitIndex
      : state.queue.findIndex(t => t.id === track.id);
    if (state.queueIndex < 0) state.queueIndex = 0;
    state.priorityNextIndices = [];
    state.shuffleHistory = [];
    state.shuffleForwardStack = [];
    if (state.isShuffle) rebuildShuffleBag(state.queueIndex);
  } else if (explicitIndex !== null && explicitIndex >= 0 && explicitIndex < state.queue.length) {
    state.queueIndex = explicitIndex;
    state.priorityNextIndices = (state.priorityNextIndices || []).filter(i => i !== explicitIndex);
    state.shuffleBag = (state.shuffleBag || []).filter(i => i !== explicitIndex);
    if (!options?.preserveShuffleForward) {
      state.shuffleForwardStack = [];
    } else {
      state.shuffleForwardStack = (state.shuffleForwardStack || []).filter(i => i !== explicitIndex);
    }
  } else {
    const existingIdx = state.queue.findIndex(t => t.id === track.id);
    if (existingIdx !== -1) {
      state.queueIndex = existingIdx;
      state.priorityNextIndices = (state.priorityNextIndices || []).filter(i => i !== existingIdx);
      state.shuffleBag = (state.shuffleBag || []).filter(i => i !== existingIdx);
    } else {
      state.queue.push(track);
      state.queueIndex = state.queue.length - 1;
    }
    if (!options?.preserveShuffleForward) {
      state.shuffleForwardStack = [];
    } else {
      state.shuffleForwardStack = (state.shuffleForwardStack || []).filter(i => i !== state.queueIndex);
    }
  }

  // Record History & Stats
  recordSongPlay(track);

  // Update Player UI immediately
  syncPlayerTrackMetadataUI(track);
  updateLikeButtonUI();
  extractAlbumColors(track.thumbnail);

  // Highlight active track rows across current view
  document.querySelectorAll('.track-row').forEach(r => r.classList.remove('active'));

  // Reset progress UI
  progressFill.style.width = '0%';
  timeCurrent.textContent = '0:00';
  timeTotal.textContent = track.duration || '--:--';
  const npFill = document.getElementById('np-progress-fill');
  if (npFill) npFill.style.width = '0%';
  const npCur = document.getElementById('np-time-current');
  const npTot = document.getElementById('np-time-total');
  if (npCur) npCur.textContent = '0:00';
  if (npTot) npTot.textContent = track.duration || '--:--';

  syncNowPlayingUI();
  renderQueue();
  savePersistentQueue();

  // Reset & immediately fetch lyrics in parallel (never leave previous song lyrics lingering)
  state.currentLyrics = [];
  state.activeLyricsIndex = -1;
  state.rawLyricsText = '';
  state.lyricsSource = null;
  lyricDomCache.drawer = [];
  lyricDomCache.np = [];
  lyricDomCache.lastLineProgressDrawer = -1;
  lyricDomCache.lastLineProgressNp = -1;

  const lyricsLoadingHtml = '<div class="lyrics-loading"><div class="spinner"></div><p style="margin-top:12px;font-size:0.85rem;color:var(--text-muted);">Fetching synchronized lyrics...</p></div>';
  lyricsView.innerHTML = lyricsLoadingHtml;
  const npLyricsContent = document.getElementById('np-lyrics-content');
  if (npLyricsContent) npLyricsContent.innerHTML = lyricsLoadingHtml;

  fetchLyrics(track);

  // If currently in Video mode, route playback to video frame and silence audio element
  if (isVideoMode) {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
    } catch (_) {}
    videoCurrentTime = 0;
    videoDuration = parseDurationToSeconds(track.duration) || 0;
    state.isPlaying = true;
    updatePlayPauseUI();
    const videoFrame = document.getElementById('np-video-frame');
    if (videoFrame) {
      videoFrame.src = getVideoEmbedUrl(track.id, 0);
    }
    startVideoPlaybackTicker();
    updateMediaSession(track);
    return;
  }

  // 1. Instant Playback for downloaded offline songs (0ms latency, works offline)
  let localFile = null;
  try {
    localFile = await window.api.checkLocalTrackFile(track, settings.downloadPath);
  } catch (_) {}

  if (requestToken !== state.playRequestToken) return;

  if (localFile && localFile.exists && localFile.fileUrl) {
    if (typeof ensureEqualizerReady === 'function') ensureEqualizerReady();
    if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
      eqAudioCtx.resume().catch(() => {});
    }
    audio.autoplay = true;
    audio.preload = 'auto';
    audio.src = localFile.fileUrl;
    audio.volume = state.isMuted ? 0 : state.volume;
    audio.playbackRate = currentPlaybackSpeed;
    if (options?.startTime && options.startTime > 0) {
      audio.currentTime = options.startTime;
    }

    const startLocalPlayback = () => {
      if (requestToken !== state.playRequestToken) return;
      if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
        eqAudioCtx.resume().catch(() => {});
      }
      const p = audio.play();
      if (p !== undefined) {
        p.then(() => {
          if (requestToken !== state.playRequestToken) return;
          state.isPlaying = true;
          updatePlayPauseUI();
          preloadAdjacentTracks();
        }).catch((err) => {
          console.warn('Local audio play waiting for buffer:', err.message);
          const onReady = () => {
            audio.removeEventListener('canplay', onReady);
            audio.removeEventListener('loadeddata', onReady);
            if (requestToken !== state.playRequestToken) return;
            if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
              eqAudioCtx.resume().catch(() => {});
            }
            audio.play().then(() => {
              if (requestToken !== state.playRequestToken) return;
              state.isPlaying = true;
              updatePlayPauseUI();
              preloadAdjacentTracks();
            }).catch(() => {});
          };
          audio.addEventListener('canplay', onReady, { once: true });
          audio.addEventListener('loadeddata', onReady, { once: true });
        });
      }
    };
    startLocalPlayback();

    updateMediaSession(track);
    updateNpDownloadButtonState(track.id, true);
    if (settings.trackNotifications && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(track.title || 'Now Playing', {
          body: cleanArtistName(track.artist) || 'OpenTune Desktop',
          icon: upgradeCover(track.thumbnail, 256),
          silent: true
        });
      } catch (_) {}
    }
    return;
  }

  // 2. Fetch direct online audio stream URL
  try {
    const res = await window.api.getStreamUrl(track.id);
    if (requestToken !== state.playRequestToken) return; // User already switched songs!

    if (res.success && res.url) {
      if (typeof ensureEqualizerReady === 'function') ensureEqualizerReady();
      if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
        eqAudioCtx.resume().catch(() => {});
      }
      audio.autoplay = true;
      audio.preload = 'auto';
      audio.src = res.url;
      audio.volume = state.isMuted ? 0 : state.volume;
      audio.playbackRate = currentPlaybackSpeed;
      if (options?.startTime && options.startTime > 0) {
        audio.currentTime = options.startTime;
      }

      const startOnlinePlayback = () => {
        if (requestToken !== state.playRequestToken) return;
        if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
          eqAudioCtx.resume().catch(() => {});
        }
        const p = audio.play();
        if (p !== undefined) {
          p.then(() => {
            if (requestToken !== state.playRequestToken) return;
            state.isPlaying = true;
            updatePlayPauseUI();
            preloadAdjacentTracks();
          }).catch((err) => {
            console.warn('Audio play waiting for buffer:', err.message);
            const onReady = () => {
              audio.removeEventListener('canplay', onReady);
              audio.removeEventListener('loadeddata', onReady);
              if (requestToken !== state.playRequestToken) return;
              if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
                eqAudioCtx.resume().catch(() => {});
              }
              audio.play().then(() => {
                if (requestToken !== state.playRequestToken) return;
                state.isPlaying = true;
                updatePlayPauseUI();
                preloadAdjacentTracks();
              }).catch(() => {});
            };
            audio.addEventListener('canplay', onReady, { once: true });
            audio.addEventListener('loadeddata', onReady, { once: true });
          });
        }
      };
      startOnlinePlayback();

      updateMediaSession(track);
      if (settings.trackNotifications && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(track.title || 'Now Playing', {
            body: cleanArtistName(track.artist) || 'OpenTune Desktop',
            icon: upgradeCover(track.thumbnail, 256),
            silent: true
          });
        } catch (_) {}
      }
    } else {
      console.error('Failed to get stream:', res.error);
      state.isPlaying = false;
      updatePlayPauseUI();
      showToast(`Could not load audio for "${track.title}"`, 'error');
    }
  } catch (err) {
    if (requestToken !== state.playRequestToken) return;
    console.error('Playback start error:', err);
    state.isPlaying = false;
    updatePlayPauseUI();
    showToast(`Playback error: ${err.message}`, 'error');
  }
}

audio.addEventListener('error', (e) => {
  const errMsg = audio.error?.message || '';
  if (!audio.getAttribute('src')) return;
  console.error('HTML5 audio error:', errMsg || e);
  state.isPlaying = false;
  updatePlayPauseUI();
  if (settings.autoSkipOnError !== false && state.queue.length > 1) {
    showToast('Stream unavailable. Skipping to next track...', 'info', 2500);
    setTimeout(() => { if (!state.isPlaying) btnNext?.click(); }, 500);
  } else {
    showToast('Audio stream failed or expired. Try skipping to the next track.', 'error');
  }
});

function updatePlayPauseUI() {
  if (state.isPlaying) {
    iconPlay.style.display = 'none';
    iconPause.style.display = 'block';
  } else {
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
  }

  const npPlay = document.getElementById('np-icon-play');
  const npPause = document.getElementById('np-icon-pause');
  if (npPlay && npPause) {
    npPlay.style.display = state.isPlaying ? 'none' : 'block';
    npPause.style.display = state.isPlaying ? 'block' : 'none';
  }

  const aodPlay = document.getElementById('aod-icon-play');
  const aodPause = document.getElementById('aod-icon-pause');
  if (aodPlay && aodPause) {
    aodPlay.style.display = state.isPlaying ? 'none' : 'block';
    aodPause.style.display = state.isPlaying ? 'block' : 'none';
  }
}

btnPlayPause.addEventListener('click', () => {
  if (!state.currentTrack) return;
  if (isVideoMode) {
    toggleVideoPlayPause();
    return;
  }
  const currentSrc = audio.getAttribute('src');
  if (!currentSrc || currentSrc === '' || currentSrc === window.location.href) {
    playTrack(state.currentTrack, null, state.queueIndex, {
      startTime: state.savedPlaybackPosition || 0,
      preserveShuffleForward: true
    });
    return;
  }
  if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
    eqAudioCtx.resume().catch(() => {});
  }
  if (audio.paused) {
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        state.isPlaying = true;
        updatePlayPauseUI();
      }).catch(err => {
        console.warn('Play button click failed:', err.message);
        state.isPlaying = false;
        updatePlayPauseUI();
      });
    } else {
      state.isPlaying = true;
      updatePlayPauseUI();
    }
  } else {
    audio.pause();
    state.isPlaying = false;
    updatePlayPauseUI();
  }
});

btnNext.addEventListener('click', () => {
  if (state.queue.length === 0) return;

  // Always consume explicit "Play Next" items first (Shuffle ON or OFF)
  while (state.priorityNextIndices && state.priorityNextIndices.length > 0) {
    const priorityIdx = state.priorityNextIndices.shift();
    if (priorityIdx >= 0 && priorityIdx < state.queue.length && priorityIdx !== state.queueIndex) {
      if (state.isShuffle && state.queueIndex >= 0 && state.queueIndex < state.queue.length) {
        state.shuffleHistory.push(state.queueIndex);
        if (state.shuffleHistory.length > 100) state.shuffleHistory.shift();
      }
      playTrack(state.queue[priorityIdx], null, priorityIdx, { preserveShuffleForward: true });
      return;
    }
  }

  if (state.isShuffle) {
    if (state.queue.length === 1) {
      playTrack(state.queue[0], null, 0, { preserveShuffleForward: true });
      return;
    }
    if (state.queueIndex >= 0 && state.queueIndex < state.queue.length) {
      state.shuffleHistory.push(state.queueIndex);
      if (state.shuffleHistory.length > 100) state.shuffleHistory.shift();
    }
    let nextIdx = -1;
    while (state.shuffleForwardStack && state.shuffleForwardStack.length > 0) {
      const candidate = state.shuffleForwardStack.pop();
      if (candidate >= 0 && candidate < state.queue.length && candidate !== state.queueIndex) {
        nextIdx = candidate;
        break;
      }
    }
    if (nextIdx < 0) {
      nextIdx = getNextShuffleIndex();
    }
    if (nextIdx < 0 && state.queue.length > 0) {
      nextIdx = (state.queueIndex + 1) % state.queue.length;
    }
    if (nextIdx >= 0 && state.queue[nextIdx]) {
      playTrack(state.queue[nextIdx], null, nextIdx, { preserveShuffleForward: true });
    }
  } else if (state.queueIndex < state.queue.length - 1) {
    const nextIdx = state.queueIndex + 1;
    playTrack(state.queue[nextIdx], null, nextIdx);
  } else if (state.repeatMode === 'all') {
    playTrack(state.queue[0], null, 0);
  } else if (settings.autoplayRadio && state.currentTrack) {
    // Autoplay Radio (fetches similar songs when end of queue reached)
    window.api.getUpNext(state.currentTrack.id).then(items => {
      if (items && items.length > 0) {
        const startIdx = state.queue.length;
        state.queue.push(...items);
        renderQueue();
        savePersistentQueue();
        playTrack(items[0], null, startIdx);
      }
    });
  }
});

btnPrev.addEventListener('click', () => {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (state.isShuffle && state.shuffleHistory.length > 0) {
    const prevIdx = state.shuffleHistory.pop();
    if (prevIdx >= 0 && prevIdx < state.queue.length) {
      if (state.queueIndex >= 0 && state.queueIndex < state.queue.length && state.queueIndex !== prevIdx) {
        state.shuffleForwardStack = state.shuffleForwardStack || [];
        state.shuffleForwardStack.push(state.queueIndex);
        if (state.shuffleForwardStack.length > 100) state.shuffleForwardStack.shift();
      }
      playTrack(state.queue[prevIdx], null, prevIdx, { preserveShuffleForward: true });
      return;
    }
  }
  if (state.queueIndex > 0) {
    const prevIdx = state.queueIndex - 1;
    playTrack(state.queue[prevIdx], null, prevIdx);
  } else if (state.repeatMode === 'all' && state.queue.length > 0) {
    const lastIdx = state.queue.length - 1;
    playTrack(state.queue[lastIdx], null, lastIdx);
  } else if (state.currentTrack) {
    audio.currentTime = 0;
  }
});

btnShuffle.addEventListener('click', () => {
  state.isShuffle = !state.isShuffle;
  state.shuffleForwardStack = [];
  if (state.isShuffle) {
    rebuildShuffleBag(state.queueIndex);
    state.shuffleHistory = [];
  } else {
    state.shuffleBag = [];
  }
  updateShuffleRepeatUI();
  renderQueue();
  savePersistentQueue();
  preloadAdjacentTracks();
});

btnRepeat.addEventListener('click', () => {
  if (state.repeatMode === 'none') {
    state.repeatMode = 'all';
  } else if (state.repeatMode === 'all') {
    state.repeatMode = 'one';
  } else {
    state.repeatMode = 'none';
  }
  updateShuffleRepeatUI();
  renderQueue();
  savePersistentQueue();
  preloadAdjacentTracks();
});

// Audio progress, zero-reflow Wavy seekbar, smooth scrub & 60fps synced lyrics RAF loop
let seekWavePhase = 0;
let visualAnimRafId = null;
let lastWaveDrawTs = 0;
let lastRenderedSecond = -1;
let lastRenderedDuration = -1;
let isScrubbingSeek = false;
const waveMetricsCache = new WeakMap();
let waveResizeObserver = null;

function measureWaveTrack(trackEl) {
  if (!trackEl) return null;
  const w = trackEl.clientWidth;
  const h = trackEl.clientHeight;
  if (w <= 0 || h <= 0) return null;
  const prev = waveMetricsCache.get(trackEl);
  const metrics = {
    w,
    h,
    lastW: prev?.lastW || 0,
    lastH: prev?.lastH || 0
  };
  waveMetricsCache.set(trackEl, metrics);
  return metrics;
}

function observeWaveTrack(trackEl) {
  if (!trackEl) return;
  if (typeof ResizeObserver !== 'undefined') {
    if (!waveResizeObserver) {
      waveResizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target;
          const prev = waveMetricsCache.get(el) || {};
          waveMetricsCache.set(el, {
            w: Math.round(entry.contentRect.width) || el.clientWidth,
            h: Math.round(entry.contentRect.height) || el.clientHeight,
            lastW: prev.lastW || 0,
            lastH: prev.lastH || 0
          });
        }
      });
    }
    waveResizeObserver.observe(trackEl);
  }
  measureWaveTrack(trackEl);
}

function invalidateWaveMetrics() {
  measureWaveTrack(progressTrack);
  const npTrack = document.getElementById('np-progress-track');
  if (npTrack) measureWaveTrack(npTrack);
  lastWaveDrawTs = 0;
}

function updateWaveSvgTrack(trackEl, percent, phase, isPlaying) {
  if (!trackEl) return;
  let m = waveMetricsCache.get(trackEl);
  if (!m || m.w <= 0 || m.h <= 0) {
    m = measureWaveTrack(trackEl);
  }
  if (!m || m.w <= 0 || m.h <= 0) return;

  const svg = trackEl._waveSvg || (trackEl._waveSvg = trackEl.querySelector('.seek-wave-svg'));
  if (!svg) return;
  const bgPath = trackEl._waveBg || (trackEl._waveBg = svg.querySelector('.seek-wave-bg'));
  const fgPath = trackEl._waveFg || (trackEl._waveFg = svg.querySelector('.seek-wave-fg'));
  if (!bgPath || !fgPath) return;

  const w = m.w;
  const h = m.h;
  if (m.lastW !== w || m.lastH !== h) {
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    m.lastW = w;
    m.lastH = h;
  }

  const midY = h * 0.5;
  const clampedPct = Math.max(0, Math.min(100, percent || 0));
  const splitX = (clampedPct / 100) * w;
  const amp = (isPlaying && !settings.reducedMotion) ? Math.min(3.4, (h - 6) * 0.33) : 0;

  if (amp === 0) {
    const midStr = midY.toFixed(1);
    fgPath.setAttribute('d', splitX > 1 ? `M 0 ${midStr} L ${splitX.toFixed(1)} ${midStr}` : '');
  } else {
    const k = (Math.PI * 2) / 24;
    let fgD = `M 0 ${(midY + Math.sin(phase) * amp).toFixed(1)}`;
    if (splitX > 1) {
      const step = 6;
      for (let x = step; x <= splitX; x += step) {
        fgD += ` L ${x} ${(midY + Math.sin(x * k + phase) * amp).toFixed(1)}`;
      }
      fgD += ` L ${splitX.toFixed(1)} ${(midY + Math.sin(splitX * k + phase) * amp).toFixed(1)}`;
    }
    fgPath.setAttribute('d', fgD);
  }

  const bgStart = Math.min(w, splitX + 4);
  const midStr = midY.toFixed(1);
  bgPath.setAttribute('d', bgStart < w ? `M ${bgStart.toFixed(1)} ${midStr} L ${w} ${midStr}` : '');
}

function refreshVisualFrame(forceWave = false) {
  const duration = (isVideoMode && videoDuration > 0)
    ? videoDuration
    : (audio.duration || parseDurationToSeconds(state.currentTrack?.duration) || 0);
  const current = isVideoMode ? (videoCurrentTime || 0) : (audio.currentTime || 0);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;

  const npOverlay = document.getElementById('now-playing-fullscreen');
  const isNpOpen = Boolean(npOverlay && npOverlay.style.display === 'flex');

  progressFill.style.width = `${percent}%`;
  const npFill = document.getElementById('np-progress-fill');
  if (isNpOpen && npFill) npFill.style.width = `${percent}%`;

  const sec = Math.floor(current);
  if (sec !== lastRenderedSecond) {
    lastRenderedSecond = sec;
    const label = formatTime(current);
    timeCurrent.textContent = label;
    const npCurrent = document.getElementById('np-time-current');
    if (npCurrent) npCurrent.textContent = label;
  }

  const durSec = Math.floor(duration);
  if (durSec !== lastRenderedDuration) {
    lastRenderedDuration = durSec;
    const durLabel = duration > 0 ? formatTime(duration) : (state.currentTrack?.duration || '0:00');
    timeTotal.textContent = durLabel;
    const npTotal = document.getElementById('np-time-total');
    if (npTotal) npTotal.textContent = durLabel;
  }

  const aodEl = document.getElementById('aod-overlay');
  if (aodEl && aodEl.style.display === 'flex') {
    const aodFill = document.getElementById('aod-progress-fill');
    const aodCur = document.getElementById('aod-time-cur');
    const aodTot = document.getElementById('aod-time-tot');
    if (aodFill) aodFill.style.width = `${percent}%`;
    if (aodCur) aodCur.textContent = formatTime(current);
    if (aodTot) aodTot.textContent = duration > 0 ? formatTime(duration) : (state.currentTrack?.duration || '0:00');
  }

  if (settings.sliderStyle === 'wavy') {
    const nowTs = performance.now();
    if (forceWave || !state.isPlaying || (nowTs - lastWaveDrawTs >= 32)) {
      const dt = lastWaveDrawTs > 0 ? Math.min(64, nowTs - lastWaveDrawTs) : 32;
      lastWaveDrawTs = nowTs;
      if (state.isPlaying && !settings.reducedMotion) {
        seekWavePhase = (seekWavePhase - (dt * 0.0042)) % (Math.PI * 2);
      }
      updateWaveSvgTrack(progressTrack, percent, seekWavePhase, state.isPlaying);
      if (isNpOpen) {
        updateWaveSvgTrack(document.getElementById('np-progress-track'), percent, seekWavePhase, state.isPlaying);
      }
    }
  }

  if (state.currentLyrics && state.currentLyrics.length > 0) {
    updateSyncedLyrics(current);
  }
}

function startVisualAnimLoop() {
  if (visualAnimRafId) return;
  observeWaveTrack(progressTrack);
  const npTrack = document.getElementById('np-progress-track');
  if (npTrack) observeWaveTrack(npTrack);

  const tick = () => {
    refreshVisualFrame();
    if (state.isPlaying && !audio.paused) {
      visualAnimRafId = requestAnimationFrame(tick);
    } else {
      visualAnimRafId = null;
    }
  };
  visualAnimRafId = requestAnimationFrame(tick);
}

audio.addEventListener('play', () => {
  if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
    eqAudioCtx.resume().catch(() => {});
  }
  state.isPlaying = true;
  updatePlayPauseUI();
  startVisualAnimLoop();
});

audio.addEventListener('playing', () => {
  if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
    eqAudioCtx.resume().catch(() => {});
  }
  state.isPlaying = true;
  updatePlayPauseUI();
  startVisualAnimLoop();
});

audio.addEventListener('pause', () => {
  if (audio.paused && !audio.ended) {
    state.isPlaying = false;
    updatePlayPauseUI();
    if (visualAnimRafId) {
      cancelAnimationFrame(visualAnimRafId);
      visualAnimRafId = null;
    }
    if (!isNaN(audio.currentTime) && audio.currentTime > 0) {
      state.savedPlaybackPosition = audio.currentTime;
      savePersistentQueue();
    }
    refreshVisualFrame(true);
  }
});

let lastPersistentTimeSaveTs = 0;
audio.addEventListener('timeupdate', () => {
  if (!audio.duration || isScrubbingSeek) return;
  state.savedPlaybackPosition = audio.currentTime;
  const now = Date.now();
  if (now - lastPersistentTimeSaveTs > 3000) {
    lastPersistentTimeSaveTs = now;
    savePersistentQueue();
  }
  if (!visualAnimRafId) {
    refreshVisualFrame(true);
  }
});

audio.addEventListener('ended', () => {
  if (sleepTimerMode === 'end_of_track') {
    setSleepTimer('0');
    audio.pause();
    state.isPlaying = false;
    updatePlayPauseUI();
    return;
  }

  if (state.repeatMode === 'one') {
    audio.currentTime = 0;
    audio.play();
  } else {
    btnNext.click();
  }
});

function handleSeekFromClientX(clientX, trackEl, rectOverride = null) {
  if (!trackEl) return;
  const targetDuration = (isVideoMode && videoDuration > 0)
    ? videoDuration
    : (audio.duration || parseDurationToSeconds(state.currentTrack?.duration) || 0);
  if (!targetDuration) return;
  const rect = rectOverride || trackEl.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const newTime = ratio * targetDuration;
  if (isVideoMode) {
    videoCurrentTime = newTime;
    sendVideoCommand('seekTo', [newTime, true]);
    lastRenderedSecond = -1;
    refreshVisualFrame(true);
  } else {
    audio.currentTime = newTime;
    lastRenderedSecond = -1;
    refreshVisualFrame(true);
  }
}

function attachSmoothSeek(trackEl) {
  if (!trackEl) return;
  observeWaveTrack(trackEl);
  let activeRect = null;

  trackEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    isScrubbingSeek = true;
    activeRect = trackEl.getBoundingClientRect();
    try { trackEl.setPointerCapture(e.pointerId); } catch (_) {}
    handleSeekFromClientX(e.clientX, trackEl, activeRect);
  });

  trackEl.addEventListener('pointermove', (e) => {
    if (!isScrubbingSeek) return;
    handleSeekFromClientX(e.clientX, trackEl, activeRect);
  });

  const endScrub = (e) => {
    if (!isScrubbingSeek) return;
    handleSeekFromClientX(e.clientX, trackEl, activeRect);
    isScrubbingSeek = false;
    activeRect = null;
    try { trackEl.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  trackEl.addEventListener('pointerup', endScrub);
  trackEl.addEventListener('pointercancel', endScrub);
}

attachSmoothSeek(progressTrack);
attachSmoothSeek(document.getElementById('np-progress-track'));

// Volume controls
function setVolume(v) {
  state.volume = Math.max(0, Math.min(1, v));
  audio.volume = state.isMuted ? 0 : state.volume;
  volumeFill.style.width = `${state.volume * 100}%`;
  if (isVideoMode) {
    sendVideoCommand('setVolume', [Math.round((state.isMuted ? 0 : state.volume) * 100)]);
  }
  if (settings.pauseOnZeroVol && state.volume <= 0.005 && state.isPlaying) {
    if (isVideoMode) {
      toggleVideoPlayPause();
    } else {
      audio.pause();
      state.isPlaying = false;
      updatePlayPauseUI();
    }
  }
}

let isDraggingVolume = false;

function updateVolumeFromPointer(e) {
  if (!volumeTrack) return;
  const rect = volumeTrack.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  setVolume(ratio);
  if (state.isMuted && ratio > 0) {
    state.isMuted = false;
    btnMute?.classList.remove('active');
  }
}

if (volumeTrack) {
  volumeTrack.addEventListener('pointerdown', (e) => {
    isDraggingVolume = true;
    try { volumeTrack.setPointerCapture(e.pointerId); } catch (_) {}
    volumeTrack.classList.add('dragging');
    updateVolumeFromPointer(e);
  });

  volumeTrack.addEventListener('pointermove', (e) => {
    if (isDraggingVolume) {
      updateVolumeFromPointer(e);
    }
  });

  const stopVolumeDrag = (e) => {
    if (isDraggingVolume) {
      isDraggingVolume = false;
      try { volumeTrack.releasePointerCapture(e.pointerId); } catch (_) {}
      volumeTrack.classList.remove('dragging');
    }
  };

  volumeTrack.addEventListener('pointerup', stopVolumeDrag);
  volumeTrack.addEventListener('pointercancel', stopVolumeDrag);
}

btnMute.addEventListener('click', () => {
  state.isMuted = !state.isMuted;
  audio.volume = state.isMuted ? 0 : state.volume;
  btnMute.classList.toggle('active', state.isMuted);
  if (isVideoMode) {
    sendVideoCommand(state.isMuted ? 'mute' : 'unMute');
    if (!state.isMuted) sendVideoCommand('setVolume', [Math.round(state.volume * 100)]);
  }
  if (settings.pauseOnZeroVol && state.isMuted && state.isPlaying) {
    if (isVideoMode) {
      toggleVideoPlayPause();
    } else {
      audio.pause();
      state.isPlaying = false;
      updatePlayPauseUI();
    }
  }
});

// Drawer Panels (Lyrics & Queue)
const sideDrawer = document.getElementById('side-drawer');
const drawerTitle = document.getElementById('drawer-title');
const lyricsView = document.getElementById('lyrics-drawer-view');
const queueView = document.getElementById('queue-drawer-view');

function openDrawer(panel) {
  if (state.activePanel === panel) {
    closeDrawer();
    return;
  }
  state.activePanel = panel;
  sideDrawer.classList.add('open');
  document.body.classList.add('drawer-open');

  const lyricsActions = document.getElementById('drawer-lyrics-actions');
  const lyricsBadge = document.getElementById('lyrics-source-badge');

  if (panel === 'lyrics') {
    drawerTitle.textContent = 'Synchronized Lyrics';
    if (lyricsActions) lyricsActions.style.display = 'inline-flex';
    lyricsView.style.display = 'flex';
    queueView.style.display = 'none';
    requestAnimationFrame(() => refreshLyricsViewsNow(true, true));
  } else {
    drawerTitle.textContent = 'Up Next Queue';
    if (lyricsActions) lyricsActions.style.display = 'none';
    if (lyricsBadge) lyricsBadge.style.display = 'none';
    lyricsView.style.display = 'none';
    queueView.style.display = 'block';
    renderQueue();
  }
}

function closeDrawer() {
  state.activePanel = null;
  sideDrawer.classList.remove('open');
  document.body.classList.remove('drawer-open');
  if (typeof updateLyricsResyncPills === 'function') updateLyricsResyncPills();
}

document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('player-lyrics-btn').addEventListener('click', () => openDrawer('lyrics'));
document.getElementById('player-queue-btn').addEventListener('click', () => openDrawer('queue'));

// Lyrics Helpers & Parsers
function formatTimeTag(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\](.*)/;

  for (const line of lines) {
    const match = timeRegex.exec(line.trim());
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').substring(0, 3), 10) : 0;
      const totalSeconds = minutes * 60 + seconds + ms / 1000;
      const text = match[4].trim();
      if (text) {
        result.push({ time: totalSeconds, text });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

// Lyrics Engine
let lyricsRequestToken = 0;

async function fetchLyrics(track) {
  if (!track || !track.id) return;
  const token = ++lyricsRequestToken;
  const targetTrackId = track.id;

  // Load saved timing offset
  const savedOffset = parseFloat(localStorage.getItem('opentune_lyrics_offset_' + track.id) || '0');
  state.lyricsOffset = isNaN(savedOffset) ? 0 : savedOffset;

  // 1. Check for user-customized lyrics in localStorage
  const customLyrics = localStorage.getItem('opentune_custom_lyrics_' + track.id);
  if (customLyrics && customLyrics.trim().length > 0) {
    if (token !== lyricsRequestToken || state.currentTrack?.id !== targetTrackId) return;
    state.rawLyricsText = customLyrics;
    state.lyricsSource = 'Custom / User Saved';
    const parsed = parseLrc(customLyrics);
    if (parsed.length > 0) {
      state.currentLyrics = parsed;
      state.activeLyricsIndex = -1;
      renderLyrics(parsed);
    } else {
      state.currentLyrics = [];
      renderPlainLyrics(customLyrics);
    }
    return;
  }

  // 2. Fetch from LRCLIB / Online
  try {
    const durSec = parseDurationToSeconds(track.duration);
    const res = await window.api.getLyrics(track.title, track.artist, durSec);
    if (token !== lyricsRequestToken || state.currentTrack?.id !== targetTrackId) return;

    const syncedLines = res.synced || res.lines || [];

    if (res.success && syncedLines.length > 0) {
      state.currentLyrics = syncedLines;
      state.rawLyricsText = syncedLines.map(l => `[${formatTimeTag(l.time)}] ${l.text}`).join('\n');
      state.lyricsSource = 'LRCLIB (Synced)';
      state.activeLyricsIndex = -1;
      renderLyrics(syncedLines);
      const current = isVideoMode ? (videoCurrentTime || 0) : (audio.currentTime || 0);
      if (current > 0) {
        updateSyncedLyrics(current);
      }
    } else if (res.success && res.plain && res.plain.trim().length > 0) {
      state.currentLyrics = [];
      state.rawLyricsText = res.plain.trim();
      state.lyricsSource = 'LRCLIB (Plain Text)';
      renderPlainLyrics(res.plain.trim());
    } else {
      state.currentLyrics = [];
      state.rawLyricsText = '';
      state.lyricsSource = null;
      renderEmptyLyrics(track);
    }
  } catch (err) {
    if (token !== lyricsRequestToken || state.currentTrack?.id !== targetTrackId) return;
    renderEmptyLyrics(track);
  }
}

function buildLyricLineContent(lineEl, text) {
  lineEl.innerHTML = '';
  const tokens = String(text || '').split(/(\s+)/);
  const totalNonSpace = tokens.filter(t => !/^\s+$/.test(t)).join('').length || 1;
  let charCursor = 0;

  tokens.forEach((tok) => {
    if (!tok) return;
    if (/^\s+$/.test(tok)) {
      lineEl.appendChild(document.createTextNode(tok));
      return;
    }
    const span = document.createElement('span');
    span.className = 'lyric-word upcoming';
    const startRatio = charCursor / totalNonSpace;
    charCursor += tok.length;
    const endRatio = charCursor / totalNonSpace;
    span.dataset.wstart = startRatio.toFixed(4);
    span.dataset.wend = endRatio.toFixed(4);
    span.textContent = tok;
    lineEl.appendChild(span);
  });
}

const lyricDomCache = {
  drawer: [],
  np: [],
  lastLineProgressDrawer: -1,
  lastLineProgressNp: -1
};

function cacheLyricWords(lineEl) {
  const words = [];
  lineEl.querySelectorAll('.lyric-word').forEach((wordEl) => {
    words.push({
      el: wordEl,
      ws: parseFloat(wordEl.dataset.wstart || '0'),
      we: parseFloat(wordEl.dataset.wend || '1'),
      state: 'upcoming',
      lastWp: -1
    });
  });
  return { el: lineEl, words };
}

function renderLyrics(lines) {
  lyricsView.innerHTML = '';
  const npLyricsContent = document.getElementById('np-lyrics-content');
  if (npLyricsContent) npLyricsContent.innerHTML = '';

  lyricDomCache.drawer = [];
  lyricDomCache.np = [];
  lyricDomCache.lastLineProgressDrawer = -1;
  lyricDomCache.lastLineProgressNp = -1;

  const animStyle = settings.lyricsAnim || 'apple';
  const alignStyle = settings.lyricsAlign || 'center';
  lyricsView.dataset.anim = animStyle;
  lyricsView.dataset.align = alignStyle;
  if (npLyricsContent) {
    npLyricsContent.dataset.anim = animStyle;
    npLyricsContent.dataset.align = alignStyle;
  }

  if (state.lyricsSource) {
    const banner = document.createElement('div');
    banner.style.cssText = 'font-size: 0.74rem; color: var(--text-muted); text-align: center; margin-bottom: 16px; opacity: 0.75;';
    banner.innerHTML = `Source: <strong>${state.lyricsSource}</strong> ${state.lyricsOffset !== 0 ? `• Offset: ${state.lyricsOffset > 0 ? '+' : ''}${state.lyricsOffset.toFixed(1)}s` : ''}`;
    lyricsView.appendChild(banner);
  }

  const drawerFrag = document.createDocumentFragment();
  const npFrag = npLyricsContent ? document.createDocumentFragment() : null;

  lines.forEach((line, index) => {
    const el = document.createElement('div');
    el.className = 'lyrics-line dist-far';
    el.dataset.index = index;
    buildLyricLineContent(el, line.text);
    el.addEventListener('click', () => {
      if (settings.lyricsClickSeek === false) return;
      lyricsScrollPause.drawerUntil = 0;
      lyricsScrollPause.npUntil = 0;
      updateLyricsResyncPills();
      audio.currentTime = Math.max(0, line.time - (state.lyricsOffset || 0));
      refreshVisualFrame(true);
      requestAnimationFrame(() => {
        centerScrollLyricElement(lyricsView, el, true);
      });
    });
    lyricDomCache.drawer.push(cacheLyricWords(el));
    drawerFrag.appendChild(el);

    if (npFrag) {
      const npEl = document.createElement('div');
      npEl.className = 'lyrics-line dist-far';
      npEl.dataset.index = index;
      buildLyricLineContent(npEl, line.text);
      npEl.addEventListener('click', () => {
        if (settings.lyricsClickSeek === false) return;
        lyricsScrollPause.drawerUntil = 0;
        lyricsScrollPause.npUntil = 0;
        updateLyricsResyncPills();
        audio.currentTime = Math.max(0, line.time - (state.lyricsOffset || 0));
        refreshVisualFrame(true);
        requestAnimationFrame(() => {
          centerScrollLyricElement(npLyricsContent, npEl, true);
        });
      });
      lyricDomCache.np.push(cacheLyricWords(npEl));
      npFrag.appendChild(npEl);
    }
  });

  lyricsView.appendChild(drawerFrag);
  if (npLyricsContent && npFrag) npLyricsContent.appendChild(npFrag);
}

function renderPlainLyrics(plainText) {
  const searchIconSvg = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';
  const headerInfo = `
    <div style="font-size: 0.76rem; color: var(--text-muted); text-align: center; margin-bottom: 14px; opacity: 0.85;">
      Plain Text Lyrics • <button id="btn-search-lyrics-from-plain" class="btn-subtle" style="font-size:0.72rem; padding:2px 8px; margin-left:4px;">${searchIconSvg} Search Synced LRC</button>
    </div>
  `;
  const bodyText = `<div style="line-height: 1.9; font-size: 0.95rem; color: var(--text-secondary); text-align: center; white-space: pre-wrap; padding: 10px 16px;">${plainText}</div>`;

  lyricsView.innerHTML = headerInfo + bodyText;
  document.getElementById('btn-search-lyrics-from-plain')?.addEventListener('click', openLyricsSearchModal);

  const npLyricsContent = document.getElementById('np-lyrics-content');
  if (npLyricsContent) {
    npLyricsContent.innerHTML = headerInfo + bodyText;
    npLyricsContent.querySelector('#btn-search-lyrics-from-plain')?.addEventListener('click', openLyricsSearchModal);
  }
}

function renderEmptyLyrics(track) {
  const searchIconSvg = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';
  const editIconSvg = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  const emptyHtml = `
    <div class="lyrics-empty" style="text-align: center; padding: 40px 20px;">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="var(--text-muted)" style="opacity: 0.4; margin-bottom: 12px;"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
      <div style="font-size: 0.95rem; font-weight: 600; margin-bottom: 6px;">No synchronized lyrics found</div>
      <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 18px;">
        Search LRCLIB database or add your own synchronized LRC lyrics.
      </p>
      <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
        <button class="btn-primary-action trigger-search-lyrics" style="padding: 8px 16px; font-size: 0.82rem;">${searchIconSvg} Find Lyrics Online</button>
        <button class="btn-subtle trigger-edit-lyrics" style="padding: 8px 16px; font-size: 0.82rem;">${editIconSvg} Add / Paste Lyrics</button>
      </div>
    </div>
  `;
  lyricsView.innerHTML = emptyHtml;
  lyricsView.querySelector('.trigger-search-lyrics')?.addEventListener('click', openLyricsSearchModal);
  lyricsView.querySelector('.trigger-edit-lyrics')?.addEventListener('click', openLyricsEditModal);

  const npLyricsContent = document.getElementById('np-lyrics-content');
  if (npLyricsContent) {
    npLyricsContent.innerHTML = emptyHtml;
    npLyricsContent.querySelector('.trigger-search-lyrics')?.addEventListener('click', openLyricsSearchModal);
    npLyricsContent.querySelector('.trigger-edit-lyrics')?.addEventListener('click', openLyricsEditModal);
  }
}

function resetCachedLineWords(lineEntry) {
  if (!lineEntry) return;
  for (let w = 0; w < lineEntry.words.length; w++) {
    const item = lineEntry.words[w];
    if (item.state !== 'upcoming') {
      item.el.classList.remove('sung', 'word-active');
      item.el.classList.add('upcoming');
      item.el.style.removeProperty('--wp');
      item.state = 'upcoming';
      item.lastWp = -1;
    }
  }
}

function updateLineWordProgressCached(lineEntry, progress, isSlideStyle) {
  if (!lineEntry) return;
  if (isSlideStyle) {
    lineEntry.el.style.setProperty('--line-progress', `${(progress * 100).toFixed(1)}%`);
  }
  const words = lineEntry.words;
  for (let w = 0; w < words.length; w++) {
    const item = words[w];
    if (progress >= item.we) {
      if (item.state !== 'sung') {
        item.el.classList.add('sung');
        item.el.classList.remove('word-active', 'upcoming');
        item.el.style.removeProperty('--wp');
        item.state = 'sung';
        item.lastWp = 100;
      }
    } else if (progress >= item.ws) {
      const spanDur = Math.max(0.01, item.we - item.ws);
      const wp = Math.max(0, Math.min(100, ((progress - item.ws) / spanDur) * 100));
      if (item.state !== 'word-active') {
        item.el.classList.add('word-active');
        item.el.classList.remove('sung', 'upcoming');
        item.state = 'word-active';
      }
      if (Math.abs(wp - item.lastWp) >= 1.5 || wp >= 99) {
        item.lastWp = wp;
        item.el.style.setProperty('--wp', `${wp.toFixed(1)}%`);
      }
    } else if (item.state !== 'upcoming') {
      item.el.classList.add('upcoming');
      item.el.classList.remove('sung', 'word-active');
      item.el.style.removeProperty('--wp');
      item.state = 'upcoming';
      item.lastWp = -1;
    }
  }
}

const lyricsScrollPause = { drawerUntil: 0, npUntil: 0 };

function getLyricsScrollContainer(contentEl) {
  if (!contentEl) return null;
  if (contentEl.id === 'lyrics-drawer-view') {
    return contentEl.closest('.drawer-content') || contentEl.parentElement || contentEl;
  }
  if (contentEl.id === 'np-lyrics-content') {
    return document.getElementById('np-lyrics-container') || contentEl.parentElement || contentEl;
  }
  return contentEl;
}

function isNowPlayingOpen() {
  const npOverlay = document.getElementById('now-playing-fullscreen');
  return Boolean(npOverlay && npOverlay.classList.contains('open'));
}

function updateLyricsResyncPills() {
  const now = Date.now();
  const drawerBtn = document.getElementById('drawer-lyrics-resync-btn');
  const npBtn = document.getElementById('np-lyrics-resync-btn');
  if (drawerBtn) {
    const showDrawer = now < lyricsScrollPause.drawerUntil && sideDrawer.classList.contains('open') && state.activePanel === 'lyrics';
    drawerBtn.style.display = showDrawer ? 'inline-flex' : 'none';
  }
  if (npBtn) {
    const npLyrWrap = document.getElementById('np-lyrics-container');
    const showNp = now < lyricsScrollPause.npUntil && isNowPlayingOpen() && npLyrWrap && npLyrWrap.style.display !== 'none';
    npBtn.style.display = showNp ? 'inline-flex' : 'none';
  }
}

(function bindManualLyricsScrollPause() {
  const pauseDrawer = () => {
    if (!sideDrawer.classList.contains('open') || state.activePanel !== 'lyrics') return;
    if (!state.currentLyrics || state.currentLyrics.length === 0) return;
    lyricsScrollPause.drawerUntil = Date.now() + 4500;
    updateLyricsResyncPills();
  };
  const pauseNp = () => {
    const npLyrWrap = document.getElementById('np-lyrics-container');
    if (!isNowPlayingOpen() || !npLyrWrap || npLyrWrap.style.display === 'none') return;
    if (!state.currentLyrics || state.currentLyrics.length === 0) return;
    lyricsScrollPause.npUntil = Date.now() + 4500;
    updateLyricsResyncPills();
  };

  const drawerBox = document.querySelector('#side-drawer .drawer-content');
  const npBox = document.getElementById('np-lyrics-container');
  ['wheel', 'touchmove'].forEach((evt) => {
    drawerBox?.addEventListener(evt, pauseDrawer, { passive: true });
    npBox?.addEventListener(evt, pauseNp, { passive: true });
  });

  document.getElementById('drawer-lyrics-resync-btn')?.addEventListener('click', () => {
    lyricsScrollPause.drawerUntil = 0;
    updateLyricsResyncPills();
    refreshLyricsViewsNow(true, true);
  });
  document.getElementById('np-lyrics-resync-btn')?.addEventListener('click', () => {
    lyricsScrollPause.npUntil = 0;
    updateLyricsResyncPills();
    refreshLyricsViewsNow(true, true);
  });
})();

function centerScrollLyricElement(scrollContainer, lineEl, instant = false) {
  const targetBox = getLyricsScrollContainer(scrollContainer);
  if (!targetBox || !lineEl) return;
  const cRect = targetBox.getBoundingClientRect();
  const lRect = lineEl.getBoundingClientRect();
  if (cRect.height <= 0 || lRect.height <= 0) return;
  const targetTop = targetBox.scrollTop + (lRect.top - cRect.top) - (cRect.height * 0.46) + (lRect.height * 0.5);
  targetBox.scrollTo({
    top: Math.max(0, targetTop),
    behavior: (instant || settings.reducedMotion) ? 'auto' : 'smooth'
  });
}

function applyLyricsWindowState(cachedLines, scrollContainer, prevIdx, activeIdx, forceFull = false, ignorePause = false) {
  if (!cachedLines || cachedLines.length === 0) return;

  const setLineClass = (i) => {
    if (i < 0 || i >= cachedLines.length) return;
    const entry = cachedLines[i];
    const dist = Math.abs(i - activeIdx);
    const isActive = i === activeIdx;
    const cls = entry.el.classList;
    cls.toggle('active', isActive);
    cls.toggle('dist-1', !isActive && dist === 1);
    cls.toggle('dist-2', !isActive && dist === 2);
    cls.toggle('dist-far', !isActive && dist >= 3);
    if (!isActive) resetCachedLineWords(entry);
  };

  if (forceFull || prevIdx < 0) {
    for (let i = 0; i < cachedLines.length; i++) setLineClass(i);
  } else {
    const startPrev = Math.max(0, prevIdx - 4);
    const endPrev = Math.min(cachedLines.length - 1, prevIdx + 4);
    for (let i = startPrev; i <= endPrev; i++) setLineClass(i);

    const startNew = Math.max(0, activeIdx - 4);
    const endNew = Math.min(cachedLines.length - 1, activeIdx + 4);
    for (let i = startNew; i <= endNew; i++) setLineClass(i);
  }

  const isDrawerTarget = scrollContainer && scrollContainer.id === 'lyrics-drawer-view';
  const pausedUntil = isDrawerTarget ? lyricsScrollPause.drawerUntil : lyricsScrollPause.npUntil;
  const isPaused = !ignorePause && Date.now() < pausedUntil;

  if (settings.lyricsAutoScroll !== false && !isPaused && activeIdx >= 0 && cachedLines[activeIdx]) {
    centerScrollLyricElement(scrollContainer, cachedLines[activeIdx].el, forceFull && ignorePause);
  }
  updateLyricsResyncPills();
}

function refreshLyricsViewsNow(forceFull = false, ignorePause = false) {
  if (!state.currentLyrics || state.currentLyrics.length === 0) return;
  const idx = state.activeLyricsIndex;
  const drawerVisible = sideDrawer.classList.contains('open') && state.activePanel === 'lyrics';
  if (drawerVisible && lyricDomCache.drawer.length > 0) {
    applyLyricsWindowState(lyricDomCache.drawer, lyricsView, idx, idx, forceFull, ignorePause);
  }
  const npLyrWrap = document.getElementById('np-lyrics-container');
  const npScroll = document.getElementById('np-lyrics-content');
  const npVisible = isNowPlayingOpen() && npLyrWrap && npLyrWrap.style.display !== 'none';
  if (npVisible && lyricDomCache.np.length > 0) {
    applyLyricsWindowState(lyricDomCache.np, npScroll || npLyrWrap, idx, idx, forceFull, ignorePause);
  }
}

function updateSyncedLyrics(currentTime) {
  if (!state.currentLyrics || state.currentLyrics.length === 0) return;

  const drawerVisible = sideDrawer.classList.contains('open') && state.activePanel === 'lyrics';
  const npLyrWrap = document.getElementById('np-lyrics-container');
  const npScroll = document.getElementById('np-lyrics-content');
  const npVisible = Boolean(isNowPlayingOpen() && npLyrWrap && npLyrWrap.style.display !== 'none');

  const effectiveTime = currentTime + (state.lyricsOffset || 0);

  let activeIdx = -1;
  const len = state.currentLyrics.length;
  for (let i = 0; i < len; i++) {
    if (effectiveTime >= state.currentLyrics[i].time) {
      activeIdx = i;
    } else {
      break;
    }
  }

  const prevIdx = state.activeLyricsIndex;
  const changed = activeIdx !== prevIdx && activeIdx >= 0;
  if (changed) {
    state.activeLyricsIndex = activeIdx;
  }

  updateLyricsResyncPills();
  if (!drawerVisible && !npVisible) return;

  if (changed) {
    if (drawerVisible) applyLyricsWindowState(lyricDomCache.drawer, lyricsView, prevIdx, activeIdx, false);
    if (npVisible) applyLyricsWindowState(lyricDomCache.np, npScroll || npLyrWrap, prevIdx, activeIdx, false);
  }

  if (activeIdx >= 0) {
    const curStart = state.currentLyrics[activeIdx].time;
    const nextStart = activeIdx + 1 < len
      ? state.currentLyrics[activeIdx + 1].time
      : Math.max(curStart + 4.0, (audio.duration || curStart + 4.0));
    const lineDur = Math.max(0.55, nextStart - curStart);
    const progress = Math.max(0, Math.min(1, (effectiveTime - curStart) / lineDur));
    const isSlideStyle = (settings.lyricsAnim || 'apple') === 'slide';

    if (drawerVisible && lyricDomCache.drawer[activeIdx]) {
      updateLineWordProgressCached(lyricDomCache.drawer[activeIdx], progress, isSlideStyle);
    }
    if (npVisible && lyricDomCache.np[activeIdx]) {
      updateLineWordProgressCached(lyricDomCache.np[activeIdx], progress, isSlideStyle);
    }
  }
}

// --- Lyrics Finder / Search Modal ---
const lyricsSearchModal = document.getElementById('lyrics-search-modal');
const lyricsSearchQueryInput = document.getElementById('lyrics-search-query-input');
const lyricsSearchSubmitBtn = document.getElementById('lyrics-search-submit-btn');
const lyricsSearchResultsList = document.getElementById('lyrics-search-results-list');
const lyricsSearchStatus = document.getElementById('lyrics-search-status');

function openLyricsSearchModal() {
  if (!lyricsSearchModal) return;
  const defaultQuery = state.currentTrack ? `${state.currentTrack.title} ${state.currentTrack.artist}`.replace(/Unknown (Title|Artist)/gi, '').trim() : '';
  if (lyricsSearchQueryInput) {
    lyricsSearchQueryInput.value = defaultQuery;
  }
  if (lyricsSearchResultsList) lyricsSearchResultsList.innerHTML = '';
  if (lyricsSearchStatus) lyricsSearchStatus.style.display = 'none';
  lyricsSearchModal.style.display = 'flex';
  lyricsSearchQueryInput?.focus();
  if (defaultQuery) {
    executeLyricsSearch(defaultQuery);
  }
}

function closeLyricsSearchModal() {
  if (lyricsSearchModal) lyricsSearchModal.style.display = 'none';
}

async function executeLyricsSearch(query) {
  if (!query || !query.trim()) return;
  if (lyricsSearchStatus) {
    lyricsSearchStatus.style.display = 'block';
    lyricsSearchStatus.innerHTML = '<span class="spinner" style="width:14px;height:14px;display:inline-block;margin-right:6px;vertical-align:middle;"></span> Searching LRCLIB database...';
  }
  if (lyricsSearchResultsList) lyricsSearchResultsList.innerHTML = '';

  try {
    const res = await window.api.searchLyrics(query.trim());
    const items = res.results || res || [];
    if (!items || items.length === 0) {
      if (lyricsSearchStatus) lyricsSearchStatus.innerHTML = 'No lyrics found on LRCLIB. Try searching with just the song title.';
      return;
    }

    if (lyricsSearchStatus) lyricsSearchStatus.style.display = 'none';

    items.forEach(item => {
      const card = document.createElement('div');
      card.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--bg-surface); border: var(--glass-border); border-radius: var(--radius-sm); gap: 12px; transition: background 0.2s ease;';
      card.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary);">${item.trackName}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.artistName} • ${item.albumName || 'Single'}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; background: ${item.hasSynced ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.08)'}; color: ${item.hasSynced ? 'var(--secondary)' : 'var(--text-muted)'};">
            ${item.hasSynced ? 'Synced LRC' : 'Plain'}
          </span>
          <button class="btn-primary-action btn-apply-this-lyrics" style="padding: 6px 14px; font-size: 0.78rem;">Apply</button>
        </div>
      `;

      card.querySelector('.btn-apply-this-lyrics').onclick = () => {
        if (!state.currentTrack) return;
        const lyricsText = item.syncedLyrics || item.plainLyrics;
        if (!lyricsText) return;

        localStorage.setItem('opentune_custom_lyrics_' + state.currentTrack.id, lyricsText);
        state.rawLyricsText = lyricsText;
        state.lyricsSource = `LRCLIB (${item.hasSynced ? 'Synced' : 'Plain'})`;

        if (item.hasSynced && item.syncedLyrics) {
          state.currentLyrics = parseLrc(item.syncedLyrics);
          state.activeLyricsIndex = -1;
          renderLyrics(state.currentLyrics);
        } else {
          state.currentLyrics = [];
          renderPlainLyrics(item.plainLyrics);
        }

        closeLyricsSearchModal();
      };

      lyricsSearchResultsList.appendChild(card);
    });
  } catch (err) {
    if (lyricsSearchStatus) lyricsSearchStatus.textContent = 'Search failed: ' + err.message;
  }
}

lyricsSearchSubmitBtn?.addEventListener('click', () => {
  executeLyricsSearch(lyricsSearchQueryInput?.value || '');
});

lyricsSearchQueryInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    executeLyricsSearch(lyricsSearchQueryInput.value);
  }
});

document.getElementById('lyrics-search-modal-close')?.addEventListener('click', closeLyricsSearchModal);
document.getElementById('btn-search-lyrics-open')?.addEventListener('click', openLyricsSearchModal);
document.getElementById('np-btn-search-lyrics')?.addEventListener('click', openLyricsSearchModal);
lyricsSearchModal?.addEventListener('click', (e) => {
  if (e.target === lyricsSearchModal) closeLyricsSearchModal();
});

// --- Lyrics Editor & Sync Offset Modal ---
const lyricsEditModal = document.getElementById('lyrics-edit-modal');
const lyricsEditTextarea = document.getElementById('lyrics-edit-textarea');
const lyricsOffsetDisplay = document.getElementById('lyrics-offset-display');
const lyricsEditSongLabel = document.getElementById('lyrics-edit-song-label');

function updateOffsetDisplay() {
  if (!lyricsOffsetDisplay) return;
  const off = state.lyricsOffset || 0;
  lyricsOffsetDisplay.textContent = (off >= 0 ? '+' : '') + off.toFixed(1) + 's';
}

function openLyricsEditModal() {
  if (!lyricsEditModal) return;
  if (lyricsEditSongLabel) {
    lyricsEditSongLabel.textContent = state.currentTrack ? `${state.currentTrack.title} • ${state.currentTrack.artist}` : 'Editing lyrics';
  }
  if (lyricsEditTextarea) {
    lyricsEditTextarea.value = state.rawLyricsText || '';
  }
  updateOffsetDisplay();
  lyricsEditModal.style.display = 'flex';
  lyricsEditTextarea?.focus();
}

function closeLyricsEditModal() {
  if (lyricsEditModal) lyricsEditModal.style.display = 'none';
}

document.getElementById('lyrics-offset-minus')?.addEventListener('click', () => {
  state.lyricsOffset = (state.lyricsOffset || 0) - 0.5;
  updateOffsetDisplay();
  if (state.currentTrack) {
    localStorage.setItem('opentune_lyrics_offset_' + state.currentTrack.id, state.lyricsOffset);
  }
});

document.getElementById('lyrics-offset-plus')?.addEventListener('click', () => {
  state.lyricsOffset = (state.lyricsOffset || 0) + 0.5;
  updateOffsetDisplay();
  if (state.currentTrack) {
    localStorage.setItem('opentune_lyrics_offset_' + state.currentTrack.id, state.lyricsOffset);
  }
});

document.getElementById('lyrics-offset-reset')?.addEventListener('click', () => {
  state.lyricsOffset = 0;
  updateOffsetDisplay();
  if (state.currentTrack) {
    localStorage.setItem('opentune_lyrics_offset_' + state.currentTrack.id, '0');
  }
});

document.getElementById('lyrics-edit-save-btn')?.addEventListener('click', () => {
  if (!state.currentTrack) return;
  const val = lyricsEditTextarea?.value || '';
  localStorage.setItem('opentune_custom_lyrics_' + state.currentTrack.id, val);
  state.rawLyricsText = val;
  state.lyricsSource = 'User Saved';

  const parsed = parseLrc(val);
  if (parsed.length > 0) {
    state.currentLyrics = parsed;
    state.activeLyricsIndex = -1;
    renderLyrics(parsed);
  } else if (val.trim().length > 0) {
    state.currentLyrics = [];
    renderPlainLyrics(val.trim());
  } else {
    state.currentLyrics = [];
    renderEmptyLyrics(state.currentTrack);
  }

  closeLyricsEditModal();
});

document.getElementById('lyrics-edit-reset-btn')?.addEventListener('click', () => {
  if (!state.currentTrack) return;
  localStorage.removeItem('opentune_custom_lyrics_' + state.currentTrack.id);
  localStorage.removeItem('opentune_lyrics_offset_' + state.currentTrack.id);
  state.lyricsOffset = 0;
  updateOffsetDisplay();
  closeLyricsEditModal();
  fetchLyrics(state.currentTrack);
});

document.getElementById('lyrics-edit-cancel-btn')?.addEventListener('click', closeLyricsEditModal);
document.getElementById('lyrics-edit-modal-close')?.addEventListener('click', closeLyricsEditModal);
document.getElementById('btn-edit-lyrics-open')?.addEventListener('click', openLyricsEditModal);
document.getElementById('np-btn-edit-lyrics')?.addEventListener('click', openLyricsEditModal);
lyricsEditModal?.addEventListener('click', (e) => {
  if (e.target === lyricsEditModal) closeLyricsEditModal();
});

// Queue Management, Edit Mode & Drag-and-Drop Reorder
let draggedQueueIdx = -1;

function moveQueueItem(fromIndex, toIndex, options = {}) {
  if (
    fromIndex < 0 || fromIndex >= state.queue.length ||
    toIndex < 0 || toIndex >= state.queue.length ||
    fromIndex === toIndex
  ) return;

  const [moved] = state.queue.splice(fromIndex, 1);
  state.queue.splice(toIndex, 0, moved);

  state.queueIndex = state.queueIndex >= 0 ? remapIndexOnMove(state.queueIndex, fromIndex, toIndex) : -1;
  state.priorityNextIndices = (state.priorityNextIndices || []).map(i => remapIndexOnMove(i, fromIndex, toIndex));
  state.shuffleBag = (state.shuffleBag || []).map(i => remapIndexOnMove(i, fromIndex, toIndex));
  state.shuffleHistory = (state.shuffleHistory || []).map(i => remapIndexOnMove(i, fromIndex, toIndex));
  state.shuffleForwardStack = (state.shuffleForwardStack || []).map(i => remapIndexOnMove(i, fromIndex, toIndex));

  if (!options.skipRender) {
    renderQueue();
    savePersistentQueue();
    preloadAdjacentTracks();
  }
}

function moveUpcomingQueueItem(fromQueueIdx, toQueueIdx) {
  if (fromQueueIdx === toQueueIdx || fromQueueIdx < 0 || toQueueIdx < 0) return;
  const upcoming = getOrderedUpcomingIndices();
  const fromPos = upcoming.indexOf(fromQueueIdx);
  const toPos = upcoming.indexOf(toQueueIdx);

  if (fromPos === -1 || toPos === -1) {
    moveQueueItem(fromQueueIdx, toQueueIdx);
    return;
  }

  const prevPrioritySet = new Set(state.priorityNextIndices || []);
  const prevPriorityCount = (state.priorityNextIndices || []).filter(i => upcoming.includes(i)).length;
  const newOrder = [...upcoming];
  const [moved] = newOrder.splice(fromPos, 1);
  newOrder.splice(toPos, 0, moved);

  let nextPriorityCount = prevPriorityCount;
  if (!prevPrioritySet.has(fromQueueIdx) && prevPrioritySet.has(toQueueIdx)) {
    nextPriorityCount = Math.min(newOrder.length, prevPriorityCount + 1);
  } else if (prevPrioritySet.has(fromQueueIdx) && !prevPrioritySet.has(toQueueIdx) && toPos >= prevPriorityCount - 1) {
    nextPriorityCount = Math.max(0, prevPriorityCount - 1);
  }

  state.priorityNextIndices = newOrder.slice(0, nextPriorityCount);

  if (state.isShuffle) {
    state.shuffleForwardStack = [];
    state.shuffleBag = newOrder.slice(nextPriorityCount);
    renderQueue();
    savePersistentQueue();
    preloadAdjacentTracks();
  } else {
    moveQueueItem(fromQueueIdx, toQueueIdx);
  }
}

function removeQueueItemAt(index) {
  if (index < 0 || index >= state.queue.length) return;
  const wasCurrent = index === state.queueIndex;
  state.queue.splice(index, 1);
  removeIndexFromTracking(index);
  shiftQueueTrackingIndices(index + 1, -1);

  if (index < state.queueIndex) {
    state.queueIndex--;
  } else if (wasCurrent) {
    if (state.queue.length === 0) {
      state.queueIndex = -1;
      audio.pause();
      state.isPlaying = false;
      updatePlayPauseUI();
    } else {
      const nextUpcoming = getOrderedUpcomingIndices();
      const nextIdx = nextUpcoming.length > 0 ? nextUpcoming[0] : Math.min(index, state.queue.length - 1);
      playTrack(state.queue[nextIdx], null, nextIdx, { preserveShuffleForward: true });
      return;
    }
  }

  renderQueue();
  savePersistentQueue();
  preloadAdjacentTracks();
}

let draggedNpQueueIdx = -1;

function updateQueueSummary() {
  const summaryEl = document.getElementById('queue-summary');
  if (!summaryEl) return;
  if (state.queue.length === 0) {
    summaryEl.textContent = '0 tracks in queue';
    return;
  }
  const upcomingCount = getOrderedUpcomingIndices().length;
  const currentCount = (state.queueIndex >= 0 && state.queueIndex < state.queue.length) ? 1 : 0;
  const playedCount = Math.max(0, state.queue.length - upcomingCount - currentCount);
  const totalSec = state.queue.reduce((acc, t) => acc + parseDurationToSeconds(t.duration), 0);
  const mins = Math.round(totalSec / 60);
  const durLabel = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  const playedSuffix = playedCount > 0 && !state.showPlayedInQueue ? ` • ${playedCount} played hidden` : '';
  summaryEl.textContent = `${upcomingCount} up next • ~${durLabel}${playedSuffix}`;
}

function renderNowPlayingQueue() {
  const npList = document.getElementById('np-queue-list');
  const npCount = document.getElementById('np-queue-count');
  if (!npList) return;
  npList.innerHTML = '';

  const npEditBtn = document.getElementById('np-btn-edit-queue');
  if (npEditBtn) npEditBtn.classList.toggle('active', Boolean(state.npQueueEditing));
  const npPlayedBtn = document.getElementById('np-btn-toggle-played-queue');
  if (npPlayedBtn) {
    npPlayedBtn.classList.toggle('active', Boolean(state.showPlayedInQueue));
    npPlayedBtn.title = state.showPlayedInQueue ? 'Hide previously played songs' : 'Show previously played songs';
  }

  if (state.queue.length === 0) {
    if (npCount) npCount.textContent = 'Up Next (0)';
    npList.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.84rem;">Queue is empty. Play a song, album, or playlist to fill Up Next.</div>';
    return;
  }

  const upcomingIndices = getOrderedUpcomingIndices();
  const prioritySet = new Set(state.priorityNextIndices || []);
  const currentIdx = (state.queueIndex >= 0 && state.queueIndex < state.queue.length) ? state.queueIndex : -1;
  const shownSet = new Set(upcomingIndices);
  if (currentIdx !== -1) shownSet.add(currentIdx);
  const pastIndices = [];
  for (let i = 0; i < state.queue.length; i++) {
    if (!shownSet.has(i)) pastIndices.push(i);
  }

  if (npCount) {
    npCount.textContent = `Up Next • ${upcomingIndices.length} track${upcomingIndices.length === 1 ? '' : 's'}${state.isShuffle ? ' • Shuffled' : ''}`;
  }

  const appendNpRow = (index, labelHtml, options = {}) => {
    const track = state.queue[index];
    if (!track) return;
    const { isCurrent = false, isPast = false, isUpcoming = false, upcomingPos = -1, upcomingLen = 0, isPriorityNext = false } = options;
    const row = document.createElement('div');
    row.className = `np-queue-item ${isCurrent ? 'active' : ''} ${isPast ? 'played-past' : ''} ${state.npQueueEditing && isUpcoming ? 'np-queue-editing' : ''}`;
    row.dataset.queueIndex = String(index);
    row.draggable = Boolean(isUpcoming);

    const numInner = isCurrent
      ? '<span class="eq-bars"><span></span><span></span><span></span></span>'
      : (isUpcoming
        ? `<span class="np-queue-drag-handle" title="Drag to reorder">${labelHtml}</span>`
        : labelHtml);

    const actionsHtml = isUpcoming
      ? `
        <div class="np-queue-actions">
          <button type="button" class="track-action-btn np-move-up" title="Move up" ${upcomingPos <= 0 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
          </button>
          <button type="button" class="track-action-btn np-move-down" title="Move down" ${upcomingPos >= upcomingLen - 1 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
          </button>
          <button type="button" class="track-action-btn np-remove-queue" title="Remove from queue">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      `
      : '';

    row.innerHTML = `
      <span class="np-queue-num">${numInner}</span>
      <img class="np-queue-thumb" src="${upgradeCover(track.thumbnail, 256)}" loading="lazy">
      <div class="np-queue-info">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          <span class="np-queue-title">${track.title || 'Unknown'}</span>
          ${isPriorityNext ? '<span class="queue-next-pill">Next</span>' : ''}
        </div>
        <span class="np-queue-artist">${cleanArtistName(track.artist) || 'Unknown Artist'}</span>
      </div>
      <span class="np-queue-dur">${track.duration || ''}</span>
      ${actionsHtml}
    `;

    if (isUpcoming) {
      const btnUp = row.querySelector('.np-move-up');
      const btnDown = row.querySelector('.np-move-down');
      const btnRemove = row.querySelector('.np-remove-queue');

      btnUp?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (upcomingPos > 0) {
          moveUpcomingQueueItem(index, upcomingIndices[upcomingPos - 1]);
          renderNowPlayingQueue();
        }
      });

      btnDown?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (upcomingPos < upcomingLen - 1) {
          moveUpcomingQueueItem(index, upcomingIndices[upcomingPos + 1]);
          renderNowPlayingQueue();
        }
      });

      btnRemove?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeQueueItemAt(index);
        renderNowPlayingQueue();
      });

      row.addEventListener('dragstart', () => {
        draggedNpQueueIdx = index;
        row.classList.add('dragging-row');
      });
      row.addEventListener('dragend', () => {
        draggedNpQueueIdx = -1;
        row.classList.remove('dragging-row');
        npList.querySelectorAll('.np-queue-item').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedNpQueueIdx === -1 || draggedNpQueueIdx === index) return;
        const rect = row.getBoundingClientRect();
        const isTop = e.clientY < rect.top + rect.height / 2;
        row.classList.toggle('drag-over-top', isTop);
        row.classList.toggle('drag-over-bottom', !isTop);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over-top', 'drag-over-bottom');
        if (draggedNpQueueIdx !== -1 && draggedNpQueueIdx !== index) {
          moveUpcomingQueueItem(draggedNpQueueIdx, index);
          renderNowPlayingQueue();
        }
      });
    }

    row.addEventListener('click', (e) => {
      if (e.target.closest('.track-action-btn, button, .np-queue-actions')) return;
      playTrack(track, null, index);
    });
    npList.appendChild(row);
  };

  if (currentIdx !== -1) {
    appendNpRow(currentIdx, '', { isCurrent: true });
  }
  upcomingIndices.forEach((idx, pos) => {
    appendNpRow(idx, `${pos + 1}`, {
      isUpcoming: true,
      upcomingPos: pos,
      upcomingLen: upcomingIndices.length,
      isPriorityNext: prioritySet.has(idx)
    });
  });
  if (state.showPlayedInQueue && pastIndices.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'queue-section-label';
    divider.style.padding = '8px 6px 2px';
    divider.innerHTML = `<span>Earlier (${pastIndices.length})</span>`;
    npList.appendChild(divider);
    pastIndices.forEach((idx) => {
      appendNpRow(idx, `${idx + 1}`, { isPast: true });
    });
  }
}

function renderQueue() {
  const list = document.getElementById('queue-track-list');
  if (!list) return;
  list.innerHTML = '';
  updateQueueSummary();
  renderNowPlayingQueue();

  const editBtn = document.getElementById('btn-edit-queue');
  if (editBtn) editBtn.classList.toggle('active', state.queueEditing);
  const togglePlayedBtn = document.getElementById('btn-toggle-played-queue');
  if (togglePlayedBtn) {
    togglePlayedBtn.classList.toggle('active', Boolean(state.showPlayedInQueue));
    togglePlayedBtn.title = state.showPlayedInQueue ? 'Hide previously played songs' : 'Show previously played songs';
  }

  if (state.queue.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding: 28px 16px; color: var(--text-muted); font-size: 0.86rem;">Queue is empty</div>';
    return;
  }

  const upcomingIndices = getOrderedUpcomingIndices();
  const prioritySet = new Set(state.priorityNextIndices || []);
  const currentIdx = (state.queueIndex >= 0 && state.queueIndex < state.queue.length) ? state.queueIndex : -1;
  const shownSet = new Set(upcomingIndices);
  if (currentIdx !== -1) shownSet.add(currentIdx);
  const pastIndices = [];
  for (let i = 0; i < state.queue.length; i++) {
    if (!shownSet.has(i)) pastIndices.push(i);
  }

  const buildQueueCard = (index, displayNum, options = {}) => {
    const track = state.queue[index];
    if (!track) return;
    const { isCurrent = false, isPast = false, isUpcoming = false, upcomingPos = -1, upcomingLen = 0 } = options;
    const card = document.createElement('div');
    card.className = `queue-item-card ${isCurrent ? 'active' : ''} ${isPast ? 'played-past' : ''} ${state.queueEditing && isUpcoming ? 'queue-editing' : ''}`;
    card.dataset.queueIndex = String(index);
    card.draggable = Boolean(state.queueEditing && isUpcoming);

    const actionsHtml = (state.queueEditing && isUpcoming)
      ? `
        <button class="track-action-btn move-queue-up" title="Move up" ${upcomingPos <= 0 ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
        </button>
        <button class="track-action-btn move-queue-down" title="Move down" ${upcomingPos >= upcomingLen - 1 ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
        </button>
        <button class="track-action-btn remove-queue" title="Remove from queue">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      `
      : `
        <button class="track-action-btn remove-queue" title="Remove from queue">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      `;

    const numContent = isCurrent
      ? '<span class="eq-bars"><span></span><span></span><span></span></span>'
      : ((state.queueEditing && isUpcoming)
        ? '<span class="queue-drag-handle" title="Drag to reorder"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></span>'
        : displayNum);

    card.innerHTML = `
      <span class="queue-item-num">${numContent}</span>
      <img class="queue-item-thumb" src="${upgradeCover(track.thumbnail, 256)}" loading="lazy">
      <div class="queue-item-info">
        <div class="queue-item-title-row">
          <span class="queue-item-title">${track.title || 'Unknown'}</span>
          ${isUpcoming && prioritySet.has(index) ? '<span class="queue-next-pill">Next</span>' : ''}
        </div>
        <span class="queue-item-artist">${renderArtistLinksHtml(track)}</span>
      </div>
      <span class="queue-item-dur">${track.duration || ''}</span>
      <div class="queue-item-actions">${actionsHtml}</div>
    `;

    bindArtistLinksInContainer(card, track);

    if (state.queueEditing && isUpcoming) {
      card.addEventListener('dragstart', () => {
        draggedQueueIdx = index;
        card.classList.add('dragging-row');
      });
      card.addEventListener('dragend', () => {
        draggedQueueIdx = -1;
        card.classList.remove('dragging-row');
        list.querySelectorAll('.queue-item-card').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedQueueIdx === -1 || draggedQueueIdx === index) return;
        const rect = card.getBoundingClientRect();
        const isTop = e.clientY < rect.top + rect.height / 2;
        card.classList.toggle('drag-over-top', isTop);
        card.classList.toggle('drag-over-bottom', !isTop);
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over-top', 'drag-over-bottom');
        if (draggedQueueIdx !== -1 && draggedQueueIdx !== index) {
          moveUpcomingQueueItem(draggedQueueIdx, index);
        }
      });
    }

    card.addEventListener('click', (e) => {
      if (isUpcoming && e.target.closest('.move-queue-up')) {
        e.stopPropagation();
        if (upcomingPos > 0) moveUpcomingQueueItem(index, upcomingIndices[upcomingPos - 1]);
        return;
      }
      if (isUpcoming && e.target.closest('.move-queue-down')) {
        e.stopPropagation();
        if (upcomingPos < upcomingLen - 1) moveUpcomingQueueItem(index, upcomingIndices[upcomingPos + 1]);
        return;
      }
      if (e.target.closest('.remove-queue')) {
        e.stopPropagation();
        removeQueueItemAt(index);
        return;
      }
      if (e.target.closest('.clickable-artist-link')) return;
      playTrack(track, null, index);
    });

    list.appendChild(card);
  };

  if (currentIdx !== -1) {
    const label = document.createElement('div');
    label.className = 'queue-section-label';
    label.innerHTML = '<span>Now Playing</span>';
    list.appendChild(label);
    buildQueueCard(currentIdx, '', { isCurrent: true });
  }

  if (upcomingIndices.length > 0) {
    const label = document.createElement('div');
    label.className = 'queue-section-label';
    label.innerHTML = `<span>Up Next (${upcomingIndices.length})</span><span>${state.isShuffle ? 'Shuffle On' : ''}</span>`;
    list.appendChild(label);
    upcomingIndices.forEach((idx, pos) => {
      buildQueueCard(idx, pos + 1, {
        isUpcoming: true,
        upcomingPos: pos,
        upcomingLen: upcomingIndices.length
      });
    });
  }

  if (state.showPlayedInQueue && pastIndices.length > 0) {
    const label = document.createElement('div');
    label.className = 'queue-section-label';
    label.innerHTML = `<span>Earlier in Queue (${pastIndices.length})</span>`;
    list.appendChild(label);
    pastIndices.forEach((idx, pos) => {
      buildQueueCard(idx, pos + 1, { isPast: true });
    });
  }
}

document.getElementById('btn-edit-queue')?.addEventListener('click', () => {
  state.queueEditing = !state.queueEditing;
  renderQueue();
});

const toggleShowPlayedInQueue = () => {
  state.showPlayedInQueue = !state.showPlayedInQueue;
  if (typeof settings !== 'undefined') {
    settings.showPlayedInQueue = state.showPlayedInQueue;
    try { localStorage.setItem('opentune_settings', JSON.stringify(settings)); } catch (_) {}
    setElementValue?.('setting-show-played-queue', settings.showPlayedInQueue);
  }
  renderQueue();
  showToast(state.showPlayedInQueue ? 'Showing previously played songs' : 'Hiding previously played songs', 'info', 2000);
};

document.getElementById('btn-toggle-played-queue')?.addEventListener('click', toggleShowPlayedInQueue);
document.getElementById('np-btn-toggle-played-queue')?.addEventListener('click', toggleShowPlayedInQueue);

document.getElementById('np-btn-edit-queue')?.addEventListener('click', () => {
  state.npQueueEditing = !state.npQueueEditing;
  renderNowPlayingQueue();
});

document.getElementById('np-btn-shuffle-queue')?.addEventListener('click', () => {
  document.getElementById('btn-shuffle-queue')?.click();
});

document.getElementById('btn-shuffle-queue')?.addEventListener('click', () => {
  if (state.queue.length <= 2) return;
  if (state.isShuffle) {
    const prioritySet = new Set(state.priorityNextIndices || []);
    const bag = (state.shuffleBag || []).filter(i => i >= 0 && i < state.queue.length && i !== state.queueIndex && !prioritySet.has(i));
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    state.shuffleBag = bag;
    state.shuffleForwardStack = [];
  } else {
    const start = state.queueIndex >= 0 ? state.queueIndex + 1 : 0;
    const tail = state.queue.slice(start);
    if (tail.length <= 1) return;
    for (let i = tail.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tail[i], tail[j]] = [tail[j], tail[i]];
    }
    state.queue.splice(start, tail.length, ...tail);
    state.priorityNextIndices = [];
  }
  renderQueue();
  savePersistentQueue();
  preloadAdjacentTracks();
  showToast('Up Next queue shuffled.', 'info');
});

document.getElementById('btn-clear-queue')?.addEventListener('click', () => {
  if (state.queue.length === 0) return;
  state.queue = [];
  state.queueIndex = -1;
  state.priorityNextIndices = [];
  state.shuffleBag = [];
  state.shuffleHistory = [];
  state.shuffleForwardStack = [];
  renderQueue();
  savePersistentQueue();
  showToast('Queue cleared.', 'info');
});

document.getElementById('btn-save-queue-playlist')?.addEventListener('click', () => {
  if (state.queue.length === 0) {
    showToast('Queue is empty — nothing to save.', 'error');
    return;
  }
  const pls = getLocalPlaylists();
  const stamp = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const newPl = {
    id: `pl_q_${Date.now()}`,
    title: `Queue (${stamp})`,
    description: `Saved from Playback Queue (${state.queue.length} tracks)`,
    thumbnail: state.queue[0]?.thumbnail || 'assets/icon.png',
    tracks: [...state.queue],
    createdAt: Date.now()
  };
  pls.unshift(newPl);
  saveLocalPlaylists(pls);
  showToast(`Saved ${state.queue.length} tracks to "${newPl.title}"`, 'success');
});

// Windows Media Session
function updateMediaSession(track) {
  if ('mediaSession' in navigator) {
    try {
      const hasArtwork = track.thumbnail && track.thumbnail.startsWith('http');
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'Unknown Title',
        artist: cleanArtistName(track.artist) || 'Unknown Artist',
        album: track.album || 'OpenTune Music',
        artwork: hasArtwork ? [{ src: upgradeCover(track.thumbnail, 512), sizes: '512x512', type: 'image/jpeg' }] : []
      });
    } catch (e) {
      console.warn('MediaSession metadata update failed:', e);
    }

    navigator.mediaSession.setActionHandler('play', () => {
      if (isVideoMode) toggleVideoPlayPause();
      else { audio.play(); state.isPlaying = true; updatePlayPauseUI(); }
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (isVideoMode) toggleVideoPlayPause();
      else { audio.pause(); state.isPlaying = false; updatePlayPauseUI(); }
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => btnPrev.click());
    navigator.mediaSession.setActionHandler('nexttrack', () => btnNext.click());
    navigator.mediaSession.setActionHandler('seekto', (details) => { if (details.seekTime) audio.currentTime = details.seekTime; });
  }
}

// Search History, Auto-Suggestions & Discovery
const SEARCH_HISTORY_KEY = 'opentune_search_history';
let searchDebounce = null;

function getSearchHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function addSearchHistory(query) {
  const clean = (query || '').trim();
  if (!clean) return;
  let hist = getSearchHistory().filter(q => q.toLowerCase() !== clean.toLowerCase());
  hist.unshift(clean);
  if (hist.length > 20) hist = hist.slice(0, 20);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(hist));
}

function removeSearchHistoryItem(query) {
  const hist = getSearchHistory().filter(q => q !== query);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(hist));
  renderSearchDiscovery();
}

function renderSearchDiscovery() {
  const discoveryPanel = document.getElementById('search-discovery-panel');
  const histSection = document.getElementById('search-history-section');
  const histChips = document.getElementById('search-history-chips');
  const recentSection = document.getElementById('search-recent-tracks-section');
  const recentGrid = document.getElementById('search-recent-tracks-grid');
  const emptyBox = document.getElementById('search-discovery-empty');
  const showDiscBtn = document.getElementById('btn-search-show-discover');
  const titleEl = document.getElementById('search-title');
  const countEl = document.getElementById('search-count');

  [
    document.getElementById('search-container-all'),
    document.getElementById('search-container-songs'),
    document.getElementById('search-container-albums'),
    document.getElementById('search-container-artists'),
    document.getElementById('search-container-playlists')
  ].forEach(c => { if (c) c.style.display = 'none'; });

  if (discoveryPanel) discoveryPanel.style.display = 'block';
  if (showDiscBtn) showDiscBtn.style.display = 'none';
  if (titleEl) titleEl.textContent = 'Search & Discover';
  if (countEl) countEl.textContent = 'Browse your recent searches and recently played music';

  const hist = getSearchHistory();
  if (histSection && histChips) {
    histChips.innerHTML = '';
    if (hist.length > 0) {
      histSection.style.display = 'block';
      hist.forEach(q => {
        const chip = document.createElement('div');
        chip.className = 'search-history-chip';
        chip.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.65;"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
          <span>${q}</span>
          <button class="search-history-remove" type="button" title="Remove">&times;</button>
        `;
        chip.addEventListener('click', (e) => {
          if (e.target.closest('.search-history-remove')) {
            e.stopPropagation();
            removeSearchHistoryItem(q);
            return;
          }
          searchInput.value = q;
          searchClearBtn.style.display = 'block';
          executeSearch(q, currentSearchFilter);
        });
        histChips.appendChild(chip);
      });
    } else {
      histSection.style.display = 'none';
    }
  }

  let recentTracks = [];
  try {
    recentTracks = JSON.parse(localStorage.getItem('opentune_history') || '[]').slice(0, 10);
  } catch (_) {}

  if (recentSection && recentGrid) {
    recentGrid.innerHTML = '';
    if (recentTracks.length > 0) {
      recentSection.style.display = 'block';
      recentTracks.forEach(track => {
        recentGrid.appendChild(createTrackCard(track, recentTracks));
      });
    } else {
      recentSection.style.display = 'none';
    }
  }

  if (emptyBox) {
    emptyBox.style.display = (hist.length === 0 && recentTracks.length === 0) ? 'flex' : 'none';
  }
}

document.getElementById('btn-clear-search-history')?.addEventListener('click', () => {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  renderSearchDiscovery();
  showToast('Search history cleared.', 'info');
});

document.getElementById('btn-search-show-discover')?.addEventListener('click', () => {
  currentSearchQuery = '';
  renderSearchDiscovery();
});

function showRecentSearchDropdown() {
  const hist = getSearchHistory().slice(0, 6);
  if (hist.length === 0) {
    suggestionsDropdown.style.display = 'none';
    return;
  }
  suggestionsDropdown.innerHTML = '';
  hist.forEach(q => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.65;"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
      <span style="flex:1;">${q}</span>
    `;
    item.addEventListener('click', () => {
      searchInput.value = q;
      searchClearBtn.style.display = 'block';
      suggestionsDropdown.style.display = 'none';
      executeSearch(q);
    });
    suggestionsDropdown.appendChild(item);
  });
  suggestionsDropdown.style.display = 'block';
}

searchInput.addEventListener('focus', () => {
  if (!searchInput.value.trim()) {
    showRecentSearchDropdown();
    if (!document.getElementById('view-search')?.classList.contains('active')) {
      navigateTo('search');
    }
    if (!currentSearchQuery) renderSearchDiscovery();
  }
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  searchClearBtn.style.display = query ? 'block' : 'none';

  clearTimeout(searchDebounce);
  if (!query) {
    showRecentSearchDropdown();
    if (document.getElementById('view-search')?.classList.contains('active')) {
      currentSearchQuery = '';
      renderSearchDiscovery();
    }
    return;
  }

  searchDebounce = setTimeout(async () => {
    try {
      const suggestions = await window.api.getSearchSuggestions(query);
      if (suggestions && suggestions.length > 0) {
        suggestionsDropdown.innerHTML = '';
        suggestions.slice(0, 7).forEach(s => {
          const item = document.createElement('div');
          item.className = 'suggestion-item';
          item.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            <span>${s}</span>
          `;
          item.addEventListener('click', () => {
            searchInput.value = s;
            suggestionsDropdown.style.display = 'none';
            executeSearch(s);
          });
          suggestionsDropdown.appendChild(item);
        });
        suggestionsDropdown.style.display = 'block';
      } else {
        suggestionsDropdown.style.display = 'none';
      }
    } catch (_) {}
  }, 220);
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  suggestionsDropdown.style.display = 'none';
  currentSearchQuery = '';
  renderSearchDiscovery();
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    suggestionsDropdown.style.display = 'none';
    executeSearch(searchInput.value.trim());
  }
});

document.getElementById('search-submit-btn')?.addEventListener('click', () => {
  suggestionsDropdown.style.display = 'none';
  executeSearch(searchInput.value.trim());
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    suggestionsDropdown.style.display = 'none';
  }
  // Close song context menu if clicked outside
  const ctx = document.getElementById('song-context-menu');
  if (ctx && ctx.style.display === 'block' && !e.target.closest('.song-context-menu') && !e.target.closest('.track-menu-btn') && !e.target.closest('#np-more-btn')) {
    ctx.style.display = 'none';
  }
});

let currentSearchQuery = '';
let currentSearchFilter = 'all';

// Search Filter Chips (Songs, Albums, Artists, Playlists, All)
const searchFilterChips = document.querySelectorAll('#search-filter-chips .chip');
searchFilterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    searchFilterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentSearchFilter = chip.dataset.searchFilter || 'all';
    if (currentSearchQuery) {
      executeSearch(currentSearchQuery, currentSearchFilter);
    }
  });
});

function createTrackCard(track, queueList) {
  const card = document.createElement('div');
  card.className = 'music-card';
  card.innerHTML = `
    <div class="card-img-wrapper">
      <img class="card-img" src="${upgradeCover(track.thumbnail, 544)}" loading="lazy">
      <div class="card-play-overlay">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
    </div>
    <div class="card-title">${track.title || 'Unknown Title'}</div>
    <div class="card-subtitle">${renderArtistLinksHtml(track)}</div>
  `;
  bindArtistLinksInContainer(card, track);
  card.addEventListener('click', (e) => {
    if (e.target.closest('.clickable-artist-link')) return;
    playTrack(track, queueList);
  });
  return card;
}

function createAlbumCard(album) {
  const card = document.createElement('div');
  card.className = 'music-card';
  card.innerHTML = `
    <div class="card-img-wrapper">
      <span class="card-type-badge">${album.releaseType || 'Album'}</span>
      <img class="card-img" src="${upgradeCover(album.thumbnail, 544)}" loading="lazy">
      <div class="card-play-overlay">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
    </div>
    <div class="card-title">${album.title}</div>
    <div class="card-subtitle">${album.artist ? `<span class="clickable-artist-link" ${album.artistId ? `data-artist-id="${album.artistId}"` : ''} data-artist-name="${String(album.artist).replace(/"/g, '&quot;')}">${album.artist}</span>` : ''} ${album.year ? '• ' + album.year : ''}</div>
  `;
  bindArtistLinksInContainer(card, album);
  card.addEventListener('click', (e) => {
    if (e.target.closest('.clickable-artist-link')) return;
    openAlbumDetail(album.id);
  });
  return card;
}

function createArtistCard(artist) {
  const card = document.createElement('div');
  card.className = 'music-card';
  card.innerHTML = `
    <div class="card-img-wrapper" style="border-radius: 50% !important; overflow: hidden;">
      <img class="card-img artist-card-img" src="${upgradeCover(artist.thumbnail, 544)}" loading="lazy">
      <div class="card-play-overlay" style="border-radius: 50% !important;">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
    </div>
    <div class="card-title" style="text-align: center;">${artist.name}</div>
    <div class="card-subtitle" style="text-align: center;">${artist.subscribers || 'Artist'}</div>
  `;
  card.addEventListener('click', () => openArtistDetail(artist.id));
  return card;
}

function createPlaylistCard(playlist) {
  const card = document.createElement('div');
  card.className = 'music-card';
  card.innerHTML = `
    <div class="card-img-wrapper">
      <span class="card-type-badge">Playlist</span>
      <img class="card-img" src="${upgradeCover(playlist.thumbnail, 544)}" loading="lazy">
      <div class="card-play-overlay">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
    </div>
    <div class="card-title">${playlist.title}</div>
    <div class="card-subtitle">${playlist.author || ''} ${playlist.itemCount ? '• ' + playlist.itemCount : ''}</div>
  `;
  card.addEventListener('click', () => openOnlinePlaylist(playlist.id));
  return card;
}

function fisherYatesShuffle(arr) {
  const copy = [...(arr || [])];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeHtmlSafe(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDurationToSecondsSafe(durStr) {
  if (!durStr || typeof durStr !== 'string') return 0;
  const parts = durStr.trim().split(':').map(n => parseInt(n, 10));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatTotalDurationText(tracks) {
  const totalSec = (tracks || []).reduce((acc, t) => acc + parseDurationToSecondsSafe(t.duration), 0);
  if (totalSec <= 0) return '';
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hrs > 0) return `${hrs} hr ${mins} min`;
  return `${Math.max(1, mins)} min`;
}

// Execute Search across Songs, Albums, Artists, Playlists, All
async function executeSearch(query, filter = 'all') {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    renderSearchDiscovery();
    return;
  }

  currentSearchQuery = cleanQuery;
  currentSearchFilter = filter || 'all';
  if (searchFilterChips) {
    searchFilterChips.forEach(c => {
      c.classList.toggle('active', (c.dataset.searchFilter || 'all') === currentSearchFilter);
    });
  }
  addSearchHistory(cleanQuery);

  const reqToken = ++state.searchRequestToken;
  navigateTo('search');

  const discoveryPanel = document.getElementById('search-discovery-panel');
  const showDiscBtn = document.getElementById('btn-search-show-discover');
  const titleEl = document.getElementById('search-title');
  const countEl = document.getElementById('search-count');

  const cAll = document.getElementById('search-container-all');
  const cSongs = document.getElementById('search-container-songs');
  const cAlbums = document.getElementById('search-container-albums');
  const cArtists = document.getElementById('search-container-artists');
  const cPlaylists = document.getElementById('search-container-playlists');

  if (discoveryPanel) discoveryPanel.style.display = 'none';
  if (showDiscBtn) showDiscBtn.style.display = 'inline-flex';
  if (titleEl) titleEl.textContent = `Search Results for "${cleanQuery}"`;
  if (countEl) countEl.textContent = 'Searching YouTube Music...';

  [cAll, cSongs, cAlbums, cArtists, cPlaylists].forEach(c => { if (c) c.style.display = 'none'; });

  const allSongsList = document.getElementById('search-all-songs-list');
  const allAlbumsSec = document.getElementById('search-all-albums-section');
  const allAlbumsGrid = document.getElementById('search-all-albums-grid');
  const allArtistsSec = document.getElementById('search-all-artists-section');
  const allArtistsGrid = document.getElementById('search-all-artists-grid');
  const allPlaylistsSec = document.getElementById('search-all-playlists-section');
  const allPlaylistsGrid = document.getElementById('search-all-playlists-grid');
  const songsList = document.getElementById('search-results-list');

  // Show loading indicator in active container
  if (currentSearchFilter === 'all') {
    if (cAll) cAll.style.display = 'block';
    if (allSongsList) allSongsList.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 36px;"><div class="spinner"></div></td></tr>';
    if (allAlbumsSec) allAlbumsSec.style.display = 'none';
    if (allArtistsSec) allArtistsSec.style.display = 'none';
    if (allPlaylistsSec) allPlaylistsSec.style.display = 'none';
  } else if (currentSearchFilter === 'song') {
    if (cSongs) cSongs.style.display = 'block';
    if (songsList) songsList.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;"><div class="spinner"></div></td></tr>';
  } else if (currentSearchFilter === 'album') {
    if (cAlbums) {
      cAlbums.style.display = 'grid';
      cAlbums.innerHTML = '<div class="spinner"></div>';
    }
  } else if (currentSearchFilter === 'artist') {
    if (cArtists) {
      cArtists.style.display = 'grid';
      cArtists.innerHTML = '<div class="spinner"></div>';
    }
  } else if (currentSearchFilter === 'playlist') {
    if (cPlaylists) {
      cPlaylists.style.display = 'grid';
      cPlaylists.innerHTML = '<div class="spinner"></div>';
    }
  }

  try {
    const res = await window.api.search(cleanQuery, currentSearchFilter);
    if (reqToken !== state.searchRequestToken) return;

    if (res && res.success === false) {
      throw new Error(res.error || 'Search failed');
    }

    if (currentSearchFilter === 'all') {
      const data = (res && res.items && !Array.isArray(res.items)) ? res.items : (res || {});
      const songs = Array.isArray(data.songs) ? data.songs : [];
      const albums = Array.isArray(data.albums) ? data.albums : [];
      const artists = Array.isArray(data.artists) ? data.artists : [];
      const playlists = Array.isArray(data.playlists) ? data.playlists : [];

      const totalCount = songs.length + albums.length + artists.length + playlists.length;
      if (countEl) countEl.textContent = `${totalCount} result${totalCount === 1 ? '' : 's'} across songs, albums, artists & playlists`;

      const songsSec = document.getElementById('search-all-songs-section');
      if (allSongsList) {
        allSongsList.innerHTML = '';
        if (songs.length > 0) {
          if (songsSec) songsSec.style.display = 'block';
          const frag = document.createDocumentFragment();
          songs.slice(0, 10).forEach((t, i) => frag.appendChild(createTrackRow(t, i + 1, songs)));
          allSongsList.appendChild(frag);
        } else if (totalCount > 0) {
          if (songsSec) songsSec.style.display = 'none';
        } else {
          if (songsSec) songsSec.style.display = 'block';
          allSongsList.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 42px; color: var(--text-muted);">No results found for "${escapeHtmlSafe(cleanQuery)}". Try a different spelling or keyword.</td></tr>`;
        }
      }

      if (allAlbumsSec && allAlbumsGrid) {
        allAlbumsGrid.innerHTML = '';
        if (albums.length > 0) {
          allAlbumsSec.style.display = 'block';
          albums.slice(0, 10).forEach(al => allAlbumsGrid.appendChild(createAlbumCard(al)));
        } else {
          allAlbumsSec.style.display = 'none';
        }
      }

      if (allArtistsSec && allArtistsGrid) {
        allArtistsGrid.innerHTML = '';
        if (artists.length > 0) {
          allArtistsSec.style.display = 'block';
          artists.slice(0, 10).forEach(ar => allArtistsGrid.appendChild(createArtistCard(ar)));
        } else {
          allArtistsSec.style.display = 'none';
        }
      }

      if (allPlaylistsSec && allPlaylistsGrid) {
        allPlaylistsGrid.innerHTML = '';
        if (playlists.length > 0) {
          allPlaylistsSec.style.display = 'block';
          playlists.slice(0, 10).forEach(pl => allPlaylistsGrid.appendChild(createPlaylistCard(pl)));
        } else {
          allPlaylistsSec.style.display = 'none';
        }
      }
      return;
    }

    const items = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
    if (countEl) countEl.textContent = `${items.length} ${currentSearchFilter}${items.length === 1 ? '' : 's'} found`;

    if (currentSearchFilter === 'song' && songsList) {
      songsList.innerHTML = '';
      if (items.length === 0) {
        songsList.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No songs found for "${escapeHtmlSafe(cleanQuery)}".</td></tr>`;
      } else {
        const frag = document.createDocumentFragment();
        items.forEach((t, i) => frag.appendChild(createTrackRow(t, i + 1, items)));
        songsList.appendChild(frag);
      }
    } else if (currentSearchFilter === 'album' && cAlbums) {
      cAlbums.innerHTML = '';
      if (items.length === 0) {
        cAlbums.innerHTML = `<div class="empty-state-box" style="grid-column: 1 / -1;"><h4>No albums found</h4><p>No albums matched "${escapeHtmlSafe(cleanQuery)}".</p></div>`;
      } else {
        items.forEach(al => cAlbums.appendChild(createAlbumCard(al)));
      }
    } else if (currentSearchFilter === 'artist' && cArtists) {
      cArtists.innerHTML = '';
      if (items.length === 0) {
        cArtists.innerHTML = `<div class="empty-state-box" style="grid-column: 1 / -1;"><h4>No artists found</h4><p>No artists matched "${escapeHtmlSafe(cleanQuery)}".</p></div>`;
      } else {
        items.forEach(ar => cArtists.appendChild(createArtistCard(ar)));
      }
    } else if (currentSearchFilter === 'playlist' && cPlaylists) {
      cPlaylists.innerHTML = '';
      if (items.length === 0) {
        cPlaylists.innerHTML = `<div class="empty-state-box" style="grid-column: 1 / -1;"><h4>No playlists found</h4><p>No playlists matched "${escapeHtmlSafe(cleanQuery)}".</p></div>`;
      } else {
        items.forEach(pl => cPlaylists.appendChild(createPlaylistCard(pl)));
      }
    }
  } catch (err) {
    if (reqToken !== state.searchRequestToken) return;
    if (countEl) countEl.textContent = `Search error: ${err.message}`;
    const errHtml = `
      <div class="empty-state-box" style="grid-column: 1 / -1;">
        <h4>Could not complete search</h4>
        <p>${escapeHtmlSafe(err.message || 'Check your internet connection and try again.')}</p>
        <button class="btn-primary-action retry-search-btn" type="button" style="margin-top: 14px;">Retry Search</button>
      </div>
    `;
    if (currentSearchFilter === 'all' && allSongsList) {
      if (document.getElementById('search-all-songs-section')) {
        document.getElementById('search-all-songs-section').style.display = 'block';
      }
      allSongsList.innerHTML = `<tr><td colspan="5">${errHtml}</td></tr>`;
      allSongsList.querySelector('.retry-search-btn')?.addEventListener('click', () => executeSearch(cleanQuery, currentSearchFilter));
    } else if (currentSearchFilter === 'song' && songsList) {
      songsList.innerHTML = `<tr><td colspan="5">${errHtml}</td></tr>`;
      songsList.querySelector('.retry-search-btn')?.addEventListener('click', () => executeSearch(cleanQuery, currentSearchFilter));
    } else {
      const targetGrid = currentSearchFilter === 'album' ? cAlbums : (currentSearchFilter === 'artist' ? cArtists : cPlaylists);
      if (targetGrid) {
        targetGrid.innerHTML = errHtml;
        targetGrid.querySelector('.retry-search-btn')?.addEventListener('click', () => executeSearch(cleanQuery, currentSearchFilter));
      }
    }
  }
}

// Open Album Detail View
async function openAlbumDetail(albumId) {
  if (!albumId) return;
  navigateTo('album-detail');

  const badgeEl = document.getElementById('album-detail-badge');
  const pillsEl = document.getElementById('album-detail-meta-pills');
  const titleEl = document.getElementById('album-detail-title');
  const artistEl = document.getElementById('album-detail-artist');
  const infoEl = document.getElementById('album-detail-info');
  const descEl = document.getElementById('album-detail-desc');
  const thumbEl = document.getElementById('album-detail-thumb');
  const listEl = document.getElementById('album-detail-tracks-list');
  const similarSec = document.getElementById('album-detail-similar-section');
  const similarGrid = document.getElementById('album-detail-similar-grid');

  if (badgeEl) badgeEl.textContent = 'ALBUM';
  if (pillsEl) pillsEl.innerHTML = '';
  if (titleEl) titleEl.textContent = 'Loading Album...';
  if (artistEl) {
    artistEl.textContent = '';
    artistEl.onclick = null;
  }
  if (infoEl) infoEl.textContent = '';
  if (descEl) {
    descEl.textContent = '';
    descEl.style.display = 'none';
  }
  if (thumbEl) thumbEl.src = 'assets/icon.png';
  if (similarSec) similarSec.style.display = 'none';
  if (listEl) listEl.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;"><div class="spinner"></div></td></tr>';

  try {
    const album = await window.api.getAlbum(albumId);
    if (!album) throw new Error('Album details not available.');

    const tracks = Array.isArray(album.tracks) ? album.tracks : [];
    const totalDuration = formatTotalDurationText(tracks);

    if (badgeEl) badgeEl.textContent = (album.releaseType || 'Album').toUpperCase();
    if (titleEl) titleEl.textContent = album.title || 'Unknown Album';
    if (thumbEl) thumbEl.src = upgradeCover(album.thumbnail, 800);

    if (artistEl) {
      artistEl.textContent = album.artist || 'Various Artists';
      if (album.artistId) {
        artistEl.classList.add('clickable-entity-link');
        artistEl.title = `Open artist: ${album.artist}`;
        artistEl.onclick = () => openArtistDetail(album.artistId);
      } else if (album.artist) {
        artistEl.classList.add('clickable-entity-link');
        artistEl.title = `Open artist: ${album.artist}`;
        artistEl.onclick = () => openArtistByNameOrId('', album.artist);
      }
    }

    if (pillsEl) {
      const pills = [];
      if (album.year) pills.push(`<span class="meta-pill">${escapeHtmlSafe(album.year)}</span>`);
      pills.push(`<span class="meta-pill">${tracks.length} track${tracks.length === 1 ? '' : 's'}</span>`);
      if (totalDuration) pills.push(`<span class="meta-pill">${escapeHtmlSafe(totalDuration)}</span>`);
      pillsEl.innerHTML = pills.join('');
    }

    if (infoEl) {
      const parts = [album.releaseType || 'Album'];
      if (album.year) parts.push(album.year);
      parts.push(`${tracks.length} songs`);
      if (totalDuration) parts.push(totalDuration);
      infoEl.textContent = parts.join(' • ');
    }

    if (descEl && album.description) {
      descEl.textContent = album.description;
      descEl.style.display = 'block';
    }

    if (listEl) {
      listEl.innerHTML = '';
      if (tracks.length === 0) {
        listEl.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No tracks found in this album.</td></tr>';
      } else {
        const frag = document.createDocumentFragment();
        tracks.forEach((t, i) => {
          const enriched = {
            ...t,
            album: t.album || album.title,
            albumId: t.albumId || album.id || albumId,
            artistId: t.artistId || album.artistId,
            year: t.year || album.year,
            thumbnail: t.thumbnail || album.thumbnail
          };
          frag.appendChild(createTrackRow(enriched, t.trackNumber || (i + 1), tracks));
        });
        listEl.appendChild(frag);
      }
    }

    const playBtn = document.getElementById('album-detail-play-btn');
    if (playBtn) {
      playBtn.onclick = () => {
        if (tracks.length > 0) playTrack(tracks[0], tracks, 0);
      };
    }

    const shuffleBtn = document.getElementById('album-detail-shuffle-btn');
    if (shuffleBtn) {
      shuffleBtn.onclick = () => {
        if (tracks.length === 0) return;
        const shuffled = fisherYatesShuffle(tracks);
        state.isShuffle = true;
        updateShuffleRepeatUI();
        playTrack(shuffled[0], shuffled, 0);
      };
    }

    const dlBtn = document.getElementById('album-detail-download-btn');
    const dlStatus = document.getElementById('album-detail-download-status');
    if (dlBtn) {
      dlBtn.onclick = () => {
        if (tracks.length > 0) {
          startBatchDownload(album.title || 'Album', tracks, dlBtn, dlStatus);
        }
      };
    }

    const qBtn = document.getElementById('album-detail-queue-btn');
    if (qBtn) {
      qBtn.onclick = () => appendTracksToQueue(tracks, 'album tracks');
    }

    const radioBtn = document.getElementById('album-detail-radio-btn');
    if (radioBtn) {
      radioBtn.onclick = () => {
        if (tracks.length > 0) startRadioFromTrack(tracks[0]);
      };
    }

    if (similarSec && similarGrid) {
      const similar = Array.isArray(album.similarAlbums) ? album.similarAlbums : [];
      similarGrid.innerHTML = '';
      if (similar.length > 0) {
        similarSec.style.display = 'block';
        similar.forEach(sim => similarGrid.appendChild(createAlbumCard(sim)));
      } else {
        similarSec.style.display = 'none';
      }
    }
  } catch (err) {
    if (titleEl) titleEl.textContent = 'Could not load album';
    if (listEl) {
      listEl.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: #ff5252;">Failed loading album: ${escapeHtmlSafe(err.message)}</td></tr>`;
    }
  }
}

// Open Artist Detail View
async function openArtistDetail(artistId) {
  if (!artistId) return;
  navigateTo('artist-detail');

  const nameEl = document.getElementById('artist-detail-name');
  const subsEl = document.getElementById('artist-detail-subs');
  const avatarEl = document.getElementById('artist-detail-avatar');
  const bioWrap = document.getElementById('artist-detail-bio-wrap');
  const bioEl = document.getElementById('artist-detail-bio');
  const bioToggle = document.getElementById('artist-detail-bio-toggle');
  const songsList = document.getElementById('artist-detail-songs-list');
  const albumsSec = document.getElementById('artist-detail-albums-section');
  const albumsGrid = document.getElementById('artist-detail-albums-grid');
  const singlesSec = document.getElementById('artist-detail-singles-section');
  const singlesGrid = document.getElementById('artist-detail-singles-grid');
  const relatedSec = document.getElementById('artist-detail-related-section');
  const relatedGrid = document.getElementById('artist-detail-related-grid');
  const featuredSec = document.getElementById('artist-detail-featured-section');
  const featuredGrid = document.getElementById('artist-detail-featured-grid');

  if (nameEl) nameEl.textContent = 'Loading Artist...';
  if (subsEl) subsEl.textContent = 'Artist on YouTube Music';
  if (avatarEl) avatarEl.src = 'assets/icon.png';
  if (bioWrap) bioWrap.style.display = 'none';
  if (bioToggle) bioToggle.style.display = 'none';
  if (albumsSec) albumsSec.style.display = 'none';
  if (singlesSec) singlesSec.style.display = 'none';
  if (relatedSec) relatedSec.style.display = 'none';
  if (featuredSec) featuredSec.style.display = 'none';
  if (songsList) songsList.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;"><div class="spinner"></div></td></tr>';

  try {
    const artist = await window.api.getArtist(artistId);
    if (!artist) throw new Error('Artist details not available.');

    if (nameEl) nameEl.textContent = artist.name || 'Unknown Artist';
    if (subsEl) subsEl.textContent = artist.subscribers || 'Artist on YouTube Music';
    if (avatarEl) avatarEl.src = upgradeCover(artist.thumbnail, 800);

    if (bioWrap && bioEl) {
      if (artist.description && artist.description.trim()) {
        bioWrap.style.display = 'block';
        bioEl.textContent = artist.description.trim();
        bioEl.classList.remove('expanded');
        if (bioToggle) {
          const isLong = artist.description.trim().length > 180;
          bioToggle.style.display = isLong ? 'inline-block' : 'none';
          bioToggle.textContent = 'Read more';
          bioToggle.onclick = () => {
            const expanded = bioEl.classList.toggle('expanded');
            bioToggle.textContent = expanded ? 'Show less' : 'Read more';
          };
        }
      } else {
        bioWrap.style.display = 'none';
      }
    }

    const allSongs = Array.isArray(artist.topSongs) ? artist.topSongs : [];
    const countBadge = document.getElementById('artist-detail-songs-count-badge');
    if (countBadge) {
      countBadge.textContent = `${allSongs.length} songs`;
      countBadge.style.display = allSongs.length > 0 ? 'inline-block' : 'none';
    }

    const btnAllSongs = document.getElementById('btn-artist-songs-all');
    const btnTopSongs = document.getElementById('btn-artist-songs-top');

    const renderArtistSongsList = (showAll) => {
      if (!songsList) return;
      songsList.innerHTML = '';
      const listToRender = showAll ? allSongs : allSongs.slice(0, 10);
      if (btnAllSongs) btnAllSongs.classList.toggle('active', showAll);
      if (btnTopSongs) btnTopSongs.classList.toggle('active', !showAll);

      if (listToRender.length === 0) {
        songsList.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 32px; color: var(--text-muted);">No songs listed for this artist.</td></tr>';
      } else {
        const frag = document.createDocumentFragment();
        listToRender.forEach((t, i) => {
          const enriched = { ...t, artistId: t.artistId || artist.id || artistId };
          frag.appendChild(createTrackRow(enriched, i + 1, allSongs));
        });
        songsList.appendChild(frag);
      }
    };

    if (btnAllSongs) {
      btnAllSongs.onclick = () => renderArtistSongsList(true);
    }
    if (btnTopSongs) {
      btnTopSongs.onclick = () => renderArtistSongsList(false);
    }

    renderArtistSongsList(true);

    const playBtn = document.getElementById('artist-detail-play-btn');
    if (playBtn) {
      playBtn.onclick = () => {
        if (allSongs.length > 0) playTrack(allSongs[0], allSongs, 0);
      };
    }

    const shuffleBtn = document.getElementById('artist-detail-shuffle-btn');
    if (shuffleBtn) {
      shuffleBtn.onclick = () => {
        if (allSongs.length === 0) return;
        const shuffled = fisherYatesShuffle(allSongs);
        state.isShuffle = true;
        updateShuffleRepeatUI();
        playTrack(shuffled[0], shuffled, 0);
      };
    }

    const dlBtn = document.getElementById('artist-detail-download-btn');
    const dlStatus = document.getElementById('artist-detail-download-status');
    if (dlBtn) {
      dlBtn.onclick = () => {
        if (allSongs.length > 0) {
          startBatchDownload(`${artist.name || 'Artist'} - All Songs`, allSongs, dlBtn, dlStatus);
        }
      };
    }

    if (albumsSec && albumsGrid) {
      albumsGrid.innerHTML = '';
      const albums = Array.isArray(artist.albums) ? artist.albums : [];
      if (albums.length > 0) {
        albumsSec.style.display = 'block';
        albums.forEach(al => albumsGrid.appendChild(createAlbumCard({ ...al, artist: al.artist || artist.name, artistId: al.artistId || artistId })));
      }
    }

    if (singlesSec && singlesGrid) {
      singlesGrid.innerHTML = '';
      const singles = Array.isArray(artist.singles) ? artist.singles : [];
      if (singles.length > 0) {
        singlesSec.style.display = 'block';
        singles.forEach(s => singlesGrid.appendChild(createAlbumCard({ ...s, releaseType: s.releaseType || 'Single', artist: s.artist || artist.name, artistId: s.artistId || artistId })));
      }
    }

    if (relatedSec && relatedGrid) {
      relatedGrid.innerHTML = '';
      const related = Array.isArray(artist.relatedArtists) ? artist.relatedArtists : [];
      if (related.length > 0) {
        relatedSec.style.display = 'block';
        related.forEach(ra => relatedGrid.appendChild(createArtistCard(ra)));
      }
    }

    if (featuredSec && featuredGrid) {
      featuredGrid.innerHTML = '';
      const featured = Array.isArray(artist.featuredOn) ? artist.featuredOn : [];
      if (featured.length > 0) {
        featuredSec.style.display = 'block';
        featured.forEach(pl => featuredGrid.appendChild(createPlaylistCard(pl)));
      }
    }
  } catch (err) {
    if (nameEl) nameEl.textContent = 'Could not load artist';
    if (songsList) {
      songsList.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: #ff5252;">Failed loading artist: ${escapeHtmlSafe(err.message)}</td></tr>`;
    }
  }
}

// Open Online YouTube Music Playlist
async function openOnlinePlaylist(playlistId) {
  navigateTo('playlist-detail');
  const titleEl = document.getElementById('detail-playlist-title');
  const countEl = document.getElementById('detail-playlist-count');
  const thumbEl = document.getElementById('detail-playlist-thumb');
  const deleteBtn = document.getElementById('detail-playlist-delete-btn');
  const playBtn = document.getElementById('detail-playlist-play-btn');
  const importBtn = document.getElementById('detail-playlist-import-btn');
  const pushYtBtn = document.getElementById('detail-playlist-push-yt-btn');
  const syncBtn = document.getElementById('detail-playlist-sync-btn');
  const syncBadge = document.getElementById('detail-playlist-sync-badge');
  const list = document.getElementById('detail-playlist-tracks-list');

  if (deleteBtn) deleteBtn.style.display = 'none';
  if (pushYtBtn) pushYtBtn.style.display = 'none';
  if (syncBtn) syncBtn.style.display = 'none';
  if (syncBadge) {
    syncBadge.style.display = 'none';
    syncBadge.className = 'sync-status-pill';
  }
  if (importBtn) {
    importBtn.style.display = 'inline-flex';
    importBtn.disabled = false;
    importBtn.innerHTML = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Import to OpenTune';
  }

  titleEl.textContent = 'Loading Playlist...';
  countEl.textContent = '';
  list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;"><div class="spinner"></div></td></tr>';

  try {
    const pl = await window.api.getPlaylist(playlistId);
    state.currentPlaylistTracks = pl.tracks;
    state.currentPlaylistTitle = pl.title;

    titleEl.textContent = pl.title;
    countEl.textContent = `${pl.tracks.length} tracks • By ${pl.author}`;
    thumbEl.src = upgradeCover(pl.thumbnail, 800);

    const cleanYtId = String(playlistId || '').replace(/^VL/, '');
    const existingLocal = getLocalPlaylists().find(lp => lp.remoteId === cleanYtId);
    if (importBtn) {
      if (existingLocal) {
        importBtn.innerHTML = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Open Synced Copy';
        importBtn.onclick = () => openPlaylistDetail(existingLocal, true);
      } else {
        importBtn.onclick = async () => {
          await importYtPlaylistDirect(cleanYtId, importBtn, true, pl);
        };
      }
    }

    list.innerHTML = '';
    if (pl.tracks.length === 0) {
      list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No tracks in this playlist.</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    pl.tracks.forEach((track, idx) => {
      fragment.appendChild(createTrackRow(track, track.trackNumber || (idx + 1), pl.tracks));
    });
    list.appendChild(fragment);

    if (playBtn) {
      playBtn.onclick = () => {
        if (pl.tracks.length > 0) playTrack(pl.tracks[0], pl.tracks);
      };
    }

    const shuffleBtn = document.getElementById('detail-playlist-shuffle-btn');
    if (shuffleBtn) {
      shuffleBtn.onclick = () => {
        if (pl.tracks.length > 0) {
          const shuffled = fisherYatesShuffle(pl.tracks);
          state.isShuffle = true;
          updateShuffleRepeatUI();
          playTrack(shuffled[0], shuffled, 0);
        }
      };
    }

    const dlBtn = document.getElementById('detail-playlist-download-btn');
    const dlStatus = document.getElementById('detail-playlist-download-status');
    if (dlBtn) {
      dlBtn.onclick = () => {
        if (pl.tracks.length > 0) {
          startBatchDownload(pl.title, pl.tracks, dlBtn, dlStatus);
        }
      };
    }

    const qBtn = document.getElementById('detail-playlist-queue-btn');
    if (qBtn) {
      qBtn.onclick = () => appendTracksToQueue(pl.tracks, 'playlist tracks');
    }

    const radioBtn = document.getElementById('detail-playlist-radio-btn');
    if (radioBtn) {
      radioBtn.onclick = () => {
        if (pl.tracks.length > 0) startRadioFromTrack(pl.tracks[0]);
      };
    }
  } catch (err) {
    list.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: #ff5252;">Failed loading playlist: ${err.message}</td></tr>`;
  }
}

document.getElementById('btn-back-from-album')?.addEventListener('click', () => {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    navigateTo(state.history[state.historyIndex], false);
  } else {
    navigateTo('home');
  }
});

document.getElementById('btn-back-from-artist')?.addEventListener('click', () => {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    navigateTo(state.history[state.historyIndex], false);
  } else {
    navigateTo('home');
  }
});

// Track Row Component with Clickable Artist & Album Links, Like, and Viewport-Safe Context Menu
function createTrackRow(track, number, playlistQueue) {
  const tr = document.createElement('tr');
  tr.className = `track-row ${state.currentTrack?.id === track.id ? 'active' : ''}`;
  const isLiked = state.likedSongs.has(track.id);
  const isDownloaded = typeof sessionDownloadedIds !== 'undefined' && sessionDownloadedIds.has(track.id);

  tr.innerHTML = `
    <td class="track-col-num">${number}</td>
    <td class="track-col-title">
      <img class="track-thumb" src="${upgradeCover(track.thumbnail, 544)}" loading="lazy" title="${track.album ? 'Open album: ' + track.album : ''}">
      <div class="track-info">
        <span class="track-name">${track.title}</span>
        <span class="track-artist">${renderArtistLinksHtml(track)}</span>
      </div>
    </td>
    <td class="track-col-album">${track.album ? `<span class="clickable-album-link">${track.album}</span>` : ''}</td>
    <td class="track-col-duration">${track.duration || ''}</td>
    <td class="track-col-actions">
      ${isDownloaded ? '<span class="track-downloaded-badge" title="Downloaded Offline"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>' : ''}
      <button class="track-action-btn ${isLiked ? 'liked' : ''}" title="Like">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
      </button>
      <button class="track-action-btn track-menu-btn" title="More options">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
      </button>
    </td>
  `;

  bindArtistLinksInContainer(tr, track);

  const albumSpan = tr.querySelector('.clickable-album-link');
  if (albumSpan && track.album) {
    albumSpan.title = `View album: ${track.album}`;
    albumSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateToAlbumFromTrack(track);
    });
  }

  const thumbEl = tr.querySelector('.track-thumb');
  if (thumbEl && track.albumId) {
    thumbEl.style.cursor = 'pointer';
    thumbEl.addEventListener('click', (e) => {
      e.stopPropagation();
      openAlbumDetail(track.albumId);
    });
  }

  tr.addEventListener('click', (e) => {
    if (e.target.closest('.track-action-btn, .clickable-artist-link, .clickable-album-link')) return;
    playTrack(track, playlistQueue);
  });

  const likeBtn = tr.querySelector('.track-action-btn:not(.track-menu-btn)');
  likeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLikeSong(track);
    const nowLiked = state.likedSongs.has(track.id);
    likeBtn.classList.toggle('liked', nowLiked);
    likeBtn.querySelector('svg').setAttribute('fill', nowLiked ? 'currentColor' : 'none');
  });

  const menuBtn = tr.querySelector('.track-menu-btn');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showContextMenu(e, track);
  });

  return tr;
}

// Song Context Menu Logic (Viewport-measured positioning + Artist/Album navigation)
function showContextMenu(e, track) {
  state.selectedContextTrack = track;
  const menu = document.getElementById('song-context-menu');
  if (!menu) return;

  const isLiked = state.likedSongs.has(track.id);
  const likeText = document.getElementById('ctx-like-text');
  if (likeText) likeText.textContent = isLiked ? 'Unlike Song' : 'Like Song';

  const goArtist = document.getElementById('ctx-go-artist');
  const goAlbum = document.getElementById('ctx-go-album');
  if (goArtist) goArtist.style.display = (track.artist && track.artist !== 'Unknown Artist') ? 'flex' : 'none';
  if (goAlbum) goAlbum.style.display = (track.albumId || track.album) ? 'flex' : 'none';

  menu.style.visibility = 'hidden';
  menu.style.display = 'block';
  const rect = menu.getBoundingClientRect();
  const menuWidth = rect.width || 210;
  const menuHeight = rect.height || 260;

  let x = e.clientX;
  let y = e.clientY;
  if (x + menuWidth > window.innerWidth - 8) x = Math.max(8, window.innerWidth - menuWidth - 10);
  if (y + menuHeight > window.innerHeight - 8) y = Math.max(8, window.innerHeight - menuHeight - 10);

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.visibility = 'visible';
}

document.getElementById('ctx-play-next')?.addEventListener('click', () => {
  const track = state.selectedContextTrack;
  document.getElementById('song-context-menu').style.display = 'none';
  if (!track) return;

  if (state.queue.length === 0) {
    state.queue.push(track);
    state.priorityNextIndices = [0];
  } else {
    const insertAt = Math.min(Math.max(0, state.queueIndex + 1), state.queue.length);
    state.queue.splice(insertAt, 0, track);
    shiftQueueTrackingIndices(insertAt, 1);
    state.shuffleBag = (state.shuffleBag || []).filter(i => i !== insertAt);
    state.shuffleForwardStack = (state.shuffleForwardStack || []).filter(i => i !== insertAt);
    state.priorityNextIndices = [insertAt, ...(state.priorityNextIndices || []).filter(i => i !== insertAt)];
  }
  renderQueue();
  savePersistentQueue();
  preloadAdjacentTracks();
  showToast(`Playing next: ${track.title}`, 'success');
});

document.getElementById('ctx-add-queue')?.addEventListener('click', () => {
  const track = state.selectedContextTrack;
  document.getElementById('song-context-menu').style.display = 'none';
  if (!track) return;
  const newIdx = state.queue.length;
  state.queue.push(track);
  if (state.isShuffle) {
    state.shuffleBag = state.shuffleBag || [];
    state.shuffleBag.push(newIdx);
  }
  renderQueue();
  savePersistentQueue();
  preloadAdjacentTracks();
  showToast(`Added "${track.title}" to queue`, 'info');
});

document.getElementById('ctx-go-artist')?.addEventListener('click', () => {
  const track = state.selectedContextTrack;
  document.getElementById('song-context-menu').style.display = 'none';
  navigateToArtistFromTrack(track, () => closeNowPlaying());
});

document.getElementById('ctx-go-album')?.addEventListener('click', () => {
  const track = state.selectedContextTrack;
  document.getElementById('song-context-menu').style.display = 'none';
  closeNowPlaying();
  navigateToAlbumFromTrack(track);
});

document.getElementById('ctx-add-playlist')?.addEventListener('click', () => {
  const track = state.selectedContextTrack;
  if (!track) return;
  document.getElementById('song-context-menu').style.display = 'none';
  openAddToPlaylistModal(track);
});

document.getElementById('ctx-start-radio')?.addEventListener('click', async () => {
  const track = state.selectedContextTrack;
  if (!track) return;
  document.getElementById('song-context-menu').style.display = 'none';
  await startRadioFromTrack(track);
});

document.getElementById('ctx-toggle-like')?.addEventListener('click', () => {
  const track = state.selectedContextTrack;
  if (track) toggleLikeSong(track);
  document.getElementById('song-context-menu').style.display = 'none';
});

document.getElementById('ctx-copy-link')?.addEventListener('click', () => {
  const track = state.selectedContextTrack;
  if (track) {
    navigator.clipboard.writeText(`https://music.youtube.com/watch?v=${track.id}`);
  }
  document.getElementById('song-context-menu').style.display = 'none';
});

document.getElementById('ctx-download-track')?.addEventListener('click', async () => {
  const track = state.selectedContextTrack;
  document.getElementById('song-context-menu').style.display = 'none';
  if (!track) return;
  await downloadTrackWithFeedback(track);
});

// Like / Favorite Songs handling
function toggleLikeSong(track) {
  if (!track || !track.id) return;
  if (state.likedSongs.has(track.id)) {
    state.likedSongs.delete(track.id);
    state.likedSongsData = state.likedSongsData.filter(t => t.id !== track.id);
  } else {
    state.likedSongs.add(track.id);
    state.likedSongsData.unshift(track);
    if (settings.autoDownloadOnLike && typeof downloadTrackWithFeedback === 'function') {
      downloadTrackWithFeedback(track);
    }
  }
  updateLikeButtonUI();
  updateLibraryBentoCounts?.();
  localStorage.setItem('opentune_liked_songs', JSON.stringify(state.likedSongsData));
}

function updateLikeButtonUI() {
  const btn = document.getElementById('player-like-btn');
  const npBtn = document.getElementById('np-like-btn');
  if (!state.currentTrack) return;
  const isLiked = state.likedSongs.has(state.currentTrack.id);
  if (btn) {
    btn.classList.toggle('liked', isLiked);
    btn.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
  }
  if (npBtn) {
    npBtn.classList.toggle('liked', isLiked);
    npBtn.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
  }
}

document.getElementById('player-like-btn').addEventListener('click', () => {
  if (state.currentTrack) toggleLikeSong(state.currentTrack);
});

document.getElementById('np-like-btn')?.addEventListener('click', () => {
  if (state.currentTrack) toggleLikeSong(state.currentTrack);
});

function loadLocalLikedSongs() {
  try {
    const raw = localStorage.getItem('opentune_liked_songs');
    if (raw) {
      state.likedSongsData = JSON.parse(raw);
      state.likedSongs = new Set(state.likedSongsData.map(t => t.id));
    }
  } catch (_) {}
}

function renderLikedTrackList(tracks, totalCount = null) {
  const list = document.getElementById('liked-songs-list');
  const count = document.getElementById('liked-count');
  if (count) count.textContent = `${state.likedSongsData.length} tracks`;
  if (!list) return;
  list.innerHTML = '';

  const total = totalCount !== null ? totalCount : state.likedSongsData.length;

  if (!tracks || tracks.length === 0) {
    if (total === 0) {
      list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No liked songs yet. Click the heart icon on any song!</td></tr>';
    } else {
      list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No liked songs matching your filter search.</td></tr>';
    }
    return;
  }

  const fragment = document.createDocumentFragment();
  tracks.forEach((track, idx) => {
    const originalIdx = state.likedSongsData.indexOf(track);
    const displayNumber = originalIdx >= 0 ? originalIdx + 1 : idx + 1;
    fragment.appendChild(createTrackRow(track, displayNumber, state.likedSongsData));
  });
  list.appendChild(fragment);
}

function filterLikedSongs() {
  const likedInput = document.getElementById('liked-search-input');
  const likedClear = document.getElementById('liked-search-clear');
  const likedFilterCount = document.getElementById('liked-filter-count');
  const tracks = state.likedSongsData || [];

  const query = likedInput ? (likedInput.value || '').trim().toLowerCase() : '';

  if (!query) {
    state.currentFilteredLikedTracks = null;
    if (likedClear) likedClear.style.display = 'none';
    if (likedFilterCount) likedFilterCount.style.display = 'none';
    renderLikedTrackList(tracks);
    return;
  }

  if (likedClear) likedClear.style.display = 'inline-flex';
  const filtered = tracks.filter(t => {
    const title = (t.title || '').toLowerCase();
    const artist = (t.artist || '').toLowerCase();
    const album = (t.album || '').toLowerCase();
    return title.includes(query) || artist.includes(query) || album.includes(query);
  });

  state.currentFilteredLikedTracks = filtered;

  if (likedFilterCount) {
    likedFilterCount.style.display = 'inline-block';
    likedFilterCount.textContent = `${filtered.length} of ${tracks.length} tracks`;
  }

  renderLikedTrackList(filtered, tracks.length);
}

function renderLikedSongs() {
  filterLikedSongs();
}

function setupLikedFilter() {
  const likedInput = document.getElementById('liked-search-input');
  const likedClear = document.getElementById('liked-search-clear');

  if (!likedInput) return;

  likedInput.addEventListener('input', () => {
    filterLikedSongs();
  });

  if (likedClear) {
    likedClear.addEventListener('click', () => {
      likedInput.value = '';
      likedInput.focus();
      filterLikedSongs();
    });
  }

  likedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      likedInput.value = '';
      filterLikedSongs();
      likedInput.blur();
    }
  });
}
setupLikedFilter();

document.getElementById('btn-play-all-liked')?.addEventListener('click', () => {
  const activeTracks = state.currentFilteredLikedTracks || state.likedSongsData;
  if (activeTracks && activeTracks.length > 0) {
    playTrack(activeTracks[0], activeTracks);
  }
});

document.getElementById('btn-shuffle-liked')?.addEventListener('click', () => {
  const activeTracks = state.currentFilteredLikedTracks || state.likedSongsData;
  if (activeTracks && activeTracks.length > 0) {
    const shuffled = fisherYatesShuffle(activeTracks);
    state.isShuffle = true;
    updateShuffleRepeatUI();
    playTrack(shuffled[0], shuffled, 0);
  }
});

document.getElementById('btn-download-liked')?.addEventListener('click', () => {
  const activeTracks = state.currentFilteredLikedTracks || state.likedSongsData;
  if (!activeTracks || activeTracks.length === 0) {
    showToast('No liked songs to download yet.', 'info');
    return;
  }
  startBatchDownload('Liked Songs', activeTracks, document.getElementById('btn-download-liked'), document.getElementById('liked-download-status'));
});

// Home Category Chips (Matching OpenTune Android ChipsRow.kt)
const categoryChips = document.querySelectorAll('.category-chips-bar .chip');
categoryChips.forEach(chip => {
  chip.addEventListener('click', () => {
    categoryChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const cat = chip.dataset.chip;
    loadCategoryFeed(cat);
  });
});

async function loadCategoryFeed(cat) {
  if (!cat || cat === 'all') {
    loadHomeFeed();
    return;
  }
  const quickPicks = document.getElementById('home-quick-picks');
  const title = document.getElementById('home-section-title');
  const userPlaylistsSec = document.getElementById('home-user-playlists-section');
  const extraSections = document.getElementById('home-extra-sections');
  if (userPlaylistsSec) userPlaylistsSec.style.display = 'none';
  if (extraSections) extraSections.innerHTML = '';
  quickPicks.innerHTML = '<div class="spinner"></div>';

  let query = 'Popular Hits 2026';
  let headerText = 'Quick Picks';

  if (cat === 'relax') { query = 'Chill Acoustic Vibes Songs'; headerText = 'Chill & Relaxing Vibes'; }
  else if (cat === 'workout') { query = 'Gym Workout Motivation Music'; headerText = 'Workout Energy Beats'; }
  else if (cat === 'energize') { query = 'EDM Club Party Dance Hits'; headerText = 'Party & Energizing Mix'; }
  else if (cat === 'commute') { query = 'Top Pop Viral Music Hits'; headerText = 'Commute & Travel Hits'; }
  else if (cat === 'focus') { query = 'Deep Focus Ambient Study Music'; headerText = 'Focus & Study Soundtracks'; }

  if (title) title.textContent = headerText;

  try {
    const res = await window.api.search(query, 'song');
    quickPicks.innerHTML = '';
    const songs = (res.success && res.items) ? res.items.slice(0, 15) : [];
    if (songs.length > 0) {
      songs.forEach(track => quickPicks.appendChild(createTrackCard(track, songs)));
    } else {
      quickPicks.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1;">No tracks found for this mood.</p>';
    }
  } catch (_) {
    loadHomeFeed();
  }
}

// Home Feed with YouTube Music Account Playlists, Recommendations & Taste Profile
async function loadHomeFeed() {
  const quickPicks = document.getElementById('home-quick-picks');
  const trendingList = document.getElementById('home-trending-list');
  const userPlaylistsSec = document.getElementById('home-user-playlists-section');
  const userPlaylistsGrid = document.getElementById('home-user-playlists-grid');
  const extraSections = document.getElementById('home-extra-sections');
  const homeTitle = document.getElementById('home-section-title');
  const trendingTitle = document.getElementById('home-trending-title');

  if (homeTitle) homeTitle.textContent = 'Quick Picks';
  if (trendingTitle) trendingTitle.textContent = 'Trending Now';

  // 1. Showcase user's connected YouTube Music Playlists & Library
  try {
    const profile = await window.api.getAccountProfile();
    if (profile && profile.isLoggedIn && userPlaylistsSec && userPlaylistsGrid) {
      const lib = await window.api.getLibrary();
      const playlists = lib.playlists || [];
      if (playlists.length > 0) {
        userPlaylistsGrid.innerHTML = '';
        playlists.slice(0, 10).forEach(pl => {
          userPlaylistsGrid.appendChild(createPlaylistCard(pl));
        });
        userPlaylistsSec.style.display = 'block';
      } else {
        userPlaylistsSec.style.display = 'none';
      }
    } else if (userPlaylistsSec) {
      userPlaylistsSec.style.display = 'none';
    }
  } catch (err) {
    if (userPlaylistsSec) userPlaylistsSec.style.display = 'none';
  }

  // 2. Load YouTube Music Personalized Home Feed Sections
  try {
    const feed = await window.api.getHomeFeed();
    if (quickPicks) quickPicks.innerHTML = '';
    if (trendingList) trendingList.innerHTML = '';
    if (extraSections) extraSections.innerHTML = '';

    if (Array.isArray(feed) && feed.length > 0) {
      const topSection = feed[0];
      if (homeTitle && topSection.title) homeTitle.textContent = topSection.title;
      if (topSection.items && topSection.items.length > 0) {
        topSection.items.forEach(track => quickPicks.appendChild(createTrackCard(track, topSection.items)));
      }

      const secondSection = feed[1] || feed[0];
      if (trendingTitle && secondSection.title) trendingTitle.textContent = secondSection.title;
      if (secondSection.items && secondSection.items.length > 0) {
        secondSection.items.forEach((track, idx) => {
          trendingList.appendChild(createTrackRow(track, idx + 1, secondSection.items));
        });
      }

      // Render all additional personalized sections (Mixed for you, Forgotten favorites, Similar to...)
      if (extraSections && feed.length > 2) {
        feed.slice(2).forEach(sec => {
          if (!sec || !sec.items || sec.items.length === 0) return;
          const wrap = document.createElement('div');
          wrap.className = 'dynamic-section-wrap';
          wrap.innerHTML = `
            <div class="section-header">
              <h2 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 12px;">${sec.title || 'Recommended For You'}</h2>
            </div>
            <div class="cards-grid"></div>
          `;
          const grid = wrap.querySelector('.cards-grid');
          sec.items.forEach(track => {
            grid.appendChild(createTrackCard(track, sec.items));
          });
          extraSections.appendChild(wrap);
        });
      }
    } else {
      if (quickPicks) quickPicks.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1;">Search your favorite songs or artists to get started.</p>';
    }
  } catch (err) {
    console.error('Home feed error:', err);
    if (quickPicks) quickPicks.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1;">Connecting to YouTube Music... Click Search to find songs.</p>';
  }
}

document.getElementById('home-btn-view-all-playlists')?.addEventListener('click', () => {
  switchView('playlists');
});

// Explore & Moods
async function loadExplore() {
  const container = document.getElementById('explore-categories');
  const newReleasesContainer = document.getElementById('explore-new-releases');
  if (container && container.children.length > 0) return;

  try {
    const data = await window.api.getExploreData();
    if (container && data.moods) {
      container.innerHTML = '';
      data.moods.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.style.background = `linear-gradient(135deg, ${cat.color || '#ED5564'}, #111)`;
        card.textContent = cat.title;
        card.addEventListener('click', () => {
          searchInput.value = cat.query;
          executeSearch(cat.query, 'all');
        });
        container.appendChild(card);
      });
    }

    if (newReleasesContainer && data.newReleases) {
      newReleasesContainer.innerHTML = '';
      data.newReleases.slice(0, 15).forEach(item => {
        const card = createAlbumCard(item);
        newReleasesContainer.appendChild(card);
      });
    }
  } catch (_) {}
}

// Charts View (Top 20 Leaderboard)
async function loadCharts() {
  const list = document.getElementById('charts-songs-list');
  if (!list) return;
  list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px;"><div class="spinner"></div></td></tr>';

  try {
    const data = await window.api.getExploreData();
    list.innerHTML = '';
    const tracks = data.trending || [];
    if (tracks.length === 0) {
      list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No chart tracks found.</td></tr>';
      return;
    }

    tracks.forEach((track, idx) => {
      list.appendChild(createTrackRow(track, `#${idx + 1}`, tracks));
    });
  } catch (err) {
    list.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: #ff5252;">Failed loading charts: ${err.message}</td></tr>`;
  }
}

// History View (Matching Android HistoryScreen.kt)
function loadHistory() {
  const list = document.getElementById('history-songs-list');
  if (!list) return;
  list.innerHTML = '';

  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('opentune_history') || '[]');
  } catch (_) {}

  if (history.length === 0) {
    list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No listening history yet. Play some tracks to see history here!</td></tr>';
    return;
  }

  history.forEach((track, idx) => {
    const tr = document.createElement('tr');
    tr.className = `track-row ${state.currentTrack?.id === track.id ? 'active' : ''}`;
    const timeAgo = formatTimeAgo(track.timestamp);
    const isLiked = state.likedSongs.has(track.id);

    tr.innerHTML = `
      <td class="track-col-num">${idx + 1}</td>
      <td class="track-col-title">
        <img class="track-thumb" src="${upgradeCover(track.thumbnail, 544)}" loading="lazy">
        <div class="track-info">
          <span class="track-name">${track.title}</span>
          <span class="track-artist">${renderArtistLinksHtml(track)}</span>
        </div>
      </td>
      <td class="track-col-album" style="color: var(--text-muted); font-size: 0.82rem;">${timeAgo}</td>
      <td class="track-col-duration">${track.duration || ''}</td>
      <td class="track-col-actions">
        <button class="track-action-btn ${isLiked ? 'liked' : ''}" title="Like">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
        <button class="track-action-btn track-menu-btn" title="More options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
        </button>
      </td>
    `;

    bindArtistLinksInContainer(tr, track);

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.track-action-btn') || e.target.closest('.clickable-artist-link')) return;
      playTrack(track, history);
    });

    const likeBtn = tr.querySelector('.track-action-btn:not(.track-menu-btn)');
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLikeSong(track);
      likeBtn.classList.toggle('liked', state.likedSongs.has(track.id));
      likeBtn.querySelector('svg').setAttribute('fill', state.likedSongs.has(track.id) ? 'currentColor' : 'none');
    });

    const menuBtn = tr.querySelector('.track-menu-btn');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu(e, track);
    });

    list.appendChild(tr);
  });
}

document.getElementById('clear-history-btn')?.addEventListener('click', () => {
  localStorage.removeItem('opentune_history');
  loadHistory();
  showToast('Listening history cleared.', 'info');
});

// Stats View (Matching Android StatsScreen.kt)
function loadStats() {
  let stats = { totalPlays: 0, totalSeconds: 0, songs: {}, artists: {} };
  try {
    const raw = localStorage.getItem('opentune_stats');
    if (raw) stats = { ...stats, ...JSON.parse(raw) };
  } catch (_) {}

  const totalPlaysEl = document.getElementById('stat-total-plays');
  const totalTimeEl = document.getElementById('stat-total-time');
  const topArtistEl = document.getElementById('stat-top-artist');

  if (totalPlaysEl) totalPlaysEl.textContent = stats.totalPlays || 0;
  if (totalTimeEl) {
    const mins = Math.round((stats.totalSeconds || 0) / 60);
    if (mins >= 60) {
      totalTimeEl.textContent = `${(mins / 60).toFixed(1)}h`;
    } else {
      totalTimeEl.textContent = `${mins}m`;
    }
  }

  let topArtist = '—';
  let maxArtistCount = 0;
  for (const [artist, count] of Object.entries(stats.artists || {})) {
    if (count > maxArtistCount) {
      maxArtistCount = count;
      topArtist = artist;
    }
  }
  if (topArtistEl) topArtistEl.textContent = topArtist;

  const list = document.getElementById('stats-songs-list');
  if (!list) return;
  list.innerHTML = '';

  const songsArray = Object.values(stats.songs || {}).sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 10);
  if (songsArray.length === 0) {
    list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No playback statistics yet. Start listening to build your insights!</td></tr>';
    return;
  }

  songsArray.forEach((track, idx) => {
    const tr = document.createElement('tr');
    tr.className = `track-row ${state.currentTrack?.id === track.id ? 'active' : ''}`;
    const isLiked = state.likedSongs.has(track.id);

    tr.innerHTML = `
      <td class="track-col-num"><span class="rank-badge">#${idx + 1}</span></td>
      <td class="track-col-title">
        <img class="track-thumb" src="${upgradeCover(track.thumbnail, 544)}" loading="lazy">
        <div class="track-info">
          <span class="track-name">${track.title}</span>
          <span class="track-artist">${renderArtistLinksHtml(track)}</span>
        </div>
      </td>
      <td class="track-col-album"><span style="background: rgba(237, 85, 100, 0.15); color: var(--accent); padding: 3px 8px; border-radius: 9999px; font-weight: 700; font-size: 0.78rem;">${track.playCount} plays</span></td>
      <td class="track-col-duration">${track.duration || ''}</td>
      <td class="track-col-actions">
        <button class="track-action-btn ${isLiked ? 'liked' : ''}" title="Like">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </button>
        <button class="track-action-btn track-menu-btn" title="More options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
        </button>
      </td>
    `;

    bindArtistLinksInContainer(tr, track);

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.track-action-btn') || e.target.closest('.clickable-artist-link')) return;
      playTrack(track, songsArray);
    });

    const likeBtn = tr.querySelector('.track-action-btn:not(.track-menu-btn)');
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLikeSong(track);
      likeBtn.classList.toggle('liked', state.likedSongs.has(track.id));
      likeBtn.querySelector('svg').setAttribute('fill', state.likedSongs.has(track.id) ? 'currentColor' : 'none');
    });

    const menuBtn = tr.querySelector('.track-menu-btn');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu(e, track);
    });

    list.appendChild(tr);
  });
}

// Playlists Hub (Local + YouTube Music)
function getLocalPlaylists() {
  try {
    return JSON.parse(localStorage.getItem('opentune_local_playlists') || '[]');
  } catch (_) {
    return [];
  }
}

function saveLocalPlaylists(pls) {
  try {
    localStorage.setItem('opentune_local_playlists', JSON.stringify(pls));
  } catch (e) {
    console.error('Failed to save playlists to localStorage:', e);
    if (typeof showToast === 'function') {
      showToast('Storage quota exceeded while saving playlists.', 'error');
    }
  }
}

const ICON_DOWNLOAD_SVG = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
const ICON_CHECK_SVG = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
const ICON_SYNC_SVG = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>';
const ICON_CLOUD_SVG = '<svg class="btn-svg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>';

let isBatchDownloading = false;
let activeProgressUnsub = null;
let cachedYtPlaylists = [];

async function startBatchDownload(title, tracks, btnEl, statusEl) {
  const pill = document.getElementById('sidebar-download-pill');
  const pillTitle = document.getElementById('sidebar-download-title');
  const pillBar = document.getElementById('sidebar-download-bar-fill');
  const pillSub = document.getElementById('sidebar-download-sub');
  const pillCancel = document.getElementById('sidebar-download-cancel');

  const hideSidebarPill = () => {
    if (pill) pill.style.display = 'none';
    if (pillBar) pillBar.style.width = '0%';
  };

  if (isBatchDownloading) {
    showToast('A download is already in progress.', 'info', 4000, {
      label: 'Stop Download',
      onClick: async () => {
        await window.api.cancelPlaylistDownload();
        isBatchDownloading = false;
        hideSidebarPill();
        showToast('Download stopped.', 'info');
      }
    });
    return;
  }

  if (typeof activeProgressUnsub === 'function') {
    activeProgressUnsub();
    activeProgressUnsub = null;
  }

  isBatchDownloading = true;
  const totalCount = Array.isArray(tracks) ? tracks.length : 0;
  const originalBtnText = btnEl ? btnEl.innerHTML : `${ICON_DOWNLOAD_SVG} Download`;
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.style.opacity = '0.85';
    btnEl.innerHTML = `<span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></span> Downloading (0/${totalCount})...`;
  }

  if (pill) {
    pill.style.display = 'block';
    if (pillTitle) pillTitle.textContent = `Downloading ${title || 'tracks'}`;
    if (pillBar) pillBar.style.width = '4%';
    if (pillSub) pillSub.textContent = `0 / ${totalCount} tracks`;
  }

  const cancelDownload = async () => {
    await window.api.cancelPlaylistDownload();
    isBatchDownloading = false;
    hideSidebarPill();
    if (statusEl) statusEl.textContent = 'Download cancelled.';
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.style.opacity = '1';
      btnEl.innerHTML = originalBtnText;
    }
    showToast('Download cancelled.', 'info');
  };

  if (pillCancel) pillCancel.onclick = cancelDownload;

  const bindCancel = () => {
    document.getElementById('btn-cancel-active-download')?.addEventListener('click', cancelDownload);
  };

  if (statusEl) {
    statusEl.style.display = 'inline-flex';
    statusEl.innerHTML = `Starting download... <button id="btn-cancel-active-download" class="btn-subtle btn-compact" style="margin-left:6px; color:#ff5252;">Cancel</button>`;
    bindCancel();
  }

  activeProgressUnsub = window.api.onDownloadProgress((data) => {
    if (!isBatchDownloading) return;
    if (data.trackSucceeded && data.trackId) {
      const doneTrack = Array.isArray(tracks) ? tracks.find(t => t && (t.id === data.trackId || t.videoId === data.trackId)) : null;
      persistDownloadedTrack(doneTrack || { id: data.trackId, title: data.trackTitle });
    }
    const pct = data.total > 0 ? Math.min(100, Math.round((data.downloadedCount / data.total) * 100)) : 0;
    if (btnEl) {
      btnEl.innerHTML = `<span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;"></span> Downloading (${data.downloadedCount}/${data.total})...`;
    }
    if (statusEl) {
      statusEl.innerHTML = `<span>Downloading <strong>${escapeHtmlSafe(data.trackTitle)}</strong> (${data.downloadedCount}/${data.total})</span> <button id="btn-cancel-active-download" class="btn-subtle btn-compact" style="color:#ff5252;">Cancel</button>`;
      bindCancel();
    }
    if (pill) {
      if (pillTitle) pillTitle.textContent = data.trackTitle || `Downloading ${title || ''}`;
      if (pillBar) pillBar.style.width = `${pct}%`;
      if (pillSub) pillSub.textContent = `${data.downloadedCount} / ${data.total} (${pct}%)`;
    }
  });

  try {
    const res = await window.api.downloadPlaylist({
      title,
      tracks,
      downloadDir: settings.downloadPath || ''
    });
    if (typeof activeProgressUnsub === 'function') {
      activeProgressUnsub();
      activeProgressUnsub = null;
    }
    isBatchDownloading = false;
    hideSidebarPill();
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.style.opacity = '1';
    }

    if (res.success) {
      if (btnEl) btnEl.innerHTML = `${ICON_CHECK_SVG} Downloaded (${res.count})`;
      if (statusEl) {
        const failNote = res.failedCount > 0 ? ` (${res.failedCount} skipped)` : '';
        statusEl.innerHTML = `${ICON_CHECK_SVG} Saved ${res.count} tracks${failNote} <a href="#" id="open-dl-folder-link" style="color:var(--accent); text-decoration:underline; font-weight:600; margin-left:6px;">Open Folder</a>`;
        document.getElementById('open-dl-folder-link')?.addEventListener('click', (e) => {
          e.preventDefault();
          window.api.openDownloadFolder(res.folderPath);
        });
      }
      showToast(`Saved ${res.count} tracks to "${title}"`, 'success', 5500, {
        label: 'Open Folder',
        onClick: () => window.api.openDownloadFolder(res.folderPath)
      });
    } else if (res.aborted) {
      if (btnEl) btnEl.innerHTML = originalBtnText;
      if (statusEl) statusEl.textContent = 'Download stopped.';
    } else {
      if (btnEl) btnEl.innerHTML = originalBtnText;
      if (statusEl) statusEl.textContent = `Download error: ${res.error || 'Could not download playlist'}`;
      showToast(`Download error: ${res.error || 'Could not complete batch download'}`, 'error');
    }
  } catch (err) {
    if (typeof activeProgressUnsub === 'function') {
      activeProgressUnsub();
      activeProgressUnsub = null;
    }
    isBatchDownloading = false;
    hideSidebarPill();
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.style.opacity = '1';
      btnEl.innerHTML = originalBtnText;
    }
    if (statusEl) statusEl.textContent = `Download error: ${err.message}`;
    showToast(`Download error: ${err.message}`, 'error');
  }
}

async function importYtPlaylistDirect(ytPlaylistId, triggerBtn = null, navigateAfter = false, preloadedPl = null) {
  const cleanId = String(ytPlaylistId || '').replace(/^VL/, '').trim();
  if (!cleanId) return null;

  const existingPls = getLocalPlaylists();
  const already = existingPls.find(p => p.remoteId === cleanId);
  if (already) {
    if (navigateAfter) openPlaylistDetail(already, true);
    return already;
  }

  const prevHtml = triggerBtn ? triggerBtn.innerHTML : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<span class="spinner" style="width:13px;height:13px;display:inline-block;"></span> Importing...';
  }

  try {
    const pl = preloadedPl || await window.api.getPlaylist(cleanId);
    const tracks = Array.isArray(pl?.tracks) ? pl.tracks : [];
    const newPl = {
      id: `yt_${cleanId}_${Date.now()}`,
      remoteId: cleanId,
      autoSync: true,
      lastSyncedAt: Date.now(),
      syncedIds: tracks.map(t => t.id),
      title: pl?.title || 'YouTube Music Playlist',
      description: pl?.description || `Synced with YouTube Music (${pl?.author || 'YouTube Music'})`,
      thumbnail: pl?.thumbnail || (tracks[0]?.thumbnail || 'assets/icon.png'),
      tracks,
      author: pl?.author || 'YouTube Music',
      isImported: true,
      createdAt: Date.now()
    };

    const pls = getLocalPlaylists();
    pls.unshift(newPl);
    saveLocalPlaylists(pls);

    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.classList.add('imported');
      triggerBtn.innerHTML = `${ICON_CHECK_SVG} Synced in OpenTune`;
    }

    if (navigateAfter) {
      openPlaylistDetail(newPl, true);
    } else {
      loadPlaylists();
    }
    return newPl;
  } catch (err) {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = prevHtml;
    }
    console.error('Direct YT playlist import failed:', err.message);
    return null;
  }
}

async function pushPlaylistToYtMusic(localPlId, triggerBtn = null) {
  const pls = getLocalPlaylists();
  const pl = pls.find(p => p.id === localPlId);
  if (!pl) return;

  const prevHtml = triggerBtn ? triggerBtn.innerHTML : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<span class="spinner" style="width:13px;height:13px;display:inline-block;"></span> Pushing...';
  }

  try {
    const videoIds = (pl.tracks || []).map(t => t.id).filter(Boolean);
    const res = await window.api.createYtPlaylist({
      title: pl.title,
      videoIds,
      privacyStatus: 'PRIVATE',
      description: pl.description || 'Synced from OpenTune Desktop'
    });
    if (!res?.success || !res.playlistId) {
      throw new Error(res?.error || 'Could not create YouTube Music playlist');
    }
    pl.remoteId = res.playlistId;
    pl.autoSync = true;
    pl.lastSyncedAt = Date.now();
    pl.syncedIds = [...videoIds];
    saveLocalPlaylists(pls);

    if (state.activePlaylistId === pl.id) {
      openPlaylistDetail(pl, true);
    }
    await syncLibrary();
  } catch (err) {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = prevHtml;
    }
    alert(`Could not sync to YouTube Music: ${err.message}\n\nMake sure you are signed in to your Google / YouTube account in Settings.`);
  }
}

let isSyncingPlaylistLock = new Set();

async function syncLinkedPlaylist(localPlId, { quiet = true } = {}) {
  const pls = getLocalPlaylists();
  const pl = pls.find(p => p.id === localPlId);
  if (!pl || !pl.remoteId || pl.autoSync === false) return false;
  if (isSyncingPlaylistLock.has(localPlId)) return false;
  isSyncingPlaylistLock.add(localPlId);

  try {
    const remote = await window.api.getPlaylist(pl.remoteId);
    if (!remote || !Array.isArray(remote.tracks)) return false;

    const localTracks = pl.tracks || [];
    const localIdSet = new Set(localTracks.map(t => t.id));
    const remoteTracks = remote.tracks;
    const remoteMap = new Map(remoteTracks.map(t => [t.id, t]));
    const remoteIdSet = new Set(remoteTracks.map(t => t.id));
    const baselineIds = new Set(pl.syncedIds || remoteTracks.map(t => t.id));

    // 1. Offline local additions -> push to YT Music
    const addedOfflineIds = localTracks.map(t => t.id).filter(id => !remoteIdSet.has(id) && !baselineIds.has(id));
    if (addedOfflineIds.length > 0) {
      try {
        await window.api.addToYtPlaylist({ playlistId: pl.remoteId, videoIds: addedOfflineIds });
      } catch (e) {
        if (!quiet) console.warn('Push offline adds notice:', e.message);
      }
    }

    // 2. Offline local removals -> remove from YT Music
    const removedOfflineIds = [...baselineIds].filter(id => !localIdSet.has(id) && remoteIdSet.has(id));
    if (removedOfflineIds.length > 0) {
      const setIds = removedOfflineIds.map(id => remoteMap.get(id)?.setVideoId).filter(Boolean);
      try {
        await window.api.removeFromYtPlaylist({ playlistId: pl.remoteId, videoIds: removedOfflineIds, setVideoIds: setIds });
      } catch (e) {
        if (!quiet) console.warn('Push offline removals notice:', e.message);
      }
    }

    // 3. Reconcile merged local list: keep local items unless removed on remote (was in baseline, now missing in remote)
    let merged = localTracks.filter(t => !(baselineIds.has(t.id) && !remoteIdSet.has(t.id) && !addedOfflineIds.includes(t.id)));
    // Update setVideoIds & append tracks added remotely on YT Music
    const mergedIds = new Set(merged.map(t => t.id));
    merged = merged.map(t => remoteMap.get(t.id) ? { ...t, setVideoId: remoteMap.get(t.id).setVideoId || t.setVideoId } : t);
    for (const rt of remoteTracks) {
      if (!mergedIds.has(rt.id) && !removedOfflineIds.includes(rt.id)) {
        merged.push(rt);
        mergedIds.add(rt.id);
      }
    }

    const changed = merged.length !== localTracks.length ||
      merged.some((t, idx) => localTracks[idx]?.id !== t.id);

    pl.tracks = merged;
    if (remote.title && remote.title !== 'Untitled Playlist') pl.title = remote.title;
    if (remote.thumbnail && !remote.thumbnail.includes('assets/icon.png')) pl.thumbnail = remote.thumbnail;
    pl.syncedIds = merged.map(t => t.id);
    pl.lastSyncedAt = Date.now();
    saveLocalPlaylists(pls);

    if (changed && state.activePlaylistId === pl.id && document.getElementById('view-playlist-detail')?.classList.contains('active')) {
      openPlaylistDetail(pl, true, true);
    }
    return changed;
  } catch (e) {
    if (!quiet) console.warn('Sync linked playlist notice:', e.message);
    return false;
  } finally {
    isSyncingPlaylistLock.delete(localPlId);
  }
}

async function removeTrackFromLocalPlaylist(localPlId, track) {
  const pls = getLocalPlaylists();
  const pl = pls.find(p => p.id === localPlId);
  if (!pl) return;

  pl.tracks = (pl.tracks || []).filter(t => t.id !== track.id);
  pl.syncedIds = (pl.syncedIds || []).filter(id => id !== track.id);
  saveLocalPlaylists(pls);

  if (state.activePlaylistId === pl.id) {
    openPlaylistDetail(pl, true, true);
  }

  if (pl.remoteId && pl.autoSync !== false) {
    try {
      await window.api.removeFromYtPlaylist({
        playlistId: pl.remoteId,
        videoIds: [track.id],
        setVideoIds: track.setVideoId ? [track.setVideoId] : []
      });
    } catch (e) {
      console.warn('Real-time remote track removal notice:', e.message);
    }
  }
}

function renderPlaylistsSections(localPls, ytPlaylists) {
  const ytSection = document.getElementById('yt-playlists-section');
  const ytGrid = document.getElementById('yt-playlists-grid');
  const localHeading = document.getElementById('local-playlists-heading');
  const container = document.getElementById('playlists-grid');
  if (!container) return;

  if (ytSection && ytGrid) {
    if (ytPlaylists.length > 0) {
      ytSection.style.display = 'block';
      ytGrid.innerHTML = '';
      if (localHeading) localHeading.style.display = 'block';

      const importAllBtn = document.getElementById('btn-import-all-yt-playlists');
      if (importAllBtn) {
        const unimported = ytPlaylists.filter(yp => !localPls.some(lp => lp.remoteId === String(yp.id || '').replace(/^VL/, '')));
        importAllBtn.style.display = unimported.length > 0 ? 'inline-flex' : 'none';
        importAllBtn.onclick = async () => {
          importAllBtn.disabled = true;
          for (let i = 0; i < unimported.length; i++) {
            importAllBtn.innerHTML = `<span class="spinner" style="width:13px;height:13px;display:inline-block;"></span> Importing (${i + 1}/${unimported.length})...`;
            await importYtPlaylistDirect(unimported[i].id, null, false);
          }
          importAllBtn.disabled = false;
          importAllBtn.innerHTML = `${ICON_CHECK_SVG} Imported All`;
          loadPlaylists();
        };
      }

      ytPlaylists.forEach(pl => {
        const cleanYtId = String(pl.id || '').replace(/^VL/, '');
        const syncedLocal = localPls.find(lp => lp.remoteId === cleanYtId);
        const card = document.createElement('div');
        card.className = 'music-card';
        card.innerHTML = `
          <div class="card-img-wrapper">
            <img class="card-img" src="${upgradeCover(pl.thumbnail, 544)}">
            <span class="card-type-badge">YT MUSIC</span>
            <div class="card-play-overlay">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
          <div class="card-title">${pl.title}</div>
          <div class="card-subtitle">${pl.itemCount || pl.author || 'YouTube Music'}</div>
          <div class="yt-card-footer-actions">
            <button class="btn-card-import ${syncedLocal ? 'imported' : ''}" type="button">
              ${syncedLocal ? `${ICON_CHECK_SVG} Synced in OpenTune` : `${ICON_DOWNLOAD_SVG} Import to OpenTune`}
            </button>
          </div>
        `;
        const importCardBtn = card.querySelector('.btn-card-import');
        importCardBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (syncedLocal) {
            openPlaylistDetail(syncedLocal, true);
          } else {
            importYtPlaylistDirect(cleanYtId, importCardBtn, false);
          }
        });
        card.addEventListener('click', () => {
          if (syncedLocal) {
            openPlaylistDetail(syncedLocal, true);
          } else {
            openOnlinePlaylist(pl.id);
          }
        });
        ytGrid.appendChild(card);
      });
    } else {
      ytSection.style.display = 'none';
      if (localHeading) localHeading.style.display = 'none';
    }
  }

  container.innerHTML = '';
  if (localPls.length === 0 && ytPlaylists.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1;">No playlists yet. Click "+ Create Playlist" to start your first playlist, or sign in with Google in Settings to see and import your YouTube Music playlists.</p>';
    return;
  }

  if (localPls.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1;">Click "Import to OpenTune" on any YouTube Music playlist above or create a new local playlist.</p>';
    return;
  }

  localPls.forEach(pl => {
    const isSynced = Boolean(pl.remoteId && pl.autoSync !== false);
    const card = document.createElement('div');
    card.className = 'music-card';
    card.innerHTML = `
      <div class="card-img-wrapper">
        <img class="card-img" src="${upgradeCover(pl.thumbnail, 544)}">
        ${isSynced ? `<span class="card-type-badge" style="color:#6ee7a0;">${ICON_SYNC_SVG} SYNCED</span>` : ''}
        <div class="card-play-overlay">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div class="card-title">${pl.title}</div>
      <div class="card-subtitle">${pl.tracks?.length || 0} tracks • ${isSynced ? '2-Way Cloud Sync' : 'Local'}</div>
    `;
    card.addEventListener('click', () => openPlaylistDetail(pl, true));
    container.appendChild(card);
  });
}

async function loadPlaylists() {
  const container = document.getElementById('playlists-grid');
  if (!container) return;

  const localPls = getLocalPlaylists();
  if (cachedYtPlaylists.length > 0) {
    renderPlaylistsSections(localPls, cachedYtPlaylists);
  } else {
    container.innerHTML = '<div class="spinner"></div>';
  }

  let ytPlaylists = cachedYtPlaylists;
  try {
    const lib = await window.api.getLibrary();
    if (Array.isArray(lib?.playlists)) {
      ytPlaylists = lib.playlists;
      cachedYtPlaylists = ytPlaylists;
    }
  } catch (_) {}

  renderPlaylistsSections(getLocalPlaylists(), ytPlaylists);
}

function renderPlaylistTrackList(tracks, isLocal, totalCount = null) {
  const list = document.getElementById('detail-playlist-tracks-list');
  if (!list) return;
  list.innerHTML = '';

  const total = totalCount !== null ? totalCount : (state.currentPlaylistTracks ? state.currentPlaylistTracks.length : 0);

  if (!tracks || tracks.length === 0) {
    if (total === 0) {
      list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No tracks in this playlist yet. Click "•••" on any song to add it!</td></tr>';
    } else {
      list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted);">No tracks found matching your filter search.</td></tr>';
    }
    return;
  }

  const fragment = document.createDocumentFragment();
  const allTracks = state.currentPlaylistTracks || tracks;
  tracks.forEach((track, idx) => {
    const originalIdx = allTracks.indexOf(track);
    const displayNumber = originalIdx >= 0 ? originalIdx + 1 : idx + 1;
    const row = createTrackRow(track, displayNumber, allTracks);
    if (isLocal && state.activePlaylistId) {
      const actCell = row.querySelector('.track-col-actions');
      if (actCell) {
        const rmBtn = document.createElement('button');
        rmBtn.className = 'track-action-btn remove-from-pl-btn';
        rmBtn.title = 'Remove from playlist';
        rmBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        rmBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          removeTrackFromLocalPlaylist(state.activePlaylistId, track);
        });
        actCell.prepend(rmBtn);
      }
    }
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
}

function filterCurrentPlaylist() {
  const plSearchInput = document.getElementById('detail-playlist-search-input');
  const plSearchClear = document.getElementById('detail-playlist-search-clear');
  const plFilterCount = document.getElementById('detail-playlist-filter-count');
  const tracks = state.currentPlaylistTracks || [];
  const isLocal = !!state.isCurrentPlaylistLocal;

  const query = plSearchInput ? (plSearchInput.value || '').trim().toLowerCase() : '';

  if (!query) {
    state.currentFilteredPlaylistTracks = null;
    if (plSearchClear) plSearchClear.style.display = 'none';
    if (plFilterCount) plFilterCount.style.display = 'none';
    renderPlaylistTrackList(tracks, isLocal);
    return;
  }

  if (plSearchClear) plSearchClear.style.display = 'inline-flex';
  const filtered = tracks.filter(t => {
    const title = (t.title || '').toLowerCase();
    const artist = (t.artist || '').toLowerCase();
    const album = (t.album || '').toLowerCase();
    return title.includes(query) || artist.includes(query) || album.includes(query);
  });

  state.currentFilteredPlaylistTracks = filtered;

  if (plFilterCount) {
    plFilterCount.style.display = 'inline-block';
    plFilterCount.textContent = `${filtered.length} of ${tracks.length} tracks`;
  }

  renderPlaylistTrackList(filtered, isLocal, tracks.length);
}

function setupPlaylistFilter() {
  const plSearchInput = document.getElementById('detail-playlist-search-input');
  const plSearchClear = document.getElementById('detail-playlist-search-clear');

  if (!plSearchInput) return;

  plSearchInput.addEventListener('input', () => {
    filterCurrentPlaylist();
  });

  if (plSearchClear) {
    plSearchClear.addEventListener('click', () => {
      plSearchInput.value = '';
      plSearchInput.focus();
      filterCurrentPlaylist();
    });
  }

  plSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      plSearchInput.value = '';
      filterCurrentPlaylist();
      plSearchInput.blur();
    }
  });
}
setupPlaylistFilter();

function openPlaylistDetail(playlist, isLocal = false, skipBackgroundSync = false) {
  const isDifferentPlaylist = state.activePlaylistId !== playlist.id;
  state.activePlaylistId = playlist.id;
  state.currentPlaylistTracks = playlist.tracks || [];
  state.currentPlaylistTitle = playlist.title || 'Playlist';
  state.isCurrentPlaylistLocal = !!isLocal;
  navigateTo('playlist-detail');

  document.getElementById('detail-playlist-title').textContent = playlist.title;
  document.getElementById('detail-playlist-count').textContent = `${playlist.tracks?.length || 0} tracks`;
  document.getElementById('detail-playlist-thumb').src = upgradeCover(playlist.thumbnail, 800);

  const importBtn = document.getElementById('detail-playlist-import-btn');
  if (importBtn) importBtn.style.display = 'none';

  const syncBadge = document.getElementById('detail-playlist-sync-badge');
  const pushYtBtn = document.getElementById('detail-playlist-push-yt-btn');
  const syncBtn = document.getElementById('detail-playlist-sync-btn');
  const syncLabel = document.getElementById('detail-playlist-sync-label');

  if (isLocal && playlist.remoteId) {
    if (pushYtBtn) pushYtBtn.style.display = 'none';
    if (syncBtn) {
      syncBtn.style.display = 'inline-flex';
      const autoOn = playlist.autoSync !== false;
      if (syncLabel) syncLabel.textContent = autoOn ? 'Real-Time Sync: ON' : 'Real-Time Sync: OFF';
      syncBtn.onclick = async () => {
        const pls = getLocalPlaylists();
        const target = pls.find(p => p.id === playlist.id);
        if (!target) return;
        target.autoSync = target.autoSync === false;
        saveLocalPlaylists(pls);
        if (target.autoSync) {
          if (syncLabel) syncLabel.textContent = 'Syncing...';
          await syncLinkedPlaylist(target.id, { quiet: false });
        }
        const updated = getLocalPlaylists().find(p => p.id === playlist.id) || target;
        openPlaylistDetail(updated, true, true);
      };
    }
    if (syncBadge) {
      const autoOn = playlist.autoSync !== false;
      syncBadge.style.display = 'inline-flex';
      syncBadge.className = `sync-status-pill ${autoOn ? 'synced' : ''}`;
      syncBadge.innerHTML = autoOn ? `${ICON_CHECK_SVG} Two-Way Cloud Sync Active` : 'Cloud Sync Paused';
    }
    if (!skipBackgroundSync && playlist.autoSync !== false) {
      syncLinkedPlaylist(playlist.id, { quiet: true });
    }
  } else if (isLocal) {
    if (syncBtn) syncBtn.style.display = 'none';
    if (syncBadge) syncBadge.style.display = 'none';
    if (pushYtBtn) {
      pushYtBtn.style.display = 'inline-flex';
      pushYtBtn.disabled = false;
      pushYtBtn.innerHTML = `${ICON_CLOUD_SVG} Sync with YT Music`;
      pushYtBtn.onclick = () => pushPlaylistToYtMusic(playlist.id, pushYtBtn);
    }
  } else {
    if (syncBtn) syncBtn.style.display = 'none';
    if (pushYtBtn) pushYtBtn.style.display = 'none';
    if (syncBadge) syncBadge.style.display = 'none';
  }

  const deleteBtn = document.getElementById('detail-playlist-delete-btn');
  if (deleteBtn) {
    deleteBtn.style.display = isLocal ? 'inline-flex' : 'none';
    deleteBtn.onclick = () => {
      if (confirm(`Delete playlist "${playlist.title}" from OpenTune?`)) {
        const pls = getLocalPlaylists().filter(p => p.id !== playlist.id);
        saveLocalPlaylists(pls);
        navigateTo('playlists');
      }
    };
  }

  const playBtn = document.getElementById('detail-playlist-play-btn');
  if (playBtn) {
    playBtn.onclick = () => {
      const activeTracks = state.currentFilteredPlaylistTracks || playlist.tracks;
      if (activeTracks && activeTracks.length > 0) {
        playTrack(activeTracks[0], activeTracks);
      }
    };
  }

  const shuffleBtn = document.getElementById('detail-playlist-shuffle-btn');
  if (shuffleBtn) {
    shuffleBtn.onclick = () => {
      const activeTracks = state.currentFilteredPlaylistTracks || playlist.tracks;
      if (activeTracks && activeTracks.length > 0) {
        const shuffled = fisherYatesShuffle(activeTracks);
        state.isShuffle = true;
        updateShuffleRepeatUI();
        playTrack(shuffled[0], shuffled, 0);
      }
    };
  }

  const dlBtn = document.getElementById('detail-playlist-download-btn');
  const dlStatus = document.getElementById('detail-playlist-download-status');
  if (dlBtn) {
    dlBtn.onclick = () => {
      const activeTracks = state.currentFilteredPlaylistTracks || playlist.tracks;
      if (activeTracks && activeTracks.length > 0) {
        startBatchDownload(playlist.title, activeTracks, dlBtn, dlStatus);
      }
    };
  }

  const qBtn = document.getElementById('detail-playlist-queue-btn');
  if (qBtn) {
    qBtn.onclick = () => {
      const activeTracks = state.currentFilteredPlaylistTracks || playlist.tracks;
      appendTracksToQueue(activeTracks || [], 'playlist tracks');
    };
  }

  const radioBtn = document.getElementById('detail-playlist-radio-btn');
  if (radioBtn) {
    radioBtn.onclick = () => {
      const activeTracks = state.currentFilteredPlaylistTracks || playlist.tracks;
      if (activeTracks && activeTracks.length > 0) startRadioFromTrack(activeTracks[0]);
    };
  }

  const plSearchInput = document.getElementById('detail-playlist-search-input');
  if (isDifferentPlaylist && plSearchInput) {
    plSearchInput.value = '';
  }

  filterCurrentPlaylist();
}

document.getElementById('btn-back-to-playlists')?.addEventListener('click', () => {
  navigateTo('playlists');
});

// Create Playlist Modal
const createPlModal = document.getElementById('create-playlist-modal');
document.getElementById('btn-create-playlist-open')?.addEventListener('click', () => {
  if (createPlModal) createPlModal.style.display = 'flex';
});

document.getElementById('create-playlist-modal-close')?.addEventListener('click', () => {
  if (createPlModal) createPlModal.style.display = 'none';
});

document.getElementById('create-playlist-cancel-btn')?.addEventListener('click', () => {
  if (createPlModal) createPlModal.style.display = 'none';
});

document.getElementById('create-playlist-confirm-btn')?.addEventListener('click', () => {
  const nameInput = document.getElementById('create-playlist-name');
  const descInput = document.getElementById('create-playlist-desc');
  const title = (nameInput?.value || '').trim();
  if (!title) {
    alert('Please enter a playlist name.');
    return;
  }

  const newPl = {
    id: `pl_${Date.now()}`,
    title,
    description: (descInput?.value || '').trim(),
    thumbnail: 'assets/icon.png',
    tracks: [],
    createdAt: Date.now()
  };

  const pls = getLocalPlaylists();
  pls.unshift(newPl);
  saveLocalPlaylists(pls);

  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  if (createPlModal) createPlModal.style.display = 'none';

  loadPlaylists();
});

// Import YouTube Playlist Modal
const importPlModal = document.getElementById('import-playlist-modal');
const importPlInput = document.getElementById('import-playlist-input');
const importPlStatus = document.getElementById('import-playlist-status');

document.getElementById('btn-import-yt-playlist-open')?.addEventListener('click', () => {
  if (importPlModal) {
    importPlModal.style.display = 'flex';
    if (importPlInput) {
      importPlInput.value = '';
      importPlInput.focus();
    }
    if (importPlStatus) importPlStatus.style.display = 'none';
  }
});

document.getElementById('import-playlist-modal-close')?.addEventListener('click', () => {
  if (importPlModal) importPlModal.style.display = 'none';
});

document.getElementById('import-playlist-cancel-btn')?.addEventListener('click', () => {
  if (importPlModal) importPlModal.style.display = 'none';
});

document.getElementById('btn-sync-yt-playlists')?.addEventListener('click', async () => {
  await syncLibrary();
  loadPlaylists();
});

document.getElementById('import-playlist-confirm-btn')?.addEventListener('click', async () => {
  const raw = (importPlInput?.value || '').trim();
  if (!raw) {
    alert('Please enter a YouTube playlist URL or ID.');
    return;
  }

  let playlistId = raw;
  if (raw.includes('list=')) {
    try {
      const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      playlistId = u.searchParams.get('list') || raw;
    } catch (_) {
      const match = raw.match(/list=([a-zA-Z0-9_-]+)/);
      if (match) playlistId = match[1];
    }
  }

  if (importPlStatus) {
    importPlStatus.style.display = 'block';
    importPlStatus.style.color = 'var(--text-secondary)';
    importPlStatus.innerHTML = '<span class="spinner" style="width:16px;height:16px;display:inline-block;margin-right:8px;vertical-align:middle;"></span> Fetching playlist details from YouTube Music...';
  }

  try {
    const pl = await window.api.getPlaylist(playlistId);
    if (!pl || !pl.tracks || pl.tracks.length === 0) {
      if (importPlStatus) {
        importPlStatus.style.color = '#ff5252';
        importPlStatus.textContent = 'Could not find tracks for this playlist ID. Please verify the link or ID.';
      }
      return;
    }

    const cleanRemote = String(pl.id || playlistId || '').replace(/^VL/, '');
    const newPl = {
      id: `yt_${cleanRemote}_${Date.now()}`,
      remoteId: cleanRemote,
      autoSync: true,
      lastSyncedAt: Date.now(),
      syncedIds: pl.tracks.map(t => t.id),
      title: pl.title || 'Imported Playlist',
      description: pl.description || `Imported from YouTube Music (${pl.author || 'YouTube'})`,
      thumbnail: pl.thumbnail || (pl.tracks[0]?.thumbnail || 'assets/icon.png'),
      tracks: pl.tracks,
      author: pl.author,
      isImported: true,
      createdAt: Date.now()
    };

    const pls = getLocalPlaylists();
    pls.unshift(newPl);
    saveLocalPlaylists(pls);

    if (importPlModal) importPlModal.style.display = 'none';
    loadPlaylists();
    openPlaylistDetail(newPl, true);
  } catch (err) {
    if (importPlStatus) {
      importPlStatus.style.color = '#ff5252';
      importPlStatus.textContent = `Import failed: ${err.message}`;
    }
  }
});

// Add to Playlist Modal
function openAddToPlaylistModal(track) {
  const modal = document.getElementById('add-to-playlist-modal');
  const list = document.getElementById('add-to-playlist-list');
  const titleLabel = document.getElementById('add-to-playlist-song-title');
  if (!modal || !list) return;

  if (titleLabel) titleLabel.textContent = `Add "${track.title}" to:`;
  list.innerHTML = '';

  const localPls = getLocalPlaylists();
  if (localPls.length === 0) {
    list.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted); padding:10px;">No playlists created yet. Create one from the Playlists tab!</p>';
  } else {
    localPls.forEach(pl => {
      const btn = document.createElement('button');
      btn.className = 'btn-subtle';
      btn.style.width = '100%';
      btn.style.justifyContent = 'flex-start';
      btn.style.padding = '10px 14px';
      btn.textContent = pl.title;
      btn.addEventListener('click', () => {
        pl.tracks = pl.tracks || [];
        if (!pl.tracks.some(t => t.id === track.id)) {
          pl.tracks.push(track);
          if (pl.tracks.length === 1) pl.thumbnail = track.thumbnail;
          saveLocalPlaylists(localPls);
          if (pl.remoteId && pl.autoSync !== false) {
            window.api.addToYtPlaylist({
              playlistId: pl.remoteId,
              videoIds: [track.id]
            }).then((res) => {
              if (res?.success) {
                const updatedPls = getLocalPlaylists();
                const targetPl = updatedPls.find(p => p.id === pl.id);
                if (targetPl) {
                  targetPl.syncedIds = [...new Set([...(targetPl.syncedIds || []), track.id])];
                  targetPl.lastSyncedAt = Date.now();
                  saveLocalPlaylists(updatedPls);
                }
              }
            }).catch(() => {});
          }
        }
        modal.style.display = 'none';
      });
      list.appendChild(btn);
    });
  }

  modal.style.display = 'flex';
}

document.getElementById('add-to-playlist-close')?.addEventListener('click', () => {
  document.getElementById('add-to-playlist-modal').style.display = 'none';
});

// Fullscreen Now Playing Overlay Logic
const npFullscreen = document.getElementById('now-playing-fullscreen');
const btnFullscreen = document.getElementById('player-fullscreen-btn');
const btnCollapseNp = document.getElementById('btn-collapse-now-playing');
const npTabCover = document.getElementById('np-tab-cover');
const npTabLyrics = document.getElementById('np-tab-lyrics');
const npTabQueue = document.getElementById('np-tab-queue');
const npCoverContainer = document.getElementById('np-cover-container');
const npLyricsContainer = document.getElementById('np-lyrics-container');
const npQueueContainer = document.getElementById('np-queue-container');
let lastNpTrackId = null;

let isVideoMode = false;
let videoCurrentTime = 0;
let videoDuration = 0;
let videoTickerInterval = null;
let lastVideoFramePingTs = 0;

function getVideoEmbedUrl(videoId, startTime = 0) {
  const start = Math.max(0, Math.floor(startTime));
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&start=${start}&enablejsapi=1&origin=https://www.youtube.com&widget_referrer=https://www.youtube.com&rel=0`;
}

function sendVideoCommand(func, args = []) {
  const videoFrame = document.getElementById('np-video-frame');
  if (videoFrame && videoFrame.contentWindow) {
    try {
      videoFrame.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: func,
        args: Array.isArray(args) ? args : [args]
      }), '*');
    } catch (e) {
      console.warn('sendVideoCommand warning:', e);
    }
  }
}

function showVideoIndicator(action) {
  const indicator = document.getElementById('np-video-play-indicator');
  const playIcon = document.getElementById('np-video-indicator-play');
  const pauseIcon = document.getElementById('np-video-indicator-pause');
  if (!indicator) return;

  if (action === 'play') {
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
  } else {
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'block';
  }
  indicator.classList.remove('show');
  void indicator.offsetWidth;
  indicator.classList.add('show');
  setTimeout(() => {
    indicator.classList.remove('show');
  }, 650);
}

function toggleVideoPlayPause() {
  if (!state.currentTrack) return;
  if (state.isPlaying) {
    sendVideoCommand('pauseVideo');
    state.isPlaying = false;
    stopVideoPlaybackTicker();
    updatePlayPauseUI();
    showVideoIndicator('pause');
  } else {
    sendVideoCommand('playVideo');
    state.isPlaying = true;
    startVideoPlaybackTicker();
    updatePlayPauseUI();
    showVideoIndicator('play');
  }
}

function startVideoPlaybackTicker() {
  stopVideoPlaybackTicker();
  videoTickerInterval = setInterval(() => {
    if (!isVideoMode || !state.isPlaying) {
      stopVideoPlaybackTicker();
      return;
    }
    const dur = videoDuration > 0 ? videoDuration : (parseDurationToSeconds(state.currentTrack?.duration) || 180);
    videoCurrentTime = Math.min(dur, (videoCurrentTime || 0) + 0.25);
    refreshVisualFrame(true);

    const now = Date.now();
    if (now - lastVideoFramePingTs > 2500) {
      lastVideoFramePingTs = now;
      sendVideoCommand('getCurrentTime');
    }
  }, 250);
}

function stopVideoPlaybackTicker() {
  if (videoTickerInterval) {
    clearInterval(videoTickerInterval);
    videoTickerInterval = null;
  }
}

// Global Message Listener for YouTube IFrame API communication
window.addEventListener('message', (event) => {
  if (!isVideoMode) return;
  let data = event.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { return; }
  }
  if (!data || typeof data !== 'object') return;

  if (data.event === 'infoDelivery' && data.info) {
    if (typeof data.info.currentTime === 'number') {
      videoCurrentTime = data.info.currentTime;
      if (typeof data.info.duration === 'number' && data.info.duration > 0) {
        videoDuration = data.info.duration;
      }
      refreshVisualFrame(true);
    }
    if (typeof data.info.playerState === 'number') {
      // 1 = PLAYING, 2 = PAUSED, 0 = ENDED, 3 = BUFFERING
      if (data.info.playerState === 1 && !state.isPlaying) {
        state.isPlaying = true;
        startVideoPlaybackTicker();
        updatePlayPauseUI();
      } else if (data.info.playerState === 2 && state.isPlaying) {
        state.isPlaying = false;
        stopVideoPlaybackTicker();
        updatePlayPauseUI();
      } else if (data.info.playerState === 0) {
        stopVideoPlaybackTicker();
        if (state.repeatMode === 'one') {
          videoCurrentTime = 0;
          sendVideoCommand('seekTo', [0, true]);
          sendVideoCommand('playVideo');
          state.isPlaying = true;
          startVideoPlaybackTicker();
          updatePlayPauseUI();
        } else {
          btnNext.click();
        }
      }
    }
  } else if (data.event === 'initialDelivery') {
    sendVideoCommand('setVolume', [Math.round((state.isMuted ? 0 : state.volume) * 100)]);
    if (state.isMuted) sendVideoCommand('mute');
    if (currentPlaybackSpeed !== 1.0) sendVideoCommand('setPlaybackRate', [currentPlaybackSpeed]);
    if (state.isPlaying) sendVideoCommand('playVideo');
  } else if (data.event === 'onError' || (data.info && data.info.errorCode)) {
    console.warn('Video embed restricted or failed:', data);
    showToast('Video restricted by rights holder — playing audio seamlessly 🎵');
    setSongVideoMode('song');
  }
});

function setNowPlayingTab(tabName) {
  const activeTab = tabName || 'cover';
  npTabCover?.classList.toggle('active', activeTab === 'cover');
  npTabLyrics?.classList.toggle('active', activeTab === 'lyrics');
  npTabQueue?.classList.toggle('active', activeTab === 'queue');

  const npVideoContainer = document.getElementById('np-video-container');
  const npModeSwitcher = document.getElementById('np-mode-switcher');

  if (activeTab === 'cover') {
    if (npModeSwitcher) npModeSwitcher.style.display = 'inline-flex';
    if (npCoverContainer) npCoverContainer.style.display = isVideoMode ? 'none' : 'block';
    if (npVideoContainer) npVideoContainer.style.display = isVideoMode ? 'block' : 'none';
  } else {
    if (npModeSwitcher) npModeSwitcher.style.display = 'none';
    if (npCoverContainer) npCoverContainer.style.display = 'none';
    if (npVideoContainer) npVideoContainer.style.display = 'none';
  }

  if (npLyricsContainer) npLyricsContainer.style.display = activeTab === 'lyrics' ? 'block' : 'none';
  if (npQueueContainer) npQueueContainer.style.display = activeTab === 'queue' ? 'flex' : 'none';

  const btnSearch = document.getElementById('np-btn-search-lyrics');
  const btnEdit = document.getElementById('np-btn-edit-lyrics');
  const showLyricsActions = activeTab === 'lyrics';
  if (btnSearch) btnSearch.style.display = showLyricsActions ? 'inline-flex' : 'none';
  if (btnEdit) btnEdit.style.display = showLyricsActions ? 'inline-flex' : 'none';

  if (activeTab === 'queue') {
    renderNowPlayingQueue();
  } else if (activeTab === 'lyrics') {
    requestAnimationFrame(() => {
      refreshLyricsViewsNow(true);
      setTimeout(() => refreshLyricsViewsNow(true), 80);
    });
  }
}

function setSongVideoMode(mode) {
  const songBtn = document.getElementById('np-mode-song-btn');
  const videoBtn = document.getElementById('np-mode-video-btn');
  const coverCont = document.getElementById('np-cover-container');
  const videoCont = document.getElementById('np-video-container');
  const videoFrame = document.getElementById('np-video-frame');

  if (mode === 'video') {
    if (!state.currentTrack?.id) {
      showToast('Select a song first to view video');
      return;
    }
    isVideoMode = true;
    songBtn?.classList.remove('active');
    videoBtn?.classList.add('active');
    if (coverCont) coverCont.style.display = 'none';
    if (videoCont) videoCont.style.display = 'flex';

    const curTime = Math.max(0, Math.floor(audio.currentTime || 0));
    try {
      audio.pause();
      audio.src = '';
    } catch (_) {}
    videoCurrentTime = curTime;
    videoDuration = parseDurationToSeconds(state.currentTrack.duration) || 0;
    state.isPlaying = true;
    updatePlayPauseUI();

    const videoId = state.currentTrack.id;
    if (videoFrame) {
      videoFrame.src = getVideoEmbedUrl(videoId, curTime);
    }
    startVideoPlaybackTicker();
    showToast('Switched to Video mode 🎬');
  } else {
    isVideoMode = false;
    songBtn?.classList.add('active');
    videoBtn?.classList.remove('active');
    if (videoCont) videoCont.style.display = 'none';
    if (coverCont) coverCont.style.display = 'block';

    sendVideoCommand('pauseVideo');
    stopVideoPlaybackTicker();

    const resumeTime = videoCurrentTime > 0 ? videoCurrentTime : (audio.currentTime || 0);
    if (videoFrame) {
      videoFrame.src = '';
    }
    if (state.currentTrack) {
      playTrack(state.currentTrack, null, state.queueIndex, {
        startTime: resumeTime,
        preserveShuffleForward: true
      });
    }
    showToast('Switched to Song mode 🎵');
  }
}

document.getElementById('np-mode-song-btn')?.addEventListener('click', () => setSongVideoMode('song'));
document.getElementById('np-mode-video-btn')?.addEventListener('click', () => setSongVideoMode('video'));
document.getElementById('np-video-switch-song-btn')?.addEventListener('click', () => setSongVideoMode('song'));
document.getElementById('np-video-click-overlay')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleVideoPlayPause();
});
document.getElementById('np-video-open-yt-btn')?.addEventListener('click', () => {
  if (state.currentTrack?.id) {
    window.api.openExternalUrl(`https://www.youtube.com/watch?v=${state.currentTrack.id}`);
  }
});

let npCloseTimer = null;

function openNowPlaying() {
  if (!npFullscreen) return;
  if (npCloseTimer) {
    clearTimeout(npCloseTimer);
    npCloseTimer = null;
  }
  document.body.classList.add('now-playing-open');
  const bottomBar = document.querySelector('.player-bar');
  if (bottomBar) bottomBar.style.display = 'none';
  npFullscreen.style.display = 'flex';
  void npFullscreen.offsetWidth;
  npFullscreen.classList.add('open');
  syncNowPlayingUI();
  requestAnimationFrame(() => {
    invalidateWaveMetrics();
    refreshVisualFrame(true);
    refreshLyricsViewsNow(true, true);
  });
}

function closeNowPlaying() {
  if (!npFullscreen) return;
  document.body.classList.remove('now-playing-open');
  const bottomBar = document.querySelector('.player-bar');
  if (bottomBar) bottomBar.style.display = '';
  npFullscreen.classList.remove('open');
  if (npCloseTimer) clearTimeout(npCloseTimer);
  npCloseTimer = setTimeout(() => {
    if (!npFullscreen.classList.contains('open')) {
      npFullscreen.style.display = 'none';
    }
    npCloseTimer = null;
  }, 380);
}

btnFullscreen?.addEventListener('click', () => {
  if (isNowPlayingOpen()) closeNowPlaying();
  else openNowPlaying();
});
document.getElementById('player-thumb-trigger')?.addEventListener('click', openNowPlaying);
document.getElementById('player-thumb')?.addEventListener('click', (e) => {
  e.stopPropagation();
  openNowPlaying();
});
document.querySelector('.player-meta')?.addEventListener('click', (e) => {
  if (settings.clickBarToExpand === false) return;
  if (e.target.closest('button, a, .clickable-artist-link')) return;
  openNowPlaying();
});
btnCollapseNp?.addEventListener('click', closeNowPlaying);
npFullscreen?.querySelector('.np-sheet-grabber')?.addEventListener('click', closeNowPlaying);

npTabCover?.addEventListener('click', () => setNowPlayingTab('cover'));
npTabLyrics?.addEventListener('click', () => setNowPlayingTab('lyrics'));
npTabQueue?.addEventListener('click', () => setNowPlayingTab('queue'));

document.getElementById('np-open-queue-drawer')?.addEventListener('click', () => {
  closeNowPlaying();
  openDrawer('queue');
});

function syncNowPlayingUI() {
  if (!state.currentTrack) return;
  const track = state.currentTrack;
  const coverImg = document.getElementById('np-cover-img');
  const ambientBg = document.getElementById('np-ambient-bg');
  const trackTitle = document.getElementById('np-track-title');
  const trackArtist = document.getElementById('np-track-artist');
  const trackAlbum = document.getElementById('np-track-album');
  const trackYear = document.getElementById('np-track-year');
  const trackDurationPill = document.getElementById('np-track-duration-pill');

  const hiResThumb = upgradeCover(track.thumbnail, 800);
  const needsYtCrop = /i\.ytimg\.com\/vi\/[^/]+\/(hqdefault|sddefault|0)\.jpg/i.test(hiResThumb);
  if (coverImg) {
    coverImg.classList.toggle('yt-crop-letterbox', needsYtCrop);
    if (track.id && track.id !== lastNpTrackId) {
      lastNpTrackId = track.id;
      coverImg.classList.add('art-switching');
      setTimeout(() => {
        coverImg.src = hiResThumb;
        coverImg.classList.remove('art-switching');
      }, 110);
    } else {
      coverImg.src = hiResThumb;
    }
  }
  const npTotal = document.getElementById('np-time-total');
  if (npTotal && !(audio.duration > 0)) {
    npTotal.textContent = track.duration || '0:00';
  }
  if (ambientBg) {
    ambientBg.style.backgroundImage = hiResThumb && hiResThumb !== 'assets/icon.png' ? `url("${hiResThumb}")` : 'none';
  }

  if (trackTitle) trackTitle.textContent = track.title || 'OpenTune';

  if (trackArtist) {
    trackArtist.innerHTML = renderArtistLinksHtml(track);
    bindArtistLinksInContainer(trackArtist, track, () => closeNowPlaying());
  }

  if (trackAlbum) {
    if (track.album) {
      trackAlbum.style.display = 'inline-flex';
      trackAlbum.textContent = track.album;
      trackAlbum.title = `Open album: ${track.album}`;
      trackAlbum.onclick = () => {
        closeNowPlaying();
        navigateToAlbumFromTrack(track);
      };
    } else {
      trackAlbum.style.display = 'none';
      trackAlbum.onclick = null;
    }
  }

  if (trackYear) {
    if (track.year) {
      trackYear.style.display = 'inline-flex';
      trackYear.textContent = track.year;
    } else {
      trackYear.style.display = 'none';
    }
  }

  if (trackDurationPill) {
    if (track.duration) {
      trackDurationPill.style.display = 'inline-flex';
      trackDurationPill.textContent = track.duration;
    } else {
      trackDurationPill.style.display = 'none';
    }
  }

  const formatPill = document.getElementById('np-track-format-pill');
  if (formatPill) {
    const qualMap = { high: 'M4A • 256 kbps', standard: 'OPUS • 160 kbps', low: 'AAC • 64 kbps' };
    formatPill.textContent = qualMap[settings.audioQuality] || 'OPUS • 160 kbps';
    formatPill.onclick = () => openSongInfoModal();
  }

  if (isVideoMode && track.id) {
    const videoFrame = document.getElementById('np-video-frame');
    if (videoFrame && !videoFrame.src.includes(track.id)) {
      videoCurrentTime = 0;
      videoDuration = parseDurationToSeconds(track.duration) || 0;
      videoFrame.src = getVideoEmbedUrl(track.id, 0);
      state.isPlaying = true;
      startVideoPlaybackTicker();
      updatePlayPauseUI();
      try { audio.pause(); } catch (_) {}
    }
  }

  if (typeof syncAodOverlay === 'function') syncAodOverlay();

  updatePlayPauseUI();
  updateLikeButtonUI();
  updateShuffleRepeatUI();
  updateNpDownloadButtonState(track.id);
  if (npQueueContainer && npQueueContainer.style.display !== 'none') {
    renderNowPlayingQueue();
  }
}

document.getElementById('np-play-pause-btn')?.addEventListener('click', () => btnPlayPause.click());
document.getElementById('np-prev-btn')?.addEventListener('click', () => btnPrev.click());
document.getElementById('np-next-btn')?.addEventListener('click', () => btnNext.click());
document.getElementById('np-shuffle-btn')?.addEventListener('click', () => btnShuffle.click());
document.getElementById('np-repeat-btn')?.addEventListener('click', () => btnRepeat.click());
document.getElementById('np-download-btn')?.addEventListener('click', (e) => {
  if (!state.currentTrack) return;
  downloadTrackWithFeedback(state.currentTrack, e.currentTarget);
});
document.getElementById('np-add-playlist-btn')?.addEventListener('click', () => {
  if (!state.currentTrack) return;
  openAddToPlaylistModal(state.currentTrack);
});
document.getElementById('np-more-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!state.currentTrack) return;
  showContextMenu(e, state.currentTrack);
});
document.getElementById('np-quick-queue-btn')?.addEventListener('click', () => setNowPlayingTab('queue'));
document.getElementById('np-quick-lyrics-btn')?.addEventListener('click', () => setNowPlayingTab('lyrics'));
document.getElementById('np-quick-radio-btn')?.addEventListener('click', () => {
  if (state.currentTrack) startRadioFromTrack(state.currentTrack);
});

// Comments Modal (YouTube Comments & User Commenting)
const commentsModal = document.getElementById('comments-modal');
const commentsModalClose = document.getElementById('comments-modal-close');
const commentsList = document.getElementById('comments-list');
const commentsCountBadge = document.getElementById('comments-count-badge');
const commentInput = document.getElementById('comment-input');
const commentPostBtn = document.getElementById('comment-post-btn');
const commentStatusMsg = document.getElementById('comment-status-msg');

async function openCommentsModal() {
  if (!state.currentTrack?.id) {
    showToast('Select a song to view comments');
    return;
  }
  if (commentsModal) commentsModal.style.display = 'flex';
  if (commentsList) commentsList.innerHTML = '<div class="comments-loading">Loading comments...</div>';
  if (commentStatusMsg) {
    commentStatusMsg.textContent = '';
    commentStatusMsg.style.color = '';
  }
  if (commentInput) commentInput.value = '';

  try {
    const res = await window.api.getTrackComments(state.currentTrack.id);
    if (!res || !Array.isArray(res.comments) || res.comments.length === 0) {
      if (commentsList) commentsList.innerHTML = '<div class="comments-empty">No comments found for this song.</div>';
      if (commentsCountBadge) commentsCountBadge.textContent = '0';
      return;
    }

    if (commentsCountBadge) commentsCountBadge.textContent = res.totalCount || String(res.comments.length);
    renderCommentsList(res.comments);
  } catch (err) {
    if (commentsList) commentsList.innerHTML = `<div class="comments-empty">Could not load comments: ${escapeHtml(err.message)}</div>`;
  }
}

function renderCommentsList(comments) {
  if (!commentsList) return;
  commentsList.innerHTML = comments.map(c => `
    <div class="comment-item">
      <img class="comment-avatar" src="${escapeHtml(c.authorAvatar || 'assets/icon.png')}" alt="${escapeHtml(c.author)}" onerror="this.src='assets/icon.png'">
      <div class="comment-body">
        <div class="comment-header-line">
          <span class="comment-author">${escapeHtml(c.author)}</span>
          ${c.isPinned ? '<span class="comment-pinned-badge">Pinned</span>' : ''}
          <span class="comment-time">${escapeHtml(c.publishedTime || '')}</span>
        </div>
        <div class="comment-text">${escapeHtml(c.text)}</div>
        ${c.likeCount && c.likeCount !== '0' ? `
          <div class="comment-footer-line">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
            <span>${escapeHtml(c.likeCount)}</span>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function postCommentAction() {
  const text = commentInput?.value?.trim();
  if (!text) {
    if (commentStatusMsg) {
      commentStatusMsg.textContent = 'Please enter a comment';
      commentStatusMsg.style.color = '#e57373';
    }
    return;
  }
  if (!state.currentTrack?.id) return;

  if (commentPostBtn) commentPostBtn.disabled = true;
  if (commentStatusMsg) {
    commentStatusMsg.textContent = 'Posting comment...';
    commentStatusMsg.style.color = 'var(--text-muted)';
  }

  try {
    const res = await window.api.postTrackComment(state.currentTrack.id, text);
    if (res && res.success) {
      if (commentInput) commentInput.value = '';
      if (commentStatusMsg) {
        commentStatusMsg.textContent = 'Comment posted successfully!';
        commentStatusMsg.style.color = '#81c784';
      }
      showToast('Comment posted! 🎉');
      const newItem = document.createElement('div');
      newItem.className = 'comment-item';
      newItem.innerHTML = `
        <img class="comment-avatar" src="assets/icon.png" alt="You">
        <div class="comment-body">
          <div class="comment-header-line">
            <span class="comment-author">You</span>
            <span class="comment-time">Just now</span>
          </div>
          <div class="comment-text">${escapeHtml(text)}</div>
        </div>
      `;
      commentsList?.prepend(newItem);
    } else {
      throw new Error(res?.error || 'Failed to post comment');
    }
  } catch (err) {
    if (commentStatusMsg) {
      commentStatusMsg.textContent = err.message || 'Login required to post comments';
      commentStatusMsg.style.color = '#e57373';
    }
  } finally {
    if (commentPostBtn) commentPostBtn.disabled = false;
  }
}

document.getElementById('np-comments-btn')?.addEventListener('click', openCommentsModal);
document.getElementById('np-quick-comments-btn')?.addEventListener('click', openCommentsModal);
commentsModalClose?.addEventListener('click', () => {
  if (commentsModal) commentsModal.style.display = 'none';
});
commentsModal?.addEventListener('click', (e) => {
  if (e.target === commentsModal) commentsModal.style.display = 'none';
});
commentPostBtn?.addEventListener('click', postCommentAction);

// Song Info & Stats Modal (Likes, Dislikes, Rating, Views, Release Date)
const songInfoModal = document.getElementById('song-info-modal');
const songInfoModalClose = document.getElementById('song-info-modal-close');

function formatSongDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '--';
  const clean = dateStr.trim();
  if (/^\d{4}$/.test(clean)) return clean;
  try {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
  } catch (_) {}
  return clean;
}

function formatCompactNumber(num) {
  const n = Number(num);
  if (isNaN(n) || n === 0) return num || '--';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

async function openSongInfoModal() {
  if (!state.currentTrack?.id) {
    showToast('Select a song to view stats & info');
    return;
  }
  const track = state.currentTrack;
  if (songInfoModal) songInfoModal.style.display = 'flex';

  const titleEl = document.getElementById('info-track-title');
  const artistEl = document.getElementById('info-track-artist');
  const coverEl = document.getElementById('info-track-cover');
  const viewsEl = document.getElementById('info-stat-views');
  const viewsBadge = document.getElementById('info-stat-views-badge');
  const likesEl = document.getElementById('info-stat-likes');
  const likesBadge = document.getElementById('info-stat-likes-badge');
  const dislikesEl = document.getElementById('info-stat-dislikes');
  const dislikesBadge = document.getElementById('info-stat-dislikes-badge');
  const ratingEl = document.getElementById('info-stat-rating');
  const ratingBadge = document.getElementById('info-stat-rating-badge');
  const ratingPctEl = document.getElementById('info-rating-pct');
  const ratingFillEl = document.getElementById('info-rating-fill');
  const dateEl = document.getElementById('info-stat-date');
  const formatEl = document.getElementById('info-stat-format');
  const durationEl = document.getElementById('info-stat-duration');
  const descEl = document.getElementById('info-stat-description');
  const qualityBadge = document.getElementById('info-badge-quality');
  const statusBadge = document.getElementById('info-badge-status');

  if (titleEl) titleEl.textContent = track.title || 'Unknown Title';
  if (artistEl) artistEl.textContent = cleanArtistName(track.artist || 'Unknown Artist');

  if (coverEl) {
    const coverSrc = upgradeCover(track.thumbnail, 400);
    coverEl.src = coverSrc;
    const needsCrop = /i\.ytimg\.com\/vi\/[^/]+\/(hqdefault|sddefault|0)\.jpg/i.test(coverSrc) || (track.thumbnail && track.thumbnail.includes('ytimg.com'));
    coverEl.classList.toggle('yt-crop-letterbox', Boolean(needsCrop));
  }

  const qualMap = { high: 'M4A • 256 kbps (High Fidelity)', standard: 'OPUS • 160 kbps (Standard)', low: 'AAC • 64 kbps (Data Saver)' };
  if (formatEl) formatEl.textContent = qualMap[settings.audioQuality] || 'OPUS • 160 kbps (Standard)';
  if (durationEl) durationEl.textContent = track.duration || formatTime(audio.duration || 0);

  if (qualityBadge) {
    qualityBadge.textContent = settings.audioQuality === 'high' ? 'High-Res Audio • 256k' : 'Standard Stream';
  }
  if (statusBadge) {
    statusBadge.textContent = 'Official Release';
  }

  if (viewsEl) viewsEl.textContent = 'Loading...';
  if (viewsBadge) viewsBadge.textContent = '';
  if (likesEl) likesEl.textContent = 'Loading...';
  if (likesBadge) likesBadge.textContent = '';
  if (dislikesEl) dislikesEl.textContent = 'Loading...';
  if (dislikesBadge) dislikesBadge.textContent = '';
  if (ratingEl) ratingEl.textContent = 'Loading...';
  if (ratingBadge) ratingBadge.textContent = '';
  if (dateEl) dateEl.textContent = 'Loading...';
  if (descEl) descEl.textContent = 'Fetching description & metadata...';

  const btnOpenYt = document.getElementById('info-open-yt-btn');
  if (btnOpenYt) {
    btnOpenYt.onclick = () => {
      window.api.openExternalUrl(`https://www.youtube.com/watch?v=${track.id}`);
    };
  }
  const btnCopyStats = document.getElementById('info-copy-details-btn');
  if (btnCopyStats) {
    btnCopyStats.onclick = () => {
      const summaryText = `Track: ${track.title} - ${cleanArtistName(track.artist)}\nRelease: ${dateEl ? dateEl.textContent : ''}\nViews: ${viewsEl ? viewsEl.textContent : ''}\nLikes: ${likesEl ? likesEl.textContent : ''}\nRating: ${ratingEl ? ratingEl.textContent : ''}\nLink: https://www.youtube.com/watch?v=${track.id}`;
      navigator.clipboard.writeText(summaryText)
        .then(() => showToast('Song info & stats copied to clipboard! 📋'))
        .catch(() => showToast('Could not copy to clipboard', 'error'));
    };
  }

  try {
    const details = await window.api.getTrackDetails(track.id);
    if (!details) return;

    if (viewsEl) viewsEl.textContent = typeof details.views === 'number' ? Number(details.views).toLocaleString() : (details.views || '--');
    if (viewsBadge) viewsBadge.textContent = details.views ? formatCompactNumber(details.views) : '';

    if (likesEl) likesEl.textContent = typeof details.likes === 'number' ? Number(details.likes).toLocaleString() : (details.likes || '--');
    if (likesBadge) likesBadge.textContent = details.likes ? formatCompactNumber(details.likes) : '';

    if (dislikesEl) dislikesEl.textContent = typeof details.dislikes === 'number' ? Number(details.dislikes).toLocaleString() : (details.dislikes || '--');
    if (dislikesBadge) dislikesBadge.textContent = details.dislikes ? formatCompactNumber(details.dislikes) : '';

    const totalVotes = (Number(details.likes) || 0) + (Number(details.dislikes) || 0);
    let pct = 100;
    if (totalVotes > 0) {
      pct = Math.round(((Number(details.likes) || 0) / totalVotes) * 100);
    } else if (details.rating) {
      pct = Math.round((details.rating / 5) * 100);
    }
    if (ratingEl) ratingEl.textContent = `${pct}% Positive (${details.rating ? details.rating + '/5' : 'Excellent'})`;
    if (ratingBadge) ratingBadge.textContent = pct >= 95 ? '★ Superb' : pct >= 80 ? '★ Great' : '★ Good';
    if (ratingPctEl) ratingPctEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -2px; margin-right: 4px;"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>Community Approval: ${pct}%`;
    if (ratingFillEl) ratingFillEl.style.width = `${pct}%`;

    if (dateEl) dateEl.textContent = formatSongDate(details.uploadDate || track.year) || 'Available on YouTube Music';
    if (descEl) descEl.textContent = details.description || 'No detailed description provided by creator.';
  } catch (err) {
    console.warn('Song info notice:', err.message);
    if (descEl) descEl.textContent = 'Basic metadata loaded from active playback session.';
  }
}

document.getElementById('np-track-format-pill')?.addEventListener('click', openSongInfoModal);
document.getElementById('np-quick-info-btn')?.addEventListener('click', openSongInfoModal);
songInfoModalClose?.addEventListener('click', () => {
  if (songInfoModal) songInfoModal.style.display = 'none';
});
songInfoModal?.addEventListener('click', (e) => {
  if (e.target === songInfoModal) songInfoModal.style.display = 'none';
});

// Sleep Timer System (Matching OpenTune Android SleepTimer)
let sleepTimerId = null;
let sleepTimerMinutesLeft = 0;
let sleepTimerMode = null; // 'minutes' | 'end_of_track' | null

function setSleepTimer(val) {
  if (sleepTimerId) {
    clearInterval(sleepTimerId);
    sleepTimerId = null;
  }

  const ind = document.getElementById('player-sleep-indicator');
  const npBadge = document.getElementById('np-sleep-badge');

  if (val === '0' || !val) {
    sleepTimerMode = null;
    sleepTimerMinutesLeft = 0;
    if (ind) ind.style.display = 'none';
    if (npBadge) npBadge.style.display = 'none';
    return;
  }

  if (val === 'end_of_track') {
    sleepTimerMode = 'end_of_track';
    if (ind) { ind.style.display = 'inline'; ind.textContent = 'End'; }
    if (npBadge) { npBadge.style.display = 'inline'; npBadge.textContent = 'End'; }
    return;
  }

  const mins = parseInt(val, 10);
  if (!mins) return;
  sleepTimerMode = 'minutes';
  sleepTimerMinutesLeft = mins;

  const updateBadge = () => {
    if (ind) { ind.style.display = 'inline'; ind.textContent = `${sleepTimerMinutesLeft}m`; }
    if (npBadge) { npBadge.style.display = 'inline'; npBadge.textContent = `${sleepTimerMinutesLeft}m`; }
  };
  updateBadge();

  sleepTimerId = setInterval(() => {
    sleepTimerMinutesLeft--;
    if (sleepTimerMinutesLeft <= 0) {
      clearInterval(sleepTimerId);
      sleepTimerId = null;
      sleepTimerMode = null;
      audio.pause();
      state.isPlaying = false;
      updatePlayPauseUI();
      if (ind) ind.style.display = 'none';
      if (npBadge) npBadge.style.display = 'none';
    } else {
      updateBadge();
    }
  }, 60000);
}

const sleepModal = document.getElementById('sleep-timer-modal');
document.getElementById('player-sleep-btn')?.addEventListener('click', () => {
  if (sleepModal) sleepModal.style.display = 'flex';
});
document.getElementById('np-sleep-btn')?.addEventListener('click', () => {
  if (sleepModal) sleepModal.style.display = 'flex';
});
document.getElementById('sleep-timer-modal-close')?.addEventListener('click', () => {
  if (sleepModal) sleepModal.style.display = 'none';
});

document.querySelectorAll('.sleep-option-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setSleepTimer(btn.dataset.minutes);
    if (sleepModal) sleepModal.style.display = 'none';
  });
});

// Speed & Pitch Tweaker Modal Controller
const speedPitchModal = document.getElementById('speed-pitch-modal');
const speedPitchModalClose = document.getElementById('speed-pitch-modal-close');
const tweakerSpeedSlider = document.getElementById('tweaker-speed-slider');
const tweakerSpeedVal = document.getElementById('tweaker-speed-val');
const tweakerPitchSlider = document.getElementById('tweaker-pitch-slider');
const tweakerPitchVal = document.getElementById('tweaker-pitch-val');
const tweakerPreservePitch = document.getElementById('tweaker-preserve-pitch');
const tweakerResetBtn = document.getElementById('tweaker-reset-btn');

let currentPitchSemitones = 0;

function syncTweakerUI() {
  const curSpeed = audio.playbackRate || 1.0;
  if (tweakerSpeedSlider) tweakerSpeedSlider.value = curSpeed;
  if (tweakerSpeedVal) tweakerSpeedVal.textContent = `${Number(curSpeed).toFixed(2)}x`;
  if (tweakerPitchSlider) tweakerPitchSlider.value = currentPitchSemitones;
  if (tweakerPitchVal) tweakerPitchVal.textContent = currentPitchSemitones === 0 ? '0 st (Natural)' : `${currentPitchSemitones > 0 ? '+' : ''}${currentPitchSemitones} st`;
  if (tweakerPreservePitch) tweakerPreservePitch.checked = audio.preservesPitch !== false;
}

function openSpeedPitchModal() {
  if (speedPitchModal) speedPitchModal.style.display = 'flex';
  syncTweakerUI();
}

function applyTweakerSettings(speed, pitch, preservePitch) {
  const s = Math.max(0.25, Math.min(3.0, Number(speed) || 1.0));
  audio.playbackRate = s;
  audio.preservesPitch = Boolean(preservePitch);
  currentPitchSemitones = Number(pitch) || 0;

  const label = s === 1.0 && currentPitchSemitones === 0 ? '1.0x' : `${Number(s).toFixed(2)}x`;
  const speedBtn = document.getElementById('player-speed-btn');
  const npSpeedBtn = document.getElementById('np-speed-btn');
  if (speedBtn) speedBtn.textContent = label;
  if (npSpeedBtn) npSpeedBtn.textContent = label;

  syncTweakerUI();
}

tweakerSpeedSlider?.addEventListener('input', (e) => {
  applyTweakerSettings(e.target.value, currentPitchSemitones, tweakerPreservePitch?.checked);
});

tweakerPitchSlider?.addEventListener('input', (e) => {
  const p = Number(e.target.value);
  if (p !== 0 && tweakerPreservePitch) {
    tweakerPreservePitch.checked = false;
  }
  const factor = Math.pow(2, p / 12);
  const baseSpeed = Number(tweakerSpeedSlider?.value || 1.0);
  applyTweakerSettings(baseSpeed * factor, p, false);
});

tweakerPreservePitch?.addEventListener('change', (e) => {
  audio.preservesPitch = e.target.checked;
});

tweakerResetBtn?.addEventListener('click', () => {
  applyTweakerSettings(1.0, 0, true);
  document.querySelectorAll('.preset-chip').forEach(c => c.classList.toggle('active', c.dataset.preset === 'normal'));
  showToast('Speed & pitch reset to default');
});

document.querySelectorAll('.preset-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const preset = btn.dataset.preset;
    if (preset === 'normal') {
      applyTweakerSettings(1.0, 0, true);
    } else if (preset === 'nightcore') {
      applyTweakerSettings(1.25, 3.8, false);
    } else if (preset === 'slowed') {
      applyTweakerSettings(0.85, -2.8, false);
    } else if (preset === 'chipmunk') {
      applyTweakerSettings(1.35, 5.2, false);
    } else if (preset === 'deep') {
      applyTweakerSettings(0.80, -3.8, false);
    }
  });
});

document.getElementById('player-speed-btn')?.addEventListener('click', openSpeedPitchModal);
document.getElementById('np-speed-btn')?.addEventListener('click', openSpeedPitchModal);
speedPitchModalClose?.addEventListener('click', () => {
  if (speedPitchModal) speedPitchModal.style.display = 'none';
});
speedPitchModal?.addEventListener('click', (e) => {
  if (e.target === speedPitchModal) speedPitchModal.style.display = 'none';
});

// Google Sign-In & Login Modal (Device Auth + Webview + Cookie)
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userLoggedInBox = document.getElementById('user-logged-in-box');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');

const loginModal = document.getElementById('login-modal');
const loginModalClose = document.getElementById('login-modal-close');
const modalGoogleBtn = document.getElementById('modal-google-signin-btn');
const modalCookieInput = document.getElementById('modal-cookie-input');
const modalSaveCookieBtn = document.getElementById('modal-save-cookie-btn');
const modalStatusMsg = document.getElementById('modal-status-msg');

const authTabDevice = document.getElementById('auth-tab-device');
const authTabWebview = document.getElementById('auth-tab-webview');
const authTabCookie = document.getElementById('auth-tab-cookie');
const paneAuthDevice = document.getElementById('pane-auth-device');
const paneAuthWebview = document.getElementById('pane-auth-webview');
const paneAuthCookie = document.getElementById('pane-auth-cookie');

const deviceAuthCode = document.getElementById('device-auth-code');
const deviceAuthCopyBtn = document.getElementById('device-auth-copy-btn');
const deviceAuthCopyText = document.getElementById('device-auth-copy-text');
const deviceAuthOpenBrowserBtn = document.getElementById('device-auth-open-browser-btn');
const deviceAuthStatusText = document.getElementById('device-auth-status-text');

let currentVerificationUrl = 'https://www.google.com/device';
let currentDeviceCode = '';
let deviceAuthActive = false;

function setAuthTab(tab) {
  [authTabDevice, authTabWebview, authTabCookie].forEach(t => t?.classList.remove('active'));
  [paneAuthDevice, paneAuthWebview, paneAuthCookie].forEach(p => { if (p) p.style.display = 'none'; });

  if (tab === 'device') {
    authTabDevice?.classList.add('active');
    if (paneAuthDevice) paneAuthDevice.style.display = 'flex';
    initDeviceAuth();
  } else if (tab === 'webview') {
    authTabWebview?.classList.add('active');
    if (paneAuthWebview) paneAuthWebview.style.display = 'flex';
  } else if (tab === 'cookie') {
    authTabCookie?.classList.add('active');
    if (paneAuthCookie) paneAuthCookie.style.display = 'flex';
  }
}

authTabDevice?.addEventListener('click', () => setAuthTab('device'));
authTabWebview?.addEventListener('click', () => setAuthTab('webview'));
authTabCookie?.addEventListener('click', () => setAuthTab('cookie'));

async function initDeviceAuth() {
  if (deviceAuthActive) return;
  deviceAuthActive = true;
  if (deviceAuthCode) {
    deviceAuthCode.textContent = 'Generating code...';
    deviceAuthCode.style.color = 'var(--accent)';
  }
  if (deviceAuthStatusText) {
    deviceAuthStatusText.textContent = 'Connecting to Google device authorization...';
  }

  try {
    const res = await window.api.startGoogleDeviceAuth();
    if (res && res.success && res.profile) {
      if (deviceAuthStatusText) deviceAuthStatusText.textContent = 'Signed in successfully! Loading library...';
      if (deviceAuthCode) deviceAuthCode.style.color = '#4caf50';
      updateAuthUI(res.profile);
      setTimeout(() => {
        if (loginModal) loginModal.style.display = 'none';
      }, 1000);
    } else if (res && res.error) {
      if (deviceAuthStatusText) deviceAuthStatusText.textContent = `Notice: ${res.error}`;
    }
  } catch (err) {
    console.warn('Device auth ended:', err.message);
  } finally {
    deviceAuthActive = false;
  }
}

window.api.onAuthDevicePending((data) => {
  if (data && data.user_code) {
    currentDeviceCode = data.user_code;
    currentVerificationUrl = data.verification_url || 'https://www.google.com/device';
    if (deviceAuthCode) {
      deviceAuthCode.textContent = data.user_code;
    }
    if (deviceAuthStatusText) {
      deviceAuthStatusText.textContent = 'Enter this code on google.com/device in your browser';
    }
  }
});

deviceAuthCopyBtn?.addEventListener('click', () => {
  if (!currentDeviceCode) return;
  navigator.clipboard.writeText(currentDeviceCode).then(() => {
    if (deviceAuthCopyText) deviceAuthCopyText.textContent = 'Copied';
    setTimeout(() => {
      if (deviceAuthCopyText) deviceAuthCopyText.textContent = 'Copy Code';
    }, 2000);
  });
});

deviceAuthOpenBrowserBtn?.addEventListener('click', () => {
  if (currentDeviceCode) {
    navigator.clipboard.writeText(currentDeviceCode).then(() => {
      if (deviceAuthCopyText) deviceAuthCopyText.textContent = 'Copied';
      setTimeout(() => {
        if (deviceAuthCopyText) deviceAuthCopyText.textContent = 'Copy Code';
      }, 2000);
    });
  }
  window.api.openExternalUrl(currentVerificationUrl);
});

function showModalStatus(text, isError = false) {
  if (!modalStatusMsg) return;
  modalStatusMsg.style.display = 'block';
  modalStatusMsg.style.color = isError ? '#ff5252' : '#4caf50';
  modalStatusMsg.textContent = text;
}

function updateAuthUI(profile) {
  const settingsAccName = document.getElementById('settings-account-name');
  const settingsAccDesc = document.getElementById('settings-account-desc');
  const btnSettingsLogin = document.getElementById('btn-settings-login');
  const btnSettingsSync = document.getElementById('btn-settings-sync-library');
  const btnSettingsLogout = document.getElementById('btn-settings-logout');

  if (profile && profile.isLoggedIn) {
    loginBtn.style.display = 'none';
    userLoggedInBox.style.display = 'flex';
    userName.textContent = profile.name || 'YouTube User';
    userAvatar.src = profile.avatar || 'assets/icon.png';
    userLoggedInBox.title = profile.name ? `${profile.name} (YouTube Music)` : 'YouTube Music Account';

    if (settingsAccName) settingsAccName.textContent = profile.name || 'Connected YouTube User';
    if (settingsAccDesc) settingsAccDesc.textContent = profile.email ? `Signed in as ${profile.email}. Library and playlists in sync.` : 'Connected to YouTube Music session. Library and playlists in sync.';
    if (btnSettingsLogin) btnSettingsLogin.style.display = 'none';
    if (btnSettingsSync) btnSettingsSync.style.display = 'inline-flex';
    if (btnSettingsLogout) btnSettingsLogout.style.display = 'inline-flex';

    syncLibrary();
  } else {
    loginBtn.style.display = 'flex';
    userLoggedInBox.style.display = 'none';

    if (settingsAccName) settingsAccName.textContent = 'Guest Mode';
    if (settingsAccDesc) settingsAccDesc.textContent = 'Sign in with your Google Account or sync via cookie to access your YouTube Music library, liked songs, and private playlists.';
    if (btnSettingsLogin) btnSettingsLogin.style.display = 'inline-flex';
    if (btnSettingsSync) btnSettingsSync.style.display = 'none';
    if (btnSettingsLogout) btnSettingsLogout.style.display = 'none';
  }
}

loginBtn.addEventListener('click', () => {
  if (loginModal) {
    loginModal.style.display = 'flex';
    if (modalStatusMsg) modalStatusMsg.style.display = 'none';
    setAuthTab('device');
  }
});

function closeLoginModal() {
  if (loginModal) loginModal.style.display = 'none';
  if (deviceAuthActive) {
    window.api.cancelGoogleDeviceAuth();
    deviceAuthActive = false;
  }
}

loginModalClose?.addEventListener('click', closeLoginModal);

loginModal?.addEventListener('click', (e) => {
  if (e.target === loginModal) {
    closeLoginModal();
  }
});

modalGoogleBtn?.addEventListener('click', async () => {
  showModalStatus('Opening in-app YouTube Music window. Sign in with your Google account...');
  try {
    const res = await window.api.openLoginWindow();
    if (res.success && res.profile) {
      updateAuthUI(res.profile);
      if (loginModal) loginModal.style.display = 'none';
    } else if (res.cancelled) {
      showModalStatus('Sign-in window closed.', true);
    }
  } catch (err) {
    showModalStatus(`Login error: ${err.message}`, true);
  }
});

modalSaveCookieBtn?.addEventListener('click', async () => {
  const cookie = (modalCookieInput?.value || '').trim();
  if (!cookie) {
    showModalStatus('Please paste a valid cookie string.', true);
    return;
  }
  showModalStatus('Validating session...');
  try {
    const res = await window.api.saveManualCookie(cookie);
    if (res.success && res.profile) {
      updateAuthUI(res.profile);
      if (loginModal) loginModal.style.display = 'none';
    } else {
      showModalStatus(res.error || 'Invalid cookie.', true);
    }
  } catch (err) {
    showModalStatus(`Error: ${err.message}`, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  await window.api.signOut();
  updateAuthUI({ isLoggedIn: false });
});

window.api.onAuthChanged((profile) => {
  updateAuthUI(profile);
  if (profile?.isLoggedIn) {
    syncLibrary();
  } else {
    cachedYtPlaylists = [];
    loadPlaylists();
  }
});

let isLibrarySyncRunning = false;

async function syncLibrary() {
  if (isLibrarySyncRunning) return;
  isLibrarySyncRunning = true;
  try {
    const lib = await window.api.getLibrary();
    if (Array.isArray(lib?.playlists)) {
      cachedYtPlaylists = lib.playlists;
    }
    if (lib.likedSongs && lib.likedSongs.length > 0) {
      let addedAny = false;
      lib.likedSongs.forEach(track => {
        if (!state.likedSongs.has(track.id)) {
          state.likedSongs.add(track.id);
          state.likedSongsData.push(track);
          addedAny = true;
        }
      });
      if (addedAny) {
        localStorage.setItem('opentune_liked_songs', JSON.stringify(state.likedSongsData));
        renderLikedSongs();
      }
    }

    // Two-way real-time sync for all linked local <-> YouTube Music playlists
    const localLinked = getLocalPlaylists().filter(p => p.remoteId && p.autoSync !== false);
    for (const pl of localLinked) {
      await syncLinkedPlaylist(pl.id, { quiet: true });
    }

    loadPlaylists();
  } catch (err) {
    console.error('Library sync error:', err);
  } finally {
    isLibrarySyncRunning = false;
  }
}

// 10-Band Web Audio Equalizer Engine
const EQ_STORAGE_KEY = 'opentune_eq';
const EQ_BANDS = [
  { freq: 32, label: '32', type: 'lowshelf' },
  { freq: 64, label: '64', type: 'peaking' },
  { freq: 125, label: '125', type: 'peaking' },
  { freq: 250, label: '250', type: 'peaking' },
  { freq: 500, label: '500', type: 'peaking' },
  { freq: 1000, label: '1K', type: 'peaking' },
  { freq: 2000, label: '2K', type: 'peaking' },
  { freq: 4000, label: '4K', type: 'peaking' },
  { freq: 8000, label: '8K', type: 'peaking' },
  { freq: 16000, label: '16K', type: 'highshelf' }
];

const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [7, 6, 5, 3, 1, 0, 0, 0, 1, 2],
  treble: [0, 0, 0, 0, 1, 2, 4, 5, 6, 7],
  vocal: [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
  rock: [5, 4, 2, 0, -1, 1, 3, 4, 5, 5],
  electronic: [6, 5, 2, 0, -2, 1, 2, 4, 5, 6],
  acoustic: [4, 3, 2, 1, 2, 2, 3, 3, 2, 1],
  latenight: [3, 2, 0, -1, 1, 2, 2, 1, 0, -2]
};

let eqState = {
  enabled: false,
  preset: 'flat',
  gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};
let eqAudioCtx = null;
let eqMediaSource = null;
let eqFilters = [];

function loadEqState() {
  try {
    const raw = localStorage.getItem(EQ_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.enabled === 'boolean') eqState.enabled = parsed.enabled;
      if (parsed.preset) eqState.preset = parsed.preset;
      if (Array.isArray(parsed.gains) && parsed.gains.length === 10) {
        eqState.gains = parsed.gains.map(v => Math.max(-12, Math.min(12, Number(v) || 0)));
      }
    }
  } catch (_) {}
}

function saveEqState() {
  try {
    localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(eqState));
  } catch (_) {}
}

function applyEqGains() {
  if (eqFilters.length === 10) {
    EQ_BANDS.forEach((_, idx) => {
      const targetGain = eqState.enabled ? (eqState.gains[idx] || 0) : 0;
      eqFilters[idx].gain.value = targetGain;
    });
  }
  ['header-eq-btn', 'player-eq-btn', 'np-eq-btn'].forEach(id => {
    document.getElementById(id)?.classList.toggle('active', Boolean(eqState.enabled));
  });
}

let eqGainNode = null;
let eqCompressorNode = null;

function applyAudioDspNodes() {
  try {
    if (eqGainNode && eqAudioCtx) {
      const db = Math.max(0, Math.min(6, Number(settings.loudnessBoost) || 0));
      eqGainNode.gain.setTargetAtTime(Math.pow(10, db / 20), eqAudioCtx.currentTime, 0.04);
    }
    if (eqCompressorNode && eqAudioCtx) {
      const normOn = settings.audioNormalization !== false;
      eqCompressorNode.threshold.setTargetAtTime(normOn ? -20 : 0, eqAudioCtx.currentTime, 0.04);
      eqCompressorNode.ratio.setTargetAtTime(normOn ? 4 : 1, eqAudioCtx.currentTime, 0.04);
    }
  } catch (_) {}
}

function ensureEqualizerReady() {
  try {
    const isEqActive = Boolean(eqState.enabled || (Number(settings?.loudnessBoost) > 0));
    // ONLY connect Web Audio API if equalizer or loudness boost is actually enabled!
    // When inactive, HTML5 audio plays natively directly through the hardware audio pipeline (zero suspension risks)
    if (!isEqActive && !eqAudioCtx) return;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!eqAudioCtx) {
      eqAudioCtx = new AudioCtx();
      eqMediaSource = eqAudioCtx.createMediaElementSource(audio);
      eqFilters = EQ_BANDS.map((band) => {
        const filter = eqAudioCtx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.freq;
        filter.Q.value = 1.4;
        filter.gain.value = 0;
        return filter;
      });
      eqCompressorNode = eqAudioCtx.createDynamicsCompressor();
      eqCompressorNode.knee.value = 18;
      eqCompressorNode.attack.value = 0.004;
      eqCompressorNode.release.value = 0.22;
      eqGainNode = eqAudioCtx.createGain();

      let node = eqMediaSource;
      eqFilters.forEach((f) => {
        node.connect(f);
        node = f;
      });
      node.connect(eqCompressorNode);
      eqCompressorNode.connect(eqGainNode);
      eqGainNode.connect(eqAudioCtx.destination);

      eqAudioCtx.onstatechange = () => {
        if (state.isPlaying && eqAudioCtx && eqAudioCtx.state === 'suspended') {
          eqAudioCtx.resume().catch(() => {});
        }
      };
    }

    if (eqAudioCtx.state === 'suspended') {
      eqAudioCtx.resume().catch(() => {});
    }
    applyEqGains();
    applyAudioDspNodes();
  } catch (err) {
    console.warn('Equalizer init skipped (direct playback active):', err.message);
  }
}

// Global gesture unlock for Web Audio context to ensure instant playback without delay
const unlockAudioContextOnGesture = () => {
  if (eqAudioCtx && eqAudioCtx.state === 'suspended') {
    eqAudioCtx.resume().catch(() => {});
  }
};
window.addEventListener('pointerdown', unlockAudioContextOnGesture, { passive: true });
window.addEventListener('keydown', unlockAudioContextOnGesture, { passive: true });

function renderEqBandsUI() {
  const container = document.getElementById('eq-bands-container');
  const enabledChk = document.getElementById('eq-enabled-checkbox');
  const presetSel = document.getElementById('eq-preset-select');
  if (enabledChk) enabledChk.checked = Boolean(eqState.enabled);
  if (presetSel) presetSel.value = EQ_PRESETS[eqState.preset] ? eqState.preset : 'custom';

  if (!container) return;
  container.innerHTML = '';

  EQ_BANDS.forEach((band, idx) => {
    const col = document.createElement('div');
    col.className = 'eq-band-col';

    const val = eqState.gains[idx] || 0;
    const dbLabel = document.createElement('span');
    dbLabel.className = 'eq-band-db';
    dbLabel.textContent = `${val > 0 ? '+' : ''}${val} dB`;

    const wrap = document.createElement('div');
    wrap.className = 'eq-slider-wrap';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'eq-slider';
    slider.min = '-12';
    slider.max = '12';
    slider.step = '1';
    slider.value = String(val);
    slider.title = `${band.label} Hz`;

    slider.addEventListener('input', () => {
      const nextVal = parseInt(slider.value, 10) || 0;
      eqState.gains[idx] = nextVal;
      eqState.preset = 'custom';
      eqState.enabled = true;
      dbLabel.textContent = `${nextVal > 0 ? '+' : ''}${nextVal} dB`;
      if (enabledChk) enabledChk.checked = true;
      if (presetSel) presetSel.value = 'custom';
      ensureEqualizerReady();
      applyEqGains();
      saveEqState();
    });

    const freqLabel = document.createElement('span');
    freqLabel.className = 'eq-band-freq';
    freqLabel.textContent = band.label;

    wrap.appendChild(slider);
    col.appendChild(dbLabel);
    col.appendChild(wrap);
    col.appendChild(freqLabel);
    container.appendChild(col);
  });
}

function openEqModal() {
  const modal = document.getElementById('eq-modal');
  if (!modal) return;
  renderEqBandsUI();
  modal.style.display = 'flex';
}

function closeEqModal() {
  const modal = document.getElementById('eq-modal');
  if (modal) modal.style.display = 'none';
}

function initEqualizerUI() {
  loadEqState();
  applyEqGains();

  document.getElementById('header-eq-btn')?.addEventListener('click', openEqModal);
  document.getElementById('player-eq-btn')?.addEventListener('click', openEqModal);
  document.getElementById('np-eq-btn')?.addEventListener('click', openEqModal);
  document.getElementById('eq-modal-close')?.addEventListener('click', closeEqModal);
  document.getElementById('eq-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEqModal();
  });

  document.getElementById('eq-enabled-checkbox')?.addEventListener('change', (e) => {
    eqState.enabled = Boolean(e.target.checked);
    ensureEqualizerReady();
    applyEqGains();
    saveEqState();
  });

  document.getElementById('eq-preset-select')?.addEventListener('change', (e) => {
    const key = e.target.value;
    if (EQ_PRESETS[key]) {
      eqState.preset = key;
      eqState.gains = [...EQ_PRESETS[key]];
      eqState.enabled = key !== 'flat' ? true : eqState.enabled;
      ensureEqualizerReady();
      applyEqGains();
      saveEqState();
      renderEqBandsUI();
    }
  });

  document.getElementById('eq-reset-btn')?.addEventListener('click', () => {
    eqState.preset = 'flat';
    eqState.gains = [...EQ_PRESETS.flat];
    ensureEqualizerReady();
    applyEqGains();
    saveEqState();
    renderEqBandsUI();
    showToast('Equalizer reset to Flat.', 'info');
  });
}

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInput?.focus();
    searchInput?.select();
    return;
  }

  if (e.key === 'Escape') {
    if (typeof closeAodMode === 'function') closeAodMode();
    closeEqModal();
    closeNowPlaying();
    const shortcutsModal = document.getElementById('shortcuts-modal');
    if (shortcutsModal) shortcutsModal.style.display = 'none';
    const ctx = document.getElementById('song-context-menu');
    if (ctx) ctx.style.display = 'none';
    return;
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.code === 'Space') {
    e.preventDefault();
    btnPlayPause.click();
  } else if (e.code === 'ArrowRight') {
    const seekStep = Math.max(1, Number(settings.fastSeek) || 10);
    if (isVideoMode) {
      const dur = videoDuration > 0 ? videoDuration : (parseDurationToSeconds(state.currentTrack?.duration) || 180);
      videoCurrentTime = Math.min(dur, (videoCurrentTime || 0) + seekStep);
      sendVideoCommand('seekTo', [videoCurrentTime, true]);
      refreshVisualFrame(true);
    } else if (audio.duration) {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + seekStep);
    }
  } else if (e.code === 'ArrowLeft') {
    const seekStep = Math.max(1, Number(settings.fastSeek) || 10);
    if (isVideoMode) {
      videoCurrentTime = Math.max(0, (videoCurrentTime || 0) - seekStep);
      sendVideoCommand('seekTo', [videoCurrentTime, true]);
      refreshVisualFrame(true);
    } else if (audio.duration) {
      audio.currentTime = Math.max(0, audio.currentTime - seekStep);
    }
  } else if (e.key === 'a' || e.key === 'A') {
    if (typeof openAodMode === 'function') openAodMode();
  } else if (e.code === 'ArrowUp') {
    setVolume(Math.min(1, state.volume + 0.05));
  } else if (e.code === 'ArrowDown') {
    setVolume(Math.max(0, state.volume - 0.05));
  } else if (e.key === 'n' || e.key === 'N') {
    btnNext.click();
  } else if (e.key === 'p' || e.key === 'P') {
    btnPrev.click();
  } else if (e.key === 'f' || e.key === 'F') {
    if (isNowPlayingOpen()) closeNowPlaying();
    else openNowPlaying();
  } else if (e.key === 'Escape') {
    if (isNowPlayingOpen()) {
      closeNowPlaying();
    } else if (typeof sideDrawer !== 'undefined' && sideDrawer?.classList.contains('open')) {
      closeDrawer();
    }
  } else if (e.key === 'e' || e.key === 'E') {
    const eqModal = document.getElementById('eq-modal');
    if (eqModal && eqModal.style.display === 'flex') closeEqModal();
    else openEqModal();
  } else if (e.key === 'i' || e.key === 'I') {
    toggleMiniPlayerMode();
  } else if (e.key === '/') {
    e.preventDefault();
    searchInput?.focus();
    searchInput?.select();
  } else if (e.key === 'm' || e.key === 'M') {
    btnMute.click();
  } else if (e.key === 'l' || e.key === 'L') {
    openDrawer('lyrics');
  } else if (e.key === 'q' || e.key === 'Q') {
    openDrawer('queue');
  } else if (e.key === 's' || e.key === 'S') {
    btnShuffle.click();
  } else if (e.key === 'r' || e.key === 'R') {
    btnRepeat.click();
  } else if (e.key === '?') {
    const sm = document.getElementById('shortcuts-modal');
    if (sm) sm.style.display = 'flex';
  }
});

// Settings Hub & Accessibility Engine
const defaultSettings = {
  darkMode: 'dark',
  accentColor: '#ED5564',
  dynamicTheme: true,
  randomTheme: false,
  liquidGlass: true,
  disableBlur: false,
  fontFamily: 'poppins',
  showHomeChips: true,
  gridCellSize: 'medium',
  showLibraryBento: true,
  playerDesign: 'cinematic',
  playerBg: 'blur',
  playerButtons: 'tonal',
  artShape: 'rounded',
  artRadius: 16,
  cropThumbnails: true,
  hidePlayerThumb: false,
  sliderStyle: 'wavy',
  lyricsAnim: 'apple',
  lyricsBlur: true,
  lyricsAlign: 'center',
  lyricsSize: 24,
  lyricsSpacing: 1.35,
  lyricsAutoScroll: true,
  lyricsClickSeek: true,
  smoothAnimations: true,
  downloadPath: '',
  audioQuality: 'standard',
  audioNormalization: true,
  loudnessBoost: 0,
  crossfade: 5,
  fastSeek: 10,
  autoplayRadio: true,
  persistentQueue: true,
  permanentShuffle: false,
  autoDownloadOnLike: false,
  skipSilence: false,
  pauseOnZeroVol: false,
  autoSkipOnError: true,
  artistSplitSymbols: ', & feat. ft. x /',
  stopOnClose: true,
  pauseHistory: false,
  highContrast: false,
  largeText: false,
  reducedMotion: false,
  country: 'US',
  filterExplicit: false,
  aodStyle: 'ambient',
  aodArtShape: 'rounded',
  aodBtnStyle: 'rounded',
  aodRelSize: 100,
  aodDarkness: 82,
  aodShowClock: true,
  aodShowTitle: true,
  aodShowArtist: true,
  aodShowTime: true,
  aodShowProgress: true,
  aodShowControls: true,
  uiThemeStyle: 'default',
  compactSidebar: false,
  clickBarToExpand: true,
  audioOutputId: '',
  showPlayedInQueue: false,
  pipAlwaysOnTop: true,
  trackNotifications: false
};

const PALETTE_SWATCH_COLORS = ['#ED5564', '#1DB954', '#00E5FF', '#8E44AD', '#FF9F1C', '#E74C3C', '#2ECC71', '#FF6B8B'];
const GRID_MIN_MAP = { big: '220px', medium: '185px', compact: '142px' };
const ART_RADIUS_MAP = { sharp: '4px', rounded: '16px', squircle: '28px', circle: '50%' };

let settings = { ...defaultSettings };
let defaultDownloadDirCache = '';
window.addEventListener('resize', () => {
  if (typeof refreshVisualFrame === 'function') refreshVisualFrame();
});

function loadSettings() {
  try {
    const raw = localStorage.getItem('opentune_settings');
    if (raw) {
      settings = { ...defaultSettings, ...JSON.parse(raw) };
    }
  } catch (_) {}
  if (settings.randomTheme) {
    settings.accentColor = PALETTE_SWATCH_COLORS[Math.floor(Math.random() * PALETTE_SWATCH_COLORS.length)];
  }
  applySettings();
}

function saveSettings() {
  localStorage.setItem('opentune_settings', JSON.stringify(settings));
  applySettings();
}

function applyAccentColorVars(hex) {
  const c = hex || '#ED5564';
  const [r, g, b] = parseColorToRgb(c);
  applyThemeRgbAccent(r, g, b);
  const b1 = document.getElementById('ambient-blob-1');
  const b2 = document.getElementById('ambient-blob-2');
  if (!settings.dynamicTheme || !state.currentTrack?.thumbnail) {
    if (b1) b1.style.background = `radial-gradient(circle, rgba(${r},${g},${b},0.42) 0%, transparent 70%)`;
    if (b2) b2.style.background = `radial-gradient(circle, rgba(${r},${g},${b},0.22) 0%, transparent 70%)`;
  }
}

function setElementValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = Boolean(value);
  else el.value = String(value);
}

function applySettings() {
  document.body.classList.toggle('pure-black', settings.darkMode === 'pure-black');
  document.body.classList.toggle('light-theme', settings.darkMode === 'light');
  document.body.classList.toggle('compact-sidebar', Boolean(settings.compactSidebar));
  document.body.dataset.uiTheme = settings.uiThemeStyle || 'default';

  const c = settings.accentColor || '#ED5564';
  applyAccentColorVars(c);
  if (settings.dynamicTheme && state.currentTrack?.thumbnail) {
    extractAlbumColors(upgradeCover(state.currentTrack.thumbnail, 800));
  }

  const blurOff = Boolean(settings.disableBlur) || !settings.liquidGlass;
  document.body.classList.toggle('no-blur', blurOff);
  document.body.classList.toggle('liquid-glass', Boolean(settings.liquidGlass) && !settings.disableBlur);

  const chosenFont = settings.fontFamily === 'system'
    ? "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    : "'Poppins', -apple-system, BlinkMacSystemFont, sans-serif";
  document.documentElement.style.setProperty('--font-family', chosenFont);
  document.body.style.fontFamily = chosenFont;

  document.documentElement.style.setProperty('--grid-min-col', GRID_MIN_MAP[settings.gridCellSize] || '185px');
  const effectiveRadius = settings.artShape === 'circle'
    ? '50%'
    : (Number.isFinite(Number(settings.artRadius)) ? `${settings.artRadius}px` : (ART_RADIUS_MAP[settings.artShape] || '16px'));
  document.documentElement.style.setProperty('--art-radius', effectiveRadius);

  document.documentElement.style.setProperty('--lyrics-font-size', `${Math.max(16, Math.min(34, Number(settings.lyricsSize) || 24))}px`);
  document.documentElement.style.setProperty('--lyrics-line-height', String(Math.max(1.1, Math.min(1.8, Number(settings.lyricsSpacing) || 1.35))));

  document.body.classList.toggle('hide-home-chips', settings.showHomeChips === false);
  document.body.classList.toggle('hide-library-bento', settings.showLibraryBento === false);
  document.body.classList.toggle('hide-player-thumb', Boolean(settings.hidePlayerThumb));
  document.body.classList.toggle('no-crop-thumbs', settings.cropThumbnails === false);
  document.body.classList.toggle('high-contrast', !!settings.highContrast);
  document.body.classList.toggle('large-text', !!settings.largeText);
  document.body.classList.toggle('reduced-motion', !!settings.reducedMotion);
  document.body.dataset.sliderStyle = settings.sliderStyle || 'wavy';
  document.body.dataset.playerButtons = settings.playerButtons || 'tonal';
  document.body.classList.toggle('lyrics-no-blur', settings.lyricsBlur === false);
  document.body.classList.toggle('smooth-animations', settings.smoothAnimations !== false && !settings.reducedMotion);

  const wantShowPlayed = Boolean(settings.showPlayedInQueue);
  if (state.showPlayedInQueue !== wantShowPlayed) {
    state.showPlayedInQueue = wantShowPlayed;
    if (typeof renderQueue === 'function') renderQueue();
  }

  if (typeof audio !== 'undefined' && typeof audio.setSinkId === 'function') {
    const targetSink = settings.audioOutputId || '';
    if (audio.sinkId !== targetSink) {
      audio.setSinkId(targetSink).catch(() => {});
    }
  }

  const npOverlay = document.getElementById('now-playing-fullscreen');
  if (npOverlay) {
    npOverlay.dataset.playerDesign = settings.playerDesign || 'cinematic';
    npOverlay.dataset.playerBg = settings.playerBg || 'blur';
  }

  ['lyrics-drawer-view', 'np-lyrics-content'].forEach((lyrId) => {
    const el = document.getElementById(lyrId);
    if (el) {
      el.dataset.anim = settings.lyricsAnim || 'apple';
      el.dataset.align = settings.lyricsAlign || 'center';
    }
  });

  const dlDisplay = document.getElementById('setting-download-path-display');
  if (dlDisplay) dlDisplay.textContent = settings.downloadPath || defaultDownloadDirCache || 'Downloads/OpenTune';

  const valLabels = [
    ['setting-art-radius-val', `${settings.artRadius ?? 16}px`],
    ['setting-lyrics-size-val', `${settings.lyricsSize ?? 24}px`],
    ['setting-lyrics-spacing-val', `${Number(settings.lyricsSpacing ?? 1.35).toFixed(2).replace(/\.00$/, '')}x`],
    ['setting-loudness-boost-val', `+${settings.loudnessBoost ?? 0} dB`],
    ['setting-aod-darkness-val', `${settings.aodDarkness ?? 82}%`],
    ['bento-sub-appearance', `${settings.darkMode === 'light' ? 'Light' : settings.darkMode === 'pure-black' ? 'AMOLED' : 'Dark'} • ${settings.dynamicTheme ? 'Dynamic' : 'Palette'}`],
    ['bento-sub-player', `${(settings.playerDesign || 'cinematic').replace(/^./, (m) => m.toUpperCase())} • ${(settings.sliderStyle || 'wavy').replace(/^./, (m) => m.toUpperCase())} bar`],
    ['bento-sub-aod', `${(settings.aodStyle || 'ambient').replace(/^./, (m) => m.toUpperCase())} • ${settings.aodDarkness ?? 82}% dim`]
  ];
  valLabels.forEach(([id, txt]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  });

  // Sync all DOM inputs declaratively
  const controlMap = {
    'setting-ui-theme-style': settings.uiThemeStyle || 'default',
    'setting-dark-mode': settings.darkMode,
    'setting-custom-color': c.startsWith('#') ? c : '#ED5564',
    'setting-dynamic-theme': settings.dynamicTheme,
    'setting-random-theme': !!settings.randomTheme,
    'setting-liquid-glass': settings.liquidGlass,
    'setting-disable-blur': !!settings.disableBlur,
    'setting-font-family': settings.fontFamily,
    'setting-show-home-chips': settings.showHomeChips !== false,
    'setting-grid-size': settings.gridCellSize || 'medium',
    'setting-show-library-bento': settings.showLibraryBento !== false,
    'setting-compact-sidebar': !!settings.compactSidebar,
    'setting-player-design': settings.playerDesign || 'cinematic',
    'setting-player-bg': settings.playerBg || 'blur',
    'setting-player-buttons': settings.playerButtons || 'tonal',
    'setting-art-shape': settings.artShape || 'rounded',
    'setting-art-radius': settings.artRadius ?? 16,
    'setting-crop-thumbs': settings.cropThumbnails !== false,
    'setting-hide-player-thumb': !!settings.hidePlayerThumb,
    'setting-bar-expand': settings.clickBarToExpand !== false,
    'setting-slider-style': settings.sliderStyle || 'wavy',
    'setting-lyrics-anim': settings.lyricsAnim || 'apple',
    'setting-lyrics-blur': settings.lyricsBlur !== false,
    'setting-lyrics-align': settings.lyricsAlign || 'center',
    'setting-lyrics-size': settings.lyricsSize ?? 24,
    'setting-lyrics-spacing': settings.lyricsSpacing ?? 1.35,
    'setting-lyrics-autoscroll': settings.lyricsAutoScroll !== false,
    'setting-lyrics-click-seek': settings.lyricsClickSeek !== false,
    'setting-smooth-animations': settings.smoothAnimations !== false,
    'setting-audio-quality': settings.audioQuality,
    'setting-audio-output': settings.audioOutputId || '',
    'setting-audio-normalization': settings.audioNormalization !== false,
    'setting-loudness-boost': settings.loudnessBoost ?? 0,
    'setting-crossfade': settings.crossfade,
    'setting-fast-seek': settings.fastSeek ?? 10,
    'setting-autoplay-radio': settings.autoplayRadio,
    'setting-persistent-queue': settings.persistentQueue,
    'setting-permanent-shuffle': !!settings.permanentShuffle,
    'setting-show-played-queue': !!settings.showPlayedInQueue,
    'setting-pip-on-top': settings.pipAlwaysOnTop !== false,
    'setting-track-notifications': !!settings.trackNotifications,
    'setting-auto-dl-like': !!settings.autoDownloadOnLike,
    'setting-skip-silence': !!settings.skipSilence,
    'setting-pause-zero-vol': !!settings.pauseOnZeroVol,
    'setting-auto-skip-error': settings.autoSkipOnError !== false,
    'setting-artist-split': settings.artistSplitSymbols || ', & feat. ft. x /',
    'setting-stop-on-close': settings.stopOnClose !== false,
    'setting-pause-history': !!settings.pauseHistory,
    'setting-high-contrast': !!settings.highContrast,
    'setting-large-text': !!settings.largeText,
    'setting-reduced-motion': !!settings.reducedMotion,
    'setting-country': settings.country,
    'setting-filter-explicit': !!settings.filterExplicit,
    'setting-aod-style': settings.aodStyle || 'ambient',
    'setting-aod-art-shape': settings.aodArtShape || 'rounded',
    'setting-aod-btn-style': settings.aodBtnStyle || 'rounded',
    'setting-aod-rel-size': settings.aodRelSize ?? 100,
    'setting-aod-darkness': settings.aodDarkness ?? 82,
    'setting-aod-show-clock': settings.aodShowClock !== false,
    'setting-aod-show-title': settings.aodShowTitle !== false,
    'setting-aod-show-artist': settings.aodShowArtist !== false,
    'setting-aod-show-time': settings.aodShowTime !== false,
    'setting-aod-show-progress': settings.aodShowProgress !== false,
    'setting-aod-show-controls': settings.aodShowControls !== false
  };
  Object.entries(controlMap).forEach(([id, val]) => setElementValue(id, val));

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color.toLowerCase() === c.toLowerCase());
  });
  document.querySelectorAll('.theme-preset-btn').forEach(btn => {
    const matchMode = btn.dataset.presetMode === settings.darkMode;
    const matchColor = (btn.dataset.presetColor || '').toLowerCase() === c.toLowerCase() && !settings.dynamicTheme;
    btn.classList.toggle('active', matchMode && matchColor);
  });

  if (typeof applyAudioDspNodes === 'function') applyAudioDspNodes();
  if (typeof syncNowPlayingUI === 'function' && state.currentTrack) {
    const formatPill = document.getElementById('np-track-format-pill');
    if (formatPill) {
      const qualMap = { high: 'M4A • 256 kbps', standard: 'OPUS • 160 kbps', low: 'AAC • 64 kbps' };
      formatPill.textContent = qualMap[settings.audioQuality] || 'OPUS • 160 kbps';
    }
  }
  if (typeof syncAodOverlay === 'function') syncAodOverlay();
}

let activeSettingsCat = 'all';
function applySettingsFilter(cat, rawQuery) {
  if (cat !== undefined && cat !== null) activeSettingsCat = cat || 'all';
  const query = String(rawQuery !== undefined ? rawQuery : (document.getElementById('settings-search-input')?.value || '')).trim().toLowerCase();

  document.querySelectorAll('.settings-bento-card[data-settings-cat], .settings-cat-chips .chip[data-settings-cat]').forEach((el) => {
    el.classList.toggle('active', el.dataset.settingsCat === activeSettingsCat);
  });

  const clearBtn = document.getElementById('settings-search-clear');
  if (clearBtn) clearBtn.style.display = query ? 'inline-flex' : 'none';

  document.querySelectorAll('#view-settings .settings-group').forEach((grp) => {
    const grpCat = grp.dataset.cat || 'all';
    const catMatch = (activeSettingsCat === 'all' || grpCat === activeSettingsCat) || Boolean(query);
    if (!catMatch) {
      grp.style.display = 'none';
      return;
    }

    if (!query) {
      grp.style.display = '';
      grp.querySelectorAll('.setting-item').forEach((item) => { item.style.display = ''; });
      return;
    }

    const headerText = (grp.querySelector('.settings-group-header')?.textContent || '').toLowerCase();
    const headerMatch = headerText.includes(query);
    let anyChildVisible = false;
    grp.querySelectorAll('.setting-item').forEach((item) => {
      const txt = (item.textContent || '').toLowerCase();
      const matched = headerMatch || txt.includes(query);
      item.style.display = matched ? '' : 'none';
      if (matched) anyChildVisible = true;
    });
    grp.style.display = (headerMatch || anyChildVisible) ? '' : 'none';
  });
}

function filterSettingsCategory(cat) {
  applySettingsFilter(cat, undefined);
}

function initSettingsListeners() {
  const bindings = [
    { id: 'setting-ui-theme-style', key: 'uiThemeStyle', type: 'value' },
    { id: 'setting-dark-mode', key: 'darkMode', type: 'value' },
    { id: 'setting-dynamic-theme', key: 'dynamicTheme', type: 'checked' },
    { id: 'setting-random-theme', key: 'randomTheme', type: 'checked' },
    { id: 'setting-liquid-glass', key: 'liquidGlass', type: 'checked', onSet: (v) => { if (v) settings.disableBlur = false; } },
    { id: 'setting-disable-blur', key: 'disableBlur', type: 'checked' },
    { id: 'setting-font-family', key: 'fontFamily', type: 'value' },
    { id: 'setting-show-home-chips', key: 'showHomeChips', type: 'checked' },
    { id: 'setting-grid-size', key: 'gridCellSize', type: 'value' },
    { id: 'setting-show-library-bento', key: 'showLibraryBento', type: 'checked' },
    { id: 'setting-player-design', key: 'playerDesign', type: 'value' },
    { id: 'setting-player-bg', key: 'playerBg', type: 'value' },
    { id: 'setting-player-buttons', key: 'playerButtons', type: 'value' },
    { id: 'setting-art-shape', key: 'artShape', type: 'value', onSet: (v) => {
      const presetRadius = { sharp: 4, rounded: 16, squircle: 28, circle: 44 }[v];
      if (presetRadius !== undefined) settings.artRadius = presetRadius;
    } },
    { id: 'setting-art-radius', key: 'artRadius', type: 'number', event: 'input' },
    { id: 'setting-crop-thumbs', key: 'cropThumbnails', type: 'checked' },
    { id: 'setting-hide-player-thumb', key: 'hidePlayerThumb', type: 'checked' },
    { id: 'setting-slider-style', key: 'sliderStyle', type: 'value', after: () => refreshVisualFrame(true) },
    { id: 'setting-lyrics-anim', key: 'lyricsAnim', type: 'value' },
    { id: 'setting-lyrics-blur', key: 'lyricsBlur', type: 'checked' },
    { id: 'setting-lyrics-align', key: 'lyricsAlign', type: 'value' },
    { id: 'setting-lyrics-size', key: 'lyricsSize', type: 'number', event: 'input' },
    { id: 'setting-lyrics-spacing', key: 'lyricsSpacing', type: 'float', event: 'input' },
    { id: 'setting-lyrics-autoscroll', key: 'lyricsAutoScroll', type: 'checked' },
    { id: 'setting-lyrics-click-seek', key: 'lyricsClickSeek', type: 'checked' },
    { id: 'setting-smooth-animations', key: 'smoothAnimations', type: 'checked' },
    { id: 'setting-audio-quality', key: 'audioQuality', type: 'value' },
    { id: 'setting-audio-normalization', key: 'audioNormalization', type: 'checked' },
    { id: 'setting-loudness-boost', key: 'loudnessBoost', type: 'number', event: 'input' },
    { id: 'setting-crossfade', key: 'crossfade', type: 'number' },
    { id: 'setting-fast-seek', key: 'fastSeek', type: 'number' },
    { id: 'setting-autoplay-radio', key: 'autoplayRadio', type: 'checked' },
    { id: 'setting-persistent-queue', key: 'persistentQueue', type: 'checked' },
    { id: 'setting-permanent-shuffle', key: 'permanentShuffle', type: 'checked', onSet: (v) => {
      if (v) {
        state.isShuffle = true;
        rebuildShuffleBag(state.queueIndex);
        updateShuffleRepeatUI();
      }
    } },
    { id: 'setting-auto-dl-like', key: 'autoDownloadOnLike', type: 'checked' },
    { id: 'setting-skip-silence', key: 'skipSilence', type: 'checked' },
    { id: 'setting-pause-zero-vol', key: 'pauseOnZeroVol', type: 'checked' },
    { id: 'setting-auto-skip-error', key: 'autoSkipOnError', type: 'checked' },
    { id: 'setting-artist-split', key: 'artistSplitSymbols', type: 'value' },
    { id: 'setting-stop-on-close', key: 'stopOnClose', type: 'checked' },
    { id: 'setting-pause-history', key: 'pauseHistory', type: 'checked' },
    { id: 'setting-high-contrast', key: 'highContrast', type: 'checked' },
    { id: 'setting-large-text', key: 'largeText', type: 'checked' },
    { id: 'setting-reduced-motion', key: 'reducedMotion', type: 'checked' },
    { id: 'setting-country', key: 'country', type: 'value' },
    { id: 'setting-filter-explicit', key: 'filterExplicit', type: 'checked' },
    { id: 'setting-aod-style', key: 'aodStyle', type: 'value' },
    { id: 'setting-aod-art-shape', key: 'aodArtShape', type: 'value' },
    { id: 'setting-aod-btn-style', key: 'aodBtnStyle', type: 'value' },
    { id: 'setting-aod-rel-size', key: 'aodRelSize', type: 'number', event: 'input' },
    { id: 'setting-aod-darkness', key: 'aodDarkness', type: 'number', event: 'input' },
    { id: 'setting-aod-show-clock', key: 'aodShowClock', type: 'checked' },
    { id: 'setting-aod-show-title', key: 'aodShowTitle', type: 'checked' },
    { id: 'setting-aod-show-artist', key: 'aodShowArtist', type: 'checked' },
    { id: 'setting-aod-show-time', key: 'aodShowTime', type: 'checked' },
    { id: 'setting-aod-show-progress', key: 'aodShowProgress', type: 'checked' },
    { id: 'setting-aod-show-controls', key: 'aodShowControls', type: 'checked' },
    { id: 'setting-compact-sidebar', key: 'compactSidebar', type: 'checked' },
    { id: 'setting-bar-expand', key: 'clickBarToExpand', type: 'checked' },
    { id: 'setting-audio-output', key: 'audioOutputId', type: 'value' },
    { id: 'setting-show-played-queue', key: 'showPlayedInQueue', type: 'checked' },
    { id: 'setting-pip-on-top', key: 'pipAlwaysOnTop', type: 'checked', after: (v) => {
      if (state.isMiniPlayer && window.api?.setMiniPlayer) {
        window.api.setMiniPlayer({ enable: true, alwaysOnTop: v !== false });
      }
    } },
    { id: 'setting-track-notifications', key: 'trackNotifications', type: 'checked', onSet: (v) => {
      if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } }
  ];

  bindings.forEach((b) => {
    const el = document.getElementById(b.id);
    if (!el) return;
    el.addEventListener(b.event || 'change', (e) => {
      const val = b.type === 'checked'
        ? e.target.checked
        : b.type === 'number'
          ? parseInt(e.target.value, 10)
          : b.type === 'float'
            ? parseFloat(e.target.value)
            : e.target.value;
      settings[b.key] = val;
      if (b.onSet) b.onSet(val);
      saveSettings();
      if (b.after) b.after(val);
    });
  });

  document.querySelectorAll('.settings-bento-card[data-settings-cat], .settings-cat-chips .chip[data-settings-cat]').forEach((el) => {
    el.addEventListener('click', () => filterSettingsCategory(el.dataset.settingsCat));
  });

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      settings.accentColor = sw.dataset.color;
      settings.dynamicTheme = false; // Selecting a palette swatch switches immediately to chosen color
      saveSettings();
    });
  });

  document.getElementById('setting-custom-color')?.addEventListener('input', (e) => {
    settings.accentColor = e.target.value;
    settings.dynamicTheme = false;
    saveSettings();
  });

  document.getElementById('btn-reset-all-settings')?.addEventListener('click', () => {
    settings = { ...defaultSettings };
    saveSettings();
    showToast('Settings restored to defaults', 'info');
  });

  document.getElementById('btn-launch-aod')?.addEventListener('click', () => openAodMode());
  document.getElementById('btn-launch-aod-group')?.addEventListener('click', () => openAodMode());

  const settingsSearchInput = document.getElementById('settings-search-input');
  const settingsSearchClear = document.getElementById('settings-search-clear');
  settingsSearchInput?.addEventListener('input', (e) => applySettingsFilter(undefined, e.target.value));
  settingsSearchClear?.addEventListener('click', () => {
    if (settingsSearchInput) settingsSearchInput.value = '';
    applySettingsFilter(undefined, '');
    settingsSearchInput?.focus();
  });

  document.querySelectorAll('.theme-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.presetMode;
      const color = btn.dataset.presetColor;
      const style = btn.dataset.presetStyle;
      if (mode) settings.darkMode = mode;
      if (color) settings.accentColor = color;
      if (style) settings.uiThemeStyle = style;
      settings.dynamicTheme = false;
      saveSettings();
      showToast(`Applied ${btn.textContent.trim()} theme`, 'success', 1800);
    });
  });

  const refreshAudioOutputs = async () => {
    const sel = document.getElementById('setting-audio-output');
    if (!sel || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      sel.innerHTML = '<option value="">System Default Output</option>';
      outputs.forEach((dev, idx) => {
        if (!dev.deviceId || dev.deviceId === 'default') return;
        const opt = document.createElement('option');
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `Audio Output ${idx + 1}`;
        sel.appendChild(opt);
      });
      sel.value = settings.audioOutputId || '';
    } catch (_) {}
  };
  refreshAudioOutputs();
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioOutputs);
  document.getElementById('np-aod-btn')?.addEventListener('click', () => openAodMode());

  document.getElementById('btn-choose-download-dir')?.addEventListener('click', async () => {
    try {
      const res = await window.api.chooseDownloadFolder();
      if (!res?.canceled && res?.downloadDir) {
        settings.downloadPath = res.downloadDir;
        saveSettings();
      }
    } catch (err) {
      alert(`Could not change folder: ${err.message}`);
    }
  });

  document.getElementById('btn-open-download-dir')?.addEventListener('click', async () => {
    await window.api.openDownloadFolder(settings.downloadPath || '');
  });

  document.getElementById('btn-reset-download-dir')?.addEventListener('click', async () => {
    try {
      const res = await window.api.setDownloadConfig({ downloadDir: '' });
      settings.downloadPath = '';
      if (res?.defaultDir) defaultDownloadDirCache = res.defaultDir;
      saveSettings();
    } catch (_) {}
  });

  document.getElementById('btn-clear-history-settings')?.addEventListener('click', () => {
    if (confirm('Clear all listening history tracks?')) {
      localStorage.removeItem('opentune_history');
      loadHistory();
      updateLibraryBentoCounts();
      alert('Listening history cleared.');
    }
  });

  document.getElementById('btn-reset-stats-settings')?.addEventListener('click', () => {
    if (confirm('Reset all listening statistics and play counts?')) {
      localStorage.removeItem('opentune_stats');
      loadStats();
      alert('Playback stats have been reset.');
    }
  });

  document.getElementById('btn-clear-cache-settings')?.addEventListener('click', async () => {
    try {
      await window.api.clearCache();
      alert('Audio stream and image cache cleared successfully!');
    } catch (err) {
      alert('Cache clean notice: ' + err.message);
    }
  });

  // Account Settings Actions
  document.getElementById('btn-settings-login')?.addEventListener('click', () => {
    if (loginModal) {
      loginModal.style.display = 'flex';
      setAuthTab('device');
    }
  });

  document.getElementById('btn-settings-sync-library')?.addEventListener('click', async () => {
    await syncLibrary();
    loadPlaylists();
    alert('YouTube Music playlists synchronized!');
  });

  document.getElementById('btn-settings-logout')?.addEventListener('click', async () => {
    if (confirm('Sign out of YouTube Music?')) {
      await window.api.signOut();
      updateAuthUI({ isLoggedIn: false });
    }
  });

  document.getElementById('btn-settings-save-cookie')?.addEventListener('click', async () => {
    const input = document.getElementById('settings-cookie-input');
    const val = (input?.value || '').trim();
    if (!val) {
      alert('Please enter a valid YouTube Music cookie string.');
      return;
    }
    const res = await window.api.saveManualCookie(val);
    if (res.success) {
      alert('YouTube Music cookie connected successfully!');
      if (input) input.value = '';
      updateAuthUI(res.profile);
    } else {
      alert(`Cookie connection failed: ${res.error}`);
    }
  });

  document.getElementById('setting-high-contrast')?.addEventListener('change', (e) => {
    settings.highContrast = e.target.checked;
    saveSettings();
  });

  document.getElementById('setting-large-text')?.addEventListener('change', (e) => {
    settings.largeText = e.target.checked;
    saveSettings();
  });

  document.getElementById('setting-reduced-motion')?.addEventListener('change', (e) => {
    settings.reducedMotion = e.target.checked;
    saveSettings();
  });

  document.getElementById('setting-country')?.addEventListener('change', (e) => {
    settings.country = e.target.value;
    saveSettings();
    loadHomeFeed();
  });

  document.getElementById('setting-filter-explicit')?.addEventListener('change', (e) => {
    settings.filterExplicit = e.target.checked;
    saveSettings();
  });

  const shortcutsModal = document.getElementById('shortcuts-modal');
  document.getElementById('btn-show-shortcuts')?.addEventListener('click', () => {
    if (shortcutsModal) shortcutsModal.style.display = 'flex';
  });
  document.getElementById('shortcuts-modal-close')?.addEventListener('click', () => {
    if (shortcutsModal) shortcutsModal.style.display = 'none';
  });
  shortcutsModal?.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) shortcutsModal.style.display = 'none';
  });

  document.getElementById('btn-export-backup')?.addEventListener('click', () => {
    const backupData = {
      version: '3.1.0',
      date: new Date().toISOString(),
      settings,
      likedSongs: state.likedSongsData,
      localPlaylists: getLocalPlaylists(),
      history: JSON.parse(localStorage.getItem('opentune_history') || '[]'),
      stats: JSON.parse(localStorage.getItem('opentune_stats') || '{}')
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opentune_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const fileInput = document.getElementById('file-import-backup');
  document.getElementById('btn-import-backup-trigger')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (imported.settings) {
          settings = { ...defaultSettings, ...imported.settings };
          saveSettings();
        }
        if (Array.isArray(imported.likedSongs)) {
          state.likedSongsData = imported.likedSongs;
          state.likedSongs = new Set(imported.likedSongs.map(t => t.id));
          localStorage.setItem('opentune_liked_songs', JSON.stringify(state.likedSongsData));
          renderLikedSongs();
        }
        if (Array.isArray(imported.localPlaylists)) {
          saveLocalPlaylists(imported.localPlaylists);
          loadPlaylists();
        }
        if (Array.isArray(imported.history)) {
          localStorage.setItem('opentune_history', JSON.stringify(imported.history));
        }
        if (imported.stats) {
          localStorage.setItem('opentune_stats', JSON.stringify(imported.stats));
        }
        alert('Backup successfully restored!');
      } catch (err) {
        alert('Failed to parse backup JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  });
}

function savePersistentQueue() {
  if (!settings.persistentQueue) return;
  try {
    const savedQueue = state.queue.slice(0, 100);
    const curTime = (audio && !isNaN(audio.currentTime) && audio.currentTime > 0)
      ? audio.currentTime
      : (state.savedPlaybackPosition || 0);
    const data = {
      queue: savedQueue,
      queueIndex: state.queueIndex,
      priorityNextIndices: (state.priorityNextIndices || []).filter(i => i >= 0 && i < savedQueue.length),
      currentTrack: state.currentTrack,
      currentTime: curTime,
      isShuffle: Boolean(state.isShuffle),
      repeatMode: state.repeatMode || 'none',
      savedAt: Date.now()
    };
    localStorage.setItem('opentune_saved_queue', JSON.stringify(data));
  } catch (_) {}
}

window.addEventListener('beforeunload', () => {
  if (typeof savePersistentQueue === 'function') savePersistentQueue();
});

function restorePersistentQueue() {
  if (!settings.persistentQueue) return;
  try {
    const raw = localStorage.getItem('opentune_saved_queue');
    if (raw) {
      const data = JSON.parse(raw);
      if (typeof data.isShuffle === 'boolean') state.isShuffle = data.isShuffle;
      if (['none', 'all', 'one'].includes(data.repeatMode)) state.repeatMode = data.repeatMode;

      if (Array.isArray(data.queue) && data.queue.length > 0) {
        state.queue = data.queue;
        state.queueIndex = (typeof data.queueIndex === 'number' && data.queueIndex >= 0 && data.queueIndex < data.queue.length)
          ? data.queueIndex
          : 0;
        state.priorityNextIndices = Array.isArray(data.priorityNextIndices)
          ? data.priorityNextIndices.filter(i => typeof i === 'number' && i >= 0 && i < data.queue.length && i !== state.queueIndex)
          : [];
        if (state.isShuffle) rebuildShuffleBag(state.queueIndex);

        const track = data.currentTrack || data.queue[state.queueIndex];
        if (track) {
          state.currentTrack = track;
          state.savedPlaybackPosition = Number(data.currentTime) || 0;
          const thumbUrl = upgradeCover(track.thumbnail, 800);
          document.getElementById('player-thumb').src = thumbUrl;
          syncPlayerTrackMetadataUI(track);
          timeTotal.textContent = track.duration || '--:--';
          if (state.savedPlaybackPosition > 0) {
            timeCurrent.textContent = formatDuration(state.savedPlaybackPosition);
            const totalSec = parseDurationToSeconds(track.duration);
            if (totalSec > 0) {
              const pct = Math.min(100, Math.max(0, (state.savedPlaybackPosition / totalSec) * 100));
              progressFill.style.width = `${pct}%`;
              const npFill = document.getElementById('np-progress-fill');
              if (npFill) npFill.style.width = `${pct}%`;
              const npCur = document.getElementById('np-time-current');
              if (npCur) npCur.textContent = formatDuration(state.savedPlaybackPosition);
            }
          }
          extractAlbumColors(thumbUrl);
          renderQueue();
          updateLikeButtonUI();
          syncNowPlayingUI();
        }
      }
      updateShuffleRepeatUI();
    }
  } catch (_) {}
}

// Custom Material 3 Frosted Select Dropdowns
const customSelectRegistry = [];
let activeCustomSelect = null;

function closeAllCustomSelects() {
  customSelectRegistry.forEach((entry) => {
    entry.wrapper.classList.remove('open');
    entry.menu.classList.remove('open');
  });
  activeCustomSelect = null;
}

function syncCustomSelectEntry(entry) {
  if (!entry) return;
  const currentVal = entry.select.value;
  let activeLabel = '';
  entry.optionBtns.forEach(({ opt, btn }) => {
    const isSel = opt.value === currentVal;
    btn.classList.toggle('selected', isSel);
    if (isSel) activeLabel = opt.textContent;
  });
  if (!activeLabel && entry.select.selectedOptions?.[0]) {
    activeLabel = entry.select.selectedOptions[0].textContent;
  }
  entry.labelEl.textContent = activeLabel || 'Select...';
}

function positionCustomSelectMenu(entry) {
  const rect = entry.trigger.getBoundingClientRect();
  const menu = entry.menu;
  menu.style.minWidth = `${Math.max(190, rect.width)}px`;

  // Measure menu height
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  const menuHeight = Math.min(280, menu.scrollHeight || 220);
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const openUpward = spaceBelow < menuHeight && rect.top > spaceBelow;

  const left = Math.max(8, Math.min(window.innerWidth - Math.max(196, rect.width) - 8, rect.left));
  const top = openUpward
    ? Math.max(8, rect.top - menuHeight - 6)
    : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.transformOrigin = openUpward ? 'bottom center' : 'top center';
  menu.style.visibility = 'visible';
}

function initCustomSelects() {
  const selects = document.querySelectorAll('select.setting-select');
  selects.forEach((selectEl) => {
    if (selectEl.dataset.m3Enhanced === '1') return;
    selectEl.dataset.m3Enhanced = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'm3-select';
    selectEl.parentNode.insertBefore(wrapper, selectEl);
    wrapper.appendChild(selectEl);
    selectEl.classList.add('m3-select-native');
    selectEl.tabIndex = -1;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'm3-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');

    const labelEl = document.createElement('span');
    labelEl.className = 'm3-select-label';

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2.2');
    chevron.setAttribute('stroke-linecap', 'round');
    chevron.setAttribute('stroke-linejoin', 'round');
    chevron.setAttribute('class', 'm3-select-chevron');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '6 9 12 15 18 9');
    chevron.appendChild(poly);

    trigger.appendChild(labelEl);
    trigger.appendChild(chevron);
    wrapper.appendChild(trigger);

    const menu = document.createElement('div');
    menu.className = 'm3-select-menu';
    menu.setAttribute('role', 'listbox');
    document.body.appendChild(menu);

    const optionBtns = [];
    Array.from(selectEl.options).forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'm3-select-option';
      btn.setAttribute('role', 'option');
      btn.innerHTML = `
        <span>${escapeHtmlSafe(opt.textContent)}</span>
        <svg class="m3-select-check" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectEl.value !== opt.value) {
          selectEl.value = opt.value;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncCustomSelectEntry(entry);
        closeAllCustomSelects();
        trigger.focus();
      });
      menu.appendChild(btn);
      optionBtns.push({ opt, btn });
    });

    const entry = { select: selectEl, wrapper, trigger, labelEl, menu, optionBtns };
    customSelectRegistry.push(entry);

    // Override .value setter on this select so programmatic updates always sync the custom trigger UI
    const protoDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (protoDescriptor && protoDescriptor.get && protoDescriptor.set) {
      Object.defineProperty(selectEl, 'value', {
        get() {
          return protoDescriptor.get.call(this);
        },
        set(val) {
          protoDescriptor.set.call(this, val);
          syncCustomSelectEntry(entry);
        }
      });
    }

    selectEl.addEventListener('change', () => syncCustomSelectEntry(entry));
    syncCustomSelectEntry(entry);

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !wrapper.classList.contains('open');
      closeAllCustomSelects();
      if (willOpen) {
        wrapper.classList.add('open');
        positionCustomSelectMenu(entry);
        activeCustomSelect = entry;
      }
    });
  });

  if (!window.__m3SelectListenersBound) {
    window.__m3SelectListenersBound = true;
    document.addEventListener('click', (e) => {
      if (activeCustomSelect && !e.target.closest('.m3-select') && !e.target.closest('.m3-select-menu')) {
        closeAllCustomSelects();
      }
    });
    window.addEventListener('resize', closeAllCustomSelects);
    window.addEventListener('scroll', (e) => {
      if (activeCustomSelect && e.target !== activeCustomSelect.menu) {
        closeAllCustomSelects();
      }
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeCustomSelect) {
        closeAllCustomSelects();
      }
    });
  }
}

let aodClockTimerId = null;

function syncAodOverlay() {
  const aod = document.getElementById('aod-overlay');
  if (!aod) return;

  aod.dataset.aodStyle = settings.aodStyle || 'ambient';
  aod.dataset.aodArtShape = settings.aodArtShape || 'rounded';
  aod.dataset.aodBtnStyle = settings.aodBtnStyle || 'rounded';

  const shapeRadii = { rounded: '22px', squircle: '34px', circle: '50%', diamond: '14px' };
  aod.style.setProperty('--aod-art-radius', shapeRadii[settings.aodArtShape] || '22px');
  aod.style.setProperty('--aod-rel-scale', String((Number(settings.aodRelSize) || 100) / 100));
  aod.style.setProperty('--aod-darkness', String((Number(settings.aodDarkness) || 82) / 100));

  const clockEl = document.getElementById('aod-clock');
  const titleEl = document.getElementById('aod-track-title');
  const artistEl = document.getElementById('aod-track-artist');
  const progEl = document.getElementById('aod-progress-wrap');
  const ctrlEl = document.getElementById('aod-controls');
  const curEl = document.getElementById('aod-time-cur');
  const totEl = document.getElementById('aod-time-tot');

  if (clockEl) {
    clockEl.style.display = settings.aodShowClock !== false ? 'block' : 'none';
    const d = new Date();
    clockEl.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (titleEl) titleEl.style.display = settings.aodShowTitle !== false ? 'block' : 'none';
  if (artistEl) artistEl.style.display = settings.aodShowArtist !== false ? 'block' : 'none';
  if (progEl) progEl.style.display = settings.aodShowProgress !== false ? 'flex' : 'none';
  if (ctrlEl) ctrlEl.style.display = settings.aodShowControls !== false ? 'flex' : 'none';
  const showTime = settings.aodShowTime !== false;
  if (curEl) curEl.style.display = showTime ? 'inline' : 'none';
  if (totEl) totEl.style.display = showTime ? 'inline' : 'none';

  const track = state.currentTrack;
  const img = document.getElementById('aod-cover-img');
  const bg = document.getElementById('aod-backdrop');
  if (track) {
    const cover = upgradeCover(track.thumbnail, 800);
    if (img) img.src = cover;
    if (bg) bg.style.backgroundImage = cover && cover !== 'assets/icon.png' ? `url("${cover}")` : 'none';
    if (titleEl) titleEl.textContent = track.title || 'OpenTune';
    if (artistEl) artistEl.textContent = cleanArtistName(track.artist) || 'Unknown Artist';
  }
  updatePlayPauseUI();
}

function openAodMode() {
  const aod = document.getElementById('aod-overlay');
  if (!aod) return;
  syncAodOverlay();
  aod.style.display = 'flex';
  refreshVisualFrame(true);
  if (aodClockTimerId) clearInterval(aodClockTimerId);
  aodClockTimerId = setInterval(() => syncAodOverlay(), 15000);
}

function closeAodMode() {
  const aod = document.getElementById('aod-overlay');
  if (aod) aod.style.display = 'none';
  if (aodClockTimerId) {
    clearInterval(aodClockTimerId);
    aodClockTimerId = null;
  }
}

document.getElementById('aod-exit-btn')?.addEventListener('click', closeAodMode);
document.getElementById('aod-play-pause-btn')?.addEventListener('click', () => btnPlayPause.click());
document.getElementById('aod-prev-btn')?.addEventListener('click', () => btnPrev.click());
document.getElementById('aod-next-btn')?.addEventListener('click', () => btnNext.click());

function updateLibraryBentoCounts() {
  const likedSub = document.getElementById('bento-liked-sub');
  const dlSub = document.getElementById('bento-downloaded-sub');
  const histSub = document.getElementById('bento-history-sub');
  if (likedSub) likedSub.textContent = `${state.likedSongsData?.length || 0} songs`;
  try {
    const dlList = JSON.parse(localStorage.getItem('opentune_downloaded_tracks') || '[]');
    if (dlSub) dlSub.textContent = `${Array.isArray(dlList) ? dlList.length : 0} offline tracks`;
  } catch (_) {}
  try {
    const histList = JSON.parse(localStorage.getItem('opentune_history') || '[]');
    if (histSub) histSub.textContent = `${Array.isArray(histList) ? histList.length : 0} recent listens`;
  } catch (_) {}
}

function initLibraryBentoListeners() {
  document.getElementById('bento-card-liked')?.addEventListener('click', () => navigateTo('liked'));
  document.getElementById('bento-card-top50')?.addEventListener('click', () => navigateTo('stats'));
  document.getElementById('bento-card-cached')?.addEventListener('click', () => navigateTo('history'));
  document.getElementById('bento-card-downloaded')?.addEventListener('click', () => {
    try {
      const saved = JSON.parse(localStorage.getItem('opentune_downloaded_tracks') || '[]');
      if (Array.isArray(saved) && saved.length > 0) {
        openPlaylistDetail({
          id: 'downloaded-offline',
          title: 'Downloaded Offline',
          thumbnail: saved[0]?.thumbnail || 'assets/icon.png',
          tracks: saved
        }, true, true);
        return;
      }
    } catch (_) {}
    window.api.openDownloadFolder(settings.downloadPath || '');
  });
}

// --- In-App Auto Update System (Windows & macOS) ---
function initAppUpdaterUI() {
  const banner = document.getElementById('app-update-banner');
  const bannerTitle = document.getElementById('update-banner-title');
  const bannerDesc = document.getElementById('update-banner-desc');
  const bannerActionBtn = document.getElementById('update-banner-action-btn');
  const bannerDismissBtn = document.getElementById('update-banner-dismiss-btn');
  const bannerProgressWrap = document.getElementById('update-banner-progress-wrap');
  const bannerProgressBar = document.getElementById('update-banner-progress-bar');

  const settingStatusText = document.getElementById('setting-update-status-text');
  const settingProgressWrap = document.getElementById('setting-update-progress-wrap');
  const settingProgressBar = document.getElementById('setting-update-progress-bar');
  const btnCheckUpdates = document.getElementById('btn-check-for-updates');
  const btnInstallNow = document.getElementById('btn-install-update-now');
  const versionBadge = document.getElementById('setting-app-version-badge');

  function formatUpdaterErrorMessage(rawError = '') {
    const errStr = String(rawError || '');
    if (errStr.includes('404') && (errStr.includes('releases.atom') || errStr.includes('authentication token') || errStr.includes('latest.yml') || errStr.includes('latest-mac.yml'))) {
      return 'No published update package found for this platform on GitHub. Check GitHub Releases for the latest DMG or installer.';
    }
    if (errStr.includes('Code signature') || errStr.includes('ShipIt') || errStr.includes('code object is not signed')) {
      return 'macOS requires an Apple Developer code-signed certificate for silent in-app updates. Download the latest DMG directly from GitHub Releases.';
    }
    if (errStr.includes('ERR_INTERNET_DISCONNECTED') || errStr.includes('ENOTFOUND')) {
      return 'Cannot connect to GitHub. Please check your internet connection.';
    }
    const firstLine = errStr.split('\n')[0].replace(/^Error:\s*/i, '').trim();
    return firstLine.slice(0, 160) || 'Could not check for updates.';
  }

  if (window.api?.getAppVersion) {
    window.api.getAppVersion().then(ver => {
      if (ver && versionBadge) versionBadge.textContent = `v${ver}`;
    }).catch(() => {});
  }

  bannerDismissBtn?.addEventListener('click', () => {
    if (banner) banner.style.display = 'none';
  });

  btnInstallNow?.addEventListener('click', () => {
    window.api?.installUpdateNow();
  });

  btnCheckUpdates?.addEventListener('click', async () => {
    btnCheckUpdates.disabled = true;
    const oldText = btnCheckUpdates.innerHTML;
    btnCheckUpdates.innerHTML = 'Checking...';
    if (settingStatusText) settingStatusText.textContent = 'Contacting GitHub Releases server...';

    try {
      const res = await window.api?.checkForUpdates();
      if (!res?.success) {
        const cleanErr = formatUpdaterErrorMessage(res?.error);
        if (settingStatusText) settingStatusText.textContent = cleanErr;
        showToast(cleanErr, 'error');
      }
    } catch (err) {
      const cleanErr = formatUpdaterErrorMessage(err.message);
      if (settingStatusText) settingStatusText.textContent = cleanErr;
    } finally {
      setTimeout(() => {
        btnCheckUpdates.disabled = false;
        btnCheckUpdates.innerHTML = oldText;
      }, 2000);
    }
  });

  if (window.api?.onUpdateStatus) {
    window.api.onUpdateStatus((data) => {
      if (!data) return;

      if (data.status === 'checking') {
        if (settingStatusText) settingStatusText.textContent = 'Checking for updates on GitHub...';
      } else if (data.status === 'available') {
        const verStr = data.version ? `v${data.version}` : 'New version';
        if (settingStatusText) settingStatusText.textContent = `Update ${verStr} available! Click download to proceed.`;
        if (banner) {
          if (bannerTitle) bannerTitle.textContent = `Update ${verStr} Available!`;
          if (bannerDesc) bannerDesc.textContent = `A new version of OpenTune is ready to download.`;
          if (bannerActionBtn) {
            bannerActionBtn.textContent = 'Download';
            bannerActionBtn.style.display = 'inline-flex';
            bannerActionBtn.disabled = false;
            bannerActionBtn.onclick = () => {
              bannerActionBtn.disabled = true;
              bannerActionBtn.textContent = 'Downloading...';
              window.api?.downloadUpdate();
            };
          }
          if (bannerProgressWrap) bannerProgressWrap.style.display = 'none';
          banner.style.display = 'block';
        }
      } else if (data.status === 'not-available') {
        const verStr = data.version ? `v${data.version}` : '';
        if (settingStatusText) settingStatusText.textContent = `OpenTune is up to date (${verStr}).`;
      } else if (data.status === 'downloading') {
        const pct = Math.max(0, Math.min(100, Number(data.percent) || 0));
        if (settingStatusText) settingStatusText.textContent = `Downloading update: ${pct}%...`;
        if (settingProgressWrap) {
          settingProgressWrap.style.display = 'block';
          if (settingProgressBar) settingProgressBar.style.width = `${pct}%`;
        }
        if (banner) {
          banner.style.display = 'block';
          if (bannerTitle) bannerTitle.textContent = `Downloading Update (${pct}%)...`;
          if (bannerDesc) bannerDesc.textContent = `Please wait while the update downloads in the background.`;
          if (bannerProgressWrap) {
            bannerProgressWrap.style.display = 'block';
            if (bannerProgressBar) bannerProgressBar.style.width = `${pct}%`;
          }
          if (bannerActionBtn) bannerActionBtn.style.display = 'none';
        }
      } else if (data.status === 'downloaded') {
        const verStr = data.version ? `v${data.version}` : '';
        if (settingStatusText) settingStatusText.textContent = `Update ${verStr} downloaded successfully! Restart to apply.`;
        if (settingProgressWrap) settingProgressWrap.style.display = 'none';
        if (btnInstallNow) btnInstallNow.style.display = 'inline-flex';

        if (banner) {
          banner.style.display = 'block';
          if (bannerTitle) bannerTitle.textContent = `Update ${verStr} Ready to Install!`;
          if (bannerDesc) bannerDesc.textContent = `Restart OpenTune to finish applying the update.`;
          if (bannerProgressWrap) bannerProgressWrap.style.display = 'none';
          if (bannerActionBtn) {
            bannerActionBtn.style.display = 'inline-flex';
            bannerActionBtn.textContent = 'Restart & Install';
            bannerActionBtn.disabled = false;
            bannerActionBtn.onclick = () => window.api?.installUpdateNow();
          }
        }
        showToast(`OpenTune ${verStr} downloaded! Ready to install. 🎉`, 'info', 5000);
      } else if (data.status === 'error') {
        const cleanErr = formatUpdaterErrorMessage(data.error);
        if (settingStatusText) settingStatusText.textContent = cleanErr;
        if (banner) banner.style.display = 'none';
      }
    });
  }
}

async function init() {
  initCustomSelects();
  loadSettings();
  initSettingsListeners();
  initLibraryBentoListeners();
  initEqualizerUI();

  if (settings.permanentShuffle) {
    state.isShuffle = true;
  }

  try {
    const dlCfg = await window.api.getDownloadConfig();
    if (dlCfg?.defaultDir) defaultDownloadDirCache = dlCfg.defaultDir;
    if (dlCfg?.downloadDir && !settings.downloadPath) {
      settings.downloadPath = dlCfg.downloadDir;
    }
    applySettings();
  } catch (_) {}

  loadLocalLikedSongs();
  restorePersistentQueue();
  if (settings.permanentShuffle && !state.isShuffle) {
    state.isShuffle = true;
    rebuildShuffleBag(state.queueIndex);
    updateShuffleRepeatUI();
  }
  updateLibraryBentoCounts();
  refreshVisualFrame();
  loadHomeFeed();

  try {
    const profile = await window.api.getAccountProfile();
    updateAuthUI(profile);
    if (profile?.isLoggedIn) {
      syncLibrary();
    }
  } catch (_) {}

  // Periodic background real-time sync (every 90s + when window regains focus)
  setInterval(async () => {
    try {
      const p = await window.api.getAccountProfile();
      if (p?.isLoggedIn) syncLibrary();
    } catch (_) {}
  }, 90000);

  window.addEventListener('focus', async () => {
    try {
      const activePlView = document.getElementById('view-playlist-detail')?.classList.contains('active');
      if (activePlView && state.activePlaylistId) {
        syncLinkedPlaylist(state.activePlaylistId, { quiet: true });
      }
    } catch (_) {}
  });
  initAppUpdaterUI();
}

init();
