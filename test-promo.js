// Uji aturan promo jam 12-16: node test-promo.js
const assert = require('assert');
const { hitung, config } = require('./promo');
const E = {}; // env kosong = nilai bawaan
const cukur = { harga: 50000, kategori: 'Rambut' };

assert.deepEqual(hitung(cukur, '12:00', E), { harga: 50000, potongan: 10000, bayar: 40000 }, 'tepat jam mulai kena promo');
assert.deepEqual(hitung(cukur, '15:00', E), { harga: 50000, potongan: 10000, bayar: 40000 }, 'jam 15 kena promo');
assert.equal(hitung(cukur, '16:00', E).potongan, 0, 'jam 16.00 sudah lewat promo');
assert.equal(hitung(cukur, '11:00', E).potongan, 0, 'sebelum jam promo');
assert.equal(hitung(cukur, '20:00', E).bayar, 50000, 'malam harga normal');
assert.equal(hitung({ harga: 75000 }, '13:00', E).bayar, 65000, 'tanpa kategori dianggap Rambut');
assert.equal(hitung({ harga: 80000, kategori: 'Perawatan' }, '13:00', E).potongan, 0, 'perawatan tidak kena promo');
assert.deepEqual(hitung({ harga: null, kategori: 'Rambut' }, '13:00', E), { harga: 0, potongan: 0, bayar: 0 }, 'harga menyesuaikan');
assert.equal(hitung(cukur, '', E).potongan, 0, 'jam kosong');
assert.equal(hitung(cukur, '12:00:00', E).potongan, 0, 'format jam salah');
assert.equal(hitung({ harga: 15000, kategori: 'Rambut' }, '13:00', E).potongan, 7500, 'potongan maksimal separuh harga');
assert.equal(hitung(cukur, '13:00', { PROMO_POTONGAN: '0' }).potongan, 0, 'dimatikan lewat env');
assert.equal(hitung(cukur, '13:00', { PROMO_POTONGAN: '' }).potongan, 10000, 'env kosong memakai bawaan');
assert.equal(hitung(cukur, '13:00', { PROMO_POTONGAN: '5000' }).bayar, 45000, 'nominal bisa diubah');
assert.equal(hitung(cukur, '09:30', { PROMO_JAM_MULAI: '09:00', PROMO_JAM_SELESAI: '10:00' }).potongan, 10000, 'rentang jam bisa diubah');
assert.deepEqual(config(E), { mulai: '12:00', selesai: '16:00', potongan: 10000 });
console.log('Semua uji promo lulus.');
