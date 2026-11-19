// Uji verifikasi token Firebase dengan pasangan kunci buatan sendiri (tanpa internet): node test-firebase.js
const assert = require('assert'), crypto = require('crypto');
const fb = require('./firebase-auth');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: kunciLain } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const PID = 'karua-barbershop', now = Math.floor(Date.now() / 1000);
const buat = (over = {}, key = privateKey, header = {}) => {
  const p = { iss: 'https://securetoken.google.com/' + PID, aud: PID, auth_time: now - 10, user_id: 'u1', sub: 'u1', iat: now - 10, exp: now + 3600,
    email: 'budi@gmail.com', email_verified: true, name: 'Budi', firebase: { identities: {}, sign_in_provider: 'google.com' }, ...over };
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header }), body = b64(p);
  return `${h}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(h + '.' + body), key).toString('base64url')}`;
};
const opsi = { certs: { k1: pem }, projectId: PID };
const gagal = async (token, pola, nama) => { try { await fb.verifikasi(token, opsi); } catch (e) { assert(pola.test(e.message), nama + ' -> ' + e.message); return; } assert.fail(nama + ' seharusnya ditolak'); };
(async () => {
  const p = await fb.verifikasi(buat(), opsi); assert.equal(p.email, 'budi@gmail.com');
  await gagal(buat({}, kunciLain), /./, 'tanda tangan palsu');
  await gagal(buat({ aud: 'proyek-lain' }), /audience/i, 'audience salah');
  await gagal(buat({ iss: 'https://securetoken.google.com/proyek-lain' }), /issuer/i, 'issuer salah');
  await gagal(buat({ exp: now - 4000, iat: now - 8000, auth_time: now - 8000 }), /expire|exp/i, 'kedaluwarsa');
  await gagal(buat({ email_verified: false }), /terverifikasi/, 'email belum terverifikasi');
  await gagal(buat({ email: undefined }), /terverifikasi/, 'tanpa email');
  await gagal(buat({ firebase: { sign_in_provider: 'password' } }), /bukan login Google/, 'provider password');
  await gagal(buat({}, privateKey, { kid: 'tidak-ada' }), /./, 'kid tidak dikenal');
  await gagal('abc', /format/, 'token sampah');
  await gagal('', /format/, 'token kosong');
  assert.equal(fb.aktif(), false); process.env.FIREBASE_API_KEY = 'a'; process.env.FIREBASE_AUTH_DOMAIN = 'b'; process.env.FIREBASE_PROJECT_ID = 'c';
  assert.deepEqual(fb.configPublik(), { apiKey: 'a', authDomain: 'b', projectId: 'c' });
  console.log('Semua uji Firebase lulus.');
})().catch(e => { console.error(e); process.exit(1); });
