require('dotenv').config();
const express = require('express'), session = require('express-session'), helmet = require('helmet'),
  rateLimit = require('express-rate-limit'), bcrypt = require('bcryptjs'), crypto = require('crypto'),
  fs = require('fs'), path = require('path'), db = require('./db'), vto = require('./vto'), bayar = require('./pembayaran'), fbAuth = require('./firebase-auth'), promo = require('./promo');
const app = express(), PROD = process.env.NODE_ENV === 'production', GID = process.env.GOOGLE_CLIENT_ID, SITE = process.env.SITE_URL || 'http://localhost:3000';
const JAM = [...Array(12)].map((_, i) => String(10 + i).padStart(2, '0') + ':00'); // 10.00 - 21.00 (tutup 22.00)
const STATUS = ['menunggu', 'dikonfirmasi', 'selesai', 'batal'];
const MAKS_AKTIF = Math.max(1, parseInt(process.env.MAKS_BOOKING_AKTIF || '3', 10) || 3); // booking aktif per pelanggan (cegah slot ditumpuk)
const MAKS_HARI = 60; // pelanggan hanya bisa booking sampai 60 hari ke depan

if (PROD) {
  app.set('trust proxy', 1);
  app.use((q, r, n) => (q.secure ? n() : r.redirect(301, 'https://' + q.headers.host + q.originalUrl))); // paksa HTTPS
  if (!process.env.SESSION_SECRET) { console.error('SESSION_SECRET wajib diisi di production.'); process.exit(1); }
}
// Firebase Auth (popup Google) membutuhkan: SDK dari gstatic, gapi, API Google, iframe di authDomain,
// dan COOP same-origin-allow-popups agar jendela popup bisa mengirim hasil login kembali.
const FB_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN ? 'https://' + process.env.FIREBASE_AUTH_DOMAIN.replace(/^https?:\/\//, '') : null;
app.use(helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://accounts.google.com', 'https://www.gstatic.com', 'https://apis.google.com'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
  fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  connectSrc: ["'self'", 'https://accounts.google.com', 'https://*.googleapis.com'],
  frameSrc: ['https://accounts.google.com', 'https://www.google.com', 'https://*.firebaseapp.com', 'https://*.web.app', ...(FB_DOMAIN ? [FB_DOMAIN] : [])] } } }));
app.use(express.json({ limit: '3mb' }));
app.use(session({ name: 'karua.sid', secret: process.env.SESSION_SECRET || 'dev-saja', resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 864e5 } }));

