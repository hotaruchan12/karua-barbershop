# Catatan perubahan

Zip ini hanya berisi file yang saya terima (server.js, public/app.js, firebase-auth.js, dst.) beserta file baru.
File lain di project kamu (db.js, vto.js, pembayaran.js, database.sql, public/index.html, CSS) **tidak saya ubah** karena tidak ada di zip.
Cara pakai: timpa file dengan nama yang sama di project kamu, lalu `npm test` dan `npm run dev`.

## Perbaikan bug
- `INSERT OR IGNORE` (libur) dan `ON CONFLICT ... excluded` (pengaturan) adalah sintaks SQLite, bukan MySQL. Diganti `INSERT IGNORE` dan `ON DUPLICATE KEY UPDATE`.
- POST booking tidak mengecek slot yang sudah terisi; kasir bisa memindah booking ke slot yang sudah dipakai. Kini keduanya dicek (409).
- Promo Rp10.000 jam 12.00–16.00 hanya tertulis, tidak pernah mengurangi harga. Kini diterapkan (lihat README).
- Gambar galeri dan capster memakai `alt=""`; kini deskriptif (syarat SEO di PRD). Foto yang gagal dimuat diganti ikon.
- Halaman kosong bila API gagal saat pindah halaman; kini tampil pesan error dan judul tab ikut berganti.
- Rate limit login menghitung login yang berhasil, dan satu penghitung dipakai bersama untuk daftar dan masuk.
- Cookie sesi tidak dihapus saat logout; JSON rusak menampilkan error mentah; `/api/*` yang tidak ada mengembalikan HTML.

## Keamanan
- Sesi dibuat ulang saat login (session fixation).
- Login Google/Firebase ditolak untuk akun staf. Sebelumnya siapa pun yang menguasai email `owner@karua.id` di Google bisa masuk sebagai admin.
- Batas password 72 karakter (bcrypt memotong diam-diam), batas booking aktif per pelanggan, jadwal maksimal 60 hari.

## Fitur yang ditambahkan (sesuai PRD)
- Halaman depan: keunggulan, cara booking, lokasi + jam buka + peta + tautan Instagram/TikTok (4.1).
- Bukti pembayaran digital untuk pelanggan dan kasir (P2).
- Dashboard pelanggan: booking mendatang dan riwayat dipisah; hasil AI Try-On tampil di dashboard.
- Rekap booking per capster di admin (P3).
- Ganti password untuk semua peran (README sebelumnya menyuruh ganti password, tetapi fiturnya tidak ada).
- Kembali ke halaman tujuan setelah login (`?next=`).
- SEO: canonical, Open Graph, noindex, JSON-LD `BarberShop` (4.6).

## Belum dikerjakan (perlu file lain atau keputusan mitra)
1. Hasil **AI Try-On belum menempel ke booking**; capster hanya melihat catatan "Acuan gaya: …". Perlu kolom baru di tabel booking (db.js / database.sql).
2. Cek `database.sql`: bila `booking` punya UNIQUE (id_capster, tanggal, jam), slot yang pernah dibatalkan tidak bisa dipesan ulang.
3. Konten halaman dibuat lewat JavaScript. Google bisa membacanya, tetapi untuk skor SEO terbaik pertimbangkan render di server.
4. Email pendaftaran belum diverifikasi (risiko pembajakan akun bila ada yang mendaftar dengan email orang lain).
5. Booking "menunggu" tanpa bayar menahan slot selamanya; pertimbangkan kedaluwarsa otomatis (butuh keputusan mitra: uang muka atau tidak).
6. Gaya baru memakai kelas CSS yang sudah ada dan gaya inline; rapikan di file CSS bila perlu (file CSS tidak ada di zip).
