'use strict';
/**
 * Scrobbling (parity with OpenTune Android): ListenBrainz + Last.fm.
 * Runs in the Electron main process (no CORS issues, credentials never touch the page origin).
 * `baseUrl` overrides exist for self-hosted ListenBrainz and for tests.
 */
const crypto = require('crypto');

const UA = 'OpenTuneDesktop/1.0 (https://github.com/Arturo254/OpenTune)';
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

async function http(url, opts = {}, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    let body = null;
    try { body = await res.json(); } catch (_) { /* empty body */ }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err && err.name === 'AbortError' ? 'timeout' : String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

const seconds = (d) => {
  if (typeof d === 'number') return Math.round(d);
  const parts = String(d || '').split(':').map(Number);
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((a, n) => a * 60 + n, 0);
};

// ----------------------------------------------------------------------------- ListenBrainz
const lbBase = (cfg) => String(cfg.baseUrl || 'https://api.listenbrainz.org').replace(/\/+$/, '');

async function lbValidate(cfg) {
  const r = await http(`${lbBase(cfg)}/1/validate-token`, { headers: { Authorization: `Token ${cfg.token}` } });
  return { ok: r.ok && !!(r.body && r.body.valid), user: r.body && r.body.user_name, error: r.error || (r.body && r.body.message) };
}

async function lbSubmit(cfg, kind, track, listenedAt) {
  const meta = {
    artist_name: track.artist || 'Unknown Artist',
    track_name: track.title || 'Unknown Title',
    additional_info: {
      media_player: 'OpenTune Desktop',
      submission_client: 'OpenTune Desktop',
      music_service: 'youtube.com',
      origin_url: track.id ? `https://music.youtube.com/watch?v=${track.id}` : undefined,
      duration_ms: seconds(track.duration) * 1000 || undefined
    }
  };
  if (track.album) meta.release_name = track.album;
  const payload = kind === 'now'
    ? { listen_type: 'playing_now', payload: [{ track_metadata: meta }] }
    : { listen_type: 'single', payload: [{ listened_at: Math.floor(listenedAt || Date.now() / 1000), track_metadata: meta }] };
  const r = await http(`${lbBase(cfg)}/1/submit-listens`, {
    method: 'POST',
    headers: { Authorization: `Token ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { ok: r.ok, status: r.status, error: r.error || (!r.ok && r.body && (r.body.error || r.body.message)) || undefined };
}

// ----------------------------------------------------------------------------- Last.fm
const lfmBase = (cfg) => cfg.baseUrl || 'https://ws.audioscrobbler.com/2.0/';

function lfmSign(params, secret) {
  const s = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback')
    .sort()
    .map((k) => k + params[k])
    .join('');
  return md5(s + secret);
}

async function lfmCall(cfg, method, params) {
  const p = { method, api_key: cfg.apiKey, ...params };
  if (cfg.sessionKey) p.sk = cfg.sessionKey;
  p.api_sig = lfmSign(p, cfg.secret);
  p.format = 'json';
  const r = await http(lfmBase(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(p).toString()
  });
  const lfmErr = r.body && r.body.error ? (r.body.message || `error ${r.body.error}`) : undefined;
  return { ok: r.ok && !lfmErr, body: r.body, error: r.error || lfmErr };
}

async function lfmLogin(cfg) {
  const r = await lfmCall({ ...cfg, sessionKey: undefined }, 'auth.getMobileSession', { username: cfg.username, password: cfg.password });
  const s = r.body && r.body.session;
  return s && s.key ? { ok: true, sessionKey: s.key, user: s.name } : { ok: false, error: r.error || 'Login failed' };
}

async function lfmSubmit(cfg, kind, track, listenedAt) {
  const base = { artist: track.artist || 'Unknown Artist', track: track.title || 'Unknown Title' };
  if (track.album) base.album = track.album;
  const dur = seconds(track.duration);
  if (kind === 'now') {
    if (dur) base.duration = String(dur);
    return lfmCall(cfg, 'track.updateNowPlaying', base);
  }
  return lfmCall(cfg, 'track.scrobble', { ...base, timestamp: String(Math.floor(listenedAt || Date.now() / 1000)) });
}

// ----------------------------------------------------------------------------- facade
/** config: { listenbrainz?: {token, baseUrl?}, lastfm?: {apiKey, secret, sessionKey, baseUrl?} } (only enabled services present) */
async function submit(config, kind, track, listenedAt) {
  const out = {};
  const jobs = [];
  if (config && config.listenbrainz && config.listenbrainz.token) {
    jobs.push(lbSubmit(config.listenbrainz, kind, track, listenedAt).then((r) => { out.listenbrainz = r; }));
  }
  if (config && config.lastfm && config.lastfm.sessionKey) {
    jobs.push(lfmSubmit(config.lastfm, kind, track, listenedAt).then((r) => { out.lastfm = { ok: r.ok, error: r.error }; }));
  }
  await Promise.all(jobs);
  return out;
}

module.exports = { submit, lbValidate, lbSubmit, lfmLogin, lfmSubmit, lfmSign, seconds };
