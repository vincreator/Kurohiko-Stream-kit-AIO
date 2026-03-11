# 🔍 Search & Filter di Media Library

Fitur **Search & Filter** di halaman Custom Deck memungkinkan kamu menemukan media dengan cepat dari koleksi yang besar, memfilter berdasarkan tipe file, dan mengurutkan tampilan sesuai kebutuhan.

---

## Lokasi

Halaman **Custom Deck** → `/customdeck.html`

Bar pencarian & filter terletak di antara zona upload dan grid media.

---

## Fitur yang Tersedia

### 1. 🔎 Search by Name

Ketik di kolom search untuk memfilter media secara real-time.

- Pencarian berlaku untuk **nama file** maupun **display name** (nama kustom yang diset di settings)
- Case-insensitive (huruf besar/kecil tidak dibedakan)
- Tombol **✕** muncul di kanan input untuk clear pencarian sekali klik

**Keyboard shortcut:** `Ctrl+F` (atau `Cmd+F` di Mac) → langsung fokus ke kolom search

---

### 2. 🏷️ Filter by Type

Empat tombol filter di sebelah search input:

| Tombol | Filter | Ekstensi yang dicakup |
|--------|--------|-----------------------|
| `ALL` | Semua file | — |
| `IMG` | Gambar | `.jpg` `.jpeg` `.png` `.gif` `.webp` |
| `VID` | Video | `.mp4` `.webm` `.mov` |
| `AUD` | Audio | `.mp3` `.wav` `.ogg` |

Setiap tombol menampilkan **badge angka** yang menunjukkan jumlah file sesuai tipe, misalnya:

```
ALL 24   IMG 10   VID 8   AUD 6
```

Badge selalu menunjukkan jumlah dari **semua file** (bukan hasil filter), agar kamu tahu total aset per tipe.

---

### 3. ↕️ Sort (Urutkan)

Dropdown sort di ujung kanan bar — 6 pilihan:

| Opsi | Keterangan |
|------|------------|
| `A → Z` | Urut nama A sampai Z |
| `Z → A` | Urut nama Z sampai A |
| `Terbaru` *(default)* | File paling baru di-upload tampil duluan |
| `Terlama` | File paling lama di-upload tampil duluan |
| `Terbesar` | File dengan ukuran terbesar tampil duluan |
| `Terkecil` | File dengan ukuran terkecil tampil duluan |

> Sort berlaku pada **nama display** (bukan nama file asli) jika sudah di-set.

---

### 4. 📊 Count Label

Di atas grid, label seperti:

```
24 files
5 files (filtered)
```

Label `(filtered)` muncul otomatis saat ada pencarian aktif atau filter tipe selain ALL.

---

## Cara Pakai

### Cari file tertentu

1. Klik kolom search (atau tekan `Ctrl+F`)
2. Ketik nama file atau display name
3. Grid langsung memfilter real-time
4. Klik **✕** atau tekan `Ctrl+A` lalu `Delete` untuk clear

### Filter hanya video

1. Klik tombol **VID**
2. Hanya file video yang tampil
3. Klik **ALL** untuk kembali ke semua file

### Cari video tertentu + sort terbesar dulu

1. Klik **VID**
2. Ketik nama di search
3. Pilih **Terbesar** di dropdown sort
4. Hasil: hanya video yang namanya cocok, diurutkan dari yang terbesar

---

## Kombinasi Filter

Search, filter type, dan sort **bekerja bersamaan**:

```
Search: "meme"  +  Filter: VID  +  Sort: Terbaru
→ Tampil: semua video yang mengandung kata "meme", diurutkan terbaru dulu
```

---

*[← Kembali ke README](../readme.md)*
