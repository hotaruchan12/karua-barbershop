require('dotenv').config();
const MySQL = require('sync-mysql');
const db = new MySQL({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'karua_areum',
  charset: 'utf8mb4',
  dateStrings: true
});
// Adapter keeps the existing synchronous API used by the Express routes.
const originalPrepare = db.query.bind(db);
db.prepare = sql => ({
  all: (...args) => originalPrepare(sql, args),
  get: (...args) => originalPrepare(sql, args)[0],
  run: (...args) => {
    let q = sql.replace(/^INSERT\s+OR\s+IGNORE/i, 'INSERT IGNORE');
    q = q.replace(/ON CONFLICT\s*\(([^)]+)\)\s*DO UPDATE SET\s+nilai=excluded\.nilai/i, 'ON DUPLICATE KEY UPDATE nilai=VALUES(nilai)');
    const result = originalPrepare(q, args);
    return { changes: result.affectedRows || 0, lastInsertRowid: result.insertId || 0 };
  }
});
// Skema tambahan untuk fitur Virtual Try-On AI.
// Aditif: tidak mengubah/menghapus tabel dan data yang sudah ada.
db.query(`CREATE TABLE IF NOT EXISTS vto_hasil (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_user BIGINT UNSIGNED NOT NULL,
  gaya VARCHAR(80) NOT NULL,
  gambar VARCHAR(255) NULL,
  status ENUM('proses','selesai','gagal') NOT NULL DEFAULT 'proses',
  provider VARCHAR(40) NULL,
  pesan VARCHAR(300) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vto_user FOREIGN KEY(id_user) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_vto_user(id_user, created_at)
) ENGINE=InnoDB`);

// Pembayaran & catatan transaksi (FU-5). Aditif.
db.query(`CREATE TABLE IF NOT EXISTS transaksi (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kode_order VARCHAR(40) NOT NULL UNIQUE,
  id_booking BIGINT UNSIGNED NULL,
  id_pelanggan BIGINT UNSIGNED NULL,
  nama_pelanggan VARCHAR(80) NOT NULL,
  layanan VARCHAR(150) NOT NULL,
  total INT NOT NULL,
  metode VARCHAR(30) NOT NULL,
  status ENUM('menunggu','berhasil','gagal','kedaluwarsa') NOT NULL DEFAULT 'menunggu',
  uang_diterima INT NULL,
  kembalian INT NULL,
  snap_url VARCHAR(300) NULL,
  id_kasir BIGINT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_trx_booking FOREIGN KEY(id_booking) REFERENCES booking(id) ON DELETE SET NULL,
  INDEX idx_trx_status(status, created_at),
  INDEX idx_trx_booking(id_booking)
) ENGINE=InnoDB`);

// Kolom tambahan tabel layanan untuk halaman Booking baru (kategori & perkiraan durasi).
// Dicek lewat INFORMATION_SCHEMA agar aman di MySQL maupun MariaDB dan tidak merusak data lama.
const adaKolom = (t, c) => db.query('SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [t, c]).length > 0;
if (!adaKolom('layanan', 'kategori')) {
  db.query("ALTER TABLE layanan ADD COLUMN kategori VARCHAR(30) NOT NULL DEFAULT 'Rambut'");
  db.query("UPDATE layanan SET kategori='Perawatan' WHERE nama LIKE 'Creambath%' OR nama LIKE 'Warna%'"); // hanya saat kolom pertama dibuat
}
if (!adaKolom('layanan', 'durasi')) db.query('ALTER TABLE layanan ADD COLUMN durasi INT NULL');

// Seed only when the database is empty.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const bcrypt = require('bcryptjs');
  const pw = bcrypt.hashSync(process.env.SEED_PASSWORD || 'GantiSaya#2026', 10);
  const addUser = db.prepare('INSERT INTO users(nama,email,hash,peran) VALUES(?,?,?,?)');
  addUser.run('Owner Karua', 'owner@karua.id', pw, 'admin');
  addUser.run('Kasir Karua', 'kasir@karua.id', pw, 'kasir');
  const c1 = addUser.run('Capster 1', 'capster1@karua.id', pw, 'capster').lastInsertRowid;
  const c2 = addUser.run('Capster 2', 'capster2@karua.id', pw, 'capster').lastInsertRowid;
  const addCapster = db.prepare('INSERT INTO capster(id_user,nama,keahlian,pengalaman) VALUES(?,?,?,?)');
  addCapster.run(c1, 'Capster 1', 'Isi keahlian (ubah lewat halaman admin)', 'Isi pengalaman');
  addCapster.run(c2, 'Capster 2', 'Isi keahlian (ubah lewat halaman admin)', 'Isi pengalaman');
  const l = db.prepare('INSERT INTO layanan(nama,harga,keterangan) VALUES(?,?,?)');
  l.run('Cukur dan styling', 50000, ''); l.run('Cukur, cuci, dan styling', 60000, '');
  l.run('Cukur, cuci, styling, dan pijat', 75000, 'Paling favorit');
  l.run('Creambath', null, 'Tergantung durasi'); l.run('Warna rambut', null, 'Tergantung warna dan produk');
  const p = db.prepare('INSERT INTO promo(judul,deskripsi) VALUES(?,?)');
  p.run('Potongan Rp10.000', 'Berlaku setiap hari pukul 12.00 sampai 16.00.');
  p.run('Gratis cukur 1x', 'Kumpulkan 10 stempel, dapatkan gratis cukur satu kali.');
  const pr = db.prepare('INSERT INTO produk(nama,deskripsi) VALUES(?,?)');
  ['Hair Powder', 'Pomade', 'Clay', 'Shampo', 'Hair Tonic'].forEach(n => pr.run(n, 'Tersedia di Karua Barbershop.'));
  const hair = (col, d) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><path fill="${col}" d="${d}"/></svg>`);
  const m = db.prepare('INSERT INTO model_rambut(nama,gambar,bentuk) VALUES(?,?,?)');
  m.run('Pompadour', hair('#1c1917', 'M10 100C10 20 60 0 100 8C150 0 190 30 190 100C170 60 150 45 100 45C50 45 30 60 10 100Z'), 'oval,persegi');
  m.run('Crop Rapi', hair('#1c1917', 'M20 100C20 40 60 25 100 25C140 25 180 40 180 100C160 70 140 62 100 62C60 62 40 70 20 100Z'), 'bulat,lonjong');
  m.run('Textured Fringe', hair('#292524', 'M15 100C15 30 80 10 120 20C170 30 185 60 185 100C165 78 140 70 110 72C70 74 40 80 15 100Z'), 'oval,bulat,lonjong');
  const g = db.prepare('INSERT INTO galeri(judul,kategori,foto) VALUES(?,?,?)');
  ['Classic', 'Fade', 'Textured', 'Classic', 'Fade', 'Textured'].forEach((k, i) => g.run('Hasil potongan ' + (i + 1), k, ''));
  const s = db.prepare('INSERT INTO pengaturan(kunci,nilai) VALUES(?,?)');
  s.run('wa', '6280000000000'); s.run('maps', 'https://www.google.com/maps/search/?api=1&query=Karua+Barbershop+Jl.+Sultan+Alauddin+2+No.+5+Makassar');
  s.run('ig', 'https://www.instagram.com/'); s.run('tiktok', 'https://www.tiktok.com/');
  s.run('alamat', 'Jl. Sultan Alauddin 2 No. 5, Makassar');
}
module.exports = db;
