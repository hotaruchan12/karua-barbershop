// Modul pembayaran (FU-5): Midtrans Snap (sandbox), verifikasi signature, kembalian tunai, rekap CSV.
// Fungsi murni dipisah dari server.js agar mudah diuji (lihat test-pembayaran.js).
const crypto = require('crypto');

const SERVER_KEY = () => process.env.MIDTRANS_SERVER_KEY || '';
const PRODUKSI = () => process.env.MIDTRANS_IS_PRODUCTION === 'true';
const SNAP_URL = () => PRODUKSI() ? 'https://app.midtrans.com/snap/v1/transactions' : 'https://app.sandbox.midtrans.com/snap/v1/transactions';
const API_URL = () => PRODUKSI() ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
const auth = () => 'Basic ' + Buffer.from(SERVER_KEY() + ':').toString('base64');

const aktif = () => !!SERVER_KEY();

class BayarError extends Error { constructor(status, pesan) { super(pesan); this.status = status; this.pesan = pesan; } }

// Persentase yang dibayar online (default 100%). Keputusan uang muka masih menunggu mitra,
// jadi nilainya dibuat bisa diubah lewat .env tanpa mengubah kode.
function totalOnline(harga) {
  const persen = Math.min(100, Math.max(1, Number(process.env.BAYAR_ONLINE_PERSEN || 100)));
  return Math.round(Number(harga) * persen / 100);
}

// signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)
function signatureValid(n, serverKey = SERVER_KEY()) {
  if (!n || !serverKey) return false;
  const ekspektasi = crypto.createHash('sha512').update(String(n.order_id) + String(n.status_code) + String(n.gross_amount) + serverKey).digest('hex');
  const a = Buffer.from(ekspektasi), b = Buffer.from(String(n.signature_key || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Pemetaan status Midtrans -> status internal.
function petaStatus(n) {
  const s = n.transaction_status;
  if (s === 'settlement') return 'berhasil';
  if (s === 'capture') return n.fraud_status === 'challenge' ? 'menunggu' : 'berhasil';
  if (s === 'pending') return 'menunggu';
  if (s === 'expire') return 'kedaluwarsa';
  if (['deny', 'cancel', 'failure'].includes(s)) return 'gagal';
  return 'menunggu';
}

const metodeDari = n => String(n.payment_type || 'online').slice(0, 30);

function hitungKembalian(total, diterima) {
  const t = Math.round(Number(total)), d = Math.round(Number(diterima));
  if (!Number.isFinite(t) || !Number.isFinite(d) || d < t) throw new BayarError(400, 'Uang diterima kurang dari total.');
  return d - t;
}

async function panggil(url, opsi) {
  let res;
  try { res = await fetch(url, { ...opsi, signal: AbortSignal.timeout(20000) }); }
  catch { throw new BayarError(502, 'Tidak dapat menghubungi Midtrans. Coba lagi sebentar.'); }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// Membuat transaksi Snap, mengembalikan { token, redirect_url }.
async function snapBuat({ orderId, total, nama, email, namaItem, kembaliUrl }) {
  if (!aktif()) throw new BayarError(503, 'Pembayaran online belum diaktifkan. Bayar di tempat kepada kasir.');
  const body = {
    transaction_details: { order_id: orderId, gross_amount: total },
    item_details: [{ id: 'layanan', price: total, quantity: 1, name: String(namaItem).slice(0, 50) }],
    customer_details: { first_name: String(nama).slice(0, 50), ...(email ? { email } : {}) },
    callbacks: { finish: kembaliUrl }
  };
  const { res, data } = await panggil(SNAP_URL(), { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth() }, body: JSON.stringify(body) });
  if (!res.ok || !data.token) {
    console.error('Midtrans Snap gagal:', res.status, JSON.stringify(data).slice(0, 300));
    throw new BayarError(502, 'Midtrans menolak permintaan pembayaran. Periksa server key sandbox.');
  }
  return { token: data.token, redirect_url: data.redirect_url };
}

// Ambil status terbaru langsung dari Midtrans (dipakai tombol "Cek status" dan untuk lokal tanpa webhook).
async function statusMidtrans(orderId) {
  if (!aktif()) throw new BayarError(503, 'Pembayaran online belum diaktifkan.');
  const { res, data } = await panggil(`${API_URL()}/${encodeURIComponent(orderId)}/status`, { headers: { Accept: 'application/json', Authorization: auth() } });
  if (res.status === 404 || data.status_code === '404') return null; // pelanggan belum memilih metode di halaman Midtrans
  if (!res.ok) throw new BayarError(502, 'Gagal membaca status dari Midtrans.');
  return data;
}

// ---- rekap ----
const sel = v => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }; // cegah formula injection di Excel
const kolomCsv = v => { const s = sel(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// CSV berpemisah titik koma + BOM agar langsung terbuka rapi di Excel (locale Indonesia).
function csvRekap(baris) {
  const kepala = ['Kode order', 'Kode booking', 'Tanggal', 'Pelanggan', 'Layanan', 'Metode', 'Total', 'Uang diterima', 'Kembalian', 'Status'];
  const isi = baris.map(x => [x.kode_order, x.kode_booking || '', x.paid_at || x.created_at, x.nama_pelanggan, x.layanan, x.metode, x.total, x.uang_diterima ?? '', x.kembalian ?? '', x.status].map(kolomCsv).join(';'));
  return '﻿' + [kepala.join(';'), ...isi].join('\r\n') + '\r\n';
}

module.exports = { metodeDari, aktif, totalOnline, signatureValid, petaStatus, hitungKembalian, snapBuat, statusMidtrans, csvRekap, BayarError };
