# 🎲 Random Trigger

Fitur **Random Trigger** memungkinkan kamu men-trigger satu media secara acak dari seluruh koleksi yang sudah di-upload — cocok buat tombol "surprise meme", StreamDeck, atau integrasi bot.

---

## Cara Pakai

### 1. Tombol 🎲 di Deck View

Buka **Deck View** (`/deck.html`), lalu klik tombol **🎲** di sebelah tombol ✏️ Edit.

- Media dipilih acak dari semua file yang ada
- Media yang baru saja di-trigger **tidak akan muncul lagi** di trigger berikutnya (anti-repeat)
- Kartu yang terpilih otomatis ter-highlight di grid
- Toast kecil muncul di bawah layar menampilkan nama file yang dipilih

---

### 2. Via URL (OBS, StreamDeck, Bot, dll)

Route ini bisa dipanggil dari browser, HTTP request, atau tool apapun:

```
GET http://localhost:3000/trigger/random
```

#### Filter by Tipe

| Parameter | Nilai | Keterangan |
|-----------|-------|------------|
| `type` | `video` | Hanya file video (`.mp4`, `.webm`, `.mov`) |
| `type` | `image` | Hanya file gambar (`.jpg`, `.png`, `.gif`, `.webp`) |
| `type` | `audio` | Hanya file audio (`.mp3`, `.wav`, `.ogg`) |

**Contoh URL:**

```
# Acak semua media
GET /trigger/random

# Acak hanya video
GET /trigger/random?type=video

# Acak video atau gambar
GET /trigger/random?type=video&type=image

# Acak dengan exclude (anti-repeat manual)
GET /trigger/random?type=audio&exclude=intro.mp3
```

#### Response

```json
{ "ok": true, "filename": "meme_ngakak.mp4" }
```

Kalau tidak ada media yang cocok:

```json
{ "ok": false, "error": "No media found" }
```

---

### 3. Pakai di StreamDeck

1. Install plugin **Open URL** di StreamDeck
2. Set URL ke:
   ```
   http://localhost:3000/trigger/random
   ```
3. Tekan tombol → media acak langsung muncul di OBS overlay

Kalau mau filter hanya video:
```
http://localhost:3000/trigger/random?type=video
```

---

### 4. Pakai di Chat Bot (Nightbot, dll)

Buat command `!random` di Nightbot:

```
!addcom !random $(urlfetch http://localhost:3000/trigger/random)
```

> ⚠️ Nightbot fetch berjalan dari server Nightbot (cloud), bukan dari PC kamu.  
> Untuk integrasi lokal, gunakan bot self-hosted seperti **Fossabot** atau script Python/Node.js.

---

## Cara Kerja (Technical)

```
Client                     Server (server.js)              OBS
  │                              │                           │
  ├─── GET /trigger/random ─────►│                           │
  │                              ├── baca MEDIA_DIR          │
  │                              ├── filter by ?type         │
  │                              ├── buang ?exclude          │
  │                              ├── Math.random()           │
  │                              ├── io.emit('show-media')──►│
  │◄── { ok:true, filename } ────┤                           │
```

- Server membaca daftar file langsung dari disk (tidak dari cache) agar selalu up-to-date
- Filter `?exclude` mencegah file yang sama muncul dua kali berturut-turut
- `incrementTrigger()` dipanggil sehingga stat "Total Trigger" di dashboard ikut bertambah

---

## Contoh Integrasi Script

### Python

```python
import requests

r = requests.get('http://localhost:3000/trigger/random?type=video')
data = r.json()
if data['ok']:
    print(f"Triggered: {data['filename']}")
```

### Node.js / JavaScript

```js
const res = await fetch('http://localhost:3000/trigger/random');
const { ok, filename } = await res.json();
if (ok) console.log('Triggered:', filename);
```

### curl

```bash
curl http://localhost:3000/trigger/random?type=image
```

---

*[← Kembali ke README](../readme.md)*
