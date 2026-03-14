# 🔊 Soundboard Mode (tanpa OBS)

Mode ini membuat Deck berfungsi sebagai soundboard lokal.
Saat aktif, klik card **audio** akan diputar langsung di browser/app tanpa lewat overlay OBS.

---

## Cara Pakai

### Opsi 1 — dari Deck
1. Buka Deck (`/deck.html`)
2. Klik tombol **🔊** di bar atas sampai ON
3. Klik card audio untuk play

### Opsi 2 — quick launch dari Dashboard
- Klik kartu **Soundboard Mode** (membuka `deck.html?soundboard=1`)

---

## Perilaku Mode

- **ON**: file audio diputar lokal (tanpa trigger ke OBS)
- **OFF**: semua media kembali trigger ke OBS seperti biasa
- File **image/video** tetap trigger ke OBS (soundboard hanya memengaruhi audio)

---

## Opsi Tambahan

Di Settings Deck:
- **Soundboard mode (tanpa OBS)**
- **Stop sound sebelumnya**
  - ON: audio baru akan menghentikan audio sebelumnya
  - OFF: audio boleh overlap (play bersamaan)

---

## Catatan Teknis

- Volume mengikuti setting per-media (`settings.volume`) jika tersedia
- Shortcut keyboard tetap bekerja, dan jika targetnya audio maka ikut diputar lokal saat soundboard ON

---

← [Kembali ke README](../readme.md)
