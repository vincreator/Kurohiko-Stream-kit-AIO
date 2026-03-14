/**
 * server.js — KSK Express + Socket.IO server
 *
 * Berjalan sebagai child process yang di-fork oleh electron/main.js,
 * atau standalone (node server.js) untuk mode dev/Docker.
 *
 * Port default: 3000 (bisa di-override via env PORT)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { execFile, execFileSync } = require('child_process');
const archiver = require('archiver');  // buat zip backup
const unzipper = require('unzipper'); // ekstrak zip restore

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── PATHS ────────────────────────────────────────────────
// Di Electron: BASE_DIR = AppData user (bisa diubah lewat Settings)
// Di standalone: BASE_DIR = folder project (__dirname)
const IS_ELECTRON = !!process.env.ELECTRON;
const BASE_DIR    = IS_ELECTRON
  ? process.env.USER_DATA_DIR  // dikirim dari main.js via env
  : __dirname;

// MEDIA_DIR bisa di-override oleh Electron saat user ganti folder assets
const MEDIA_DIR  = process.env.ASSETS_DIR_OVERRIDE || process.env.MEDIA_DIR || path.join(BASE_DIR, 'assets');
const META_FILE  = path.join(BASE_DIR, 'meta.json');        // settings per-media (volume, duration, dll)
const THUMB_DIR  = path.join(BASE_DIR, 'thumbs');           // thumbnail video yang di-cache ffmpeg
const TEXT_DIR   = path.join(MEDIA_DIR, 'text');            // file .txt untuk counter OBS
const COUNTER_META       = path.join(BASE_DIR, 'counters.json');       // daftar nama counter
const DECK_SETTINGS_FILE = path.join(BASE_DIR, 'deck_settings.json'); // layout & tombol custom deck
const STATS_FILE         = path.join(BASE_DIR, 'stats.json');          // statistik trigger
const CONFIG_FILE        = path.join(BASE_DIR, 'config.json');         // config app (folder assets, dll)
const DONATION_CONFIG_FILE = path.join(BASE_DIR, 'donation_config.json'); // config donation alert
const DONATIONS_FILE       = path.join(BASE_DIR, 'donations.json');       // riwayat 50 donasi terakhir
const TIMER_CONFIG_FILE    = path.join(BASE_DIR, 'timer_config.json');     // config widget timer/countdown
const CHAT_COMMANDS_FILE   = path.join(BASE_DIR, 'chat_commands.json');    // config chat command trigger
const CHAT_EVENTS_FILE     = path.join(BASE_DIR, 'chat_events.json');      // history chat trigger terbaru
const PORT               = parseInt(process.env.PORT || '3000', 10);

// Bikin folder kalau belum ada
[MEDIA_DIR, THUMB_DIR, TEXT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

console.log(`[paths] base=${BASE_DIR}`);
console.log(`[paths] media=${MEDIA_DIR}`);
console.log(`[paths] mode=${IS_ELECTRON ? 'electron' : 'standalone'}`);

// ── MIDDLEWARE ───────────────────────────────────────────
// Limit 50mb untuk support upload JSON besar (misal deck settings dengan banyak tombol)
app.use(express.json({ limit: '50mb' }));

// IS_PACKAGED: deteksi apakah berjalan dalam Electron packaged build.
// process.resourcesPath adalah property Electron — TIDAK tersedia di child process fork.
// Karena itu main.js meneruskannya via env var RESOURCES_PATH.
const IS_PACKAGED = IS_ELECTRON && !!process.env.RESOURCES_PATH;
const APP_PATH = IS_PACKAGED
  ? path.join(process.env.RESOURCES_PATH, 'app.asar')
  : __dirname;

app.use(express.static(path.join(APP_PATH, 'public')));
app.use('/lang', express.static(path.join(APP_PATH, 'lang')));
// ksk-ui.js di-serve manual agar bisa diakses dari semua halaman
app.get('/ksk-ui.js', (req, res) =>
  res.sendFile(path.join(APP_PATH, 'ksk-ui.js'))
);

// Redirect shortcut /customdeck → customdeck.html
app.get('/customdeck', (req, res) => res.sendFile(path.join(APP_PATH, 'public', 'customdeck.html')));

// Assets (gambar, video, audio) disajikan dari folder data user, bukan app.asar
app.use('/assets', express.static(MEDIA_DIR));

// ── META HELPERS ─────────────────────────────────────────
// Pola: read-through cache + write-through ke disk.
// Cache di memori agar tidak baca disk setiap request.
// Saat write: update cache dulu, lalu tulis disk — data tidak pernah stale.
let _metaCache = null;
function loadMeta() {
  if (_metaCache) return _metaCache;
  try { _metaCache = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); }
  catch { _metaCache = {}; } // file belum ada → default kosong
  return _metaCache;
}
function saveMeta(meta) {
  try {
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
    _metaCache = meta;
    return true;
  } catch(e) { console.error('saveMeta failed:', e.message); return false; }
}

// ── STATS HELPERS ────────────────────────────────────────
// Pola sama: cache in-memory, write-through ke disk.
// incrementTrigger() dipanggil setiap kali ada trigger meme.
let _statsCache = null;
function loadStatsData() {
  if (_statsCache) return _statsCache;
  try { _statsCache = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch { _statsCache = { totalTriggers: 0 }; }
  return _statsCache;
}
function saveStatsData(data) {
  _statsCache = data; // update cache dulu baru disk
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(data)); } catch(e) { console.error(e); }
}
function incrementTrigger() {
  const stats = loadStatsData();
  stats.totalTriggers = (stats.totalTriggers || 0) + 1;
  saveStatsData(stats);
}

app.get('/api/stats', (req, res) => {
  res.json(loadStatsData());
});

// ── FFMPEG CHECK ─────────────────────────────────────────
let hasFfmpeg = false;
try {
  execFileSync('ffmpeg', ['-version'], { timeout: 3000 });
  hasFfmpeg = true;
  console.log('ffmpeg: available');
} catch {
  console.log('ffmpeg: not available — video thumbnails disabled');
}

// ── MULTER ───────────────────────────────────────────────
// Simpan file langsung ke MEDIA_DIR dengan nama yang di-sanitasi
// (karakter non-alphanumeric diganti _ untuk menghindari nama file bermasalah)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
    cb(null, safe);
  }
});
// Batas upload 500MB per file
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// ── MEDIA API ────────────────────────────────────────────
// GET /api/media — daftar semua file media beserta settings-nya
app.get('/api/media', (req, res) => {
  try {
    const meta = loadMeta();
    const exts = ['.jpg','.jpeg','.png','.gif','.webp','.mp4','.webm','.mov','.mp3','.wav','.ogg'];
    const files = fs.readdirSync(MEDIA_DIR)
      .filter(f => !f.startsWith('_') && exts.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const stat = fs.statSync(path.join(MEDIA_DIR, f));
        return { name: f, size: stat.size, mtime: stat.mtime, settings: meta[f] || null };
      });
    res.json(files);
  } catch(e) { console.error(e); res.json([]); }
});

// POST /upload — upload satu atau lebih file media
app.post('/upload', upload.any(), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ ok: false, error: 'No files' });
  console.log('Uploaded:', req.files.map(f => f.filename));
  res.json({ ok: true, files: req.files.map(f => f.filename) });
});

// POST /api/media/:filename/settings — simpan settings (volume, durasi, dll) untuk satu file
// path.basename() mencegah path traversal (misal filename = '../../etc/passwd')
app.post('/api/media/:filename/settings', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const meta = loadMeta();
  meta[filename] = req.body;
  res.json({ ok: saveMeta(meta) });
});

// DELETE /api/media/:filename — hapus file media + thumbnail-nya + entry di meta
app.delete('/api/media/:filename', (req, res) => {
  try {
    const filename = path.basename(decodeURIComponent(req.params.filename));
    const fp = path.join(MEDIA_DIR, filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    // hapus thumbnail yang di-cache (kalau ada)
    const tp = path.join(THUMB_DIR, filename + '.jpg');
    if (fs.existsSync(tp)) fs.unlinkSync(tp);
    const meta = loadMeta();
    delete meta[filename];
    saveMeta(meta);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── THUMBNAIL ────────────────────────────────────────────
// GET /api/thumb/:filename — ambil thumbnail video (generate via ffmpeg jika belum ada)
// Thumbnail di-cache di THUMB_DIR agar ffmpeg tidak dipanggil berulang kali
app.get('/api/thumb/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const videoPath = path.join(MEDIA_DIR, filename);
  const thumbPath = path.join(THUMB_DIR, filename + '.jpg');

  if (!fs.existsSync(videoPath)) return res.status(404).end();
  if (fs.existsSync(thumbPath)) return res.sendFile(thumbPath); // cache hit
  if (!hasFfmpeg) return res.status(503).end(); // ffmpeg tidak tersedia

  // Generate thumbnail dari frame detik ke-1
  execFile('ffmpeg', [
    '-i', videoPath, '-ss', '00:00:01', '-vframes', '1',
    '-vf', 'scale=320:-2', '-pix_fmt', 'yuvj420p', '-q:v', '5', '-y', thumbPath
  ], { timeout: 15000 }, (err) => {
    if (err || !fs.existsSync(thumbPath)) return res.status(500).end();
    res.sendFile(thumbPath);
  });
});

// ── TRIGGER ──────────────────────────────────────────────
// POST /trigger — trigger meme dengan body JSON (dipakai dari dashboard)
// GET  /trigger/:filename — trigger meme via URL (dipakai dari OBS, StreamDeck, dll)
app.post('/trigger', (req, res) => {
  incrementTrigger();
  io.emit('show-media', req.body);
  res.json({ ok: true });
});

// GET /trigger/random — pilih file media secara acak lalu trigger ke OBS overlay
// WAJIB ditempatkan SEBELUM /trigger/:filename agar "random" tidak dianggap filename
// Query params opsional:
//   ?type=video|image|audio  → filter by type (bisa multi: ?type=video&type=image atau ?type=video,image)
//   ?exclude=filename         → skip file ini (cegah repeat dari trigger sebelumnya)
app.get('/trigger/random', (req, res) => {
  try {
    const exts = {
      image: ['.jpg','.jpeg','.png','.gif','.webp'],
      video: ['.mp4','.webm','.mov'],
      audio: ['.mp3','.wav','.ogg'],
    };
    const allExts = Object.values(exts).flat();

    // Parsing ?type= — bisa ?type=video&type=image atau ?type=video,image
    const typeParam = [].concat(req.query.type || []).join(',');
    const types = typeParam ? typeParam.split(',').map(t => t.trim()).filter(Boolean) : [];
    const allowedExts = types.length ? types.flatMap(t => exts[t] || []) : allExts;

    if (!allowedExts.length) return res.status(400).json({ ok: false, error: 'invalid type filter' });

    const exclude = req.query.exclude ? path.basename(decodeURIComponent(req.query.exclude)) : null;

    let candidates = fs.readdirSync(MEDIA_DIR)
      .filter(f => !f.startsWith('_') && allowedExts.includes(path.extname(f).toLowerCase()));

    // Buang file exclude agar tidak repeat dua kali berturut-turut (kalau masih ada kandidat lain)
    if (exclude && candidates.length > 1) candidates = candidates.filter(f => f !== exclude);

    if (!candidates.length) return res.status(404).json({ ok: false, error: 'No media found' });

    const filename = candidates[Math.floor(Math.random() * candidates.length)];
    const meta = loadMeta();
    incrementTrigger();
    io.emit('show-media', { filename, ...(meta[filename] || {}) });
    res.json({ ok: true, filename });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/trigger/:filename', (req, res) => {
  incrementTrigger();
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const meta = loadMeta();
  // Gabungkan filename dengan settings yang tersimpan (kalau ada)
  io.emit('show-media', { filename, ...(meta[filename] || {}) });
  res.json({ ok: true });
});
// GET/POST /hide — sembunyikan media yang sedang tampil di OBS overlay
app.all('/hide', (req, res) => { io.emit('hide-media'); res.json({ ok: true }); });

// ── DONATION ALERT ───────────────────────────────────────
// Webhook endpoint untuk Saweria & Trakteer.
// Token verifikasi opsional — jika diisi di config, request harus menyertakan ?token=xxx.
// Riwayat 50 donasi terakhir disimpan ke donations.json.

let _donationConfigCache = null;
function loadDonationConfig() {
  if (_donationConfigCache) return _donationConfigCache;
  try { _donationConfigCache = JSON.parse(fs.readFileSync(DONATION_CONFIG_FILE, 'utf8')); }
  catch { _donationConfigCache = { saweria_token: '', trakteer_token: '', alert_duration: 8, media_on_donation: '' }; }
  return _donationConfigCache;
}
function saveDonationConfig(cfg) {
  _donationConfigCache = cfg;
  try { fs.writeFileSync(DONATION_CONFIG_FILE, JSON.stringify(cfg, null, 2)); return true; }
  catch(e) { console.error('saveDonationConfig:', e.message); return false; }
}
function addDonationHistory(entry) {
  let history = [];
  try { history = JSON.parse(fs.readFileSync(DONATIONS_FILE, 'utf8')); } catch {}
  history.unshift(entry); // terbaru di depan
  if (history.length > 50) history = history.slice(0, 50);
  try { fs.writeFileSync(DONATIONS_FILE, JSON.stringify(history, null, 2)); } catch(e) { console.error(e); }
}

app.get('/api/donation-config', (req, res) => res.json(loadDonationConfig()));
app.post('/api/donation-config', (req, res) => {
  const ok = saveDonationConfig({ ...loadDonationConfig(), ...req.body });
  res.json({ ok });
});

// GET /api/donations — riwayat donasi (max 50)
app.get('/api/donations', (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(DONATIONS_FILE, 'utf8'))); }
  catch { res.json([]); }
});

// POST /webhook/saweria
// Payload Saweria: { donor_name, amount_raw (atau amount), message, id, created_at }
// Untuk verifikasi: tambahkan ?token=xxx di URL webhook yang didaftarkan ke Saweria
app.post('/webhook/saweria', (req, res) => {
  const cfg = loadDonationConfig();
  if (cfg.saweria_token && req.query.token !== cfg.saweria_token) {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
  const body = req.body || {};
  const entry = {
    platform: 'saweria',
    name:    body.donator_name || body.donor_name || 'Anonymous',
    amount:  Number(body.amount_raw || body.amount || 0),
    message: body.message || '',
    timestamp: new Date().toISOString()
  };
  addDonationHistory(entry);
  io.emit('donation-alert', { ...entry, duration: Number(cfg.alert_duration) || 8 });
  // Opsional: trigger media saat ada donasi
  if (cfg.media_on_donation) {
    const meta = loadMeta();
    incrementTrigger();
    io.emit('show-media', { filename: cfg.media_on_donation, ...(meta[cfg.media_on_donation] || {}) });
  }
  res.json({ ok: true });
});

// POST /webhook/trakteer
// Payload Trakteer: { supporter_name, supporter_message, price_amount, quantity, total, unit_name }
// Untuk verifikasi: tambahkan ?token=xxx di URL webhook yang didaftarkan ke Trakteer
app.post('/webhook/trakteer', (req, res) => {
  const cfg = loadDonationConfig();
  if (cfg.trakteer_token && req.query.token !== cfg.trakteer_token) {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
  const body = req.body || {};
  const qty  = Number(body.quantity) || 1;
  const rawTotal = body.total != null ? Number(body.total) : Number(body.price_amount || 0) * qty;
  const entry = {
    platform: 'trakteer',
    name:     body.supporter_name || 'Anonymous',
    amount:   rawTotal,
    message:  body.supporter_message || '',
    unit:     body.unit_name || '',
    quantity: qty,
    timestamp: new Date().toISOString()
  };
  addDonationHistory(entry);
  io.emit('donation-alert', { ...entry, duration: Number(cfg.alert_duration) || 8 });
  if (cfg.media_on_donation) {
    const meta = loadMeta();
    incrementTrigger();
    io.emit('show-media', { filename: cfg.media_on_donation, ...(meta[cfg.media_on_donation] || {}) });
  }
  res.json({ ok: true });
});

// ── TIMER / COUNTDOWN / COUNT-UP WIDGET ────────────────
// Widget OBS realtime yang bisa Start/Pause/Resume/Reset dari dashboard/API.
// Mendukung 2 mode: countdown dan countup (stopwatch target).

let _timerConfigCache = null;
function loadTimerConfig() {
  if (_timerConfigCache) return _timerConfigCache;
  try { _timerConfigCache = JSON.parse(fs.readFileSync(TIMER_CONFIG_FILE, 'utf8')); }
  catch {
    _timerConfigCache = {
      label: 'COUNTDOWN',
      mode: 'countdown',
      durationSec: 300,
      autoRestart: false,
      color: '#38bdf8'
    };
  }
  return _timerConfigCache;
}
function saveTimerConfig(cfg) {
  _timerConfigCache = cfg;
  try { fs.writeFileSync(TIMER_CONFIG_FILE, JSON.stringify(cfg, null, 2)); return true; }
  catch(e) { console.error('saveTimerConfig failed:', e.message); return false; }
}

const timerState = {
  running: false,
  mode: (loadTimerConfig().mode === 'countup') ? 'countup' : 'countdown',
  durationMs: (loadTimerConfig().durationSec || 300) * 1000,
  elapsedMs: 0,     // akumulasi elapsed saat paused/stopped
  startedAt: 0,     // timestamp saat running=true
  _lastSecond: null,
};

function clampNumber(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function getCurrentElapsedMs() {
  if (!timerState.running) return Math.max(0, timerState.elapsedMs);
  return Math.max(0, timerState.elapsedMs + (Date.now() - timerState.startedAt));
}
function getTimerSnapshot() {
  const cfg = loadTimerConfig();
  const elapsedMs = getCurrentElapsedMs();
  const remainingMs = Math.max(0, timerState.durationMs - elapsedMs);
  const displayMs = timerState.mode === 'countup' ? elapsedMs : remainingMs;
  return {
    running: timerState.running,
    mode: timerState.mode,
    elapsedMs,
    remainingMs,
    displayMs,
    totalMs: timerState.durationMs,
    label: cfg.label || 'COUNTDOWN',
    autoRestart: !!cfg.autoRestart,
    color: cfg.color || '#38bdf8',
  };
}
function emitTimerSync() {
  io.emit('timer-sync', getTimerSnapshot());
}

// Tick loop: emit per detik agar ringan tapi tetap realtime
setInterval(() => {
  if (!timerState.running) return;
  const elapsed = getCurrentElapsedMs();
  const modeSec = timerState.mode === 'countup'
    ? Math.floor(elapsed / 1000)
    : Math.ceil(Math.max(0, timerState.durationMs - elapsed) / 1000);

  if (modeSec !== timerState._lastSecond) {
    timerState._lastSecond = modeSec;
    emitTimerSync();
  }

  if (elapsed >= timerState.durationMs) {
    const cfg = loadTimerConfig();
    timerState.running = false;
    timerState.elapsedMs = timerState.durationMs;
    timerState.startedAt = 0;
    timerState._lastSecond = null;
    emitTimerSync();
    io.emit('timer-finished');

    if (cfg.autoRestart) {
      timerState.running = true;
      timerState.elapsedMs = 0;
      timerState.startedAt = Date.now();
      timerState._lastSecond = null;
      emitTimerSync();
    }
  }
}, 200);

app.get('/api/timer/config', (req, res) => res.json(loadTimerConfig()));

app.post('/api/timer/config', (req, res) => {
  const prev = loadTimerConfig();
  const body = req.body || {};
  const nextMode = body.mode === 'countup' ? 'countup' : (body.mode === 'countdown' ? 'countdown' : (prev.mode || 'countdown'));
  const next = {
    ...prev,
    label: String(body.label ?? prev.label ?? 'COUNTDOWN').slice(0, 40),
    mode: nextMode,
    durationSec: clampNumber(body.durationSec, 1, 24 * 60 * 60, prev.durationSec || 300),
    autoRestart: !!body.autoRestart,
    color: /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? String(body.color) : (prev.color || '#38bdf8')
  };
  const ok = saveTimerConfig(next);

  timerState.mode = next.mode;
  timerState.durationMs = next.durationSec * 1000;

  // Jika tidak running, reset ke baseline config baru
  if (!timerState.running) {
    timerState.elapsedMs = 0;
  } else {
    // Jika running, clamp elapsed agar tidak melebihi target baru
    timerState.elapsedMs = Math.min(getCurrentElapsedMs(), timerState.durationMs);
    timerState.startedAt = Date.now();
  }

  timerState._lastSecond = null;
  emitTimerSync();
  io.emit('timer-config-updated', next);
  res.json({ ok, config: next });
});

app.get('/api/timer/state', (req, res) => res.json(getTimerSnapshot()));

app.post('/api/timer/start', (req, res) => {
  const body = req.body || {};
  const cfg = loadTimerConfig();
  const mode = body.mode === 'countup' ? 'countup' : (body.mode === 'countdown' ? 'countdown' : (cfg.mode || 'countdown'));
  const sec = clampNumber(body.seconds, 1, 24 * 60 * 60, cfg.durationSec || 300);
  timerState.mode = mode;
  timerState.durationMs = sec * 1000;
  timerState.elapsedMs = 0;
  timerState.running = true;
  timerState.startedAt = Date.now();
  timerState._lastSecond = null;
  emitTimerSync();
  res.json({ ok: true, state: getTimerSnapshot() });
});

app.post('/api/timer/pause', (req, res) => {
  if (timerState.running) {
    timerState.elapsedMs = getCurrentElapsedMs();
    timerState.running = false;
    timerState.startedAt = 0;
    timerState._lastSecond = null;
  }
  emitTimerSync();
  res.json({ ok: true, state: getTimerSnapshot() });
});

app.post('/api/timer/resume', (req, res) => {
  const elapsed = getCurrentElapsedMs();
  if (!timerState.running && elapsed < timerState.durationMs) {
    timerState.elapsedMs = elapsed;
    timerState.running = true;
    timerState.startedAt = Date.now();
    timerState._lastSecond = null;
  }
  emitTimerSync();
  res.json({ ok: true, state: getTimerSnapshot() });
});

app.post('/api/timer/reset', (req, res) => {
  timerState.running = false;
  timerState.startedAt = 0;
  timerState.elapsedMs = 0;
  timerState._lastSecond = null;
  emitTimerSync();
  res.json({ ok: true, state: getTimerSnapshot() });
});

app.post('/api/timer/add', (req, res) => {
  const body = req.body || {};
  const addMs = clampNumber(body.seconds, -24 * 60 * 60, 24 * 60 * 60, 0) * 1000;

  if (timerState.mode === 'countup') {
    // Count-up: +/− memajukan/memundurkan elapsed
    const curElapsed = getCurrentElapsedMs();
    const nextElapsed = Math.max(0, Math.min(timerState.durationMs, curElapsed + addMs));
    timerState.elapsedMs = nextElapsed;
    if (timerState.running) timerState.startedAt = Date.now();
  } else {
    // Countdown: +/− menambah/mengurangi sisa waktu (duration berubah, elapsed tetap)
    const curElapsed = getCurrentElapsedMs();
    timerState.durationMs = Math.max(1000, timerState.durationMs + addMs);
    timerState.elapsedMs = Math.min(curElapsed, timerState.durationMs);
    if (timerState.running) timerState.startedAt = Date.now();
  }

  timerState._lastSecond = null;
  emitTimerSync();
  res.json({ ok: true, state: getTimerSnapshot() });
});

// ── CHAT COMMAND TRIGGER (TWITCH / YOUTUBE) ───────────
// Gunakan endpoint ini dari bot/automation (Nightbot, StreamElements, dll)
// untuk meneruskan command chat menjadi trigger media.

let _chatCmdCache = null;
let _chatEventCache = null;

function loadChatCommandConfig() {
  if (_chatCmdCache) return _chatCmdCache;
  try { _chatCmdCache = JSON.parse(fs.readFileSync(CHAT_COMMANDS_FILE, 'utf8')); }
  catch {
    _chatCmdCache = {
      enabled: false,
      token: '',
      defaultQueueMode: true,
      platformFilter: 'all', // all|twitch|youtube
      commands: [] // [{ command:'!meme', filename:'x.mp4', queueMode:true }]
    };
  }
  return _chatCmdCache;
}

function saveChatCommandConfig(cfg) {
  _chatCmdCache = cfg;
  try { fs.writeFileSync(CHAT_COMMANDS_FILE, JSON.stringify(cfg, null, 2)); return true; }
  catch(e) { console.error('saveChatCommandConfig failed:', e.message); return false; }
}

function loadChatEvents() {
  if (_chatEventCache) return _chatEventCache;
  try { _chatEventCache = JSON.parse(fs.readFileSync(CHAT_EVENTS_FILE, 'utf8')); }
  catch { _chatEventCache = []; }
  return _chatEventCache;
}

function pushChatEvent(ev) {
  const list = loadChatEvents();
  list.unshift(ev);
  if (list.length > 80) list.length = 80;
  try { fs.writeFileSync(CHAT_EVENTS_FILE, JSON.stringify(list, null, 2)); } catch(e) { console.error(e); }
}

function normCommand(s) {
  const raw = String(s || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('!') ? raw : ('!' + raw);
}

app.get('/api/chat-command-config', (req, res) => res.json(loadChatCommandConfig()));

app.post('/api/chat-command-config', (req, res) => {
  const prev = loadChatCommandConfig();
  const body = req.body || {};

  const commands = Array.isArray(body.commands)
    ? body.commands
      .map(c => ({
        command: normCommand(c && c.command),
        filename: path.basename(String((c && c.filename) || '').trim()),
        queueMode: c && c.queueMode === false ? false : true
      }))
      .filter(c => c.command && c.filename)
    : (prev.commands || []);

  const next = {
    enabled: !!body.enabled,
    token: String(body.token != null ? body.token : prev.token || '').trim(),
    defaultQueueMode: body.defaultQueueMode === false ? false : true,
    platformFilter: ['all', 'twitch', 'youtube'].includes(body.platformFilter) ? body.platformFilter : (prev.platformFilter || 'all'),
    commands
  };

  const ok = saveChatCommandConfig(next);
  res.json({ ok, config: next });
});

app.get('/api/chat-command-events', (req, res) => res.json(loadChatEvents()));

// POST /chat/trigger
// Body flexible:
// {
//   token, platform:'twitch'|'youtube', user:'name',
//   command:'!meme'  OR  message:'!meme wow'
// }
app.post('/chat/trigger', (req, res) => {
  const cfg = loadChatCommandConfig();
  const b = req.body || {};

  if (!cfg.enabled) {
    return res.status(403).json({ ok: false, error: 'chat command disabled' });
  }

  const reqToken = String(req.query.token || b.token || req.headers['x-chat-token'] || '').trim();
  if (cfg.token && reqToken !== cfg.token) {
    return res.status(401).json({ ok: false, error: 'invalid token' });
  }

  const platform = String(b.platform || req.query.platform || 'unknown').toLowerCase();
  if (cfg.platformFilter !== 'all' && platform !== cfg.platformFilter) {
    pushChatEvent({
      ts: new Date().toISOString(),
      platform,
      user: String(b.user || b.username || 'unknown'),
      raw: String(b.message || b.command || ''),
      status: 'ignored-platform'
    });
    return res.json({ ok: true, ignored: 'platform-filter' });
  }

  const raw = String(b.command || b.message || '').trim();
  const command = b.command
    ? normCommand(b.command)
    : normCommand(raw.split(/\s+/)[0] || '');

  if (!command) {
    pushChatEvent({ ts: new Date().toISOString(), platform, user: String(b.user || b.username || 'unknown'), raw, status: 'invalid-command' });
    return res.status(400).json({ ok: false, error: 'missing command' });
  }

  const map = (cfg.commands || []).find(c => normCommand(c.command) === command);
  if (!map) {
    pushChatEvent({ ts: new Date().toISOString(), platform, user: String(b.user || b.username || 'unknown'), raw, command, status: 'unmapped' });
    return res.status(404).json({ ok: false, error: 'command not mapped', command });
  }

  const filename = path.basename(map.filename);
  const mediaPath = path.join(MEDIA_DIR, filename);
  if (!fs.existsSync(mediaPath)) {
    pushChatEvent({ ts: new Date().toISOString(), platform, user: String(b.user || b.username || 'unknown'), raw, command, filename, status: 'file-missing' });
    return res.status(404).json({ ok: false, error: 'media file not found', filename });
  }

  const meta = loadMeta();
  const queueMode = map.queueMode === false ? false : !!cfg.defaultQueueMode;

  incrementTrigger();
  io.emit('show-media', { filename, ...(meta[filename] || {}), queueMode });

  pushChatEvent({
    ts: new Date().toISOString(),
    platform,
    user: String(b.user || b.username || 'unknown'),
    raw,
    command,
    filename,
    queueMode,
    status: 'triggered'
  });

  res.json({ ok: true, command, filename, queueMode });
});

// ── COUNTER API ──────────────────────────────────────────
// Counter = file .txt di TEXT_DIR yang dibaca OBS sebagai Text Source
// Pola cache sama dengan meta: read-through / write-through
let _counterCache = null;
function loadCounterMeta() {
  if (_counterCache) return _counterCache;
  try { _counterCache = JSON.parse(fs.readFileSync(COUNTER_META, 'utf8')); }
  catch { _counterCache = []; }
  return _counterCache;
}
function saveCounterMeta(list) {
  _counterCache = list;
  try { fs.writeFileSync(COUNTER_META, JSON.stringify(list, null, 2)); return true; } catch { return false; }
}

app.get('/api/counters', (req, res) => res.json(loadCounterMeta()));

app.post('/api/counters', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: 'Nama wajib diisi' });
  const cleanName = String(name).trim().replace(/[<>"'`]/g, '');
  const filename = cleanName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-\.]/g, '') + '.txt';
  if (!filename.replace('.txt','')) return res.status(400).json({ ok: false, error: 'Nama tidak valid' });
  const filepath = path.join(TEXT_DIR, filename);
  const list = loadCounterMeta();
  if (list.find(c => c.filename === filename)) return res.status(409).json({ ok: false, error: 'Counter sudah ada' });
  try {
    fs.writeFileSync(filepath, '0', 'utf8');
    list.push({ name: cleanName, filename, created: new Date().toISOString() });
    saveCounterMeta(list);
    res.json({ ok: true, filename, name: cleanName });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/counters/:filename/value', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filepath = path.join(TEXT_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ ok: false });
  try { res.json({ ok: true, value: fs.readFileSync(filepath, 'utf8').trim() }); }
  catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/counters/:filename/value', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filepath = path.join(TEXT_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ ok: false });
  const { value } = req.body || {};
  try { fs.writeFileSync(filepath, String(value ?? '0'), 'utf8'); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/counters/:filename/op — operasi atomic: inc / dec / reset
// Server yang menghitung (bukan client) agar nilai selalu konsisten
// Setelah update, emit socket 'counter-updated' ke semua client (OBS overlay)
app.post('/api/counters/:filename/op', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filepath = path.join(TEXT_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ ok: false });
  const { op } = req.body || {};
  try {
    let cur = parseInt(fs.readFileSync(filepath, 'utf8').trim(), 10) || 0;
    if (op === 'inc') cur += 1;
    else if (op === 'dec') cur = Math.max(0, cur - 1);
    else if (op === 'reset') cur = 0;
    else return res.status(400).json({ ok: false, error: 'invalid op' });
    fs.writeFileSync(filepath, String(cur), 'utf8');
    io.emit('counter-updated', { filename, value: cur });
    res.json({ ok: true, value: cur });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/counters/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filepath = path.join(TEXT_DIR, filename);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    saveCounterMeta(loadCounterMeta().filter(c => c.filename !== filename));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── DECK SETTINGS ────────────────────────────────────────
// Sentinel: undefined = belum pernah dimuat dari disk
//           null     = sudah dicek tapi file deck_settings.json belum ada
// (tidak bisa pakai null sebagai sentinel karena null adalah nilai valid saat file tidak ada)
let _deckSettingsCache = undefined;
function loadDeckSettings() {
  if (_deckSettingsCache !== undefined) return _deckSettingsCache;
  try { _deckSettingsCache = JSON.parse(fs.readFileSync(DECK_SETTINGS_FILE, 'utf8')); }
  catch { _deckSettingsCache = null; }
  return _deckSettingsCache;
}
function saveDeckSettings(data) {
  try {
    fs.writeFileSync(DECK_SETTINGS_FILE, JSON.stringify(data, null, 2));
    _deckSettingsCache = data;
    return true;
  } catch(e) { console.error('saveDeckSettings failed:', e.message); return false; }
}

app.get('/api/deck-settings', (req, res) => res.json(loadDeckSettings() || {}));
app.post('/api/deck-settings', (req, res) => {
  const ok = saveDeckSettings(req.body);
  if (ok) io.emit('deck-settings-updated', req.body);
  res.json({ ok });
});

// ── LOCAL IP (untuk QR / phone connect) ─────────────────
app.get('/api/local-ip', (req, res) => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return res.json({ ip: net.address, port: PORT });
      }
    }
  }
  res.json({ ip: 'localhost', port: PORT });
});

// ── CONFIG API ──────────────────────────────────────────
let _appConfigCache = null;
function loadAppConfig() {
  if (_appConfigCache) return _appConfigCache;
  try { _appConfigCache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { _appConfigCache = {}; }
  return _appConfigCache;
}
app.get('/api/config', (req, res) => res.json(loadAppConfig()));

// ── BACKUP & RESTORE ────────────────────────────────────
// GET /api/backup — streaming download ZIP berisi semua assets + config
// Struktur ZIP:
//   config/  → meta.json, counters.json, deck_settings.json, config.json
//   assets/  → semua file media
//   thumbs/  → thumbnail yang sudah di-cache
app.get('/api/backup', (req, res) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = 'KSK-Backup-' + timestamp + '.zip';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', err => { console.error('Backup error:', err); res.status(500).end(); });
  archive.pipe(res);

  // Config files
  const configFiles = ['meta.json', 'counters.json', 'deck_settings.json', 'config.json'];
  for (const f of configFiles) {
    const fp = path.join(BASE_DIR, f);
    if (fs.existsSync(fp)) archive.file(fp, { name: 'config/' + f });
  }

  // Assets folder (memes + text counters)
  if (fs.existsSync(MEDIA_DIR)) {
    archive.directory(MEDIA_DIR, 'assets');
  }

  // Thumbs folder
  if (fs.existsSync(THUMB_DIR)) {
    archive.directory(THUMB_DIR, 'thumbs');
  }

  archive.finalize();
});

const restoreUpload = multer({ dest: path.join(BASE_DIR, '_restore_tmp'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
app.post('/api/restore', restoreUpload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

  const zipPath = req.file.path;
  try {
    const zip = await unzipper.Open.file(zipPath);
    let restoredFiles = 0;
    let restoredConfigs = 0;

    for (const entry of zip.files) {
      if (entry.type === 'Directory') continue;
      const rel = entry.path.replace(/\\/g, '/');

      if (rel.startsWith('config/')) {
        const fname = path.basename(rel);
        const allowed = ['meta.json', 'counters.json', 'deck_settings.json', 'config.json'];
        if (allowed.includes(fname)) {
          const dest = path.join(BASE_DIR, fname);
          const content = await entry.buffer();
          fs.writeFileSync(dest, content);
          restoredConfigs++;
        }
      } else if (rel.startsWith('assets/')) {
        const subPath = rel.slice('assets/'.length);
        if (!subPath) continue;
        const dest = path.join(MEDIA_DIR, subPath);
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const content = await entry.buffer();
        fs.writeFileSync(dest, content);
        restoredFiles++;
      } else if (rel.startsWith('thumbs/')) {
        const subPath = rel.slice('thumbs/'.length);
        if (!subPath) continue;
        const dest = path.join(THUMB_DIR, subPath);
        const content = await entry.buffer();
        fs.writeFileSync(dest, content);
      }
    }

    try { fs.unlinkSync(zipPath); } catch {}
    try { fs.rmSync(path.join(BASE_DIR, '_restore_tmp'), { recursive: true, force: true }); } catch {}

    // Setelah restore: wajib invalidate semua cache agar data baru terbaca dari disk
    // (bukan dari memori yang masih menyimpan data sebelum restore)
    _metaCache = null;
    _counterCache = null;
    _statsCache = null;
    _deckSettingsCache = undefined; // undefined agar loadDeckSettings re-read dari disk
    _appConfigCache = null;
    _donationConfigCache = null;
    _timerConfigCache = null;
    _chatCmdCache = null;
    _chatEventCache = null;

    res.json({ ok: true, restoredFiles, restoredConfigs });
  } catch(e) {
    try { fs.unlinkSync(zipPath); } catch {}
    console.error('Restore error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SOCKET ───────────────────────────────────────────────
io.on('connection', s => {
  console.log('Client connected:', s.id);
  s.emit('timer-sync', getTimerSnapshot());
});

// ── START ────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`KSK Server | port:${PORT} | media:${MEDIA_DIR} | ffmpeg:${hasFfmpeg}`);
});