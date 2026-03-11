# 🕐 Auto-Hide Timer per Media

Setiap media bisa dikonfigurasi berapa detik ia tampil di OBS overlay sebelum otomatis tersembunyi — termasuk **video** dan **audio**.

---

## Cara Mengatur

1. Buka **Kelola Media** di Custom Deck
2. Klik ✏️ pada media yang ingin diatur
3. Di bagian **Auto-Hide Timer**, geser slider

---

## Perilaku per Tipe

### 🖼 Image
| Nilai `dur` | Perilaku |
|---|---|
| `0` | Harus di-hide manual (tombol atau socket event `hide-media`) |
| `> 0` | Auto-hide setelah N detik |

### 🎬 Video
| Nilai `dur` | Perilaku |
|---|---|
| `0` | Video main sampai selesai → auto-hide via `onended` |
| `> 0` | Force-stop setelah N detik (meski video belum selesai) |

> Berguna untuk video loop atau video panjang yang hanya ingin ditampilkan sebentar.

### 🔊 Audio
| Nilai `dur` | Perilaku |
|---|---|
| `0` | Audio main sampai selesai → state direset, queue dilanjutkan |
| `> 0` | Force-stop setelah N detik |

> Audio tidak punya elemen visual — timer hanya mengatur kapan audio dihentikan dan queue dilanjutkan.

---

## Batas Slider per Tipe

| Tipe | Min | Max |
|---|---|---|
| Image | 0 | 60 detik |
| Video | 0 | 300 detik |
| Audio | 0 | 300 detik |

---

## Tampilan di Modal

Slider muncul di antara bagian **Animasi** dan **Posisi & Ukuran**. Label dan hint text berubah otomatis sesuai tipe media yang dibuka.

```
[ Animasi In / Out ]
┌────────────────────────────────────────────┐
│ Paksa stop setelah N detik — 0 = main …   │
│ ●────────────────────  12s                 │
│ 0 = video main penuh sampai selesai. …     │
└────────────────────────────────────────────┘
[ Posisi & Ukuran ]
```

---

## Interaksi dengan Queue Mode

Saat `queueMode: true` dikirim via socket `show-media`:

- Media sebelumnya di-hide dulu (animasi out)
- Setelah hide selesai, media baru dari queue langsung ditampilkan
- Timer force-stop (audio/video) juga me-reset state dan melanjutkan queue

---

## Penyimpanan

Nilai `duration` disimpan per-media di `meta.json`:

```json
{
  "myvideo.mp4": {
    "duration": 15,
    ...
  }
}
```

---

← [Kembali ke README](../readme.md)
