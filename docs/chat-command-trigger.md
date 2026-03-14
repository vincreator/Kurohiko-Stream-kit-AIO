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
