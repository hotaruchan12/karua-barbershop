# Karua Areum — MySQL Edition

Website booking online dan virtual hair try-on Karua Barbershop (Node.js + Express + MySQL).

## Persiapan database dengan XAMPP
1. Jalankan Apache dan MySQL dari XAMPP.
2. Buka `http://localhost/phpmyadmin`.
3. Pilih menu **Import**, unggah file `database.sql`, lalu klik **Import/Kirim**. File ini membuat database `karua_areum` beserta seluruh tabel.
4. Salin `.env.example` menjadi `.env`. Untuk XAMPP standar, DB_HOST `127.0.0.1`, DB_PORT `3306`, DB_USER `root`, DB_PASSWORD kosong, DB_NAME `karua_areum`.
5. Ganti `SESSION_SECRET` dan `SEED_PASSWORD` di `.env` sebelum menjalankan website.

## Menjalankan website
1. Pasang Node.js 18 atau lebih baru.
2. Buka folder project di VS Code.
3. Jalankan `npm install`.
4. Jalankan `npm run dev` (atau `npm start`).
5. Buka `http://localhost:3000`.

Saat pertama kali backend tersambung ke database kosong, akun staf dan data awal akan dibuat otomatis. Password awal semua akun staf sama dengan nilai `SEED_PASSWORD` di `.env`.

| Peran | Email |
|---|---|
| Admin/Owner | owner@karua.id |
| Kasir | kasir@karua.id |
| Capster | capster1@karua.id, capster2@karua.id |

Pelanggan dapat mendaftar melalui halaman Masuk. **Segera ubah password awal setelah login.**

## Login Google lewat Firebase
Browser memakai Firebase Authentication (popup Google), lalu mengirim ID token ke `POST /api/firebase`. Server memverifikasi token itu sendiri (`firebase-auth.js`: tanda tangan, project ID, kedaluwarsa, email terverifikasi, penyedia google.com) dan membuat sesi biasa. Peran tetap diatur di database; akun baru otomatis menjadi *pelanggan*.

Pengaturan di Firebase Console (project kamu):
1. **Authentication > Get started > Sign-in method > Google > Enable**, pilih email dukungan proyek, Save.
2. **Authentication > Settings > Authorized domains**: `localhost` sudah ada. Saat online, tambahkan domain websitemu.
3. **Project settings (ikon roda gigi) > General > Your apps > ikon Web `</>`**, beri nama aplikasi, daftarkan. Salin `apiKey`, `authDomain`, `projectId`, `appId` dari `firebaseConfig` ke `.env` sebagai `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`.
4. Restart server. Di halaman Masuk muncul tombol **Lanjutkan dengan Google**.

Kalau keempat variabel `FIREBASE_*` kosong, website memakai cara lama (`GOOGLE_CLIENT_ID`). Uji verifikasi token: `npm test`.

## Pembayaran & transaksi (FU-5)
Ada dua jalur, keduanya tercatat di tabel `transaksi` (dibuat otomatis saat server start, juga ada di `database.sql`):

1. **Bayar di tempat (kasir)** — dashboard kasir > *Pembayaran di tempat*. Pilih Tunai (isi uang diterima, kembalian dihitung otomatis) atau QRIS. Bisa untuk booking (isi kode / tombol *catat bayar*) maupun pelanggan datang langsung.
2. **Bayar online (Midtrans Snap, sandbox)** — pelanggan menekan *Bayar online* setelah booking atau dari dashboard. Setelah berhasil, status booking otomatis menjadi *dikonfirmasi*.

