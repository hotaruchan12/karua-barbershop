// Aturan promo "potongan Rp10.000 pukul 12.00 sampai 16.00" (PRD bagian 1.1).
// Berlaku untuk layanan berharga tetap dengan kategori Rambut; creambath dan warna rambut tidak kena potongan.
// Semua nilai bisa diubah lewat .env; PROMO_POTONGAN=0 mematikan promo ini.
function config(env = process.env) {
  const mentah = env.PROMO_POTONGAN;
  const potongan = mentah === undefined || mentah === '' ? 10000 : Math.max(0, parseInt(mentah, 10) || 0);
  return { mulai: env.PROMO_JAM_MULAI || '12:00', selesai: env.PROMO_JAM_SELESAI || '16:00', potongan };
}

// layanan: { harga, kategori }, jam: 'HH:MM' (jam mulai). Potongan tidak pernah melebihi separuh harga.
function hitung(layanan, jam, env = process.env) {
  const c = config(env), harga = layanan && layanan.harga ? Math.round(Number(layanan.harga)) : 0;
  if (!harga) return { harga: 0, potongan: 0, bayar: 0 };
  const dalamJam = /^\d{2}:\d{2}$/.test(jam || '') && jam >= c.mulai && jam < c.selesai;
  const berlaku = c.potongan > 0 && (layanan.kategori || 'Rambut') === 'Rambut' && dalamJam;
  const potongan = berlaku ? Math.min(c.potongan, Math.floor(harga / 2)) : 0;
  return { harga, potongan, bayar: harga - potongan };
}

module.exports = { config, hitung };
