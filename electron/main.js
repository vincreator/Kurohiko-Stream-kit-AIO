/**
 * electron/main.js — Electron main process
 *
 * Tugas utama:
 * 1. Fork server.js sebagai child process
 * 2. Buat BrowserWindow yang load http://127.0.0.1:PORT/
 * 3. Kelola System Tray & Global Shortcut
 * 4. Handle IPC dari renderer (preload.js)
 */

const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const os = require('os');
const fs = require('fs');

// ── SINGLE INSTANCE LOCK ─────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── USER DATA PATHS ──────────────────────────────────────
const USER_DATA  = app.getPath('userData');
const ASSETS_DIR = path.join(USER_DATA, 'assets');
const TEXT_DIR   = path.join(USER_DATA, 'assets', 'text');
const LOG_FILE   = path.join(USER_DATA, 'app.log');
const CONFIG_FILE = path.join(USER_DATA, 'config.json');

[ASSETS_DIR, TEXT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── CONFIG ───────────────────────────────────────────────
// loadConfig/saveConfig untuk preferensi user (folder assets kustom, dll)
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); }
  catch(e) { log(`saveConfig failed: ${e.message}`); } // error di-log, tidak ditelan diam-diam
}

// ── LOGGING ─────────────────────────────────────────────
// Log ke console DAN ke file app.log di USER_DATA (bisa dilihat dari tray menu)
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

// ── STATE ───────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let serverProcess = null;
const PORT = parseInt(process.env.PORT || '3000', 10);
let shortcutsEnabled = false; // default OFF

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ── START SERVER ─────────────────────────────────────────
// server.js di-fork sebagai child process terpisah (bukan thread).
// stdout/stderr dari server di-pipe ke file log agar bisa di-debug.
function startServer() {
  const cfg = loadConfig();
  const assetsDir = cfg.assetsDir || ASSETS_DIR; // pakai folder kustom jika user sudah set

  // Di packaged app, server.js ada di app.asar.unpacked karena perlu dieksekusi langsung
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server.js')
    : path.join(__dirname, '..', 'server.js');

  log(`=== Kurohiko Stream Kit AIO starting ===`);
  log(`Version: ${app.getVersion()}`);
  log(`Platform: ${process.platform}`);
  log(`User data: ${USER_DATA}`);
  log(`Local IP: ${getLocalIP()}`);
  log(`Starting server: ${serverPath}`);

  serverProcess = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(PORT),
      USER_DATA_DIR: USER_DATA,
      ASSETS_DIR_OVERRIDE: assetsDir,
      ELECTRON: '1',
    },
    silent: true,
  });

  serverProcess.stdout.on('data', d => log(`[server] ${d.toString().trim()}`));
  serverProcess.stderr.on('data', d => log(`[server:err] ${d.toString().trim()}`));
  serverProcess.on('exit', code => log(`Server exited: ${code}`));
}

// ── WINDOW ───────────────────────────────────────────────
function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1200, height: 720, minWidth: 800, minHeight: 560,
    title: 'Kurohiko Stream Kit AIO',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#09090d',

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  // Jangan langsung load URL — server butuh waktu untuk siap.
  // tryLoad polling setiap 500ms sampai server merespons (max 40x = 20 detik).
  const tryLoad = (attempts = 0) => {
    const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
      res.resume(); // buang response body agar koneksi ditutup dengan benar
      log(`Server ready (attempt ${attempts})`);
      mainWindow.loadURL(`http://127.0.0.1:${PORT}/`).then(() => {
        log('Page loaded successfully');
      }).catch(err => {
        log(`loadURL error: ${err.message}`);
      });
    });
    req.on('error', () => {
      if (attempts < 40) setTimeout(() => tryLoad(attempts + 1), 500);
      else dialog.showErrorBox('Error', 'Server gagal start.\nLog: ' + LOG_FILE);
    });
    req.setTimeout(1000, () => req.destroy()); // timeout per-attempt 1 detik
  };
  setTimeout(() => tryLoad(), 1500); // delay awal 1.5 detik untuk beri waktu fork

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
      e.preventDefault(); shell.openExternal(url);
    }
  });

  // Tampilkan window hanya setelah halaman benar-benar selesai load
  // (bukan saat Electron frame siap) agar user tidak melihat layar kosong
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      log('Window shown (did-finish-load)');
    }
  });

  // Fallback: kalau did-finish-load tidak terpanggil, paksa show setelah 3 detik
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show();
        log('Window shown (ready-to-show fallback)');
      }
    }, 3000);
  });
  // Tutup window → hide ke tray (tidak quit), kecuali app.isQuitting = true
  mainWindow.on('close', e => { if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('closed', () => { mainWindow = null; });

  // Retry otomatis kalau halaman gagal load (misal server belum siap)
  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    log(`did-fail-load: code=${code} desc=${desc} url=${url}`);
    if (code !== -3) { // -3 = ERR_ABORTED (intentional navigate), skip retry
      setTimeout(() => {
        log('Retrying loadURL after failure...');
        mainWindow.loadURL(`http://127.0.0.1:${PORT}/`).catch(err => {
          log(`Retry loadURL error: ${err.message}`);
        });
      }, 2000);
    }
  });

  // Log error dari renderer (level 2 = warning, level 3 = error)
  mainWindow.webContents.on('console-message', (e, level, msg) => {
    if (level >= 2) log(`[renderer] ${msg}`);
  });
}

