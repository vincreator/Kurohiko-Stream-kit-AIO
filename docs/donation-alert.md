# 🔔 Donation Alert — Saweria & Trakteer Webhook

Alert otomatis tampil di OBS saat ada donasi masuk dari Saweria atau Trakteer, lengkap dengan nama donatur, jumlah, dan pesan.

---

## Cara Setup (5 menit)

### Langkah 1 — Buka Setup Modal

Di dashboard KSK → klik kartu **🔔 Donation Alert**

---

### Langkah 2 — Salin Webhook URL

Di dalam modal, tersedia dua URL webhook siap pakai:

| Platform | URL |
|---|---|
| Saweria | `http://[IP-LAN]:3000/webhook/saweria` |
| Trakteer | `http://[IP-LAN]:3000/webhook/trakteer` |

> IP-LAN otomatis terisi berdasarkan jaringan lokal kamu. Jika platform donation kamu perlu URL publik (HTTPS), gunakan tunneling seperti [ngrok](https://ngrok.com) atau [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

---

### Langkah 3 — Daftarkan ke Platform

#### Saweria
1. Login → **Pengaturan** → **Webhook**
2. Aktifkan Webhook
3. Paste URL: `http://[IP]:3000/webhook/saweria`
4. (Opsional) Isi Secret Token — samakan dengan field di modal KSK

#### Trakteer
1. Login → **Pengaturan Kreator** → **Webhook Notifikasi**
2. Aktifkan Webhook
3. Paste URL: `http://[IP]:3000/webhook/trakteer`
4. (Opsional) Isi Secret Token — samakan dengan field di modal KSK

---

### Langkah 4 — Tambahkan OBS Browser Source

1. Di OBS → klik **+** → **Browser Source**
2. Beri nama, misal: `KSK Donation Alert`
3. URL: `http://[IP]:3000/donation.html`
4. Width: `1920`, Height: `1080`
5. Centang **Shutdown source when not visible** ← opsional
6. Klik OK

> Alert tampil di **bawah-tengah** layar. Tidak perlu atur posisi di OBS — alert sudah teposisi otomatis dalam canvas 1920×1080.

---

### Langkah 5 — Simpan Config

Isi semua setting di modal lalu klik **💾 Simpan**.

---

## Pengaturan yang Tersedia

| Setting | Keterangan |
|---|---|
| **Secret Token** (per platform) | Jika diisi, webhook hanya diterima jika request menyertakan `?token=xxx` yang cocok. Biarkan kosong untuk tidak verifikasi. |
| **Durasi tampil** | Berapa detik alert tampil di OBS. Range: 3–30 detik (default 8s). |
| **Sound FX saat donasi** | Nama file dari Media Library (contoh: `kaching.mp3`). File akan di-trigger ke OBS overlay saat webhook diterima. Kosongkan jika tidak perlu. |

---

## Tampilan Alert

```
┌────────────────────────────────────────────────────┐
│  ☕ SAWERIA          ♥♥♥              Rp 50.000   │
│  ─────────────────────────────────────────────── │
│  ❤️  BucengGaming                                │
│  "Semangat streamnya kak!"                        │
│  ████████████░░░░░░░░░░░░░░░░░░░░░  (countdown)  │
└────────────────────────────────────────────────────┘
```

- Badge platform berwarna (Saweria = 🟠, Trakteer = 🔴)
- Progress bar countdown sesuai durasi yang diset
- Jika ada donasi beruntun, tampil satu per satu (queue)

---

## Payload yang Diterima

### Saweria
```json
{
  "donator_name": "BucengGaming",
  "amount_raw": 50000,
  "message": "Semangat streamnya kak!"
}
```

### Trakteer
```json
{
  "supporter_name": "BucengGaming",
  "supporter_message": "Gass terus streamnya!",
  "price_amount": 5000,
  "quantity": 3,
  "total": 15000,
  "unit_name": "Kopi"
}
```

---

## Menggunakan Tunneling (untuk URL Publik)

Platform donation membutuhkan URL HTTPS yang bisa diakses dari internet. Jika kamu stream dari jaringan rumah (NAT), gunakan tunnel:

### Opsi A — ngrok (paling mudah)
```bash
ngrok http 3000
```
Gunakan URL `https://xxxx.ngrok-free.app/webhook/saweria` di Saweria.

### Opsi B — Cloudflare Tunnel (gratis, tanpa batas waktu)
```bash
cloudflared tunnel --url http://localhost:3000
```

### Opsi C — localhost.run (tanpa install)
```bash
ssh -R 80:localhost:3000 nokey@localhost.run
```

> Setiap kali tunnel di-restart, URL berubah — update juga di dashboard Saweria/Trakteer.

---

## Test Webhook Manual

Gunakan `curl` untuk test tanpa donasi sungguhan:

```bash
# Test Saweria
curl -X POST http://localhost:3000/webhook/saweria \
  -H "Content-Type: application/json" \
  -d '{"donator_name":"TestUser","amount_raw":10000,"message":"Test donasi!"}'

# Test Trakteer
curl -X POST http://localhost:3000/webhook/trakteer \
  -H "Content-Type: application/json" \
  -d '{"supporter_name":"TestUser","supporter_message":"Halo!","total":15000,"unit_name":"Kopi","quantity":3}'

# Test dengan token
curl -X POST "http://localhost:3000/webhook/saweria?token=rahasia123" \
  -H "Content-Type: application/json" \
  -d '{"donator_name":"TestUser","amount_raw":50000,"message":""}'
```

Response sukses:
```json
{ "ok": true }
```

---

## Riwayat Donasi

50 donasi terakhir disimpan otomatis di `donations.json` (di folder AppData). Bisa dilihat di bagian bawah modal setup, termasuk nama, jumlah, platform, dan waktu relatif.

---

## Storage

| File | Isi |
|---|---|
| `donation_config.json` | Token, durasi alert, nama file sound |
| `donations.json` | Riwayat 50 donasi terakhir |

---

← [Kembali ke README](../readme.md)
