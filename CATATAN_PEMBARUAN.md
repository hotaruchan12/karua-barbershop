# Catatan pembaruan

## File baru
- `pembayaran.js`, `test-pembayaran.js`

## File diubah
- `server.js`: rute pembayaran/transaksi/rekap/ekspor, webhook Midtrans, kolom layanan baru, pelanggan tidak bisa membatalkan booking yang sudah dibayar.
- `db.js` dan `database.sql`: tabel `transaksi`; kolom `layanan.kategori` dan `layanan.durasi` (migrasi otomatis).
- `public/app.js`, `public/style.css`, `public/index.html`: halaman Booking sesuai Figma (3 langkah, kartu layanan, ringkasan "Kunjunganmu"), footer, tombol Masuk, note box, UI pembayaran kasir/pelanggan, rekap admin.
- `.env.example`, `README.md`, `package.json`.

## Tidak diubah
`vto.js` dan halaman Virtual Try-On AI.
