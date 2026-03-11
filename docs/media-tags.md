# 🏷️ Media Tags & Kategori

Fitur **Tags** memungkinkan kamu mengelompokkan media berdasarkan kategori bebas — misalnya `funny`, `anime`, `sfx`, `intro` — lalu memfilter grid hanya menampilkan media dengan tag tertentu.

---

## Lokasi

Halaman **Custom Deck** → `/customdeck.html`

- **Tag input**: di dalam modal Settings setiap media (setelah Display Name)
- **Tag filter bar**: di atas grid, muncul otomatis kalau ada minimal 1 media yang sudah diberi tag
- **Tag mini chips**: ditampilkan langsung di kartu media di grid

---

## Cara Menambah Tag ke Media

1. Di grid, klik tombol **⚙** di kartu media (atau klik kartu dalam edit mode)
2. Modal settings terbuka — cari field **Tags**
3. Ketik nama tag lalu tekan **Enter** atau **koma (,)**
4. Tag langsung muncul sebagai chip di dalam input
5. Klik **✕** di chip untuk menghapus tag
6. Klik **Save** — tag tersimpan bersama settings media di `meta.json`

**Autocomplete:** saat mengetik, tag yang pernah dipakai di media lain akan muncul sebagai saran. Klik saran untuk langsung menambahkan.

---

## Aturan Tag

| Aturan | Detail |
|--------|--------|
| Panjang max | 24 karakter per tag |
| Karakter dilarang | `< > " ' \`` |
| Jumlah tag | Tidak dibatasi |
| Case-sensitive | Ya — `Funny` dan `funny` dianggap berbeda |

---

## Filter by Tag di Grid

Setelah ada media yang diberi tag, **Tag Bar** muncul otomatis di atas grid:

```
🏷 TAG:  🏷 funny   🏷 anime   🏷 sfx   🏷 intro
```

- Klik tag → grid hanya menampilkan media dengan tag tersebut
- Tag aktif ditandai dengan highlight
- Tombol **✕ clear** muncul untuk menghapus filter
- Klik tag yang sama lagi → filter dinonaktifkan

---

## Kombinasi Filter

Tag filter bekerja **bersama** dengan search, type filter, dan sort:

```
Search: "meme"  +  Filter: VID  +  Tag: funny  +  Sort: Terbaru
→ Tampil: video yang mengandung "meme" DAN ber-tag "funny", diurutkan terbaru
```

---

## Tag pada Kartu di Grid

Setiap kartu menampilkan **hingga 3 tag pertama** sebagai mini chip di atas nama file:

```
┌──────────────┐
│   [thumbnail] │
│ [funny][anime]│  ← max 3 tag
│  nama_file.mp4│
└──────────────┘
```

Klik kartu tag di modal untuk langsung filter — atau gunakan tag bar.

---

## Contoh Workflow

### Setup kategori untuk stream

```
Video "pake.mp4"      → tags: funny, reaction
Video "nangis.mp4"    → tags: funny, sad
Audio "airhorn.mp3"   → tags: sfx
Audio "sadviolin.mp3" → tags: sfx, sad
Image "logo.png"      → tags: intro, branding
```

Saat stream:
- Filter **`sfx`** → hanya tampil `airhorn.mp3` dan `sadviolin.mp3`
- Filter **`funny`** → tampil `pake.mp4` dan `nangis.mp4`
- Filter **`intro`** + Type **IMG** → hanya `logo.png`

---

## Penyimpanan

Tag disimpan di `meta.json` sebagai bagian dari settings per-file:

```json
{
  "pake.mp4": {
    "displayName": "Pake Meme",
    "tags": ["funny", "reaction"],
    "volume": 80,
    ...
  }
}
```

Tag ikut ter-backup dan ter-restore bersama backup ZIP.

---

*[← Kembali ke README](../readme.md)*