// ---- helper ----
const wrap = f => (q, r) => {
  const fail = e => {
    if (r.headersSent) return;
    if (e && e.status && e.pesan) return r.status(e.status).json({ pesan: e.pesan });
    if (['ER_DUP_ENTRY','ER_NO_REFERENCED_ROW_2','ER_ROW_IS_REFERENCED_2'].includes(e.code)) return r.status(409).json({ pesan: 'Data bentrok atau masih dipakai (mis. slot sudah terisi).' });
    console.error(e); r.status(500).json({ pesan: 'Terjadi kesalahan server.' });
  };
  try { const out = f(q, r); if (out && typeof out.catch === 'function') out.catch(fail); } catch (e) { fail(e); }
};
const peran = (...p) => (q, r, n) => q.session.user ? (p.includes(q.session.user.peran) ? n() : r.status(403).json({ pesan: 'Akses ditolak.' })) : r.status(401).json({ pesan: 'Silakan masuk.' });
const bersih = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const urlOk = v => !v || /^(\/[\w\-./]+|https:\/\/[^\s"'<>]+|data:image\/(png|jpeg|webp|svg\+xml)[;,][^\s"'<>]+)$/.test(v);
const tglOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const TZ = 'Asia/Makassar'; // WITA, supaya tanggal/jam benar walau server berada di zona waktu lain
const hariIni = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const jamSekarang = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const lewat = (tanggal, jam) => tanggal < hariIni() || (tanggal === hariIni() && jam <= jamSekarang());
const sekarang = () => new Date().toLocaleString('sv-SE', { timeZone: TZ }); // 'YYYY-MM-DD HH:MM:SS' WITA
const tambahHari = (t, n) => new Date(Date.parse(t + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// Sesi dibuat ulang setiap login (mencegah session fixation). Token CSRF lama ikut hilang, klien meminta token baru setelah login.
const masuk = (q, r, u) => q.session.regenerate(err => {
  if (err) { console.error(err); return r.status(500).json({ pesan: 'Terjadi kesalahan server.' }); }
  q.session.user = { id: u.id, nama: u.nama, peran: u.peran };
  q.session.save(() => r.json(q.session.user));
});

// ---- CSRF ----
app.get('/api/csrf', (q, r) => { q.session.csrf ??= crypto.randomBytes(24).toString('hex'); r.json({ token: q.session.csrf }); });
app.use('/api', (q, r, n) => (q.method !== 'GET' && q.path !== '/midtrans/notifikasi' && (!q.session.csrf || q.get('x-csrf-token') !== q.session.csrf))
  ? r.status(403).json({ pesan: 'Token CSRF tidak valid. Muat ulang halaman.' }) : n());

// ---- data publik ----
app.get('/api/publik', wrap((q, r) => {
  const a = t => db.prepare(`SELECT * FROM ${t}`).all();
  r.json({ layanan: a('layanan'), promo: a('promo'), produk: a('produk'), galeri: a('galeri'), model: a('model_rambut'),
    capster: db.prepare('SELECT * FROM capster WHERE aktif=1').all(), jam: JAM, googleClientId: GID || '', firebase: fbAuth.configPublik(),
    vto: vto.publicStyles(), vtoProvider: (process.env.VTO_PROVIDER || 'auto'), bayarOnline: bayar.aktif(), bayarPersen: Math.min(100, Math.max(1, Number(process.env.BAYAR_ONLINE_PERSEN || 100))), promoAturan: promo.config(), halaman: META,
    pengaturan: Object.fromEntries(db.prepare('SELECT * FROM pengaturan').all().map(x => [x.kunci, x.nilai])) });
}));
app.get('/api/saya', (q, r) => r.json(q.session.user || null));

// ---- auth ----
// Login: hanya percobaan yang gagal dihitung. Pendaftaran dan cek kode punya batas sendiri.
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, skipSuccessfulRequests: true, message: { pesan: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' } });
const limiterDaftar = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { pesan: 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.' } });
const limiterCek = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { pesan: 'Terlalu banyak pengecekan. Coba lagi beberapa menit lagi.' } });
app.post('/api/daftar', limiterDaftar, wrap((q, r) => {
  const nama = bersih(q.body.nama, 80), email = bersih(q.body.email, 120).toLowerCase(), hp = bersih(q.body.hp, 16), pw = String(q.body.password || '');
  if (!nama || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?\d{8,15}$/.test(hp) || pw.length < 8 || pw.length > 72)
    return r.status(400).json({ pesan: 'Data tidak valid (nama, email, HP 8-15 angka, password 8-72 karakter).' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return r.status(409).json({ pesan: 'Email sudah terdaftar.' });
  db.prepare("INSERT INTO users(nama,email,hp,hash,peran) VALUES(?,?,?,?, 'pelanggan')").run(nama, email, hp, bcrypt.hashSync(pw, 10));
  r.json({ pesan: 'Pendaftaran berhasil. Silakan masuk.' });
}));
app.post('/api/masuk', limiter, wrap((q, r) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(bersih(q.body.email, 120).toLowerCase());
  if (!u || !u.hash || !bcrypt.compareSync(String(q.body.password || ''), u.hash)) return r.status(401).json({ pesan: 'Email atau password salah.' });
  masuk(q, r, u);
}));
app.post('/api/google', limiter, async (q, r) => {
  if (!GID) return r.status(501).json({ pesan: 'Login Google belum dikonfigurasi.' });
  try {
    const { OAuth2Client } = require('google-auth-library');
    const p = (await new OAuth2Client(GID).verifyIdToken({ idToken: String(q.body.credential), audience: GID })).getPayload();
    if (!p.email_verified) throw new Error('email belum terverifikasi');
    let u = db.prepare('SELECT * FROM users WHERE email=?').get(p.email.toLowerCase());
    if (u && u.peran !== 'pelanggan') return r.status(403).json({ pesan: 'Akun staf masuk dengan email dan password, bukan Google.' });
    if (!u) { const i = db.prepare("INSERT INTO users(nama,email,peran) VALUES(?,?,'pelanggan')").run(bersih(p.name || p.email, 80), p.email.toLowerCase()); u = { id: i.lastInsertRowid, nama: p.name, peran: 'pelanggan' }; }
    masuk(q, r, u);
  } catch (e) { r.status(401).json({ pesan: 'Login Google gagal.' }); }
});
// Login Google lewat Firebase Authentication: browser mengirim ID token, server memverifikasinya
// lalu membuat sesi sendiri (peran tetap diatur di database, bukan oleh Firebase).
app.post('/api/firebase', limiter, async (q, r) => {
  if (!fbAuth.aktif()) return r.status(501).json({ pesan: 'Login Google (Firebase) belum dikonfigurasi.' });
  try {
    const p = await fbAuth.verifikasi(q.body && q.body.idToken), email = p.email.toLowerCase();
    let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u && u.peran !== 'pelanggan') return r.status(403).json({ pesan: 'Akun staf masuk dengan email dan password, bukan Google.' });
    if (!u) { const i = db.prepare("INSERT INTO users(nama,email,peran) VALUES(?,?,'pelanggan')").run(bersih(p.name || email, 80), email); u = { id: i.lastInsertRowid, nama: bersih(p.name || email, 80), peran: 'pelanggan' }; }
    masuk(q, r, u);
  } catch (e) { console.error('Login Firebase gagal:', e.message); r.status(401).json({ pesan: 'Login Google gagal. Coba lagi.' }); }
});
app.post('/api/keluar', (q, r) => q.session.destroy(() => { r.clearCookie('karua.sid'); r.json({ pesan: 'ok' }); }));
// Ganti password (semua peran). Akun yang dibuat lewat Google belum punya password, jadi tidak perlu password lama.
app.post('/api/akun/password', limiter, peran('pelanggan', 'capster', 'kasir', 'admin'), wrap((q, r) => {
  const lama = String(q.body.lama || ''), baru = String(q.body.baru || '');
  if (baru.length < 8 || baru.length > 72) return r.status(400).json({ pesan: 'Password baru 8-72 karakter.' });
  const u = db.prepare('SELECT id,hash FROM users WHERE id=?').get(q.session.user.id);
  if (!u) return r.status(404).json({ pesan: 'Akun tidak ditemukan.' });
  if (u.hash && !bcrypt.compareSync(lama, u.hash)) return r.status(403).json({ pesan: 'Password lama salah.' });
  if (u.hash && lama === baru) return r.status(400).json({ pesan: 'Password baru harus berbeda dari yang lama.' });
  db.prepare('UPDATE users SET hash=? WHERE id=?').run(bcrypt.hashSync(baru, 10), u.id);
  r.json({ pesan: 'Password diperbarui.' });
}));

// ---- booking (FU-1) ----
app.get('/api/slot', wrap((q, r) => {
  const { capster, tanggal } = q.query;
  if (!tglOk(tanggal) || tanggal < hariIni() || tanggal > tambahHari(hariIni(), MAKS_HARI)) return r.status(400).json({ pesan: 'Tanggal tidak valid.' });
  if (db.prepare('SELECT 1 FROM libur WHERE id_capster=? AND tanggal=?').get(capster, tanggal)) return r.json({ libur: true, jam: [] });
  const terisi = db.prepare("SELECT jam FROM booking WHERE id_capster=? AND tanggal=? AND status!='batal'").all(capster, tanggal).map(x => x.jam);
  r.json({ jam: JAM.map(j => ({ jam: j, kosong: !terisi.includes(j) && !lewat(tanggal, j) })) });
}));
app.post('/api/booking', peran('pelanggan', 'kasir', 'admin'), wrap((q, r) => {
  const u = q.session.user, b = q.body, tanggal = bersih(b.tanggal, 10), jam = bersih(b.jam, 5);
  const nama = u.peran === 'pelanggan' ? u.nama : bersih(b.nama_pelanggan, 80);
  if (!nama || !tglOk(tanggal) || tanggal < hariIni() || !JAM.includes(jam)) return r.status(400).json({ pesan: 'Data booking tidak valid.' });
  if (lewat(tanggal, jam) && u.peran === 'pelanggan') return r.status(400).json({ pesan: 'Jam tersebut sudah lewat.' });
  if (u.peran === 'pelanggan' && tanggal > tambahHari(hariIni(), MAKS_HARI)) return r.status(400).json({ pesan: `Booking hanya bisa sampai ${MAKS_HARI} hari ke depan.` });
  if (u.peran === 'pelanggan' && +db.prepare("SELECT COUNT(*) n FROM booking WHERE id_pelanggan=? AND status IN('menunggu','dikonfirmasi') AND tanggal>=?").get(u.id, hariIni()).n >= MAKS_AKTIF)
    return r.status(409).json({ pesan: `Kamu sudah punya ${MAKS_AKTIF} booking aktif. Selesaikan atau batalkan dulu sebelum booking lagi.` });
  const catatan = bersih(b.catatan, 300); let idTryon = null;
  if (u.peran === 'pelanggan' && b.id_tryon) { // acuan hasil try-on harus milik pelanggan itu sendiri
    if (!db.prepare('SELECT 1 FROM tryon WHERE id=? AND id_user=?').get(b.id_tryon, u.id)) return r.status(400).json({ pesan: 'Hasil try-on tidak ditemukan.' });
    idTryon = +b.id_tryon; }
  if (!db.prepare('SELECT 1 FROM layanan WHERE id=?').get(b.id_layanan) || !db.prepare('SELECT 1 FROM capster WHERE id=? AND aktif=1').get(b.id_capster))
    return r.status(400).json({ pesan: 'Layanan atau capster tidak ditemukan.' });
  if (db.prepare('SELECT 1 FROM libur WHERE id_capster=? AND tanggal=?').get(b.id_capster, tanggal)) return r.status(409).json({ pesan: 'Capster libur pada tanggal tersebut.' });
  // Cek dan simpan berjalan sinkron tanpa jeda, jadi dua permintaan serentak tidak bisa lolos ke slot yang sama.
  if (db.prepare("SELECT 1 FROM booking WHERE id_capster=? AND tanggal=? AND jam=? AND status!='batal'").get(b.id_capster, tanggal, jam)) return r.status(409).json({ pesan: 'Jam tersebut sudah terisi. Pilih jam atau capster lain.' });
  const kode = 'KA-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  db.prepare('INSERT INTO booking(kode,id_pelanggan,nama_pelanggan,id_layanan,id_capster,tanggal,jam,status,catatan,id_tryon) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(kode, u.peran === 'pelanggan' ? u.id : null, nama, b.id_layanan, b.id_capster, tanggal, jam, u.peran === 'pelanggan' ? 'menunggu' : 'dikonfirmasi', catatan, idTryon);
  r.json({ kode });
}));
const SEL = `SELECT b.id,b.kode,b.nama_pelanggan,b.tanggal,b.jam,b.status,b.catatan,b.id_tryon,l.nama layanan,l.harga,l.kategori,c.nama capster,
  (SELECT COUNT(*) FROM transaksi x WHERE x.id_booking=b.id AND x.status='berhasil') dibayar FROM booking b
  JOIN layanan l ON l.id=b.id_layanan JOIN capster c ON c.id=b.id_capster`;
app.get('/api/booking', peran('pelanggan', 'capster', 'kasir', 'admin'), wrap((q, r) => {
  const u = q.session.user; let w = '1=1'; const a = [];
  if (u.peran === 'pelanggan') { w = 'b.id_pelanggan=?'; a.push(u.id); }
  if (u.peran === 'capster') { w = 'b.id_capster=(SELECT id FROM capster WHERE id_user=?)'; a.push(u.id); }
  if (tglOk(q.query.tanggal)) { w += ' AND b.tanggal=?'; a.push(q.query.tanggal); }
  if (tglOk(q.query.dari)) { w += ' AND b.tanggal>=?'; a.push(q.query.dari); }
  r.json(db.prepare(`${SEL} WHERE ${w} ORDER BY b.tanggal,b.jam LIMIT 300`).all(...a).map(x => { const h = promo.hitung(x, x.jam); return { ...x, potongan: h.potongan, harga_bayar: h.bayar }; }));
}));
app.get('/api/booking/kode/:kode', limiterCek, wrap((q, r) => { // cek status (P3)
  const b = db.prepare(`${SEL} WHERE b.kode=?`).get(bersih(q.params.kode, 12).toUpperCase());
  b ? r.json({ kode: b.kode, tanggal: b.tanggal, jam: b.jam, status: b.status, layanan: b.layanan, capster: b.capster }) : r.status(404).json({ pesan: 'Kode tidak ditemukan.' });
}));
app.patch('/api/booking/:id', peran('kasir', 'admin'), wrap((q, r) => {
  const s = [], a = [], b = q.body;
  if (b.status) { if (!STATUS.includes(b.status)) return r.status(400).json({ pesan: 'Status tidak valid.' }); s.push('status=?'); a.push(b.status); }
  if (b.tanggal) { if (!tglOk(b.tanggal)) return r.status(400).json({ pesan: 'Tanggal tidak valid.' }); s.push('tanggal=?'); a.push(b.tanggal); }
  if (b.jam) { if (!JAM.includes(b.jam)) return r.status(400).json({ pesan: 'Jam tidak valid.' }); s.push('jam=?'); a.push(b.jam); }
  if (!s.length) return r.status(400).json({ pesan: 'Tidak ada perubahan.' });
  const cur = db.prepare('SELECT id_capster,tanggal,jam FROM booking WHERE id=?').get(q.params.id);
  if (!cur) return r.status(404).json({ pesan: 'Booking tidak ditemukan.' });
  const t = b.tanggal || cur.tanggal, j = b.jam || cur.jam;
  if (b.tanggal || b.jam) {
    if (t < hariIni()) return r.status(400).json({ pesan: 'Tanggal sudah lewat.' });
    if (db.prepare('SELECT 1 FROM libur WHERE id_capster=? AND tanggal=?').get(cur.id_capster, t)) return r.status(409).json({ pesan: 'Capster libur pada tanggal tersebut.' });
  }
  if ((b.tanggal || b.jam || (b.status && b.status !== 'batal')) && db.prepare("SELECT 1 FROM booking WHERE id_capster=? AND tanggal=? AND jam=? AND status!='batal' AND id!=?").get(cur.id_capster, t, j, q.params.id))
    return r.status(409).json({ pesan: 'Jam tersebut sudah terisi booking lain.' });
  db.prepare(`UPDATE booking SET ${s.join(',')} WHERE id=?`).run(...a, q.params.id); r.json({ pesan: 'ok' });
}));
app.patch('/api/booking/:id/batal', peran('pelanggan'), wrap((q, r) => {
  const x = db.prepare("UPDATE booking SET status='batal' WHERE id=? AND id_pelanggan=? AND status IN('menunggu','dikonfirmasi') AND NOT EXISTS(SELECT 1 FROM transaksi WHERE id_booking=booking.id AND status='berhasil')").run(q.params.id, q.session.user.id);
  x.changes ? r.json({ pesan: 'ok' }) : r.status(409).json({ pesan: 'Booking tidak dapat dibatalkan. Jika sudah dibayar, hubungi kasir lewat WhatsApp.' });
}));
app.post('/api/libur', peran('kasir', 'admin'), wrap((q, r) => {
  if (!tglOk(q.body.tanggal)) return r.status(400).json({ pesan: 'Tanggal tidak valid.' });
  db.prepare('INSERT IGNORE INTO libur(id_capster,tanggal) VALUES(?,?)').run(q.body.id_capster, q.body.tanggal); r.json({ pesan: 'ok' });
}));
app.get('/api/libur', peran('kasir', 'admin'), wrap((q, r) => r.json(db.prepare('SELECT l.*,c.nama FROM libur l JOIN capster c ON c.id=l.id_capster WHERE tanggal>=? ORDER BY tanggal').all(hariIni()))));
app.delete('/api/libur', peran('kasir', 'admin'), wrap((q, r) => { db.prepare('DELETE FROM libur WHERE id_capster=? AND tanggal=?').run(q.body.id_capster, q.body.tanggal); r.json({ pesan: 'ok' }); }));


// ---- pembayaran & transaksi (FU-5) ----
const TRX = `SELECT t.id,t.kode_order,t.nama_pelanggan,t.layanan,t.total,t.metode,t.status,t.uang_diterima,t.kembalian,t.snap_url,t.created_at,t.paid_at,b.kode kode_booking
  FROM transaksi t LEFT JOIN booking b ON b.id=t.id_booking`;
const TGL_TRX = 'DATE(COALESCE(t.paid_at,t.created_at))';
const kodeOrder = kode => kode + '-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

// Terapkan status dari Midtrans (webhook atau cek manual). Idempoten; transaksi yang sudah final tidak diubah.
function terapkanStatus(trx, n) {
  if (n.gross_amount != null && Math.round(Number(n.gross_amount)) !== trx.total) throw { status: 400, pesan: 'Nominal tidak cocok.' };
  if (trx.status !== 'menunggu') { if (trx.status === 'gagal' && bayar.petaStatus(n) === 'berhasil') console.warn('Pembayaran masuk untuk transaksi yang sudah dibatalkan kasir:', trx.kode_order); return trx.status; }
  const st = bayar.petaStatus(n), metode = bayar.metodeDari(n);
  if (st === 'berhasil') {
    db.prepare("UPDATE transaksi SET status='berhasil',metode=?,paid_at=? WHERE id=?").run(metode, sekarang(), trx.id);
    if (trx.id_booking) db.prepare("UPDATE booking SET status='dikonfirmasi' WHERE id=? AND status='menunggu'").run(trx.id_booking); // konfirmasi otomatis
  } else if (st !== 'menunggu') db.prepare('UPDATE transaksi SET status=?,metode=? WHERE id=?').run(st, metode, trx.id);
  else if (n.payment_type) db.prepare('UPDATE transaksi SET metode=? WHERE id=?').run(n.payment_type, trx.id);
  return st;
}

// Notifikasi dari Midtrans (tanpa sesi/CSRF; diverifikasi dengan signature SHA-512).
app.post('/api/midtrans/notifikasi', wrap((q, r) => {
  const n = q.body || {};
  if (!bayar.signatureValid(n)) return r.status(403).json({ pesan: 'Signature tidak valid.' });
  const trx = db.prepare('SELECT * FROM transaksi WHERE kode_order=?').get(bersih(n.order_id, 60));
  if (!trx) return r.status(404).json({ pesan: 'Order tidak dikenal.' });
  terapkanStatus(trx, n); r.json({ pesan: 'ok' });
}));

// Pelanggan membayar booking miliknya secara online (Midtrans Snap).
app.post('/api/pembayaran/online', peran('pelanggan'), wrap(async (q, r) => {
  if (!bayar.aktif()) return r.status(503).json({ pesan: 'Pembayaran online belum diaktifkan. Bayar di tempat kepada kasir.' });
  const u = q.session.user;
  const b = db.prepare('SELECT b.id,b.kode,b.status,b.jam,b.nama_pelanggan,l.nama layanan,l.harga,l.kategori FROM booking b JOIN layanan l ON l.id=b.id_layanan WHERE b.kode=? AND b.id_pelanggan=?')
    .get(bersih(q.body.kode, 12).toUpperCase(), u.id);
  if (!b) return r.status(404).json({ pesan: 'Booking tidak ditemukan.' });
  if (['batal', 'selesai'].includes(b.status)) return r.status(400).json({ pesan: 'Booking ini tidak dapat dibayar.' });
  if (!b.harga) return r.status(400).json({ pesan: 'Harga layanan ini menyesuaikan. Silakan bayar di tempat.' });
  if (db.prepare("SELECT 1 FROM transaksi WHERE id_booking=? AND status='berhasil'").get(b.id)) return r.status(409).json({ pesan: 'Booking ini sudah dibayar.' });
  const lama = db.prepare("SELECT snap_url FROM transaksi WHERE id_booking=? AND status='menunggu' AND metode='online' AND snap_url IS NOT NULL AND created_at > ? ORDER BY id DESC")
    .get(b.id, new Date(Date.now() - 20 * 36e5).toLocaleString('sv-SE', { timeZone: TZ })); // token Snap berlaku 24 jam
  if (lama) return r.json({ url: lama.snap_url });
  const total = bayar.totalOnline(promo.hitung(b, b.jam).bayar), order = kodeOrder(b.kode); // harga sudah dipotong promo jam 12-16 bila berlaku
  const id = db.prepare("INSERT INTO transaksi(kode_order,id_booking,id_pelanggan,nama_pelanggan,layanan,total,metode,status,created_at) VALUES(?,?,?,?,?,?,'online','menunggu',?)")
    .run(order, b.id, u.id, b.nama_pelanggan, b.layanan, total, sekarang()).lastInsertRowid;
  try {
    const email = (db.prepare('SELECT email FROM users WHERE id=?').get(u.id) || {}).email;
    const snap = await bayar.snapBuat({ orderId: order, total, nama: b.nama_pelanggan, email, namaItem: b.layanan, kembaliUrl: SITE + '/dashboard' });
    db.prepare('UPDATE transaksi SET snap_url=? WHERE id=?').run(snap.redirect_url, id);
    r.json({ url: snap.redirect_url });
  } catch (e) { db.prepare('DELETE FROM transaksi WHERE id=?').run(id); throw e; }
}));

// Cek status ke Midtrans (berguna di lokal karena webhook tidak bisa menjangkau localhost).
app.post('/api/pembayaran/:id/sinkron', peran('pelanggan', 'kasir', 'admin'), wrap(async (q, r) => {
  const u = q.session.user, trx = db.prepare('SELECT * FROM transaksi WHERE id=?').get(q.params.id);
  if (!trx || (u.peran === 'pelanggan' && trx.id_pelanggan !== u.id)) return r.status(404).json({ pesan: 'Transaksi tidak ditemukan.' });
  if (trx.status === 'menunggu' && trx.metode !== 'tunai' && trx.metode !== 'qris') {
    const n = await bayar.statusMidtrans(trx.kode_order);
    if (n) terapkanStatus(trx, n);
  }
  r.json({ status: db.prepare('SELECT status FROM transaksi WHERE id=?').get(trx.id).status });
}));

// Kasir mencatat pembayaran di tempat (tunai dengan kembalian, atau QRIS).
app.post('/api/transaksi', peran('kasir', 'admin'), wrap((q, r) => {
  const b = q.body, metode = bersih(b.metode, 10);
  if (!['tunai', 'qris'].includes(metode)) return r.status(400).json({ pesan: 'Metode harus tunai atau QRIS.' });
  let nama = bersih(b.nama_pelanggan, 80), idBooking = null, idPel = null, lay, kodeBooking = null, jamPromo = jamSekarang();
  if (b.kode_booking) {
    const bk = db.prepare('SELECT b.id,b.kode,b.status,b.jam,b.nama_pelanggan,b.id_pelanggan,l.nama layanan,l.harga,l.kategori FROM booking b JOIN layanan l ON l.id=b.id_layanan WHERE b.kode=?').get(bersih(b.kode_booking, 12).toUpperCase());
    if (!bk) return r.status(404).json({ pesan: 'Kode booking tidak ditemukan.' });
    if (bk.status === 'batal') return r.status(400).json({ pesan: 'Booking ini sudah dibatalkan.' });
    if (db.prepare("SELECT 1 FROM transaksi WHERE id_booking=? AND status='berhasil'").get(bk.id)) return r.status(409).json({ pesan: 'Booking ini sudah dibayar.' });
    idBooking = bk.id; idPel = bk.id_pelanggan; nama = bk.nama_pelanggan; lay = { nama: bk.layanan, harga: bk.harga, kategori: bk.kategori }; jamPromo = bk.jam; kodeBooking = bk.kode;
  } else {
    lay = db.prepare('SELECT nama,harga,kategori FROM layanan WHERE id=?').get(b.id_layanan);
    if (!lay) return r.status(400).json({ pesan: 'Pilih layanan.' });
    if (!nama) return r.status(400).json({ pesan: 'Nama pelanggan wajib diisi.' });
  }
  // Potongan promo jam 12-16 otomatis; kasir bisa mematikannya per transaksi (mis. pelanggan memakai gratis cukur dari stempel).
  const hp = b.tanpa_promo ? { potongan: 0, bayar: lay.harga ? +lay.harga : 0 } : promo.hitung(lay, jamPromo);
  const total = lay.harga ? hp.bayar : Math.round(Number(b.total)); // layanan tanpa harga tetap (creambath, warna): kasir mengisi total
  if (hp.potongan) lay.nama = bersih(lay.nama + ` (promo -Rp${hp.potongan.toLocaleString('id-ID')})`, 120);
  if (!Number.isInteger(total) || total <= 0 || total > 10e6) return r.status(400).json({ pesan: 'Total tidak valid. Isi total untuk layanan berharga menyesuaikan.' });
  let diterima = null, kembalian = null;
  if (metode === 'tunai') { diterima = Math.round(Number(b.uang_diterima)); kembalian = bayar.hitungKembalian(total, diterima); }
  const order = kodeOrder(kodeBooking || 'KASIR'), waktu = sekarang();
  db.prepare("INSERT INTO transaksi(kode_order,id_booking,id_pelanggan,nama_pelanggan,layanan,total,metode,status,uang_diterima,kembalian,id_kasir,created_at,paid_at) VALUES(?,?,?,?,?,?,?,'berhasil',?,?,?,?,?)")
    .run(order, idBooking, idPel, nama, lay.nama, total, metode, diterima, kembalian, q.session.user.id, waktu, waktu);
  if (idBooking) { // tagihan online yang belum dibayar dibatalkan supaya tidak terbayar dua kali
    db.prepare("UPDATE transaksi SET status='gagal' WHERE id_booking=? AND status='menunggu' AND metode='online'").run(idBooking);
    db.prepare("UPDATE booking SET status='dikonfirmasi' WHERE id=? AND status='menunggu'").run(idBooking);
  }
  r.json({ kode_order: order, total, kembalian, potongan: hp.potongan });
}));

// Filter tanggal + status, dipakai daftar, rekap, dan ekspor.
function filterTrx(q) {
  const dari = tglOk(q.query.dari) ? q.query.dari : hariIni(), sampai = tglOk(q.query.sampai) ? q.query.sampai : dari;
  let w = `${TGL_TRX} BETWEEN ? AND ?`; const a = [dari, sampai];
  if (['menunggu', 'berhasil', 'gagal', 'kedaluwarsa'].includes(q.query.status)) { w += ' AND t.status=?'; a.push(q.query.status); }
  return { w, a, dari, sampai };
}
app.get('/api/transaksi', peran('kasir', 'admin'), wrap((q, r) => {
  const f = filterTrx(q), rows = db.prepare(`${TRX} WHERE ${f.w} ORDER BY t.id DESC LIMIT 1000`).all(...f.a);
  const ok = rows.filter(x => x.status === 'berhasil'), per = m => ok.filter(x => x.metode === m).reduce((s, x) => s + x.total, 0);
  r.json({ dari: f.dari, sampai: f.sampai, rows, ringkasan: { jumlah: ok.length, total: ok.reduce((s, x) => s + x.total, 0), tunai: per('tunai'), qris: per('qris'),
    online: ok.filter(x => !['tunai', 'qris'].includes(x.metode)).reduce((s, x) => s + x.total, 0) } });
}));
app.get('/api/transaksi/ekspor', peran('admin'), wrap((q, r) => {
  const f = filterTrx(q), rows = db.prepare(`${TRX} WHERE ${f.w} ORDER BY t.id`).all(...f.a);
  r.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="transaksi-karua-${f.dari}_${f.sampai}.csv"` }).send(bayar.csvRekap(rows));
}));
app.get('/api/transaksi/saya', peran('pelanggan'), wrap((q, r) => r.json(db.prepare(`${TRX} WHERE t.id_pelanggan=? ORDER BY t.id DESC LIMIT 50`).all(q.session.user.id))));
// Bukti pembayaran digital (P2): dilihat pelanggan (miliknya sendiri), kasir, dan admin tanpa perlu memotret nota.
app.get('/api/transaksi/:id/bukti', peran('pelanggan', 'kasir', 'admin'), wrap((q, r) => {
  const u = q.session.user, x = db.prepare(`${TRX} WHERE t.id=?`).get(q.params.id), own = db.prepare('SELECT id_pelanggan FROM transaksi WHERE id=?').get(q.params.id);
  if (!x || !own || x.status !== 'berhasil' || (u.peran === 'pelanggan' && own.id_pelanggan !== u.id)) return r.status(404).json({ pesan: 'Bukti pembayaran tidak ditemukan.' });
  const st = Object.fromEntries(db.prepare('SELECT * FROM pengaturan').all().map(k => [k.kunci, k.nilai]));
  r.json({ ...x, alamat: st.alamat || '' });
}));
// Rekap booking per periode dan capster (P3), untuk membantu manajemen.
app.get('/api/rekap/booking', peran('admin'), wrap((q, r) => {
  const dari = tglOk(q.query.dari) ? q.query.dari : hariIni(), sampai = tglOk(q.query.sampai) ? q.query.sampai : dari;
  const rows = db.prepare('SELECT c.nama capster,b.status,COUNT(*) n FROM booking b JOIN capster c ON c.id=b.id_capster WHERE b.tanggal BETWEEN ? AND ? GROUP BY c.nama,b.status ORDER BY c.nama').all(dari, sampai);
  r.json({ dari, sampai, rows: rows.map(x => ({ capster: x.capster, status: x.status, jumlah: +x.n })) });
}));
app.get('/api/rekap', peran('admin'), wrap((q, r) => {
  const bulanan = q.query.periode === 'bulanan', f = filterTrx(q), fmt = bulanan ? "DATE_FORMAT(COALESCE(t.paid_at,t.created_at),'%Y-%m')" : TGL_TRX;
  const rows = db.prepare(`SELECT ${fmt} periode,COUNT(*) jumlah,SUM(t.total) omzet FROM transaksi t WHERE t.status='berhasil' AND ${TGL_TRX} BETWEEN ? AND ? GROUP BY periode ORDER BY periode DESC`).all(f.dari, f.sampai);
  r.json({ dari: f.dari, sampai: f.sampai, periode: bulanan ? 'bulanan' : 'harian', rows: rows.map(x => ({ periode: x.periode, jumlah: +x.jumlah, omzet: +x.omzet })) });
}));

// ---- try-on (FU-2) ----
app.post('/api/tryon', peran('pelanggan'), wrap((q, r) => {
  const g = String(q.body.gambar || '');
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(g) || g.length > 1.5e6) return r.status(400).json({ pesan: 'Gambar harus PNG/JPEG maksimal ±1 MB.' });
  db.prepare('INSERT INTO tryon(id_user,gambar) VALUES(?,?)').run(q.session.user.id, g); r.json({ pesan: 'Hasil try-on disimpan di dashboard.' });
}));
app.get('/api/tryon', peran('pelanggan'), wrap((q, r) => r.json(db.prepare('SELECT id,gambar,created_at FROM tryon WHERE id_user=? ORDER BY id DESC LIMIT 12').all(q.session.user.id))));

app.get('/api/tryon/:id', peran('capster', 'kasir', 'admin'), wrap((q, r) => {
  const x = db.prepare('SELECT gambar FROM tryon WHERE id=?').get(q.params.id);
  x ? r.json(x) : r.status(404).json({ pesan: 'Hasil try-on tidak ditemukan.' });
}));

// ---- virtual try-on AI (Hugging Face Gradio) ----
// Foto asli pelanggan tidak pernah ditulis ke disk. Hanya hasil AI yang disimpan,
// di storage/vto (di luar public) dan disajikan lewat route ber-autentikasi.
const vtoLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 6, message: { pesan: 'Terlalu banyak permintaan Virtual Try-On. Coba lagi 15 menit lagi.' } });

app.get('/api/vto/status', wrap(async (q, r) => r.json(await vto.status())));

app.get('/api/vto/riwayat', peran('pelanggan', 'capster', 'kasir', 'admin'), wrap((q, r) => {
  const rows = db.prepare('SELECT id,gaya,status,provider,pesan,created_at FROM vto_hasil WHERE id_user=? ORDER BY id DESC LIMIT 24').all(q.session.user.id);
  r.json(rows.map(x => ({ ...x, gambar: x.status === 'selesai' ? '/api/vto/gambar/' + x.id : null })));
}));

app.post('/api/vto/generate', vtoLimiter, peran('pelanggan', 'capster', 'kasir', 'admin'), wrap(async (q, r) => {
  const u = q.session.user;
  const style = vto.styleBySlug(bersih(q.body.gaya, 40));
  if (!style) return r.status(400).json({ pesan: 'Gaya rambut tidak valid.' });
  const face = vto.decodeImage(q.body.gambar);

  const id = db.prepare("INSERT INTO vto_hasil(id_user,gaya,status) VALUES(?,?,'proses')").run(u.id, style.slug).lastInsertRowid;
  try {
    const result = await vto.generate({ face, style });
    const file = vto.saveResult(result.buffer, result.mime, id);
    db.prepare("UPDATE vto_hasil SET gambar=?,status='selesai',provider=? WHERE id=?").run(file, result.provider, id);
    r.json({
      id,
      url: '/api/vto/gambar/' + id,
      gaya: style.slug,
      gaya_nama: style.nama,
      provider: result.provider,
      catatan: result.provider === 'fallback'
        ? 'Model HairFastGAN sedang tidak tersedia; hasil dibuat dengan model AI alternatif yang juga berjalan di Hugging Face.'
        : ''
    });
  } catch (e) {
    const pesan = String((e && (e.pesan || e.message)) || 'Gagal memproses foto.').slice(0, 300);
    db.prepare("UPDATE vto_hasil SET status='gagal',pesan=? WHERE id=?").run(pesan, id);
    throw e;
  }
}));

app.get('/api/vto/gambar/:id', peran('pelanggan', 'capster', 'kasir', 'admin'), wrap((q, r) => {
  const row = db.prepare('SELECT id,id_user,gambar,status FROM vto_hasil WHERE id=?').get(q.params.id);
  if (!row || row.status !== 'selesai' || !row.gambar) return r.status(404).json({ pesan: 'Hasil tidak ditemukan.' });
  if (row.id_user !== q.session.user.id && q.session.user.peran !== 'admin') return r.status(403).json({ pesan: 'Akses ditolak.' });
  const file = vto.resultPath(row.gambar);
  if (!file || !fs.existsSync(file)) return r.status(404).json({ pesan: 'File hasil tidak ditemukan.' });
  r.set('Cache-Control', 'private, max-age=3600');
  if (q.query.download) r.set('Content-Disposition', `attachment; filename="karua-vto-${row.id}${path.extname(file)}"`);
  r.sendFile(file);
}));

app.delete('/api/vto/:id', peran('pelanggan', 'capster', 'kasir', 'admin'), wrap((q, r) => {
  const row = db.prepare('SELECT id,id_user,gambar FROM vto_hasil WHERE id=?').get(q.params.id);
  if (!row || (row.id_user !== q.session.user.id && q.session.user.peran !== 'admin')) return r.status(404).json({ pesan: 'Hasil tidak ditemukan.' });
  vto.removeResult(row.gambar);
  db.prepare('DELETE FROM vto_hasil WHERE id=?').run(row.id);
  r.json({ pesan: 'Dihapus.' });
}));

// ---- upload gambar (admin) ----
const TIPE = { png: [[0x89, 0x50, 0x4e, 0x47]], jpeg: [[0xff, 0xd8, 0xff]], webp: [[0x52, 0x49, 0x46, 0x46]] };
app.post('/api/admin/upload', peran('admin'), wrap((q, r) => {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(q.body.gambar || ''));
  if (!m) return r.status(400).json({ pesan: 'Gambar harus PNG, JPEG, atau WEBP.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.4e6) return r.status(400).json({ pesan: 'Gambar terlalu besar (maks. ±1,4 MB).' });
  if (!TIPE[m[1]].some(sig => sig.every((b, i) => buf[i] === b))) return r.status(400).json({ pesan: 'Isi file tidak sesuai tipe gambar.' });
  const dir = path.join(__dirname, 'public', 'uploads'); fs.mkdirSync(dir, { recursive: true });
  const nama = crypto.randomBytes(8).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(dir, nama), buf); r.json({ url: '/uploads/' + nama });
}));

// ---- admin (FU-3..FU-6) ----
app.get('/api/admin/capster', peran('admin'), wrap((q, r) => r.json(db.prepare('SELECT * FROM capster').all()))); // termasuk yang nonaktif
const T = { layanan: ['nama', 'harga', 'keterangan', 'kategori', 'durasi'], promo: ['judul', 'deskripsi'], produk: ['nama', 'deskripsi'], galeri: ['judul', 'kategori', 'foto'],
  model_rambut: ['nama', 'gambar', 'bentuk'], capster: ['nama', 'keahlian', 'pengalaman', 'foto', 'aktif'] };
const nilai = (k, v) => k === 'kategori' ? (['Rambut', 'Perawatan'].includes(bersih(v, 30)) ? bersih(v, 30) : 'Rambut') : k === 'durasi' ? (v === '' || v == null ? null : Math.min(600, Math.max(0, parseInt(v, 10) || 0)) || null) : k === 'harga' ? (v === '' || v == null ? null : Math.max(0, parseInt(v, 10) || 0)) : k === 'aktif' ? (+v ? 1 : 0) : bersih(v, k === 'gambar' ? 4000 : 1000);
app.get('/api/ringkasan', peran('admin'), wrap((q, r) => r.json({
  hariIni: db.prepare("SELECT COUNT(*) n FROM booking WHERE tanggal=? AND status!='batal'").get(hariIni()).n,
  menunggu: db.prepare("SELECT COUNT(*) n FROM booking WHERE status='menunggu'").get().n,
  selesai: db.prepare("SELECT COUNT(*) n FROM booking WHERE status='selesai'").get().n,
  total: db.prepare('SELECT COUNT(*) n FROM booking').get().n,
  omzetHariIni: +db.prepare("SELECT COALESCE(SUM(total),0) n FROM transaksi WHERE status='berhasil' AND DATE(COALESCE(paid_at,created_at))=?").get(hariIni()).n })));
app.put('/api/admin/pengaturan', peran('admin'), wrap((q, r) => {
  for (const k of ['wa', 'maps', 'ig', 'tiktok', 'alamat']) if (k in q.body) {
    const v = bersih(q.body[k], 300); if (k !== 'wa' && k !== 'alamat' && !/^https:\/\//.test(v)) return r.status(400).json({ pesan: k + ' harus berupa tautan https.' });
    db.prepare('INSERT INTO pengaturan(kunci,nilai) VALUES(?,?) ON DUPLICATE KEY UPDATE nilai=VALUES(nilai)').run(k, v); }
  r.json({ pesan: 'Tersimpan.' });
}));
app.post('/api/admin/staf', peran('admin'), wrap((q, r) => {
  const b = q.body, nama = bersih(b.nama, 80), email = bersih(b.email, 120).toLowerCase();
  if (!nama || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || String(b.password || '').length < 8 || String(b.password).length > 72 || !['capster', 'kasir', 'admin'].includes(b.peran))
    return r.status(400).json({ pesan: 'Data akun tidak valid (password 8-72 karakter).' });
  const id = db.prepare('INSERT INTO users(nama,email,hash,peran) VALUES(?,?,?,?)').run(nama, email, bcrypt.hashSync(b.password, 10), b.peran).lastInsertRowid;
  if (b.peran === 'capster') db.prepare('INSERT INTO capster(id_user,nama) VALUES(?,?)').run(id, nama);
  r.json({ pesan: 'Akun dibuat.' });
}));
const cek = (q, r) => { const t = q.params.t; if (!T[t]) { r.status(404).json({ pesan: 'Tabel tidak ada.' }); return null; }
  for (const k of T[t]) if (['foto', 'gambar'].includes(k) && !urlOk(String(q.body[k] || ''))) { r.status(400).json({ pesan: 'URL gambar tidak valid.' }); return null; }
  if (!bersih(q.body[T[t][0]])) { r.status(400).json({ pesan: 'Kolom pertama wajib diisi.' }); return null; } return T[t]; };
app.post('/api/admin/:t', peran('admin'), wrap((q, r) => { const c = cek(q, r); if (!c) return;
  db.prepare(`INSERT INTO ${q.params.t}(${c.join(',')}) VALUES(${c.map(() => '?').join(',')})`).run(...c.map(k => nilai(k, q.body[k]))); r.json({ pesan: 'Ditambahkan.' }); }));
app.put('/api/admin/:t/:id', peran('admin'), wrap((q, r) => { const c = cek(q, r); if (!c) return;
  db.prepare(`UPDATE ${q.params.t} SET ${c.map(k => k + '=?').join(',')} WHERE id=?`).run(...c.map(k => nilai(k, q.body[k])), q.params.id); r.json({ pesan: 'Diperbarui.' }); }));
app.delete('/api/admin/:t/:id', peran('admin'), wrap((q, r) => { if (!T[q.params.t]) return r.status(404).json({ pesan: 'Tabel tidak ada.' });
  db.prepare(`DELETE FROM ${q.params.t} WHERE id=?`).run(q.params.id); r.json({ pesan: 'Dihapus.' }); }));

// ---- halaman + SEO (URL ramah, meta unik per halaman, sitemap, noindex) ----
const META = {
  '/': ['Karua Barbershop Makassar – Booking Online & Coba Model Rambut', 'Barbershop premium di Makassar. Booking capster tanpa antre, lihat harga dan promo, coba model rambut virtual sebelum datang.'],
  '/layanan': ['Harga, Promo & Produk – Karua Barbershop Makassar', 'Cukur mulai Rp50.000, promo potongan Rp10.000 pukul 12.00–16.00, dan produk perawatan rambut di Karua Barbershop Makassar.'],
  '/galeri': ['Galeri Hasil Potongan – Karua Barbershop Makassar', 'Lihat hasil potongan rambut pria Karua Barbershop berdasarkan kategori gaya.'],
  '/capster': ['Profil Capster – Karua Barbershop Makassar', 'Kenali capster Karua Barbershop dan booking langsung capster pilihanmu.'],
  '/coba-model': ['Coba Model Rambut Virtual – Karua Areum', 'Unggah foto atau pakai kamera untuk mencoba model rambut sebelum potong di Karua Barbershop Makassar.'],
  '/virtual-tryon': ['Virtual Try-On AI – Coba Gaya Rambut Online | Karua Areum', 'Unggah foto wajah dan lihat pratinjau 12 gaya rambut pria dengan AI. Temukan gaya yang cocok, lalu booking capster Karua Barbershop Makassar.'],
  '/booking': ['Booking Online – Karua Barbershop Makassar', 'Pilih layanan, capster, tanggal, dan jam kosong. Dapatkan kode booking tanpa antre.'],
  '/masuk': ['Masuk – Karua Areum', 'Masuk atau daftar akun Karua Areum.'], '/dashboard': ['Dashboard – Karua Areum', 'Dashboard Karua Areum.'] };
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
// JS/CSS/HTML selalu divalidasi ulang (ETag -> 304 bila tidak berubah) supaya perubahan kode langsung terbaca browser.
// Hanya gambar yang di-cache lama.
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '7d', setHeaders: (res, file) => {
  if (/\.(js|css|html)$/i.test(file)) res.setHeader('Cache-Control', 'no-cache');
} }));
app.get('/robots.txt', (q, r) => r.type('text/plain').send(`User-agent: *\nDisallow: /masuk\nDisallow: /dashboard\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`));
app.get('/sitemap.xml', (q, r) => r.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
  Object.keys(META).filter(p => !['/masuk', '/dashboard'].includes(p)).map(p => `<url><loc>${SITE}${p}</loc></url>`).join('')}</urlset>`));
const NOINDEX = ['/masuk', '/dashboard'];
const escHtml = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Data terstruktur LocalBusiness untuk halaman depan (diambil dari pengaturan + harga layanan di database).
function dataUsaha() {
  try {
    const st = Object.fromEntries(db.prepare('SELECT * FROM pengaturan').all().map(k => [k.kunci, k.nilai]));
    const harga = db.prepare('SELECT harga FROM layanan WHERE harga>0').all().map(x => +x.harga);
    const d = { '@context': 'https://schema.org', '@type': 'BarberShop', name: 'Karua Barbershop', url: SITE,
      description: META['/'][1], address: { '@type': 'PostalAddress', streetAddress: st.alamat || 'Jl. Sultan Alauddin 2 No. 5', addressLocality: 'Makassar', addressRegion: 'Sulawesi Selatan', addressCountry: 'ID' },
      openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '10:00', closes: '22:00' }] };
    if (st.wa) d.telephone = '+' + String(st.wa).replace(/\D/g, '');
    if (harga.length) d.priceRange = 'Rp' + Math.min(...harga).toLocaleString('id-ID') + ' - Rp' + Math.max(...harga).toLocaleString('id-ID');
    const sama = [st.ig, st.tiktok].filter(v => /^https:\/\//.test(v || '')); if (sama.length) d.sameAs = sama;
    if (/^https:\/\//.test(st.maps || '')) d.hasMap = st.maps;
    return d;
  } catch (e) { console.error('Data terstruktur gagal dibuat:', e.message); return null; }
}
// Mengisi {{TITLE}}/{{DESC}}/{{URL}} dan menambah tag SEO yang belum ada di index.html (canonical, Open Graph, noindex, JSON-LD).
function halaman(path) {
  const ada = !!META[path], [t, d] = ada ? META[path] : ['Halaman tidak ditemukan | Karua Areum', 'Halaman tidak ditemukan.'], url = SITE + (ada ? path : '');
  let out = html.replace(/{{TITLE}}/g, () => escHtml(t)).replace(/{{DESC}}/g, () => escHtml(d)).replace(/{{URL}}/g, () => escHtml(url));
  const tambah = [];
  if (!/rel=["']canonical["']/.test(out) && ada) tambah.push(`<link rel="canonical" href="${escHtml(url)}">`);
  if (!/property=["']og:title["']/.test(out)) tambah.push(`<meta property="og:type" content="website"><meta property="og:site_name" content="Karua Barbershop"><meta property="og:locale" content="id_ID"><meta property="og:title" content="${escHtml(t)}"><meta property="og:description" content="${escHtml(d)}"><meta property="og:url" content="${escHtml(url)}">`);
  if (!ada || NOINDEX.includes(path)) { if (!/name=["']robots["']/.test(out)) tambah.push('<meta name="robots" content="noindex">'); }
  if (path === '/' && !/application\/ld\+json/.test(out)) { const j = dataUsaha(); if (j) tambah.push(`<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`); }
  return tambah.length && out.includes('</head>') ? out.replace('</head>', () => tambah.join('\n') + '\n</head>') : out;
}
app.get(Object.keys(META), (q, r) => { if (NOINDEX.includes(q.path)) r.set('X-Robots-Tag', 'noindex'); r.type('html').send(halaman(q.path)); });
app.use('/api', (q, r) => r.status(404).json({ pesan: 'Endpoint tidak ditemukan.' }));
app.use((q, r) => r.status(404).set('X-Robots-Tag', 'noindex').type('html').send(halaman(null)));
// Penangan error terakhir: JSON rusak atau terlalu besar tidak lagi menampilkan tumpukan error mentah.
app.use((err, q, r, n) => {
  if (r.headersSent) return n(err);
  const besar = err && err.type === 'entity.too.large';
  if (!besar && !(err && err.status && err.status < 500)) console.error(err);
  r.status(besar ? 413 : (err && err.status && err.status < 500 ? err.status : 500)).json({ pesan: besar ? 'Ukuran data terlalu besar.' : (err && err.status && err.status < 500 ? 'Permintaan tidak valid.' : 'Terjadi kesalahan server.') });
});
app.listen(process.env.PORT || 3000, () => console.log('Karua Areum berjalan di ' + SITE));