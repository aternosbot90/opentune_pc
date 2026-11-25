/**
 * OpenTune Desktop – Material 3 Expressive shell behaviour (loaded after renderer.js).
 *  - navigation rail <-> compact/expanded mode, search item
 *  - header actions (history, stats, update bell, account avatar)
 *  - body.is-playing flag (drives cover morph / scale animations of the player designs)
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ---- rail mode follows the compact-sidebar setting & responsive width --------------
  const rail = $('sidebar-rail');
  let railSheet = null;
  let itemSheet = null;
  try {
    railSheet = new CSSStyleSheet();
    railSheet.replaceSync(`
      :host(:not(:is(:state(--compact), :--compact))) { width: 100% !important; display: block !important; }
      :host(:not(:is(:state(--compact), :--compact))) .base { width: 100% !important; align-items: stretch !important; }
    `);
    itemSheet = new CSSStyleSheet();
    itemSheet.replaceSync(`
      :host(:not([orientation="vertical"])) { max-width: 100% !important; width: 100% !important; flex: none !important; display: block !important; }
      :host(:not([orientation="vertical"])) .outer { width: 100% !important; }
      :host(:not([orientation="vertical"])) .inner { width: 100% !important; justify-content: flex-start !important; }
      :host(:not([orientation="vertical"])) .indicator { width: 100% !important; margin-inline: 0 !important; }
      :host(:not([orientation="vertical"])) .base { width: 100% !important; justify-content: flex-start !important; }
    `);
  } catch (_) {}

  function injectRailShadowStyles() {
    if (rail?.shadowRoot && railSheet && !rail.shadowRoot.adoptedStyleSheets.includes(railSheet)) {
      rail.shadowRoot.adoptedStyleSheets = [...rail.shadowRoot.adoptedStyleSheets, railSheet];
    }
    if (itemSheet) {
      rail?.querySelectorAll('m3e-nav-item').forEach((it) => {
        if (it.shadowRoot && !it.shadowRoot.adoptedStyleSheets.includes(itemSheet)) {
          it.shadowRoot.adoptedStyleSheets = [...it.shadowRoot.adoptedStyleSheets, itemSheet];
        }
      });
    }
  }

  function syncRailMode() {
    if (!rail) return;
    const isMobileViewport = window.innerWidth <= 820;
    const compact = !isMobileViewport && document.body.classList.contains('compact-sidebar');
    rail.setAttribute('mode', compact ? 'compact' : 'expanded');
    rail.querySelectorAll('m3e-nav-item').forEach((it) => {
      if (compact) it.setAttribute('orientation', 'vertical'); else it.removeAttribute('orientation');
    });
    injectRailShadowStyles();
  }
  new MutationObserver(syncRailMode).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', syncRailMode);
  syncRailMode();
  setTimeout(injectRailShadowStyles, 120);

  // Search entry of the rail: show the search view and focus the field
  rail?.querySelector('[data-view="search"]')?.addEventListener('click', () => {
    setTimeout(() => $('search-input')?.focus(), 30);
  });

  // ---- header actions -----------------------------------------------------------------
  $('header-history-btn')?.addEventListener('click', () => navigateTo('history'));
  $('header-stats-btn')?.addEventListener('click', () => navigateTo('stats'));

  $('header-notif-btn')?.addEventListener('click', async () => {
    try {
      showToast?.('Checking for updates…');
      const res = await window.api?.checkForUpdates?.();
      if (res && res.error) showToast?.('Update check failed');
    } catch (_) { showToast?.('Update check failed'); }
  });
  window.api?.onUpdateStatus?.((s) => {
    const dot = $('header-notif-dot');
    if (dot && s && (s.status === 'available' || s.status === 'downloaded' || s.available)) dot.hidden = false;
  });

  // account avatar mirrors the sidebar user card; click opens login or the account section
  const avatarBtn = $('header-avatar-btn');
  const avatarImg = $('header-avatar-img');
  const sideAvatar = $('user-avatar');
  function syncAvatar() {
    const src = sideAvatar?.getAttribute('src');
    if (avatarImg) avatarImg.src = src && src.length > 4 ? src : 'assets/icon.png';
  }
  if (sideAvatar) new MutationObserver(syncAvatar).observe(sideAvatar, { attributes: true, attributeFilter: ['src'] });
  syncAvatar();
  avatarBtn?.addEventListener('click', () => {
    const loggedIn = $('user-logged-in-box') && $('user-logged-in-box').style.display !== 'none';
    if (loggedIn) navigateTo('settings');
    else $('login-btn')?.click();
  });


  // =====================================================================================
  // Mobile-parity features: Speed dial, Forgotten favorites, scrobbling
  // =====================================================================================
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  function buildTile(kind, title, sub, thumb, onClick, onContext) {
    const el = document.createElement('div');
    el.className = `keep-tile ${kind}`;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const art = document.createElement('div');
    art.className = 'keep-art';
    const img = document.createElement('img');
    img.loading = 'lazy'; img.alt = ''; img.src = upgradeCover(thumb, 360);
    img.onerror = () => { if (typeof handleCoverError === 'function') handleCoverError(img); else img.src = 'assets/icon.png'; };
    art.appendChild(img);
    const t = document.createElement('div'); t.className = 'keep-title'; t.textContent = title;
    const s = document.createElement('div'); s.className = 'keep-sub'; s.textContent = sub;
    el.append(art, t, s);
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    if (onContext) el.addEventListener('contextmenu', (e) => { e.preventDefault(); onContext(); });
    return el;
  }

  // ---- Speed dial (pinned songs, stored locally) ---------------------------------------
  const SD_KEY = 'opentune_speed_dial';
  const speedDial = () => lsGet(SD_KEY, []).filter((t) => t && t.id);
  const isPinned = (id) => speedDial().some((t) => t.id === id);

  function togglePin(track) {
    if (!track || !track.id) return false;
    let list = speedDial();
    const pinned = list.some((t) => t.id === track.id);
    list = pinned ? list.filter((t) => t.id !== track.id)
      : [{ id: track.id, title: track.title, artist: track.artist, album: track.album || '', duration: track.duration || '', thumbnail: track.thumbnail || '' }, ...list].slice(0, 24);
    lsSet(SD_KEY, list);
    renderSpeedDial();
    return !pinned;
  }

  function renderSpeedDial() {
    const sec = $('home-speeddial-section'); const row = $('home-speeddial-row');
    if (!sec || !row) return;
    const list = speedDial();
    row.innerHTML = '';
    sec.hidden = list.length === 0;
    list.forEach((track) => row.appendChild(buildTile('keep-track', track.title || 'Unknown', track.artist || '', track.thumbnail,
      () => playTrack(track, list),
      () => { togglePin(track); showToast?.('Removed from Speed dial'); })));
  }

  $('ctx-pin-speed-dial')?.addEventListener('click', () => {
    const track = state.selectedContextTrack;
    $('song-context-menu').style.display = 'none';
    if (!track) return;
    showToast?.(togglePin(track) ? 'Pinned to Speed dial' : 'Removed from Speed dial');
  });
  const ctxMenu = $('song-context-menu');
  if (ctxMenu) {
    new MutationObserver(() => {
      if (ctxMenu.style.display === 'block') {
        const t = state.selectedContextTrack;
        const label = $('ctx-pin-text');
        if (label) label.textContent = t && isPinned(t.id) ? 'Unpin from Speed dial' : 'Pin to Speed dial';
      }
    }).observe(ctxMenu, { attributes: true, attributeFilter: ['style'] });
  }

  // ---- Forgotten favorites: liked songs you have not played lately ------------------------
  function renderForgotten() {
    const sec = $('home-forgotten-section'); const row = $('home-forgotten-row');
    if (!sec || !row) return;
    const recent = new Set(lsGet('opentune_history', []).slice(0, 40).map((t) => t.id));
    const liked = (Array.isArray(state.likedSongsData) ? state.likedSongsData : []).filter((t) => t && t.id && t.thumbnail && !recent.has(t.id));
    // stable per-day shuffle so the row does not jump around on every visit
    const day = Math.floor(Date.now() / 864e5);
    const rank = (id) => { let h = day; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; };
    const picks = liked.sort((a, b) => rank(a.id) - rank(b.id)).slice(0, 14);
    row.innerHTML = '';
    sec.hidden = picks.length < 3;
    if (picks.length < 3) return;
    picks.forEach((track) => row.appendChild(buildTile('keep-track', track.title || 'Unknown', track.artist || '', track.thumbnail, () => playTrack(track, picks))));
  }

  const _renderKeepListening = typeof renderKeepListening === 'function' ? renderKeepListening : () => {};
  renderKeepListening = function () { _renderKeepListening(); renderSpeedDial(); renderForgotten(); };
  renderSpeedDial(); renderForgotten();

  // ---- Scrobbling -------------------------------------------------------------------------------
  const scrobbleConfig = () => {
    const cfg = {};
    if (settings.scrobbleLb && settings.lbToken) cfg.listenbrainz = { token: settings.lbToken };
    if (settings.scrobbleLfm && settings.lfmSession && settings.lfmApiKey && settings.lfmSecret) {
      cfg.lastfm = { apiKey: settings.lfmApiKey, secret: settings.lfmSecret, sessionKey: settings.lfmSession };
    }
    return cfg;
  };
  const SCR = { id: null, startedAt: 0, listened: 0, lastT: null, sentNow: false, scrobbled: false, track: null };

  function scrobbleReset(track) {
    SCR.id = track ? track.id : null; SCR.track = track || null;
    SCR.startedAt = Math.floor(Date.now() / 1000); SCR.listened = 0; SCR.lastT = null; SCR.sentNow = false; SCR.scrobbled = false;
  }
  async function scrobbleSend(kind, track, at) {
    const config = scrobbleConfig();
    if (!Object.keys(config).length || !window.api?.scrobbleSubmit) return null;
    try { return await window.api.scrobbleSubmit({ config, kind, track, listenedAt: at }); } catch (_) { return null; }
  }
  const durationOf = (t) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    const p = String(t?.duration || '').split(':').map(Number);
    return p.length && !p.some(Number.isNaN) ? p.reduce((a, n) => a * 60 + n, 0) : 0;
  };
  function scrobbleTrack() {
    const cur = state.currentTrack;
    if (!cur || !cur.id) return null;
    if (SCR.id !== cur.id) scrobbleReset(cur);
    return cur;
  }
  audio.addEventListener('playing', () => {
    const cur = scrobbleTrack();
    if (cur && !SCR.sentNow) { SCR.sentNow = true; scrobbleSend('now', cur); }
  });
  audio.addEventListener('pause', () => { SCR.lastT = null; });
  audio.addEventListener('seeking', () => { SCR.lastT = null; });
  audio.addEventListener('timeupdate', () => {
    const cur = scrobbleTrack();
    if (!cur || audio.paused) return;
    const t = audio.currentTime;
    if (SCR.lastT !== null) { const d = t - SCR.lastT; if (d > 0 && d < 2.5) SCR.listened += d; }
    SCR.lastT = t;
    const dur = durationOf(cur);
    if (!SCR.scrobbled && dur >= 30 && SCR.listened >= Math.min(dur / 2, 240)) {
      SCR.scrobbled = true;
      scrobbleSend('listen', cur, SCR.startedAt);
    }
  });
  audio.addEventListener('ended', () => scrobbleReset(null));
  window.__scrobbleState = SCR; // exposed for tests

  // dialog wiring
  const dlg = $('scrobble-modal');
  const setStatus = (id, text, cls) => { const el = $(id); if (el) { el.textContent = text || ''; el.className = 'scrobble-status' + (cls ? ' ' + cls : ''); } };
  const setSwitch = (id, v) => { const el = $(id); if (el) { el.checked = !!v; if (v) el.setAttribute('checked', ''); else el.removeAttribute('checked'); } };
  function fillScrobbleDialog() {
    setSwitch('scrobble-lb-enabled', settings.scrobbleLb);
    setSwitch('scrobble-lfm-enabled', settings.scrobbleLfm);
    $('scrobble-lb-token').value = settings.lbToken || '';
    $('scrobble-lfm-key').value = settings.lfmApiKey || '';
    $('scrobble-lfm-secret').value = settings.lfmSecret || '';
    $('scrobble-lfm-user').value = settings.lfmUser || '';
    $('scrobble-lfm-pass').value = '';
    setStatus('scrobble-lb-status', settings.lbToken ? 'Token saved' : '');
    setStatus('scrobble-lfm-status', settings.lfmSession ? `Signed in as ${settings.lfmUser || 'user'}` : '', settings.lfmSession ? 'ok' : '');
  }
  $('btn-open-scrobble')?.addEventListener('click', () => { fillScrobbleDialog(); dlg?.show(); });
  $('scrobble-modal-close')?.addEventListener('click', () => dlg?.hide());
  $('scrobble-done')?.addEventListener('click', () => {
    settings.lbToken = $('scrobble-lb-token').value.trim();
    settings.lfmApiKey = $('scrobble-lfm-key').value.trim();
    settings.lfmSecret = $('scrobble-lfm-secret').value.trim();
    settings.scrobbleLb = !!$('scrobble-lb-enabled').checked;
    settings.scrobbleLfm = !!$('scrobble-lfm-enabled').checked;
    saveSettings();
    dlg?.hide();
    showToast?.(settings.scrobbleLb || settings.scrobbleLfm ? 'Scrobbling settings saved' : 'Scrobbling is off');
  });
  $('scrobble-lb-test')?.addEventListener('click', async () => {
    const token = $('scrobble-lb-token').value.trim();
    if (!token) { setStatus('scrobble-lb-status', 'Enter a token first', 'err'); return; }
    setStatus('scrobble-lb-status', 'Checking…');
    const r = await window.api.scrobbleTestListenBrainz({ token });
    if (r && r.ok) { setStatus('scrobble-lb-status', `Valid · ${r.user || 'user'}`, 'ok'); }
    else setStatus('scrobble-lb-status', (r && r.error) || 'Invalid token', 'err');
  });
  $('scrobble-lfm-login')?.addEventListener('click', async () => {
    const apiKey = $('scrobble-lfm-key').value.trim(); const secret = $('scrobble-lfm-secret').value.trim();
    const username = $('scrobble-lfm-user').value.trim(); const password = $('scrobble-lfm-pass').value;
    if (!apiKey || !secret || !username || !password) { setStatus('scrobble-lfm-status', 'Fill every field', 'err'); return; }
    setStatus('scrobble-lfm-status', 'Signing in…');
    const r = await window.api.scrobbleLastfmLogin({ apiKey, secret, username, password });
    if (r && r.ok) {
      settings.lfmApiKey = apiKey; settings.lfmSecret = secret; settings.lfmUser = r.user || username; settings.lfmSession = r.sessionKey;
      saveSettings();
      $('scrobble-lfm-pass').value = '';
      setStatus('scrobble-lfm-status', `Signed in as ${settings.lfmUser}`, 'ok');
    } else setStatus('scrobble-lfm-status', (r && r.error) || 'Login failed', 'err');
  });

  // ---- playing flag ----------------------------------------------------------------------
  if (typeof audio !== 'undefined' && audio) {
    const set = (v) => document.body.classList.toggle('is-playing', v);
    audio.addEventListener('playing', () => set(true));
    audio.addEventListener('play', () => set(true));
    audio.addEventListener('pause', () => set(false));
    audio.addEventListener('ended', () => set(false));
  }
})();