Mengaktifkan bayar online:
1. Daftar di https://dashboard.sandbox.midtrans.com, lalu salin **Server Key** (Settings > Access Keys) ke `.env` sebagai `MIDTRANS_SERVER_KEY`.
2. Restart server. Tanpa key, tombol bayar online otomatis tidak muncul.
3. **Lokal:** Midtrans tidak bisa menjangkau `localhost`, jadi status diperbarui saat pelanggan kembali ke dashboard atau menekan *cek status* (server menanyakan langsung ke Midtrans).
4. **Server publik (HTTPS):** isi *Payment Notification URL* di dashboard Midtrans dengan `https://DOMAINMU/api/midtrans/notifikasi`. Notifikasi diverifikasi dengan signature SHA-512 dan nominalnya dicocokkan dengan data di database.
5. Uji dengan simulator sandbox Midtrans (https://simulator.sandbox.midtrans.com); jangan memakai kartu atau akun asli.

`BAYAR_ONLINE_PERSEN` (default 100) menentukan persen yang dibayar online. Ubah bila mitra memutuskan uang muka. Layanan tanpa harga tetap (creambath, warna) tidak bisa dibayar online; kasir mengisi total manual.

Rekap: dashboard admin > *Rekap transaksi* (per hari/bulan), unduh **CSV** (dibuka di Excel) atau **Cetak / simpan PDF**. Uji logika pembayaran: `npm test`.

## Promo jam 12.00–16.00
Potongan Rp10.000 pukul 12.00–16.00 (PRD 1.1) kini diterapkan otomatis ke harga booking, pembayaran online, dan pembayaran kasir, hanya untuk layanan kategori **Rambut** berharga tetap. Ringkasan booking menampilkan harga coret dan harga akhir. Kasir bisa mencentang *Jangan terapkan potongan promo* per transaksi (mis. pelanggan memakai gratis cukur dari stempel). Atur lewat `PROMO_POTONGAN`, `PROMO_JAM_MULAI`, `PROMO_JAM_SELESAI` di `.env`; `PROMO_POTONGAN=0` mematikannya. Logikanya ada di `promo.js` dan diuji `test-promo.js`. **Konfirmasikan aturan ini ke Pak Thoriq** (apakah creambath dan warna rambut ikut dipotong, dan apakah promo berlaku untuk paket pijat).

## Bukti pembayaran, ganti password, rekap booking
- Tombol **bukti** di riwayat pembayaran pelanggan dan tabel transaksi kasir/admin membuka struk digital yang bisa dicetak atau disimpan PDF (`GET /api/transaksi/:id/bukti`; pelanggan hanya bisa melihat miliknya).
- **Ganti password** ada di bagian bawah dashboard semua peran (`POST /api/akun/password`). Akun staf awal memakai `SEED_PASSWORD`, jadi segera ganti.
- **Rekap booking per capster** (`GET /api/rekap/booking`) tampil di admin > Rekap transaksi.

## Keamanan yang ditambahkan
Sesi dibuat ulang saat login; hanya percobaan login yang gagal dihitung rate limit, pendaftaran dan cek kode booking punya batas sendiri; login Google/Firebase hanya untuk akun pelanggan (staf wajib password); cookie dihapus saat logout; password dibatasi 72 karakter (batas bcrypt); booking aktif per pelanggan dibatasi dan jadwal maksimal 60 hari ke depan; pindah jadwal oleh kasir kini dicek bentrok dengan booking lain.

## SEO
Server menambahkan canonical, Open Graph, `noindex` untuk halaman login/dashboard/404, dan data terstruktur `BarberShop` (alamat, jam buka, kisaran harga, media sosial) di halaman depan, tanpa menggandakan tag yang sudah ada di `index.html`. Halaman depan kini memuat bagian keunggulan, cara booking, serta lokasi dengan peta Google.

## Hosting
Website ini memakai **Node.js + MySQL**, jadi tidak bisa dijalankan di InfinityFree (hanya PHP/MySQL). Gunakan VPS, atau layanan yang mendukung Node.js dan MySQL. Isi `NODE_ENV=production`, `SITE_URL` (https), `SESSION_SECRET` acak, dan sediakan disk persisten untuk `storage/vto/` dan `public/uploads/`.

## Memperbarui database lama
Tidak perlu impor ulang. Saat server start, `db.js` menambahkan tabel `transaksi` serta kolom `layanan.kategori` dan `layanan.durasi` bila belum ada. Atur kategori (Rambut/Perawatan) dan durasi lewat dashboard admin > layanan.

## Struktur penting
- `server.js`: API, autentikasi, dan routing.
- `db.js`: koneksi MySQL dan pengisian data awal.
- `database.sql`: struktur database MySQL untuk diimpor ke phpMyAdmin.
- `pembayaran.js`: Midtrans Snap, verifikasi signature, kembalian, ekspor CSV. `test-pembayaran.js`: uji logikanya.
- `firebase-auth.js`: verifikasi ID token Firebase. `test-firebase.js`: ujinya.
- `vto.js`: integrasi Virtual Try-On AI (validasi gambar, Gradio client, provider, penyimpanan hasil).
- `public/`: tampilan website.
- `public/vto-styles/`: 12 gambar referensi gaya rambut.
- `storage/vto/`: hasil AI (dibuat otomatis, tidak masuk git, disajikan lewat route ber-autentikasi).
- `.env.example`: contoh konfigurasi koneksi dan Virtual Try-On.
- `promo.js`: aturan promo jam 12.00–16.00. `test-promo.js`: ujinya.

## Virtual Try-On AI (Hugging Face Gradio)

Halaman `/virtual-tryon` memakai model AI nyata lewat Gradio API milik Hugging Face Space. Tidak ada hasil yang disimulasikan: jika layanan AI gagal, pengguna melihat pesan error dan tombol coba lagi.

### Cara kerja
1. Pengguna mengunggah foto JPG/PNG. Browser mengompresnya ke maksimal 1024 px sebelum dikirim.
2. Server memvalidasi tipe file, ukuran, dan dimensi (minimal 256 × 256, maksimal 2 MB secara default).
3. Server memanggil Space Gradio. Provider utama: `AIRI-Institute/HairFastGAN`.
4. Hanya **hasil AI** yang disimpan di `storage/vto/` (di luar `public/`). Foto asli pelanggan hanya hidup di memori selama request dan tidak pernah ditulis ke disk.
5. Hasil disajikan lewat `/api/vto/gambar/:id` yang memerlukan login. Pemilik hasil dan admin dapat mengaksesnya.
6. Riwayat disimpan di tabel `vto_hasil` (dibuat otomatis oleh `db.js`, juga ada di `database.sql`).

### Variabel `.env`
| Variabel | Default | Keterangan |
|---|---|---|
| `HF_TOKEN` | kosong | Opsional. Diperlukan untuk Space private atau kuota HF lebih tinggi. Jangan pernah ditaruh di frontend. |
| `HF_SPACE_ID` | `AIRI-Institute/HairFastGAN` | Space utama (owner/nama Space). |
| `HF_SPACE_URL` | kosong | Alternatif bila memakai endpoint Gradio sendiri, mis. `http://127.0.0.1:7860`. |
| `VTO_PROVIDER` | `auto` | `auto` (utama lalu cadangan), `hairfastgan` (hanya utama), atau `fallback`. |
| `VTO_FALLBACK_SPACE_ID` | `Ciraaa/Virtual_Hair_stylist` | Space cadangan yang juga AI nyata. Kosongkan untuk menonaktifkan. |
| `VTO_FALLBACK_SPACE_URL` | kosong | Endpoint Gradio cadangan milik sendiri. |
| `VTO_CONNECT_TIMEOUT_MS` | `25000` | Batas waktu koneksi ke Space. |
| `VTO_RESIZE_TIMEOUT_MS` | `45000` | Batas waktu normalisasi foto/referensi. |
| `VTO_TIMEOUT_MS` | `120000` | Batas waktu proses AI utama. |
| `VTO_PRIMARY_COOLDOWN_MS` | `300000` | Setelah provider utama gagal di mode `auto`, provider utama dilewati selama ini agar permintaan berikutnya langsung ke cadangan. |
| `VTO_MAX_UPLOAD_MB` | `2` | Ukuran maksimal foto setelah decode (1–20 MB). Default 2 MB agar tetap di bawah batas body JSON 3 MB. |
| `VTO_ALIGN` | `0` | `1` untuk mencoba `align_face` bawaan Space. Space resmi saat ini bermasalah untuk align, jadi default center-crop. |

### Status layanan & fallback
Space resmi `AIRI-Institute/HairFastGAN` berstatus `RUNNING`, tetapi backend inferensinya saat ini mengembalikan `process_completed` dengan `success:false` (`{"error":null}`). Karena itu `VTO_PROVIDER=auto` mencoba HairFastGAN lebih dulu, lalu memakai Space cadangan yang juga berjalan di Hugging Face. Ketika fallback dipakai, API mengirim `provider:"fallback"` dan UI menampilkan keterangan **“Model AI alternatif”** secara jujur. Jika kedua provider gagal, tidak ada hasil palsu — pengguna mendapat pesan error.

### Menjalankan model sendiri (disarankan untuk produksi)
- Deploy Space HairFastGAN milik sendiri (GPU) lalu set `HF_SPACE_ID=<user>/<space>`.
- Atau jalankan repo `AIRI-Institute/HairFastGAN` di server GPU, lalu set `HF_SPACE_URL=http://127.0.0.1:7860` dan `VTO_PROVIDER=hairfastgan`.
- Endpoint dan `fn_index` mengikuti `app.py` Space (resize fn 1/2, `swap_hair` fn 4). Jika memakai versi/model lain, sesuaikan `vto.js`.

### Hosting
- Sediakan disk persisten untuk `storage/vto/` agar hasil tidak hilang saat redeploy.
- Server harus bisa mengakses `huggingface.co` (outbound HTTPS).
- Set `SITE_URL` ke domain publik dan jalankan di belakang HTTPS.
- Rate limit VTO adalah 6 permintaan / 15 menit / IP dan disimpan di memori proses. Untuk beberapa instance, gunakan store rate-limit bersama.

### Uji cepat
1. `npm start`, lalu buka `http://localhost:3000/virtual-tryon`.
2. Masuk sebagai pelanggan, unggah foto wajah, pilih gaya, tekan **Coba gaya ini**.
3. Pastikan hasil muncul, slider sebelum/sesudah berfungsi, unduh bekerja, dan tombol **Booking gaya ini** membuka `/booking?gaya=<slug>` dengan catatan otomatis.
4. Buka `/api/vto/riwayat` di browser setelah login; hasil hanya boleh terlihat oleh pemiliknya (coba akun lain → 403/404).

## Catatan
Koneksi database menggunakan `sync-mysql` agar kompatibel dengan pola query sinkron pada backend asli. Untuk penggunaan produksi dengan trafik tinggi, disarankan migrasi lanjutan ke driver pool asynchronous seperti `mysql2/promise`.
