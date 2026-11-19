const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = n => 'Rp' + Number(n).toLocaleString('id-ID');
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
let D = {}, U = null, csrf = '';
const maxTgl = () => new Date(Date.now() + 60 * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10); // batas booking 60 hari (sama dengan server)
// Tujuan setelah login (?next=/booking). Hanya path internal yang diterima.
const lanjut = () => { const x = new URLSearchParams(location.search).get('next') || ''; return /^\/[a-z0-9\-/]*(\?[\w=&%.\-]*)?$/i.test(x) && !x.startsWith('//') ? x : '/dashboard'; };
// Aturan promo jam 12.00-16.00; harus sama dengan promo.js di server. Server tetap yang menentukan nominal akhir.
const promoHitung = (l, jam) => { const a = D.promoAturan || {}, h = l && l.harga ? +l.harga : 0;
  const ok = h && a.potongan > 0 && (l.kategori || 'Rambut') === 'Rambut' && /^\d{2}:\d{2}$/.test(jam || '') && jam >= a.mulai && jam < a.selesai;
  const p = ok ? Math.min(a.potongan, Math.floor(h / 2)) : 0; return { harga: h, potongan: p, bayar: h - p }; };

async function api(u, m = 'GET', b) {
  const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.pesan || 'Terjadi kesalahan');
  return d;
}
const toast = t => { const e = $('#toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => e.style.display = 'none', 3200); };
const opt = (a, sel) => a.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`).join('');
const ph = (src, ikon, alt = '') => `<div class="ph">${src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">` : ikon}</div>`;
const hargaTxt = l => l.harga ? rp(l.harga) : esc(l.keterangan);

// ---------- komponen bersama ----------
const promoCards = () => D.promo.map(p => `<div class="card"><h3>🏷️ ${esc(p.judul)}</h3><p class="mut">${esc(p.deskripsi)}</p></div>`).join('');
const layananCards = () => D.layanan.map(l => `<div class="card"><h3>${esc(l.nama)}</h3><p class="price">${hargaTxt(l)}</p>${l.harga && l.keterangan ? `<p class="mut">${esc(l.keterangan)}</p>` : ''}</div>`).join('');
const capsterCards = () => D.capster.map(c => `<div class="card">${ph(c.foto, '💈', 'Capster ' + c.nama + ' – Karua Barbershop Makassar')}<h3>${esc(c.nama)}</h3><p><b>Keahlian:</b> ${esc(c.keahlian)}</p><p class="mut">${esc(c.pengalaman)}</p><br><a class="btn s" href="/booking?capster=${c.id}" data-l>Booking capster ini</a></div>`).join('');
const galeriCards = list => list.map(g => `<div class="card" style="padding:12px;cursor:pointer" data-act="lb" data-src="${esc(g.foto)}" data-alt="${esc(g.judul)}">${ph(g.foto, '✂️', g.judul + (g.kategori ? ' – gaya ' + g.kategori : '') + ' di Karua Barbershop Makassar')}<b>${esc(g.judul)}</b> <span class="st">${esc(g.kategori)}</span></div>`).join('');
const bRow = (b, aksi = '') => `<tr><td>${esc(b.kode)}</td><td>${esc(b.tanggal)} ${esc(b.jam)}</td><td>${esc(b.nama_pelanggan)}</td><td>${esc(b.layanan)}<br><small class="mut">${esc(b.capster)}</small>${b.catatan ? `<br><small>📝 ${esc(b.catatan)}</small>` : ''}${b.id_tryon && U && U.peran !== 'pelanggan' ? `<br><button class="btn s o" data-act="lihattryon" data-id="${b.id_tryon}">lihat model pilihan</button>` : ''}</td><td><span class="st ${esc(b.status)}">${esc(b.status)}</span></td><td>${aksi}</td></tr>`;
const bTable = (rows, aksi) => `<div class="tw"><table><tr><th>Kode</th><th>Jadwal</th><th>Pelanggan</th><th>Layanan / Capster</th><th>Status</th><th></th></tr>${rows.length ? rows.map(b => bRow(b, aksi ? aksi(b) : '')).join('') : '<tr><td colspan="6" class="mut">Belum ada booking.</td></tr>'}</table></div>`;

// ---------- halaman ----------
const P = {}, A = {};
const keunggulanHtml = () => [['💈', 'Pelayanan capster', 'Dua capster kami melayani dari konsultasi gaya sampai styling akhir. Hasil kerjanya bisa kamu lihat langsung di galeri.'],
  ['🛋️', 'Tempat yang nyaman', 'Nyaman untuk yang sedang dicukur maupun yang menunggu giliran.'],
  ['💆', 'Paket lengkap dengan pijat', 'Cukur, cuci, styling, lalu pijat. Paket favorit pelanggan; ada yang sampai hampir tertidur.'],
  ['⏱️', 'Booking tanpa antre', 'Lihat capster dan jam yang kosong, pilih sendiri, lalu datang sesuai jadwal.']]
  .map(([i, j, t]) => `<div class="card"><h3>${i} ${j}</h3><p class="mut">${t}</p></div>`).join('');
const caraBooking = () => [['Pilih layanan', 'Cukur, cukur dan cuci, paket dengan pijat, creambath, atau warna rambut.'],
  ['Pilih capster, tanggal, dan jam', 'Hanya jam yang masih kosong yang bisa dipilih, jadi jadwal tidak bentrok.'],
  ['Coba model rambut (opsional)', 'Lihat gaya yang cocok lewat Virtual Try-On, lalu tulis di catatan booking.'],
  ['Bayar dan simpan kode booking', D.bayarOnline ? 'Bayar online atau bayar di tempat. Tunjukkan kode booking ke kasir saat datang.' : 'Bayar di tempat. Tunjukkan kode booking ke kasir saat datang.']]
  .map(([j, t], i) => `<div class="card"><h3>${i + 1}. ${j}</h3><p class="mut">${t}</p></div>`).join('');
const lokasiHtml = () => { const s = D.pengaturan || {}, q = encodeURIComponent('Karua Barbershop ' + (s.alamat || 'Jl. Sultan Alauddin 2 No. 5, Makassar')),
    ext = (href, t, kelas = '') => href ? `<a ${kelas ? `class="${kelas}" ` : ''}href="${esc(href)}" target="_blank" rel="noopener">${t}</a>` : '';
  return `<div class="grid"><div class="card"><h3>📍 Karua Barbershop</h3><p>${esc(s.alamat)}</p><p><b>Jam buka:</b> setiap hari, 10.00–22.00</p>
<p class="row">${ext(s.maps, 'Buka di Google Maps', 'btn')}${ext(s.wa && 'https://wa.me/' + s.wa, 'Chat WhatsApp', 'btn o')}</p>
<p class="mut">Ikuti kami di ${ext(s.ig, 'Instagram')} dan ${ext(s.tiktok, 'TikTok')}</p></div>
<div class="card" style="padding:0;overflow:hidden"><iframe title="Peta lokasi Karua Barbershop Makassar" src="https://www.google.com/maps?q=${q}&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" style="border:0;width:100%;min-height:300px;display:block"></iframe></div></div>`; };
P['/'] = () => `<section class="hero"><span class="badge">Barbershop Premium · Makassar</span>
<h1>Tampil rapi, <br>tanpa antre.</h1><p>Pilih capster, pilih jam, dan coba model rambut virtual sebelum datang. Buka setiap hari pukul 10.00–22.00.</p>
<div class="row"><a class="btn" href="/booking" data-l>Booking Sekarang</a><a class="btn o" href="/coba-model" data-l>Coba Model Rambut</a><a class="btn o" href="/virtual-tryon" data-l>AI Try-On</a></div></section>
<section class="wrap"><h2>Kenapa Karua Barbershop</h2><div class="grid">${keunggulanHtml()}</div></section>
<section class="wrap" style="padding-top:0"><h2>Layanan &amp; harga</h2><div class="grid">${layananCards()}</div><p><a href="/layanan" data-l>Lihat harga, promo &amp; produk →</a></p></section>
<section class="wrap" style="padding-top:0"><h2>Promo</h2><div class="grid">${promoCards()}</div></section>
<section class="wrap" style="padding-top:0"><h2>Hasil potongan</h2><div class="grid">${galeriCards(D.galeri.slice(0, 3))}</div><p><a href="/galeri" data-l>Lihat semua →</a></p></section>
<section class="wrap" style="padding-top:0"><h2>Capster kami</h2><div class="grid">${capsterCards()}</div></section>
<section class="wrap" style="padding-top:0"><h2>Cara booking</h2><div class="grid">${caraBooking()}</div><p><a class="btn" href="/booking" data-l>Mulai booking</a></p></section>
<section class="wrap" style="padding-top:0"><h2>Lokasi &amp; jam operasional</h2>${lokasiHtml()}</section>`;

P['/layanan'] = () => `<section class="wrap"><h1>Harga &amp; Promo</h1><p class="mut">Barbershop Makassar dengan layanan cukur, perawatan, dan pijat.</p>
<div class="grid">${layananCards()}</div><h2 style="margin-top:36px">Promo</h2><div class="grid">${promoCards()}</div>
<h2 style="margin-top:36px">Produk</h2><p class="mut">Informasi produk yang dijual di tempat (bukan toko online).</p>
<div class="grid">${D.produk.map(p => `<div class="card"><h3>${esc(p.nama)}</h3><p class="mut">${esc(p.deskripsi)}</p></div>`).join('')}</div></section>`;

let kat = 'Semua';
P['/galeri'] = () => { const ks = ['Semua', ...new Set(D.galeri.map(g => g.kategori).filter(Boolean))];
  return `<section class="wrap"><h1>Galeri Hasil Potongan</h1><div class="chips">${ks.map(k => `<button class="chip ${k === kat ? 'on' : ''}" data-act="kat" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>
  <div class="grid">${galeriCards(D.galeri.filter(g => kat === 'Semua' || g.kategori === kat))}</div></section>`; };
P['/capster'] = () => `<section class="wrap"><h1>Profil Capster</h1><div class="grid">${capsterCards()}</div></section>`;

// --- Try-on ---
P['/coba-model'] = () => `<section class="wrap"><h1>Coba Model Rambut</h1>
<p class="note">⚠️ Ini hanya simulasi, bukan jaminan hasil akhir. Fotomu diproses di browser dan hanya tersimpan jika kamu menekan “Simpan”. Untuk hasil AI yang lebih realistis, coba <a href="/virtual-tryon" data-l>Virtual Try-On AI</a>.</p>
<div class="tryon"><div><canvas id="cv" width="480" height="480"></canvas><video id="vid" autoplay playsinline hidden></video></div>
<div class="form"><label>Unggah foto (JPG/PNG, maks. 5 MB)<input type="file" id="foto" accept="image/jpeg,image/png"></label>
<button class="btn o" data-act="kamera">📷 Pakai kamera</button><button class="btn o" data-act="jepret" id="jepret" hidden>Ambil foto</button>
<label>Bentuk wajah (untuk rekomendasi)<select id="bw"><option value="">Pilih bentuk wajah…</option><option value="oval">Oval</option><option value="bulat">Bulat</option><option value="persegi">Persegi</option><option value="lonjong">Lonjong</option></select></label>
<p id="rek" class="note" hidden></p>
<div><b>Model</b><div class="hairs">${D.model.map((m, i) => `<button data-act="model" data-i="${i}" title="${esc(m.nama)}"><img src="${esc(m.gambar)}" alt="${esc(m.nama)}"></button>`).join('')}</div></div>
<label>Posisi horizontal<input type="range" id="tx" min="-200" max="200" value="0"></label><label>Posisi vertikal<input type="range" id="ty" min="-200" max="200" value="-60"></label>
<label>Ukuran<input type="range" id="ts" min="20" max="200" value="90"></label>
<div class="row"><button class="btn" data-act="simpan">Simpan ke dashboard</button> <button class="btn o" data-act="unduh">Unduh</button></div>
<p class="mut">Setelah cocok, <a href="/booking" data-l>lanjut booking</a> dan sebutkan model pilihanmu.</p></div></div></section>`;
let TO = { img: null, hair: null, stream: null };
A['/coba-model'] = () => {
  const cv = $('#cv'), c = cv.getContext('2d');
  const draw = () => { c.fillStyle = '#faf7f0'; c.fillRect(0, 0, 480, 480);
    if (TO.img) { const s = Math.max(480 / TO.img.width, 480 / TO.img.height), w = TO.img.width * s, h = TO.img.height * s; c.drawImage(TO.img, (480 - w) / 2, (480 - h) / 2, w, h); }
    else { c.fillStyle = '#78716c'; c.font = '16px Inter'; c.textAlign = 'center'; c.fillText('Unggah foto atau pakai kamera', 240, 240); }
    if (TO.hair) { const w = 2.4 * $('#ts').value, h = w * .6; c.drawImage(TO.hair, 240 - w / 2 + +$('#tx').value, 240 - h / 2 + +$('#ty').value, w, h); } };
  A.redraw = draw; draw();
  ['tx', 'ty', 'ts'].forEach(i => $('#' + i).oninput = draw);
  $('#bw').onchange = e => { const v = e.target.value, bs = [...document.querySelectorAll('.hairs button')], rek = $('#rek');
    bs.forEach(b => b.classList.remove('rec')); if (!v) { rek.hidden = true; return; }
    const cocok = D.model.map((m, i) => [m, i]).filter(([m]) => (m.bentuk || '').split(',').map(x => x.trim()).includes(v));
    cocok.forEach(([, i]) => bs[i].classList.add('rec')); rek.hidden = false;
    rek.textContent = cocok.length ? `Rekomendasi untuk wajah ${v}: ${cocok.map(([m]) => m.nama).join(', ')}. Ini hanya saran umum; capster dapat menyesuaikan dengan bentuk kepala dan rambutmu.` : 'Belum ada rekomendasi untuk bentuk wajah ini. Coba model lain atau tanyakan ke capster.'; };
  $('#foto').onchange = e => { const f = e.target.files[0]; if (!f) return;
    if (!['image/jpeg', 'image/png'].includes(f.type) || f.size > 5e6) return toast('Gunakan JPG/PNG maksimal 5 MB.');
    const im = new Image(); im.onload = () => { TO.img = im; draw(); }; im.src = URL.createObjectURL(f); };
};

// --- Virtual Try-On AI (Hugging Face Gradio) ---
let VTO = { dataUrl: '', style: '', result: null, busy: false, error: '', history: [] };

const vtoName = slug => ((D.vto || []).find(s => s.slug === slug) || {}).nama || slug;

const vtoStylesHtml = () => (D.vto || []).map(s => `<button type="button" class="vto-style${VTO.style === s.slug ? ' on' : ''}" data-act="vto-style" data-slug="${esc(s.slug)}" title="${esc(s.deskripsi)}">
  <span class="vto-style-img"><img src="${esc(s.gambar)}" alt="${esc(s.nama)}" loading="lazy"><span class="vto-check">✓</span></span>
  <b>${esc(s.nama)}</b><span>${esc(s.deskripsi)}</span></button>`).join('');

const vtoPreviewHtml = () => `<div class="vto-drop${VTO.dataUrl ? ' has-img' : ''}" id="vtoDrop">
  ${VTO.dataUrl ? `<img src="${VTO.dataUrl}" alt="Pratinjau foto kamu">` : `<div class="vto-drop-inner"><span class="vto-drop-ico">📷</span><b>Unggah foto wajah</b><span>atau tarik &amp; lepas file ke sini</span></div>`}
  <input type="file" id="vtoFile" accept="image/jpeg,image/png">
  ${VTO.dataUrl ? '<span class="vto-drop-edit">Ganti foto</span>' : ''}</div>`;

const vtoResultHtml = () => {
  if (VTO.busy) return `<div class="vto-loading"><div class="vto-spin"></div><div class="vto-load-bar"><i></i></div><b>AI sedang memproses…</b><p>Biasanya 10–60 detik. Jangan tutup halaman ini.</p></div>`;
  if (VTO.error) return `<div class="vto-error"><span>⚠️</span><b>Belum berhasil</b><p>${esc(VTO.error)}</p><button class="btn o" data-act="vto-generate">Coba lagi</button></div>`;
  if (!VTO.result) return `<div class="vto-result-empty"><span>✨</span><b>Hasil AI muncul di sini</b><p>Unggah foto, pilih gaya, lalu tekan “Coba gaya ini”.</p></div>`;
  const r = VTO.result;
  return `<div class="vto-result-head"><div><span class="vto-kicker">Hasil AI</span><h3>${esc(r.gaya_nama)}</h3></div><span class="vto-provider">${r.provider === 'fallback' ? 'Model AI alternatif' : 'HairFastGAN'}</span></div>
  ${r.catatan ? `<p class="vto-note">${esc(r.catatan)}</p>` : ''}
  <div class="vto-compare">
    <img class="vto-before" src="${VTO.dataUrl}" alt="Sebelum">
    <img class="vto-after" id="vtoAfter" src="${r.url}" alt="Sesudah">
    <div class="vto-divider" id="vtoDivider"></div>
    <span class="vto-tag before">Sebelum</span><span class="vto-tag after">Sesudah</span>
    <input type="range" id="vtoRange" min="0" max="100" value="50" aria-label="Geser untuk membandingkan sebelum dan sesudah">
  </div>
  <p class="vto-hint">Geser slider untuk membandingkan. Hasil AI bersifat ilustrasi; capster akan menyesuaikan dengan struktur rambutmu.</p>
  <div class="vto-actions">
    <a class="btn" href="/booking?gaya=${encodeURIComponent(r.gaya)}" data-l>Booking gaya ini</a>
    <a class="btn o" href="${r.url}?download=1" download>Unduh</a>
    <button class="btn o" data-act="vto-generate">Coba lagi</button>
  </div>`;
};

const vtoHistoryHtml = () => {
  if (!U) return `<p class="vto-empty">Masuk atau daftar untuk menyimpan dan melihat riwayat hasil AI kamu.</p>`;
  if (!VTO.history.length) return `<p class="vto-empty">Belum ada hasil. Hasil yang kamu buat akan muncul di sini.</p>`;
  return `<div class="vto-history">${VTO.history.map(h => `<button type="button" class="vto-hist" data-act="vto-open" data-id="${h.id}" ${h.status !== 'selesai' ? 'disabled' : ''}>
    ${h.gambar ? `<img src="${esc(h.gambar)}" alt="Hasil ${esc(vtoName(h.gaya))}" loading="lazy">` : `<span class="vto-hist-ph">${h.status === 'gagal' ? '✕' : '…'}</span>`}
    <b>${esc(vtoName(h.gaya))}</b><small>${esc(String(h.created_at || '').slice(0, 16).replace('T', ' '))} · ${esc(h.status)}</small></button>`).join('')}</div>`;
};

function vtoSyncButton() {
  const b = $('#vtoGo'); if (!b) return;
  b.disabled = VTO.busy || !U || !VTO.dataUrl || !VTO.style;
  b.textContent = VTO.busy ? 'Memproses…' : '✨ Coba gaya ini';
}

function vtoWireCompare() {
  const range = $('#vtoRange'); if (!range) return;
  const after = $('#vtoAfter'), divider = $('#vtoDivider');
  const sync = () => { const v = +range.value; if (after) after.style.clipPath = `inset(0 0 0 ${v}%)`; if (divider) divider.style.left = v + '%'; };
  range.oninput = sync; sync();
}

function vtoRenderResult() {
  const box = $('#vtoResult'); if (box) box.innerHTML = vtoResultHtml();
  vtoWireCompare(); vtoSyncButton();
}

function vtoRenderPreview() {
  const drop = $('#vtoDrop'); if (!drop) return;
  drop.outerHTML = vtoPreviewHtml(); vtoWireDrop();
}

async function vtoLoadHistory() {
  if (!U) return;
  try { VTO.history = await api('/api/vto/riwayat'); } catch { VTO.history = []; }
  const box = $('#vtoHistory'); if (box) box.innerHTML = vtoHistoryHtml();
}

function vtoCompress(file) {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png'].includes(file.type)) return reject(new Error('Gunakan foto JPG atau PNG.'));
    if (file.size > 15e6) return reject(new Error('Ukuran file maksimal 15 MB.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      if (Math.min(w, h) < 256) { URL.revokeObjectURL(url); return reject(new Error('Foto terlalu kecil. Gunakan minimal 256 × 256 piksel.')); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let dataUrl = c.toDataURL('image/jpeg', 0.86);
      if (dataUrl.length > 2.6e6) dataUrl = c.toDataURL('image/jpeg', 0.72);
      if (dataUrl.length > 2.6e6) dataUrl = c.toDataURL('image/jpeg', 0.6);
      resolve(dataUrl);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('File tidak dapat dibaca sebagai gambar.')); };
    img.src = url;
  });
}

async function vtoPick(file) {
  try {
    VTO.dataUrl = await vtoCompress(file);
    VTO.result = null; VTO.error = '';
    vtoRenderPreview(); vtoRenderResult();
    toast('Foto siap. Sekarang pilih gaya rambut.');
  } catch (e) { toast(e.message); }
}

function vtoWireDrop() {
  const drop = $('#vtoDrop'), file = $('#vtoFile'); if (!drop || !file) return;
  file.onchange = e => { const f = e.target.files && e.target.files[0]; if (f) vtoPick(f); file.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) vtoPick(f); });
}

async function vtoGenerate() {
  if (!U) { toast('Masuk atau daftar dulu untuk memakai AI Try-On.'); return go('/masuk?next=/virtual-tryon'); }
  if (!VTO.dataUrl) return toast('Unggah foto wajah dulu.');
  if (!VTO.style) return toast('Pilih gaya rambut dulu.');
  if (VTO.busy) return;
  VTO.busy = true; VTO.error = ''; VTO.result = null;
  vtoRenderResult();
  try {
    VTO.result = await api('/api/vto/generate', 'POST', { gaya: VTO.style, gambar: VTO.dataUrl });
    toast('Hasil AI siap.');
    vtoLoadHistory();
  } catch (e) {
    VTO.error = e.message;
  } finally {
    VTO.busy = false;
    vtoRenderResult();
  }
}

P['/virtual-tryon'] = () => `<section class="vto-hero">
  <span class="vto-badge">AI Virtual Try-On</span>
  <h1>Coba gaya rambut <em>sebelum</em> duduk di kursi.</h1>
  <p>Unggah satu foto wajah, pilih dari 12 gaya rambut, lalu lihat pratinjau AI dalam hitungan detik. Foto aslimu tidak disimpan permanen di server kami; foto dikirim ke layanan AI Hugging Face hanya untuk membuat hasil ini.</p>
</section>
<section class="vto-wrap">
  <div class="vto-grid">
    <div class="vto-col">
      <div class="vto-panel">
        <div class="vto-step"><span>1</span><div><h2>Foto wajah</h2><p>Menghadap kamera, pencahayaan cukup, tanpa penutup kepala.</p></div></div>
        ${vtoPreviewHtml()}
        <p class="vto-hint">JPG/PNG · otomatis dikompres ke 1024 px · foto asli tidak disimpan di server kami</p>
      </div>
      <div class="vto-panel">
        <div class="vto-step"><span>2</span><div><h2>Pilih gaya</h2><p>Ketuk salah satu dari 12 gaya rambut pria.</p></div></div>
        <div class="vto-styles" id="vtoStyles">${vtoStylesHtml()}</div>
      </div>
    </div>
    <div class="vto-col">
      <div class="vto-panel vto-sticky">
        <div class="vto-step"><span>3</span><div><h2>Hasil AI</h2><p>Bandingkan sebelum &amp; sesudah.</p></div></div>
        <div id="vtoResult">${vtoResultHtml()}</div>
        <button class="btn vto-generate" id="vtoGo" data-act="vto-generate">✨ Coba gaya ini</button>
        ${U ? '' : '<p class="vto-hint">Masuk atau daftar gratis untuk memakai AI Try-On dan menyimpan riwayat.</p>'}
      </div>
    </div>
  </div>
  <div class="vto-panel vto-history-panel">
    <div class="vto-step"><span>↺</span><div><h2>Riwayat hasil</h2><p>Hanya kamu yang dapat melihat hasil ini.</p></div></div>
    <div id="vtoHistory">${vtoHistoryHtml()}</div>
  </div>
</section>`;

A['/virtual-tryon'] = () => { vtoWireDrop(); vtoRenderResult(); if (U) vtoLoadHistory(); };

// --- Booking (desain Figma: 3 langkah + ringkasan "Kunjunganmu") ---
let BK = { lid: '', kat: 'Semua', jam: '' };
const tglPanjang = t => new Date(t + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const jamTxt = j => String(j).replace(':', '.');
const svcCards = () => D.layanan.filter(l => BK.kat === 'Semua' || (l.kategori || 'Rambut') === BK.kat).map(l =>
  `<button type="button" class="svc${String(l.id) === String(BK.lid) ? ' on' : ''}" data-act="svc" data-id="${l.id}" aria-pressed="${String(l.id) === String(BK.lid)}"><span class="kick">${esc(l.kategori || 'Rambut')}</span><h3>${esc(l.nama)}</h3>${l.keterangan ? `<p class="mut">${esc(l.keterangan)}</p>` : ''}<p class="svc-p"><b>${l.harga ? rp(l.harga) : 'Harga menyesuaikan'}</b>${l.durasi ? `<small class="mut">± ${l.durasi} menit</small>` : ''}</p></button>`).join('') || '<p class="mut">Belum ada layanan.</p>';
function bkSummary() {
  const box = $('#sum'); if (!box) return;
  const l = D.layanan.find(x => String(x.id) === String(BK.lid)), cs = D.capster.find(x => String(x.id) === String($('#bc').value)), tgl = $('#bt').value, hp = promoHitung(l, BK.jam);
  box.innerHTML = `<h2>Kunjunganmu</h2><span class="st">Menunggu</span><p class="sum-l"><b>${l ? esc(l.nama) : 'Pilih layanan dulu'}</b></p>
<p class="mut sum-d">${tgl ? esc(tglPanjang(tgl)) : '–'}<br>${BK.jam ? jamTxt(BK.jam) : 'Pilih jam'}${l && l.durasi ? ' · ± ' + l.durasi + ' menit' : ''}<br>Capster: ${cs ? esc(cs.nama) : '–'}</p>
<div class="sum-t"><span>Total</span><b>${l ? (l.harga ? (hp.potongan ? `<s class="mut">${rp(hp.harga)}</s> ${rp(hp.bayar)}` : rp(l.harga)) : 'Menyesuaikan') : '–'}</b></div>
${hp.potongan ? `<p class="mut sum-n">Promo jam ${jamTxt(D.promoAturan.mulai)}–${jamTxt(D.promoAturan.selesai)}: potongan ${rp(hp.potongan)} sudah diterapkan.</p>` : ''}
<button class="btn" form="bkform" ${U ? '' : 'disabled'}>Lanjutkan booking</button>
<p class="mut sum-n">${D.bayarOnline ? 'Booking dikonfirmasi kasir, atau otomatis setelah pembayaran online berhasil.' : 'Booking dikonfirmasi oleh kasir.'}</p>`;
  const stage = !BK.lid ? 1 : !BK.jam ? 2 : 3;
  document.querySelectorAll('.bk-steps span').forEach((e, i) => e.classList.toggle('on', i + 1 === stage));
}
P['/booking'] = async () => { const q = new URLSearchParams(location.search);
  BK = { lid: D.layanan.some(l => String(l.id) === q.get('layanan')) ? q.get('layanan') : '', kat: 'Semua', jam: '' };
  let to = []; if (U && U.peran === 'pelanggan') try { to = await api('/api/tryon'); } catch {}
  const gayaRef = q.get('gaya') ? (D.vto || []).find(s => s.slug === q.get('gaya')) : null;
  const catatanRef = gayaRef ? 'Acuan gaya: ' + gayaRef.nama : '';
  const kats = ['Semua', ...new Set(D.layanan.map(l => l.kategori || 'Rambut'))];
  return `<section class="bk-hero"><div class="wrap"><p class="eyebrow">Booking / Karua Areum Makassar</p><h1>Waktunya tampil<br>lebih berkarakter.</h1>
<p class="mut">Pilih layanan, tentukan jadwal, dan biarkan kami merapikan harimu.</p>
<div class="bk-steps"><span class="on"><i>01</i> Layanan</span><span><i>02</i> Jadwal</span><span><i>03</i> Konfirmasi</span></div></div></section>
<section class="wrap bk-layout"><div class="bk-main">${U ? '' : '<p class="note"><b>Masuk dulu</b>Silakan <a href="/masuk?next=${encodeURIComponent(location.pathname + location.search)}" data-l>masuk atau daftar</a> agar booking tersimpan di dashboard.</p>'}
${gayaRef ? `<div class="note"><img src="${esc(gayaRef.gambar)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:10px;float:left;margin:0 12px 4px 0"><b>Gaya acuan: ${esc(gayaRef.nama)}</b>Catatan booking sudah diisi otomatis. Tunjukkan referensi ini ke capster saat datang.</div>` : ''}
<form id="bkform" data-form="booking"><input type="hidden" name="id_layanan" value="${esc(BK.lid)}"><input type="hidden" name="jam">
<h2 class="sec">01 / Pilih layanan</h2><div class="chips" id="bkcats">${kats.map(k => `<button type="button" class="chip ${k === 'Semua' ? 'on' : ''}" data-act="bkkat" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>
<div class="svc-list" id="svcs">${svcCards()}</div>
<h2 class="sec">02 / Tentukan jadwal</h2>
<div class="row2"><label>Tanggal kunjungan<input type="date" id="bt" name="tanggal" min="${today()}" max="${maxTgl()}" value="${today()}" required></label>
<label>Pilih capster<select name="id_capster" id="bc" required>${opt(D.capster.map(c => [c.id, c.nama]), q.get('capster'))}</select></label></div>
<div class="bk-jam"><small class="mut">Jam tersedia</small><div id="slots" class="slots"></div><small class="mut">Dicoret = terisi · Gold = pilihanmu · Buka 10.00–22.00</small></div>
<label>Nama lengkap<input name="nama_pelanggan" maxlength="80" placeholder="Masukkan nama lengkap" value="${esc(U && U.peran === 'pelanggan' ? U.nama : '')}" ${U ? (U.peran === 'pelanggan' ? 'readonly' : 'required') : 'disabled'}></label>
<label>Catatan untuk capster (opsional)<input name="catatan" maxlength="300" value="${esc(catatanRef)}" placeholder="mis. fade tipis di samping, atas dirapikan"></label>
${to.length ? `<div><small class="mut">Acuan model dari hasil try-on (opsional)</small><div class="thumbs" id="acuan">${to.map(x => `<img src="${x.gambar}" alt="Try-on" data-act="acuan" data-id="${x.id}" style="cursor:pointer">`).join('')}</div></div><input type="hidden" name="id_tryon">` : ''}
</form>
<p class="note"><b>Sebelum datang</b>Datang 10 menit lebih awal. Perlu mengubah jadwal? Hubungi kami melalui WhatsApp.</p><div id="hasil"></div></div>
<aside class="bk-sum card" id="sum"></aside></section>
<section class="wrap" style="padding-top:0"><h2>Cek status booking</h2><form class="form" data-form="cek"><label>Kode booking<input name="kode" placeholder="KA-XXXXXX" required></label><button class="btn o">Cek</button></form><div id="cekhasil"></div></section>`; };
A['/booking'] = () => { const load = async () => { const s = $('#slots'); s.innerHTML = '<span class="mut">Memuat…</span>'; BK.jam = ''; $('[name=jam]').value = ''; bkSummary();
  try { const d = await api(`/api/slot?capster=${$('#bc').value}&tanggal=${$('#bt').value}`);
    s.innerHTML = d.libur ? '<span class="mut">Capster libur pada tanggal ini. Coba tanggal atau capster lain.</span>' : d.jam.map(x => `<button type="button" class="slot" data-act="jam" data-j="${x.jam}" ${x.kosong ? '' : 'disabled'}>${jamTxt(x.jam)}</button>`).join('');
  } catch (e) { s.innerHTML = `<span class="mut">${esc(e.message)}</span>`; } };
  $('#bc').onchange = $('#bt').onchange = load; load(); };

// --- Login ---
let daftar = false;
P['/masuk'] = () => `<section class="wrap"><div class="card form" style="margin:auto"><h1 style="font-size:30px">${daftar ? 'Daftar Pelanggan' : 'Masuk'}</h1>
<form class="form" data-form="${daftar ? 'daftar' : 'masuk'}">${daftar ? '<label>Nama<input name="nama" required maxlength="80"></label><label>Nomor HP<input name="hp" required inputmode="tel" placeholder="08xxxxxxxxxx"></label>' : ''}
<label>Email<input name="email" type="email" required></label><label>Password${daftar ? ' (min. 8 karakter)' : ''}<input name="password" type="password" required minlength="${daftar ? 8 : 1}"></label>
<button class="btn">${daftar ? 'Daftar' : 'Masuk'}</button></form>${D.firebase ? '<p class="mut" style="text-align:center">atau</p><button type="button" class="btn o" data-act="fblogin">Lanjutkan dengan Google</button>' : '<div id="gbtn"></div>'}
<button class="btn o" data-act="swap">${daftar ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}</button></div></section>`;
// --- Login Google lewat Firebase Authentication ---
// SDK dimuat saat halaman Masuk dibuka (bukan saat tombol ditekan) supaya popup langsung terbuka
// dari klik pengguna dan tidak diblokir browser.
const FB = { auth: null, lib: null, loading: null };
function fbMuat() {
  if (!D.firebase) return Promise.resolve();
  FB.loading ??= (async () => {
    const V = 'https://www.gstatic.com/firebasejs/10.14.1/';
    const [{ initializeApp }, lib] = await Promise.all([import(V + 'firebase-app.js'), import(V + 'firebase-auth.js')]);
    FB.lib = lib; FB.auth = lib.getAuth(initializeApp(D.firebase));
  })().catch(e => { FB.loading = null; throw e; });
  return FB.loading;
}
const FB_ERR = { 'auth/popup-closed-by-user': 'Login dibatalkan.', 'auth/cancelled-popup-request': 'Login dibatalkan.', 'auth/popup-blocked': 'Popup diblokir browser. Izinkan popup untuk situs ini.',
  'auth/unauthorized-domain': 'Domain ini belum diizinkan di Firebase (Authentication > Settings > Authorized domains).', 'auth/operation-not-allowed': 'Login Google belum diaktifkan di Firebase (Authentication > Sign-in method).',
  'auth/network-request-failed': 'Jaringan bermasalah. Periksa koneksi internet.' };
A['/masuk'] = () => { if (D.firebase) { fbMuat().catch(() => toast('Gagal memuat Firebase. Periksa koneksi internet lalu muat ulang.')); return; } if (!D.googleClientId) return;
  const init = () => { google.accounts.id.initialize({ client_id: D.googleClientId, callback: async r => { try { U = await api('/api/google', 'POST', { credential: r.credential }); await refreshCsrf(); nav(); go(lanjut()); } catch (e) { toast(e.message); } } });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'continue_with' }); };
  if (window.google) return init(); const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = init; document.head.append(s); };

// --- Dashboard ---
const FLD = { layanan: [['nama', 'Nama'], ['harga', 'Harga (kosongkan jika menyesuaikan)'], ['keterangan', 'Keterangan'], ['kategori', 'Kategori (Rambut atau Perawatan)'], ['durasi', 'Perkiraan durasi (menit, opsional)']], promo: [['judul', 'Judul'], ['deskripsi', 'Deskripsi']],
  produk: [['nama', 'Nama'], ['deskripsi', 'Deskripsi']], galeri: [['judul', 'Judul'], ['kategori', 'Kategori'], ['foto', 'Foto (URL atau unggah)']],
  model_rambut: [['nama', 'Nama model'], ['gambar', 'Gambar PNG/SVG transparan (URL atau unggah)'], ['bentuk', 'Cocok untuk wajah (oval,bulat,persegi,lonjong)']], capster: [['nama', 'Nama'], ['keahlian', 'Keahlian'], ['pengalaman', 'Pengalaman'], ['foto', 'Foto (URL atau unggah)'], ['aktif', 'Aktif (1/0)']] };
const buktiBtn = x => x.status === 'berhasil' ? `<button class="btn s o" data-act="bukti" data-id="${x.id}">bukti</button>` : '';
const trxTable = (rows, bukti = false) => `<div class="tw"><table><tr><th>Waktu</th><th>Kode</th><th>Pelanggan / Layanan</th><th>Metode</th><th>Total</th><th>Status</th>${bukti ? '<th></th>' : ''}</tr>${rows.length ? rows.map(x => `<tr><td>${esc((x.paid_at || x.created_at || '').slice(5, 16))}</td><td>${esc(x.kode_booking || x.kode_order)}</td><td>${esc(x.nama_pelanggan)}<br><small class="mut">${esc(x.layanan)}</small></td><td>${esc(x.metode)}${x.kembalian != null && x.metode === 'tunai' ? `<br><small class="mut">kembali ${rp(x.kembalian)}</small>` : ''}</td><td>${rp(x.total)}</td><td><span class="st ${x.status === 'berhasil' ? 'dikonfirmasi' : x.status === 'menunggu' ? '' : 'batal'}">${esc(x.status)}</span></td>${bukti ? `<td>${buktiBtn(x)}</td>` : ''}</tr>`).join('') : `<tr><td colspan="${bukti ? 7 : 6}" class="mut">Belum ada transaksi.</td></tr>`}</table></div>`;
let rekapData = null;
const rekapBookingHtml = rb => { const st = ['menunggu', 'dikonfirmasi', 'selesai', 'batal'], cs = [...new Set(rb.rows.map(x => x.capster))];
  return `<h3 style="margin-top:18px">Rekap booking per capster · ${esc(rb.dari)} s/d ${esc(rb.sampai)}</h3><div class="tw"><table><tr><th>Capster</th>${st.map(x => `<th>${x}</th>`).join('')}<th>Total</th></tr>${cs.map(c => { const j = x => rb.rows.filter(r => r.capster === c && r.status === x).reduce((t, r) => t + r.jumlah, 0); return `<tr><td>${esc(c)}</td>${st.map(x => `<td>${j(x)}</td>`).join('')}<td>${st.reduce((t, x) => t + j(x), 0)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="mut">Tidak ada booking pada periode ini.</td></tr>'}</table></div>`; };
const rekapHtml = (rk, tr, bukti = false) => `<h3>Rekap ${esc(rk.periode)} · ${esc(rk.dari)} s/d ${esc(rk.sampai)}</h3><div class="tw"><table><tr><th>${rk.periode === 'bulanan' ? 'Bulan' : 'Tanggal'}</th><th>Transaksi</th><th>Pemasukan</th></tr>${rk.rows.map(x => `<tr><td>${esc(x.periode)}</td><td>${x.jumlah}</td><td>${rp(x.omzet)}</td></tr>`).join('') || '<tr><td colspan="3" class="mut">Tidak ada transaksi berhasil.</td></tr>'}<tr><th>Total</th><th>${tr.ringkasan.jumlah}</th><th>${rp(tr.ringkasan.total)}</th></tr></table></div><h3 style="margin-top:18px">Riwayat transaksi</h3>${trxTable(tr.rows, bukti)}`;
const buktiHtml = x => { const baris = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`, kode = x.kode_booking || x.kode_order;
  return `<!doctype html><meta charset="utf-8"><title>Bukti pembayaran ${esc(kode)}</title><style>body{font:14px Inter,Arial,sans-serif;color:#1c1917;max-width:380px;margin:24px auto;padding:0 16px}h1{font-size:18px;margin:0}small{color:#666}table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}td:last-child{text-align:right}hr{border:0;border-top:1px dashed #999;margin:12px 0}.t td{font-weight:700;font-size:16px}.l{display:inline-block;border:2px solid #15803d;color:#15803d;padding:2px 10px;border-radius:6px;font-weight:700;margin-top:8px}button{margin-top:16px;padding:8px 14px}@media print{button{display:none}}</style>
<h1>Karua Barbershop</h1><small>${esc(x.alamat)}</small><hr><div class="l">LUNAS</div><hr><table>${baris('No. transaksi', esc(x.kode_order))}${x.kode_booking ? baris('Kode booking', esc(x.kode_booking)) : ''}${baris('Tanggal', esc((x.paid_at || x.created_at || '').slice(0, 16)))}${baris('Pelanggan', esc(x.nama_pelanggan))}${baris('Layanan', esc(x.layanan))}${baris('Metode', esc(x.metode))}${x.metode === 'tunai' && x.uang_diterima != null ? baris('Uang diterima', rp(x.uang_diterima)) + baris('Kembalian', rp(x.kembalian || 0)) : ''}</table><hr><table class="t">${baris('Total', rp(x.total))}</table><hr><small>Terima kasih sudah mempercayakan rambutmu kepada kami. Simpan bukti ini sebagai tanda pembayaran.</small><br><button id="cetak">Cetak / simpan PDF</button>`; };
function cetakRekap() { if (!rekapData) return toast('Tampilkan rekap dulu.'); const w = window.open('', '_blank'); if (!w) return toast('Izinkan pop-up untuk mencetak.');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Rekap transaksi Karua Areum</title><style>body{font:13px Inter,Arial,sans-serif;color:#1c1917;padding:24px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{text-align:left;padding:6px;border-bottom:1px solid #ddd}h1{font-size:20px}</style><h1>Karua Barbershop – Rekap Transaksi</h1>${rekapHtml(rekapData.rk, rekapData.tr)}${rekapData.rb ? rekapBookingHtml(rekapData.rb) : ''}`);
  w.document.close(); w.focus(); w.print(); }
const kasirPanel = async () => { const tgl = kasirPanel.t || today(), [bk, lb, tr] = await Promise.all([api('/api/booking?tanggal=' + tgl), api('/api/libur'), api(`/api/transaksi?dari=${tgl}&sampai=${tgl}`)]);
  const msg = kasirPanel.msg; kasirPanel.msg = '';
  const aksi = b => (+b.dibayar ? '<span class="st dikonfirmasi">lunas</span> ' : b.status !== 'batal' ? `<button class="btn s" data-act="isibayar" data-kode="${esc(b.kode)}">catat bayar</button> ` : '') + (b.status === 'batal' || b.status === 'selesai' ? '' : ['dikonfirmasi', 'selesai', 'batal'].map(s => `<button class="btn s o" data-act="status" data-id="${b.id}" data-v="${s}">${s}</button>`).join(' ') + ` <button class="btn s o" data-act="ubah" data-id="${b.id}">ubah jadwal</button>`);
  return `<h2>Kalender booking</h2><label style="max-width:220px">Tanggal<input type="date" id="kt" value="${tgl}"></label><br>${bTable(bk, aksi)}
<h2 style="margin-top:30px">Pembayaran di tempat</h2>${msg ? `<p class="note"><b>Tercatat</b>${esc(msg)}</p>` : ''}
<form class="form" data-form="bayar"><label>Kode booking (kosongkan jika pelanggan datang langsung)<input name="kode_booking" placeholder="KA-XXXXXX"></label>
<label>Nama pelanggan (tanpa booking)<input name="nama_pelanggan" maxlength="80"></label><label>Layanan (tanpa booking)<select name="id_layanan">${opt(D.layanan.map(l => [l.id, l.nama + (l.harga ? ' – ' + rp(l.harga) : '')]))}</select></label>
<label>Total (hanya untuk layanan berharga menyesuaikan)<input name="total" type="number" min="0" inputmode="numeric"></label>
<label>Metode<select name="metode">${opt([['tunai', 'Tunai'], ['qris', 'QRIS']])}</select></label><label>Uang diterima (tunai)<input name="uang_diterima" type="number" min="0" inputmode="numeric"></label>
${D.promoAturan && D.promoAturan.potongan > 0 ? `<label><span><input type="checkbox" name="tanpa_promo" style="width:auto;margin-right:8px">Jangan terapkan potongan promo jam ${jamTxt(D.promoAturan.mulai)}–${jamTxt(D.promoAturan.selesai)}</span></label><p class="mut">Potongan ${rp(D.promoAturan.potongan)} diterapkan otomatis sesuai jam booking (atau jam sekarang bila tanpa booking) untuk layanan rambut berharga tetap.</p>` : ''}
<button class="btn">Catat pembayaran</button></form>
<h2 style="margin-top:30px">Transaksi ${esc(tgl)}</h2><p class="mut">${tr.ringkasan.jumlah} transaksi berhasil · total <b>${rp(tr.ringkasan.total)}</b> (tunai ${rp(tr.ringkasan.tunai)}, QRIS ${rp(tr.ringkasan.qris)}, online ${rp(tr.ringkasan.online)})</p>${trxTable(tr.rows, true)}
<h2 style="margin-top:30px">Tambah booking (pelanggan datang langsung)</h2><form class="form" data-form="manual"><label>Nama pelanggan<input name="nama_pelanggan" required></label>
<label>Layanan<select name="id_layanan">${opt(D.layanan.map(l => [l.id, l.nama]))}</select></label><label>Capster<select name="id_capster">${opt(D.capster.map(c => [c.id, c.nama]))}</select></label>
<label>Tanggal<input type="date" name="tanggal" min="${today()}" value="${tgl}" required></label><label>Jam<select name="jam">${opt(D.jam.map(j => [j, j]))}</select></label><button class="btn">Tambah</button></form>
<h2 style="margin-top:30px">Hari libur capster</h2><form class="form" data-form="libur"><label>Capster<select name="id_capster">${opt(D.capster.map(c => [c.id, c.nama]))}</select></label><label>Tanggal<input type="date" name="tanggal" min="${today()}" required></label><button class="btn o">Tandai libur</button></form>
<p>${lb.map(l => `<span class="st">${esc(l.nama)} · ${esc(l.tanggal)} <a href="#" data-act="hapuslibur" data-c="${l.id_capster}" data-t="${esc(l.tanggal)}">✕</a></span> `).join('')}</p>`; };
const adminPanel = async () => { const [r, semuaCapster] = await Promise.all([api('/api/ringkasan'), api('/api/admin/capster')]), t = Object.keys(FLD);
  const form = k => `<form class="form" data-form="crud" data-t="${k}"><input type="hidden" name="_id">${FLD[k].map(([n, l]) => `<label>${l}<input name="${n}">${['foto', 'gambar'].includes(n) ? '<input type="file" accept="image/png,image/jpeg,image/webp" data-up>' : ''}</label>`).join('')}<button class="btn s">Simpan</button></form>`;
  const items = k => (k === 'model_rambut' ? D.model : k === 'capster' ? semuaCapster : D[k]).map(x => `<p>${esc(x.nama || x.judul)} <button class="btn s o" data-act="edit" data-t="${k}" data-row="${esc(JSON.stringify(x))}">ubah</button> <button class="btn s o" data-act="hapus" data-t="${k}" data-id="${x.id}">hapus</button></p>`).join('');
  const P_ = D.pengaturan;
  return `<div class="grid"><div class="card"><b>${r.hariIni}</b><br>Booking hari ini</div><div class="card"><b>${r.menunggu}</b><br>Menunggu konfirmasi</div><div class="card"><b>${r.selesai}</b><br>Selesai</div><div class="card"><b>${r.total}</b><br>Total booking</div><div class="card"><b>${rp(r.omzetHariIni)}</b><br>Pemasukan hari ini</div></div>
<h2 style="margin-top:30px">Kelola konten</h2>${t.map(k => `<details><summary>${k.replace('_', ' ')}</summary>${items(k)}${form(k)}</details>`).join('')}
<details><summary>Kontak &amp; media sosial</summary><form class="form" data-form="pengaturan">${[['wa', 'WhatsApp (628xxx)'], ['maps', 'Link Google Maps'], ['ig', 'Instagram'], ['tiktok', 'TikTok'], ['alamat', 'Alamat']].map(([n, l]) => `<label>${l}<input name="${n}" value="${esc(P_[n])}"></label>`).join('')}<button class="btn s">Simpan</button></form></details>
<details><summary>Rekap transaksi</summary><form class="form" data-form="rekap"><label>Dari<input type="date" name="dari" value="${today().slice(0, 8)}01" required></label><label>Sampai<input type="date" name="sampai" value="${today()}" required></label>
<label>Rekap per<select name="periode">${opt([['harian', 'Hari'], ['bulanan', 'Bulan']])}</select></label><button class="btn s">Tampilkan</button></form><div id="rekap"></div></details>
<details><summary>Buat akun staf</summary><form class="form" data-form="staf"><label>Nama<input name="nama" required></label><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="8" required></label><label>Peran<select name="peran">${opt([['capster', 'capster'], ['kasir', 'kasir'], ['admin', 'admin']])}</select></label><button class="btn s">Buat</button></form></details>`; };
const passwordCard = () => `<details style="margin-top:30px"><summary>Ganti password</summary><form class="form" data-form="password"><label>Password lama (kosongkan bila akunmu dibuat lewat Google)<input name="lama" type="password" autocomplete="current-password"></label><label>Password baru (8–72 karakter)<input name="baru" type="password" minlength="8" maxlength="72" required autocomplete="new-password"></label><button class="btn s">Simpan password</button></form></details>`;
P['/dashboard'] = async () => { if (!U) { history.replaceState(0, '', '/masuk'); return P['/masuk'](); }
  let h = `<section class="wrap"><h1 style="font-size:34px">Halo, ${esc(U.nama)}</h1><p class="mut">Peran: ${esc(U.peran)} · <a href="#" data-act="keluar">Keluar</a></p>`;
  try {
    if (U.peran === 'pelanggan') { let [bk, to, tx, vt] = await Promise.all([api('/api/booking'), api('/api/tryon'), api('/api/transaksi/saya'), api('/api/vto/riwayat').catch(() => [])]);
      if (D.bayarOnline) { let ubah = false; for (const x of tx.filter(t => t.status === 'menunggu' && t.snap_url).slice(0, 3)) { try { await api(`/api/pembayaran/${x.id}/sinkron`, 'POST'); ubah = true; } catch {} }
        if (ubah) [bk, tx] = await Promise.all([api('/api/booking'), api('/api/transaksi/saya')]); } // sinkron status setelah kembali dari halaman Midtrans
      const sel = bk.filter(b => b.status === 'selesai').length, aktif = b => ['menunggu', 'dikonfirmasi'].includes(b.status) && b.tanggal >= today();
      const aksiPel = b => (+b.dibayar ? '<span class="st dikonfirmasi">lunas</span> ' : '') + (['menunggu', 'dikonfirmasi'].includes(b.status) ? (D.bayarOnline && b.harga && !+b.dibayar ? `<button class="btn s" data-act="bayar" data-kode="${esc(b.kode)}">bayar online ${rp(Math.round(b.harga_bayar * D.bayarPersen / 100))}</button> ` : '') + (+b.dibayar ? '' : `<button class="btn s o" data-act="batalku" data-id="${b.id}">batalkan</button>`) : '');
      const aiOk = vt.filter(x => x.gambar).slice(0, 8);
      h += `<div class="card" style="max-width:420px"><b>Kartu stempel</b><p class="price">${'★'.repeat(sel % 10)}${'☆'.repeat(10 - sel % 10)}</p><p class="mut">${sel % 10} dari 10 stempel${sel >= 10 ? ` · kamu sudah mengumpulkan ${Math.floor(sel / 10)}x gratis cukur (tunjukkan ke kasir)` : ' · 10 stempel = gratis cukur 1x'}</p></div>
<h2 style="margin-top:24px">Booking mendatang</h2>${bTable(bk.filter(aktif), aksiPel)}<p><a class="btn" href="/booking" data-l>Booking baru</a></p>
<h2 style="margin-top:30px">Riwayat booking</h2>${bTable(bk.filter(b => !aktif(b)).reverse(), aksiPel)}
<h2 style="margin-top:30px">Riwayat pembayaran</h2><div class="tw"><table><tr><th>Kode</th><th>Layanan</th><th>Total</th><th>Metode</th><th>Status</th><th></th></tr>${tx.map(x => `<tr><td>${esc(x.kode_booking || x.kode_order)}</td><td>${esc(x.layanan)}</td><td>${rp(x.total)}</td><td>${esc(x.metode)}</td><td><span class="st ${x.status === 'berhasil' ? 'dikonfirmasi' : x.status === 'menunggu' ? '' : 'batal'}">${esc(x.status)}</span></td><td>${buktiBtn(x)}${x.status === 'menunggu' && x.snap_url ? `<a class="btn s" href="${esc(x.snap_url)}">lanjut bayar</a> <button class="btn s o" data-act="sinkron" data-id="${x.id}">cek status</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="mut">Belum ada pembayaran.</td></tr>'}</table></div>
<h2 style="margin-top:30px">Hasil try-on tersimpan</h2><div class="thumbs">${aiOk.map(x => `<img src="${esc(x.gambar)}" alt="Hasil AI gaya ${esc(vtoName(x.gaya))}" loading="lazy">`).join('')}${to.map(x => `<img src="${esc(x.gambar)}" alt="Hasil try-on" loading="lazy">`).join('')}${!aiOk.length && !to.length ? '<span class="mut">Belum ada.</span>' : ''}</div><p><a href="/virtual-tryon" data-l>Buka Virtual Try-On AI →</a></p>`; }
    else if (U.peran === 'capster') h += `<h2>Jadwal saya</h2>${bTable(await api('/api/booking?dari=' + today()))}`;
    else h += (U.peran === 'admin' ? await adminPanel() : '') + await kasirPanel();
  } catch (e) { h += `<p class="note">${esc(e.message)}</p>`; }
  return h + passwordCard() + '</section>'; };
A['/dashboard'] = () => { const k = $('#kt'); if (k) k.onchange = () => { kasirPanel.t = k.value; route(); }; };

// ---------- router & aksi ----------
async function route() {
  let p = P[location.pathname] ? location.pathname : '/', ok = true;
  try { app.innerHTML = await P[p](); }
  catch (e) { ok = false; console.error(e); app.innerHTML = `<section class="wrap"><p class="note"><b>Halaman gagal dimuat</b>${esc(e.message)}. <a href="${esc(location.pathname + location.search)}">Muat ulang</a></p></section>`; }
  if (P[location.pathname]) p = location.pathname; if (ok) A[p]?.(); window.scrollTo(0, 0);
  if (D.halaman && D.halaman[p]) document.title = D.halaman[p][0]; // judul tab ikut berganti saat pindah halaman
  document.body.classList.toggle('vto-dark', p === '/virtual-tryon');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.pathname === p)); $('#nav').classList.remove('open');
}
const go = u => { history.pushState(0, '', u); return route(); };
window.onpopstate = route;
const nav = () => $('#auth').innerHTML = U ? '<a href="/dashboard" data-l>Dashboard</a>' : '<a class="btn s o" href="/masuk" data-l>Masuk</a>';
const refreshCsrf = async () => csrf = (await api('/api/csrf')).token;
const reload = async () => { D = await api('/api/publik'); await route(); };

const ACT = {
  menu: () => $('#nav').classList.toggle('open'),
  kat: e => { kat = e.dataset.k; route(); },
  lb: e => { const d = document.createElement('div'); d.className = 'lb'; d.innerHTML = `<div class="ph">${e.dataset.src ? `<img src="${esc(e.dataset.src)}" alt="${esc(e.dataset.alt || 'Foto hasil potongan Karua Barbershop')}">` : '✂️'}</div>`; d.onclick = () => d.remove(); document.body.append(d); },
  acuan: e => { const on = e.classList.contains('on'); document.querySelectorAll('#acuan img').forEach(i => i.classList.remove('on'));
    $('[name=id_tryon]').value = on ? '' : e.dataset.id; if (!on) e.classList.add('on'); },
  lihattryon: async e => { const x = await api('/api/tryon/' + e.dataset.id); const d = document.createElement('div'); d.className = 'lb';
    d.innerHTML = `<div class="ph"><img src="${esc(x.gambar)}" alt="Model pilihan pelanggan"></div>`; d.onclick = () => d.remove(); document.body.append(d); },
  jam: e => { document.querySelectorAll('.slot').forEach(s => s.classList.remove('on')); e.classList.add('on'); $('[name=jam]').value = BK.jam = e.dataset.j; bkSummary(); },
  svc: e => { BK.lid = e.dataset.id; $('[name=id_layanan]').value = BK.lid; $('#svcs').innerHTML = svcCards(); bkSummary(); },
  bkkat: e => { BK.kat = e.dataset.k; document.querySelectorAll('#bkcats .chip').forEach(c => c.classList.toggle('on', c.dataset.k === BK.kat)); $('#svcs').innerHTML = svcCards(); },
  bayar: async e => { const r = await api('/api/pembayaran/online', 'POST', { kode: e.dataset.kode }); if (!/^https:\/\//.test(r.url || '')) throw new Error('Tautan pembayaran tidak valid.'); toast('Mengalihkan ke halaman pembayaran…'); location.href = r.url; },
  sinkron: async e => { const r = await api(`/api/pembayaran/${e.dataset.id}/sinkron`, 'POST'); toast('Status pembayaran: ' + r.status); route(); },
  isibayar: e => { const f = document.querySelector('[data-form=bayar]'); f.kode_booking.value = e.dataset.kode; f.scrollIntoView({ block: 'center' }); f.metode.focus(); },
  cetak: () => cetakRekap(),
  bukti: async e => { const w = window.open('', '_blank'); if (!w) return toast('Izinkan pop-up untuk melihat bukti pembayaran.'); // dibuka dulu agar tidak diblokir browser
    try { const x = await api(`/api/transaksi/${e.dataset.id}/bukti`); w.document.write(buktiHtml(x)); w.document.close(); w.focus();
      const t = w.document.getElementById('cetak'); if (t) t.onclick = () => w.print(); } catch (x) { w.close(); toast(x.message); } },
  swap: () => { daftar = !daftar; route(); },
  fblogin: async () => {
    if (!FB.auth) { fbMuat().catch(() => {}); return toast('Firebase sedang dimuat. Coba tekan lagi sebentar lagi.'); }
    let cred; try { cred = await FB.lib.signInWithPopup(FB.auth, new FB.lib.GoogleAuthProvider()); } catch (e) { return toast(FB_ERR[e.code] || 'Login Google gagal.'); }
    const idToken = await cred.user.getIdToken();
    U = await api('/api/firebase', 'POST', { idToken }); FB.lib.signOut(FB.auth).catch(() => {}); // sesi dipegang server; sesi Firebase di browser tidak dipakai
    await refreshCsrf(); nav(); go(lanjut()); },
  keluar: async () => { await api('/api/keluar', 'POST'); U = null; await refreshCsrf(); nav(); go('/'); },
  model: e => { document.querySelectorAll('.hairs button').forEach(b => b.classList.remove('on')); e.classList.add('on'); const im = new Image(); im.onload = () => { TO.hair = im; A.redraw(); }; im.src = D.model[e.dataset.i].gambar; },
  kamera: async () => { try { TO.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } }); $('#vid').srcObject = TO.stream; $('#vid').hidden = false; $('#jepret').hidden = false; } catch { toast('Kamera tidak dapat diakses. Gunakan unggah foto.'); } },
  jepret: () => { const v = $('#vid'), t = document.createElement('canvas'); t.width = v.videoWidth; t.height = v.videoHeight; t.getContext('2d').drawImage(v, 0, 0);
    const im = new Image(); im.onload = () => { TO.img = im; A.redraw(); }; im.src = t.toDataURL('image/jpeg', .9); TO.stream.getTracks().forEach(x => x.stop()); v.hidden = true; $('#jepret').hidden = true; },
  unduh: () => { const a = document.createElement('a'); a.download = 'karua-tryon.jpg'; a.href = $('#cv').toDataURL('image/jpeg', .85); a.click(); },
  simpan: async () => { if (!U || U.peran !== 'pelanggan') return toast('Masuk sebagai pelanggan untuk menyimpan.'); try { toast((await api('/api/tryon', 'POST', { gambar: $('#cv').toDataURL('image/jpeg', .7) })).pesan); } catch (e) { toast(e.message); } },
  status: async e => { await api('/api/booking/' + e.dataset.id, 'PATCH', { status: e.dataset.v }); route(); },
  ubah: async e => { const t = prompt('Tanggal baru (YYYY-MM-DD):'); if (!t) return; const j = prompt('Jam baru (mis. 14:00):'); if (!j) return;
    try { await api('/api/booking/' + e.dataset.id, 'PATCH', { tanggal: t, jam: j }); route(); } catch (x) { toast(x.message); } },
  batalku: async e => { if (confirm('Batalkan booking ini?')) { try { await api(`/api/booking/${e.dataset.id}/batal`, 'PATCH'); route(); } catch (x) { toast(x.message); } } },
  hapuslibur: async e => { await api('/api/libur', 'DELETE', { id_capster: e.dataset.c, tanggal: e.dataset.t }); route(); },
  edit: e => { const f = e.closest('details').querySelector('form'), r = JSON.parse(e.dataset.row); f._id.value = r.id; for (const k in r) if (f[k]) f[k].value = r[k] ?? ''; f.scrollIntoView({ block: 'center' }); },
  hapus: async e => { if (!confirm('Hapus data ini?')) return; try { await api(`/api/admin/${e.dataset.t}/${e.dataset.id}`, 'DELETE'); toast('Dihapus.'); reload(); } catch (x) { toast(x.message); } },
  'vto-style': e => { VTO.style = e.dataset.slug; VTO.result = null; VTO.error = '';
    document.querySelectorAll('.vto-style').forEach(b => b.classList.toggle('on', b.dataset.slug === VTO.style)); vtoRenderResult(); },
  'vto-generate': () => vtoGenerate(),
  'vto-open': e => { const h = VTO.history.find(x => String(x.id) === String(e.dataset.id)); if (!h || h.status !== 'selesai') return;
    const d = document.createElement('div'); d.className = 'lb vto-lb';
    d.innerHTML = `<div class="vto-lb-inner"><img src="${esc(h.gambar)}" alt="Hasil ${esc(vtoName(h.gaya))}"><div class="vto-lb-bar"><b>${esc(vtoName(h.gaya))}</b><a class="btn s" href="${esc(h.gambar)}?download=1" download>Unduh</a><button class="btn s o" data-act="vto-del" data-id="${h.id}">Hapus</button></div></div>`;
    d.onclick = ev => { if (!ev.target.closest('.vto-lb-inner')) d.remove(); };
    document.body.append(d); },
  'vto-del': async e => { if (!confirm('Hapus hasil ini?')) return; try { await api('/api/vto/' + e.dataset.id, 'DELETE');
    e.closest('.lb')?.remove(); await vtoLoadHistory(); toast('Hasil dihapus.'); } catch (x) { toast(x.message); } }
};
const FORM = {
  masuk: async d => { U = await api('/api/masuk', 'POST', d); await refreshCsrf(); nav(); go(lanjut()); },
  daftar: async d => { toast((await api('/api/daftar', 'POST', d)).pesan); daftar = false; route(); },
  booking: async d => { if (!d.id_layanan) return toast('Pilih layanan terlebih dahulu.'); if (!d.jam) return toast('Pilih jam terlebih dahulu.'); const r = await api('/api/booking', 'POST', d);
    const l = D.layanan.find(x => String(x.id) === String(d.id_layanan));
    $('#hasil').innerHTML = `<div class="note"><b>Booking berhasil</b>Kode booking kamu: <b class="kode">${esc(r.kode)}</b>. Simpan kode ini. Status: menunggu konfirmasi.</div>` +
      (U.peran === 'pelanggan' && D.bayarOnline && l && l.harga ? `<p><button type="button" class="btn" data-act="bayar" data-kode="${esc(r.kode)}">Bayar online ${rp(Math.round(promoHitung(l, d.jam).bayar * D.bayarPersen / 100))}</button> <span class="mut">atau bayar di tempat kepada kasir.</span></p>` : '<p class="mut">Pembayaran dilakukan di tempat kepada kasir.</p>');
    $('#hasil').scrollIntoView({ block: 'center', behavior: 'smooth' }); A['/booking'](); },
  bayar: async d => { const r = await api('/api/transaksi', 'POST', d); kasirPanel.msg = `Pembayaran ${rp(r.total)} tercatat (${r.kode_order}).` + (r.kembalian != null ? ` Kembalian: ${rp(r.kembalian)}.` : '') + (r.potongan ? ` Potongan promo ${rp(r.potongan)} sudah diterapkan.` : ''); route(); },
  rekap: async (d, f) => { const qs = `dari=${d.dari}&sampai=${d.sampai}`; const [rk, tr, rb] = await Promise.all([api(`/api/rekap?${qs}&periode=${d.periode}`), api(`/api/transaksi?${qs}`), api(`/api/rekap/booking?${qs}`)]);
    rekapData = { rk, tr, rb }; $('#rekap').innerHTML = rekapHtml(rk, tr, true) + rekapBookingHtml(rb) + `<p class="no-print"><a class="btn s" href="/api/transaksi/ekspor?${qs}" download>Unduh Excel (CSV)</a> <button type="button" class="btn s o" data-act="cetak">Cetak / simpan PDF</button></p>`; },
  cek: async d => { try { const r = await api('/api/booking/kode/' + encodeURIComponent(d.kode)); $('#cekhasil').innerHTML = `<div class="note">${esc(r.layanan)} dengan ${esc(r.capster)} · ${esc(r.tanggal)} ${esc(r.jam)} · <span class="st ${esc(r.status)}">${esc(r.status)}</span></div>`; } catch (e) { $('#cekhasil').innerHTML = `<div class="note">${esc(e.message)}</div>`; } },
  manual: async d => { await api('/api/booking', 'POST', d); toast('Booking ditambahkan.'); route(); },
  libur: async d => { await api('/api/libur', 'POST', d); route(); },
  password: async (d, f) => { toast((await api('/api/akun/password', 'POST', d)).pesan); f.reset(); },
  pengaturan: async d => { toast((await api('/api/admin/pengaturan', 'PUT', d)).pesan); reload(); },
  staf: async d => toast((await api('/api/admin/staf', 'POST', d)).pesan),
  crud: async (d, f) => { const id = d._id; delete d._id; const t = f.dataset.t; await api(id ? `/api/admin/${t}/${id}` : '/api/admin/' + t, id ? 'PUT' : 'POST', d); toast('Tersimpan.'); reload(); }
};
// Foto yang gagal dimuat diganti ikon (handler inline diblokir CSP, jadi memakai listener global).
document.addEventListener('error', e => { const i = e.target; if (i && i.tagName === 'IMG' && i.closest('.ph')) { const t = document.createElement('span'); t.textContent = '💈'; i.replaceWith(t); } }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelector('.lb')?.remove(); });
document.addEventListener('click', e => {
  const l = e.target.closest('a[data-l]'); if (l) { e.preventDefault(); return go(l.getAttribute('href')); }
  const a = e.target.closest('[data-act]'); if (a) { e.preventDefault(); Promise.resolve(ACT[a.dataset.act]?.(a)).catch(x => toast(x.message)); }
});
document.addEventListener('change', e => { const f = e.target.files?.[0]; if (!f || e.target.dataset.up === undefined) return;
  const png = f.type === 'image/png', im = new Image(), box = e.target.closest('label');
  im.onload = async () => { const s = Math.min(1, (png ? 600 : 1000) / Math.max(im.width, im.height)), c = document.createElement('canvas');
    c.width = im.width * s; c.height = im.height * s; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    try { const r = await api('/api/admin/upload', 'POST', { gambar: c.toDataURL(png ? 'image/png' : 'image/jpeg', .82) }); box.querySelector('input:not([type=file])').value = r.url; toast('Gambar terunggah. Tekan Simpan.'); }
    catch (x) { toast(x.message); } };
  im.onerror = () => toast('File bukan gambar yang valid.'); im.src = URL.createObjectURL(f); });
document.addEventListener('submit', async e => { const n = e.target.dataset.form; if (!n) return; e.preventDefault();
  try { await FORM[n](Object.fromEntries(new FormData(e.target)), e.target); } catch (x) { toast(x.message); } });

(async () => {
  await refreshCsrf(); [D, U] = await Promise.all([api('/api/publik'), api('/api/saya')]);
  const s = D.pengaturan; $('#fwa').href = 'https://wa.me/' + s.wa; $('#fmap').href = s.maps;
  $('#foot').innerHTML = `<div class="ft"><div><a href="/" data-l class="logo">KARUA <span>AREUM</span></a><div class="ft-l"><a href="/booking" data-l>Booking</a><a href="https://wa.me/${esc(s.wa)}" target="_blank" rel="noopener">WhatsApp</a><a href="${esc(s.maps)}" target="_blank" rel="noopener">Lokasi</a><a href="${esc(s.ig)}" target="_blank" rel="noopener">Instagram</a><a href="${esc(s.tiktok)}" target="_blank" rel="noopener">TikTok</a></div>
<p class="ft-c">${esc(s.alamat)} · Buka setiap hari 10.00–22.00</p><p class="ft-c">© 2026 Karua Areum · Makassar</p></div><p class="ft-tag">Barbershop di Makassar.<br>Rapi untuk setiap cerita.</p></div>`;
  nav(); route();
})();
