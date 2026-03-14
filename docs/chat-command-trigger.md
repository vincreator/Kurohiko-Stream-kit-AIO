# 💬 Chat Command Trigger (Twitch / YouTube)

Trigger media dari command chat Twitch/YouTube lewat webhook bot (Nightbot/StreamElements/otomasi custom).

---

## Setup Cepat

1. Buka Dashboard → **Chat Command Trigger**
2. Aktifkan **Enable Chat Command Trigger**
3. Isi **Secret Token** (disarankan)
4. Tambah mapping command ke media (contoh `!meme` → `ketawa.mp3`)
5. Copy webhook URL yang tampil

---

## How To Use (Step-by-step)

### A) Siapkan mapping command di KSK

1. Buka menu **Chat Command Trigger**
2. Nyalakan **Enable Chat Command Trigger**
3. Isi **Secret Token** (wajib kalau endpoint dibuka ke publik)
4. Di bagian **Command Mapping** tambahkan baris:
   - `!meme` → `ketawa.mp3`
   - `!boom` → `boom.mp4`
5. Klik **Simpan Config**

### B) Hubungkan bot chat ke webhook

Setiap kali bot mendeteksi command (misal `!meme`), bot kirim **HTTP POST** ke:

`http://IP-PC:3000/chat/trigger?token=TOKEN_KAMU`

Dengan body JSON minimal:

```json
{
  "platform": "twitch",
  "user": "username_viewer",
  "message": "!meme"
}
```

### C) Verifikasi

1. Viewer ketik `!meme` di chat
2. Bot mengirim POST ke webhook
3. KSK cocokkan command ke mapping
4. Media ditrigger ke OBS
5. Status `triggered` muncul di **Recent Events**

---

## Template Payload Siap Pakai

### Twitch

```json
{
  "platform": "twitch",
  "user": "$(user)",
  "message": "$(message)"
}
```

### YouTube

```json
{
  "platform": "youtube",
  "user": "{{author}}",
  "message": "{{message}}"
}
```

> Kalau tool bot kamu tidak punya variabel `message`, kirim `command` langsung.

---

## Contoh URL Command Bot

Jika command di bot adalah `!meme`, webhook call-nya:

- URL: `http://IP-PC:3000/chat/trigger?token=TOKEN_KAMU`
- Method: `POST`
- Headers: `Content-Type: application/json`
- Body:

```json
{
  "platform": "twitch",
  "user": "$(user)",
  "command": "!meme"
}
```

---

## Kalau pakai URL publik (cloud/tunnel)

Untuk Nightbot/StreamElements cloud, endpoint lokal `localhost` tidak bisa diakses langsung.
Gunakan tunnel publik (ngrok / cloudflared), lalu pakai URL tunnel:

`https://xxxx.ngrok-free.app/chat/trigger?token=TOKEN_KAMU`

Pastikan token tetap dipakai.

---

## Endpoint

- `POST /chat/trigger`

Contoh URL dengan token:

`http://IP-PC:3000/chat/trigger?token=TOKEN_KAMU`

---

## Payload Minimal

```json
{
  "platform": "twitch",
  "user": "viewer123",
  "message": "!meme"
}
```

Alternatif bisa kirim field `command` langsung:

```json
{
  "platform": "youtube",
  "user": "viewerYt",
  "command": "!hype"
}
```

---

## Mapping Command

- Command otomatis dinormalisasi ke format `!command`
- Masing-masing command bisa dipetakan ke 1 file media
- Per-row bisa override queue (checkbox `queue`)

---

## Platform Filter

- `all`: terima semua platform
- `twitch`: hanya terima event twitch
- `youtube`: hanya terima event youtube

---

## Recent Events

Panel **Recent Events** menampilkan log status terbaru:

- `triggered`
- `unmapped`
- `invalid-command`
- `file-missing`
- `ignored-platform`

---

## Contoh Integrasi Bot

### Nightbot / StreamElements webhook style
Kirim request HTTP POST ke URL webhook dengan body JSON:

```json
{
  "platform": "twitch",
  "user": "$(user)",
  "message": "!meme"
}
```

### cURL test manual

```bash
curl -X POST "http://localhost:3000/chat/trigger?token=TOKEN_KAMU" \
  -H "Content-Type: application/json" \
  -d '{"platform":"twitch","user":"tester","message":"!meme"}'
```

---

## File Storage

- `chat_commands.json` → config command
- `chat_events.json` → history event terbaru

---

← [Kembali ke README](../readme.md)
