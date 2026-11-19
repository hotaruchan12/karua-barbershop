// Verifikasi ID token Firebase Authentication di server, tanpa firebase-admin.
// Token Firebase adalah JWT RS256 yang ditandatangani kunci publik Google (securetoken).
// Syarat sah: tanda tangan cocok, aud = project ID, iss = https://securetoken.google.com/<project ID>,
// belum kedaluwarsa, email terverifikasi, dan penyedia login = google.com.
const { OAuth2Client } = require('google-auth-library');

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cache = { certs: null, exp: 0 };

const aktif = () => !!(process.env.FIREBASE_API_KEY && process.env.FIREBASE_AUTH_DOMAIN && process.env.FIREBASE_PROJECT_ID);

// Konfigurasi web Firebase. Nilai ini memang publik (bukan rahasia) dan dikirim ke browser.
const configPublik = () => aktif() ? {
  apiKey: process.env.FIREBASE_API_KEY, authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID, ...(process.env.FIREBASE_APP_ID ? { appId: process.env.FIREBASE_APP_ID } : {})
} : null;

async function ambilCerts() {
  if (cache.certs && Date.now() < cache.exp) return cache.certs;
  const res = await fetch(CERT_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('gagal mengambil kunci publik Firebase (' + res.status + ')');
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  cache = { certs: await res.json(), exp: Date.now() + (m ? Number(m[1]) : 3600) * 1000 };
  return cache.certs;
}

// opsi.certs dan opsi.projectId hanya dipakai untuk pengujian.
async function verifikasi(idToken, opsi = {}) {
  const pid = opsi.projectId || process.env.FIREBASE_PROJECT_ID;
  if (!pid) throw new Error('FIREBASE_PROJECT_ID belum diisi');
  const token = String(idToken || '');
  if (token.length < 100 || token.length > 6000) throw new Error('format token tidak valid');
  const certs = opsi.certs || await ambilCerts();
  const tiket = await new OAuth2Client().verifySignedJwtWithCertsAsync(token, certs, pid, ['https://securetoken.google.com/' + pid]);
  const p = tiket.getPayload();
  if (!p.sub || String(p.sub).length > 128) throw new Error('subject token tidak valid');
  if (!p.email || p.email_verified !== true) throw new Error('email Google belum terverifikasi');
  if (!p.firebase || p.firebase.sign_in_provider !== 'google.com') throw new Error('bukan login Google');
  if (p.auth_time && p.auth_time * 1000 > Date.now() + 5 * 60 * 1000) throw new Error('auth_time di masa depan');
  return p;
}

module.exports = { aktif, configPublik, verifikasi };