// ── TRAY ────────────────────────────────────────────────
function createTray() {
  const iconPaths = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
  ];

  let icon = nativeImage.createEmpty();
  for (const p of iconPaths) {
    if (fs.existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) { icon = img.resize({ width: 16, height: 16 }); break; }
      } catch(e) { log(`Icon load failed: ${e.message}`); }
    }
  }

  tray = new Tray(icon);
  tray.setToolTip('Kurohiko Stream Kit AIO');
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); });
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const ip = getLocalIP();
  const scLabel = shortcutsEnabled ? '⌨ Shortcut: ON  — Klik untuk matikan' : '⌨ Shortcut: OFF — Klik untuk aktifkan';
  const menu = Menu.buildFromTemplate([
    { label: 'Kurohiko Stream Kit AIO', enabled: false },
    { type: 'separator' },
    { label: '🏠 Buka Dashboard', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); } },
    { label: '🎮 Buka Deck View', click: () => shell.openExternal(`http://${ip}:${PORT}/deck.html`) },
    { type: 'separator' },
    { label: scLabel, click: () => toggleShortcutsFromTray() },
    { type: 'separator' },
    { label: `🌐 ${ip}:${PORT}`, enabled: false },
    { type: 'separator' },
    { label: '📋 Lihat Log', click: () => shell.openPath(LOG_FILE) },
    { label: '📂 Folder Data', click: () => shell.openPath(USER_DATA) },
    { label: '📝 Folder Counter', click: () => shell.openPath(TEXT_DIR) },
    { type: 'separator' },
    { label: '❌ Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function toggleShortcutsFromTray() {
  shortcutsEnabled = !shortcutsEnabled;
  rebuildTrayMenu();
  // Broadcast ke semua window (deck.html & index.html)
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('shortcut-state-changed', shortcutsEnabled);
  });
  log(`Shortcut toggled from tray: ${shortcutsEnabled}`);
}

// ── GLOBAL SHORTCUT ──────────────────────────────────────
ipcMain.on('register-shortcuts', (event, shortcuts) => {
  globalShortcut.unregisterAll();
  if (!shortcuts || !Array.isArray(shortcuts)) return;

  shortcuts.forEach(sc => {
    try {
      globalShortcut.register(sc.combo, () => {
        // Shortcut dipencet → kirim ke mainWindow untuk dieksekusi di renderer
        if (mainWindow) {
          mainWindow.webContents.send('shortcut-triggered', sc.action);
        }
      });
    } catch (err) {
      log(`Gagal register shortcut: ${sc.combo}`);
    }
  });
});
// ── IPC ──────────────────────────────────────────────────
// Renderer memberitahu main saat shortcut di-toggle ON/OFF.
// Main update state + rebuild tray + broadcast ke semua window lain.
ipcMain.on('set-shortcut-enabled', (event, enabled) => {
  shortcutsEnabled = !!enabled;
  rebuildTrayMenu();
  // Broadcast ke window lain
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.webContents !== event.sender) {
      win.webContents.send('shortcut-state-changed', shortcutsEnabled);
    }
  });
  log(`Shortcut set from renderer: ${shortcutsEnabled}`);
});

ipcMain.on('open-text-folder', () => {
  if (!fs.existsSync(TEXT_DIR)) fs.mkdirSync(TEXT_DIR, { recursive: true });
  shell.openPath(TEXT_DIR);
});
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (e, cfg) => { saveConfig(cfg); return { ok: true }; });
ipcMain.handle('choose-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Pilih Folder Assets' });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('get-local-ip', () => getLocalIP());

// ── SECOND INSTANCE ──────────────────────────────────────
// Kalau user buka app kedua kali, cukup fokus window yang sudah ada
app.on('second-instance', () => {
  if (mainWindow) { if (!mainWindow.isVisible()) mainWindow.show(); mainWindow.focus(); }
});

// ── APP EVENTS ───────────────────────────────────────────
app.whenReady().then(() => { startServer(); createWindow(); createTray(); });
// Cegah Electron quit saat semua window ditutup (minimize ke tray)
app.on('window-all-closed', e => e.preventDefault());
// Sebelum quit: kill server process dan tutup log stream
app.on('before-quit', () => { if (serverProcess) serverProcess.kill(); logStream.end(); });
// Unregister semua shortcut saat app benar-benar keluar
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});