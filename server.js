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

    res.json({ ok: true, restoredFiles, restoredConfigs });
  } catch(e) {
    try { fs.unlinkSync(zipPath); } catch {}
    console.error('Restore error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SOCKET ───────────────────────────────────────────────
io.on('connection', s => console.log('Client connected:', s.id));

// ── START ────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`KSK Server | port:${PORT} | media:${MEDIA_DIR} | ffmpeg:${hasFfmpeg}`);
});