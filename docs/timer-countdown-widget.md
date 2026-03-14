# ⏱️ Timer / Countdown Widget untuk OBS

Widget realtime untuk OBS yang mendukung **countdown** dan **count-up (stopwatch)**, dikontrol langsung dari dashboard KSK.

Fitur utama:
- Start / Pause / Resume / Reset
- Tambah/Kurang waktu (`+1m`, `-1m`)
- Label custom (contoh: `STREAM STARTING IN`)
- Warna accent custom
- Auto-restart saat timer habis (opsional)
- Mode `countdown` dan `countup`
- Preset scene: `Starting Soon`, `BRB`, `Intermission`, `Live Stopwatch`

---

## 1) Setup di Dashboard

1. Buka dashboard KSK
2. Klik **⏱️ Timer / Countdown**
3. Atur:
  - `Mode` (`countdown` / `countup`)
   - `Label`
   - `Durasi (detik)`
   - `Warna Accent`
   - `Auto restart`
4. Klik **💾 Simpan Config**

---

## 2) Pasang ke OBS

1. Di OBS, tambah **Browser Source** baru
2. URL: `http://[IP-PC]:3000/timer.html`
3. Width: `1920`, Height: `1080`
4. Background transparan (default)

> Posisi default widget ada di kanan atas canvas 1920×1080.

---

## 3) Kontrol Timer / Stopwatch

Dari modal setup di dashboard:

- `▶ Start` → mulai timer sesuai mode + durasi input
- `⏸ Pause` → jeda
- `⏯ Resume` → lanjutkan
- `↺ Reset` → kembali ke titik awal mode
- `+1m / -1m`
  - countdown: menambah/mengurangi **sisa waktu**
  - countup: memajukan/memundurkan **elapsed time**

Preview waktu realtime juga tampil di modal.

---

## 4) API Endpoint

### Config
- `GET /api/timer/config`
- `POST /api/timer/config`

Body contoh:
```json
{
  "label": "STREAM STARTING IN",
  "mode": "countdown",
  "durationSec": 300,
  "autoRestart": false,
  "color": "#38bdf8"
}
```

### State & Control
- `GET /api/timer/state`
- `POST /api/timer/start`
- `POST /api/timer/pause`
- `POST /api/timer/resume`
- `POST /api/timer/reset`
- `POST /api/timer/add`

Contoh start mode count-up:
```json
{ "mode": "countup", "seconds": 14400 }
```

Contoh tambah waktu:
```json
{ "seconds": 60 }
```

Contoh kurangi waktu:
```json
{ "seconds": -60 }
```

---

## 5) Socket Event

Widget menerima event realtime:
- `timer-sync` → update waktu/status
- `timer-finished` → notifikasi saat mencapai 00:00

---

## 6) File Storage

Konfigurasi disimpan di:
- `timer_config.json`

---

← [Kembali ke README](../readme.md)
