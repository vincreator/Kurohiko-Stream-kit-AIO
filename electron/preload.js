/**
 * electron/preload.js — Jembatan aman antara renderer (browser) dan main process
 *
 * contextBridge.exposeInMainWorld() membuat API tersedia di window.kskElectron
 * tanpa mengekspos Node.js/Electron API secara langsung ke renderer.
 * (nodeIntegration: false → renderer tidak bisa require() Node modules langsung)
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kskElectron', {
  // ── Config & Folder ───────────────────────────────────────────
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),       // buka dialog pilih folder
  getConfig: () => ipcRenderer.invoke('get-config'),             // baca config.json
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),   // simpan config.json
  openTextFolder: () => ipcRenderer.send('open-text-folder'),    // buka folder counter di Explorer
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'),          // IP lokal untuk QR code

  // ── Global Shortcut ──────────────────────────────────────────
  registerShortcuts: (shortcuts) => ipcRenderer.send('register-shortcuts', shortcuts),

  // removeAllListeners sebelum register ulang — mencegah listener numpuk (memory leak)
  // jika halaman re-init atau user mengubah shortcut beberapa kali
  onShortcutTriggered: (callback) => {
    ipcRenderer.removeAllListeners('shortcut-triggered');
    ipcRenderer.on('shortcut-triggered', (event, action) => callback(action));
  },

  // ── Shortcut Toggle Sync ──────────────────────────────────────
  // Sinkronisasi status shortcut ON/OFF antara tray dan semua window yang terbuka
  setShortcutEnabled: (enabled) => ipcRenderer.send('set-shortcut-enabled', enabled),
  onShortcutStateChanged: (cb) => {
    ipcRenderer.removeAllListeners('shortcut-state-changed');
    ipcRenderer.on('shortcut-state-changed', (e, enabled) => cb(enabled));
  },
});