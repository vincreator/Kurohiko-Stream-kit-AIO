# 📃 Media Queue / Playlist Mode

Fitur ini menambahkan dua mode baru di Deck:

- **Queue Mode** → setiap trigger akan diantrikan (FIFO), tidak langsung menimpa media yang sedang tampil.
- **Playlist Mode** → kumpulkan beberapa media ke playlist lalu enqueue sekali jalan.

---

## 1) Queue Mode

Aktifkan dari tombol **⏳ / ▶** di search bar Deck.

### Perilaku

- **Queue Mode OFF (▶)**
  - Trigger baru langsung mengganti media yang sedang tampil.
- **Queue Mode ON (⏳)**
  - Trigger baru masuk antrean.
  - Overlay OBS memutar antrean satu per satu secara urut.

### Catatan

- Antrean berjalan di sisi overlay (`obs.html`) dengan sistem FIFO.
- `hide-media` akan membersihkan antrean.

---

## 2) Playlist Mode

Buka tombol **📃 Playlist** di Deck.

### Yang bisa dilakukan

- Tambah media dari library (panel kanan)
- Lihat urutan playlist (panel kiri)
- Ubah urutan item (↑ / ↓)
- Hapus item per baris (✕)
- Shuffle (🔀)
- Clear semua (🧹)
- Play (▶) untuk enqueue semua item playlist
- Toggle **Loop**

### Cara pakai cepat

1. Klik **📃 Playlist**
2. Tambah item dari panel library
3. Klik **▶ Play**
4. Item akan dikirim sebagai trigger ber-`queueMode: true`

---

## 3) Random Trigger + Queue

Saat Queue Mode aktif, tombol random **🎲** tidak lagi memakai endpoint random server langsung.
Sebaliknya, Deck memilih random lokal lalu mengirim trigger dalam mode queue agar tidak double-trigger.

---

## 4) Penyimpanan Settings

Disimpan di `deck_settings.json`:

```json
{
  "queueMode": true,
  "playlistItems": ["a.mp4", "b.mp3", "c.png"],
  "playlistLoop": false
}
```

---

## 5) Integrasi OBS

OBS overlay sekarang memakai antrean array (bukan single-slot) sehingga:

- trigger queue bertubi-tubi tetap urut
- tidak ada item queue yang ketimpa item baru
- selesai hide/ended akan lanjut ke item berikutnya otomatis

---

← [Kembali ke README](../readme.md)
