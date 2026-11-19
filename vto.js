'use strict';
/**
 * Virtual Try-On (VTO) — integrasi nyata dengan Gradio API milik Hugging Face Space.
 *
 * Model utama : AIRI-Institute/HairFastGAN (Gradio Space)
 * Endpoint    : /resize_inner (fn 1 & 2) lalu /swap_hair (fn 4)
 * Input       : face image, shape/reference image, color image, blending, poisson_iters, poisson_erosion
 *
 * Catatan penting:
 * - Space resmi HairFastGAN saat ini RUNNING tetapi backend inferensinya (gRPC) mengembalikan
 *   error. Karena itu tersedia provider fallback yang juga merupakan Space Gradio nyata
 *   (bukan respons palsu). Fallback dapat dimatikan lewat VTO_FALLBACK_SPACE_ID="".
 * - Semua kredensial hanya dibaca di server. Tidak pernah dikirim ke browser.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('@gradio/client');
const imageSize = require('image-size');

const STYLE_DIR = path.join(__dirname, 'public', 'vto-styles');
const STORAGE_DIR = path.join(__dirname, 'storage', 'vto');

const HF_TOKEN = (process.env.HF_TOKEN || '').trim();
const PRIMARY_SPACE = (process.env.HF_SPACE_ID || 'AIRI-Institute/HairFastGAN').trim();
const PRIMARY_URL = (process.env.HF_SPACE_URL || '').trim();
const FALLBACK_SPACE = (process.env.VTO_FALLBACK_SPACE_ID || '').trim();
const FALLBACK_URL = (process.env.VTO_FALLBACK_SPACE_URL || '').trim();
const PROVIDER = (process.env.VTO_PROVIDER || 'auto').trim().toLowerCase();
const CONNECT_TIMEOUT = Number(process.env.VTO_CONNECT_TIMEOUT_MS || 25000);
const RESIZE_TIMEOUT = Number(process.env.VTO_RESIZE_TIMEOUT_MS || 45000);
const PREDICT_TIMEOUT = Number(process.env.VTO_TIMEOUT_MS || 120000);
const PRIMARY_COOLDOWN = Math.max(0, Number(process.env.VTO_PRIMARY_COOLDOWN_MS || 300000));
const MAX_UPLOAD_MB = Math.max(1, Math.min(20, Number(process.env.VTO_MAX_UPLOAD_MB || 2)));
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ALIGN = /^(1|true|yes)$/i.test(process.env.VTO_ALIGN || '');

class VtoError extends Error {
  constructor(status, pesan) {
    super(pesan);
    this.status = status;
    this.pesan = pesan;
  }
}

/** Koleksi gaya rambut. File gambar berada di public/vto-styles/<file>. */
const STYLES = [
  { slug: 'french-crop', nama: 'French Crop', deskripsi: 'Fringe pendek rapi dengan sisi taper.', file: 'french-crop.jpg', bentuk: 'oval,persegi' },
  { slug: 'two-block', nama: 'Two Block', deskripsi: 'Top panjang bertekstur, sisi pendek terputus.', file: 'two-block.jpg', bentuk: 'oval,bulat' },
  { slug: 'mullet', nama: 'Mullet', deskripsi: 'Pendek di depan, panjang di belakang.', file: 'mullet.jpg', bentuk: 'oval,lonjong' },
  { slug: 'buzz-cut', nama: 'Buzz Cut', deskripsi: 'Sangat pendek merata, bersih dan praktis.', file: 'buzz-cut.jpg', bentuk: 'oval,persegi,bulat' },
  { slug: 'low-fade', nama: 'Low Fade', deskripsi: 'Fade rendah di atas telinga, top bertekstur.', file: 'low-fade.jpg', bentuk: 'oval,lonjong' },
  { slug: 'mid-fade', nama: 'Mid Fade', deskripsi: 'Fade di pelipis, kontras top yang rapi.', file: 'mid-fade.jpg', bentuk: 'oval,bulat' },
  { slug: 'high-fade', nama: 'High Fade', deskripsi: 'Skin fade tinggi dengan top lebih panjang.', file: 'high-fade.jpg', bentuk: 'oval,persegi' },
  { slug: 'textured-crop', nama: 'Textured Crop', deskripsi: 'Crop bertekstur dengan fringe acak.', file: 'textured-crop.jpg', bentuk: 'oval,bulat,lonjong' },
  { slug: 'middle-part', nama: 'Middle Part', deskripsi: 'Belah tengah, curtain hair medium length.', file: 'middle-part.jpg', bentuk: 'oval,lonjong' },
  { slug: 'side-part', nama: 'Side Part', deskripsi: 'Belah samping klasik, rapi dan formal.', file: 'side-part.jpg', bentuk: 'oval,persegi,lonjong' },
  { slug: 'pompadour', nama: 'Pompadour', deskripsi: 'Volume disisir ke atas dan ke belakang.', file: 'pompadour.jpg', bentuk: 'oval,lonjong' },
  { slug: 'undercut', nama: 'Undercut', deskripsi: 'Top panjang disisir belakang, sisi dicukur.', file: 'undercut.jpg', bentuk: 'oval,persegi' },
];

const STYLE_MAP = new Map(STYLES.map((s) => [s.slug, s]));

function styleBySlug(slug) {
  return STYLE_MAP.get(String(slug || '').trim()) || null;
}

function publicStyles() {
  return STYLES.map(({ file, ...s }) => ({ ...s, gambar: '/vto-styles/' + file }));
}

function stylePath(style) {
  return path.join(STYLE_DIR, style.file);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new VtoError(504, message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function friendlyUpstreamError(message) {
  const m = String(message || '').toLowerCase();
  if (/timeout|timed out/.test(m)) return 'Proses AI melebihi batas waktu. Silakan coba lagi.';
  if (/queue|busy|overload|503/.test(m)) return 'Layanan AI sedang sibuk. Silakan coba beberapa saat lagi.';
  if (/face|wajah|detect/.test(m)) return 'Wajah tidak terdeteksi. Gunakan foto wajah yang jelas dan menghadap kamera.';
  return 'Layanan AI gagal memproses foto. Pastikan foto menampilkan wajah dengan jelas.';
}

function translateError(error) {
  if (error instanceof VtoError) return error;
  const m = String(error && error.message ? error.message : error || '').toLowerCase();
  if (/fetch failed|enotfound|eai_again|network|space metadata|could not resolve/.test(m)) {
    return new VtoError(503, 'Tidak dapat menghubungi layanan AI. Periksa koneksi server atau coba lagi beberapa saat.');
  }
  if (/timeout|timed out/.test(m)) return new VtoError(504, 'Proses AI melebihi batas waktu. Silakan coba lagi.');
  if (/unexpected error|error occurred/.test(m)) {
    return new VtoError(502, 'Layanan AI gagal memproses foto. Pastikan foto menampilkan wajah dengan jelas.');
  }
  return new VtoError(502, 'Layanan AI gagal memproses foto. Silakan coba lagi.');
}

/**
 * Memvalidasi data URL gambar dari browser. Mengembalikan buffer + metadata.
 * Tidak menulis file apa pun — foto asli pelanggan hanya hidup di memori selama request.
 */
function decodeImage(dataUrl) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new VtoError(400, 'Format foto harus JPG atau PNG.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new VtoError(400, 'Foto tidak valid atau kosong.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new VtoError(413, `Ukuran foto maksimal ${MAX_UPLOAD_MB} MB.`);

  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isPng && !isJpeg) throw new VtoError(400, 'Isi file tidak sesuai tipe gambar JPG/PNG.');

  let dim;
  try {
    dim = imageSize(buffer);
  } catch {
    throw new VtoError(400, 'Gambar tidak dapat dibaca. Gunakan JPG atau PNG yang valid.');
  }
  if (!dim.width || !dim.height || dim.width < 256 || dim.height < 256) {
    throw new VtoError(400, 'Foto terlalu kecil. Gunakan minimal 256 × 256 piksel.');
  }
  if (dim.width > 6000 || dim.height > 6000) {
    throw new VtoError(400, 'Foto terlalu besar. Maksimal 6000 × 6000 piksel.');
  }

  return {
    buffer,
    mime: isPng ? 'image/png' : 'image/jpeg',
    width: dim.width,
    height: dim.height,
  };
}

async function connect(target, label) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const options = HF_TOKEN ? { hf_token: HF_TOKEN } : undefined;
      return await withTimeout(
        Client.connect(target, options),
        CONNECT_TIMEOUT,
        'Koneksi ke layanan AI melebihi batas waktu.'
      );
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1200);
    }
  }
  console.warn(`[VTO] Gagal terhubung ke ${label}: ${lastError && lastError.message ? lastError.message : lastError}`);
  throw translateError(lastError);
}

/**
 * Menjalankan satu endpoint Gradio lewat queue API dan menunggu event process_completed.
 * Endpoint dapat berupa nama ("/swap_hair") atau fn_index (4).
 */
async function call(app, endpoint, data, timeoutMs, label) {
  let iterator;
  try {
    iterator = await app.submit(endpoint, data, null, null, true);
  } catch (error) {
    throw translateError(error);
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      try { await iterator.cancel(); } catch { /* ignore */ }
      try { iterator.close_stream(); } catch { /* ignore */ }
      reject(new VtoError(504, 'Proses AI melebihi batas waktu. Silakan coba lagi.'));
    }, timeoutMs);
  });

  const run = (async () => {
    let lastData = null;
    for await (const event of iterator) {
      if (event.type === 'data') lastData = event.data;
      if (event.type === 'status' && event.stage === 'error') {
        console.warn(`[VTO] ${label} error: ${event.message || 'tanpa pesan'}`);
        throw new VtoError(502, friendlyUpstreamError(event.message));
      }
      if (event.type === 'status' && event.stage === 'complete') return lastData;
    }
    if (lastData) return lastData;
    throw new VtoError(502, 'Layanan AI tidak mengembalikan hasil.');
  })();
  // Cegah unhandled rejection ketika timeout lebih dulu menang.
  run.catch(() => {});

  try {
    return await Promise.race([run, timeout]);
  } catch (error) {
    throw translateError(error);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFile(fileData, app) {
  if (!fileData) throw new VtoError(502, 'Layanan AI tidak mengembalikan gambar.');
  let url = typeof fileData === 'string' ? fileData : fileData.url;
  const root = (app && app.config && app.config.root) || '';
  if (!url && fileData && fileData.path) {
    url = String(root).replace(/\/$/, '') + '/file=' + encodeURIComponent(fileData.path);
  }
  if (!url) throw new VtoError(502, 'Layanan AI tidak mengembalikan gambar.');
  if (!/^https?:\/\//i.test(url)) {
    try { url = new URL(url, root || undefined).toString(); } catch { /* biarkan */ }
  }

  const headers = HF_TOKEN ? { authorization: `Bearer ${HF_TOKEN}` } : {};
  const response = await withTimeout(
    fetch(url, { headers }),
    45000,
    'Mengunduh hasil AI melebihi batas waktu.'
  );
  if (!response.ok) throw new VtoError(502, 'Gagal mengunduh hasil dari layanan AI.');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 100 || buffer.length > 12 * 1024 * 1024) {
    throw new VtoError(502, 'Ukuran hasil AI tidak wajar.');
  }
  const mime = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0].toLowerCase();
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) {
    throw new VtoError(502, 'Hasil AI bukan gambar yang didukung.');
  }
  return { buffer, mime };
}

/** Provider utama: HairFastGAN resmi. */
function readReference(style) {
  const file = stylePath(style);
  if (!fs.existsSync(file)) throw new VtoError(500, 'Gambar referensi gaya tidak ditemukan di server.');
  return fs.readFileSync(file);
}

async function runHairFastGan(face, style) {
  const target = PRIMARY_URL || PRIMARY_SPACE;
  const app = await connect(target, 'HairFastGAN');
  const faceBlob = new Blob([face.buffer], { type: face.mime });
  const refBlob = new Blob([readReference(style)], { type: 'image/jpeg' });

  // 1) Normalisasi foto wajah ke 1024x1024. Align opsional karena model align_face
  //    pada Space resmi saat ini bermasalah; center-crop tetap didukung.
  let faceData = null;
  if (ALIGN) {
    try {
      const aligned = await call(app, 1, [faceBlob, ['Face']], RESIZE_TIMEOUT, 'resize-face');
      faceData = Array.isArray(aligned) ? aligned[0] : null;
    } catch (error) {
      console.warn('[VTO] align wajah gagal, memakai center-crop:', error.message);
    }
  }
  if (!faceData) {
    const resized = await call(app, 1, [faceBlob, []], RESIZE_TIMEOUT, 'resize-face');
    faceData = Array.isArray(resized) ? resized[0] : null;
  }
  if (!faceData) throw new VtoError(502, 'Foto wajah gagal diproses.');

  // 2) Normalisasi gambar referensi gaya.
  let shapeData = null;
  if (ALIGN) {
    try {
      const aligned = await call(app, 2, [refBlob, ['Shape']], RESIZE_TIMEOUT, 'resize-shape');
      shapeData = Array.isArray(aligned) ? aligned[0] : null;
    } catch (error) {
      console.warn('[VTO] align referensi gagal, memakai center-crop:', error.message);
    }
  }
  if (!shapeData) {
    const resized = await call(app, 2, [refBlob, []], RESIZE_TIMEOUT, 'resize-shape');
    shapeData = Array.isArray(resized) ? resized[0] : null;
  }
  if (!shapeData) throw new VtoError(502, 'Gambar referensi gaya gagal diproses.');

  // 3) Transfer gaya rambut. Parameter sesuai app.py Space:
  //    swap_hair(face, shape, color, blending, poisson_iters, poisson_erosion)
  const output = await call(
    app,
    4,
    [faceData, shapeData, null, 'Article', 0, 15],
    PREDICT_TIMEOUT,
    'swap-hair'
  );
  const image = Array.isArray(output) ? output[0] : null;
  const upstreamMessage = Array.isArray(output) ? output[1] : null;
  if (!image) {
    throw new VtoError(502, upstreamMessage ? friendlyUpstreamError(upstreamMessage) : 'Layanan AI tidak mengembalikan hasil.');
  }
  const file = await fetchFile(image, app);
  return { ...file, provider: 'hairfastgan' };
}

/**
 * Provider fallback (opsional, tetap AI nyata): Space Gradio dengan input
 * face + hair reference. Default: Ciraaa/Virtual_Hair_stylist (GPU).
 * Signature: fn_index 0 -> [face, hair, guidance, strength, ip_scale, steps]
 */
async function runFallback(face, style) {
  const target = FALLBACK_URL || FALLBACK_SPACE;
  const app = await connect(target, 'fallback');
  const faceBlob = new Blob([face.buffer], { type: face.mime });
  const refBlob = new Blob([readReference(style)], { type: 'image/jpeg' });

  const output = await call(
    app,
    0,
    [faceBlob, refBlob, 7.5, 0.8, 0.7, 20],
    PREDICT_TIMEOUT,
    'fallback-hair'
  );
  const image = Array.isArray(output) ? (output[1] || output[0]) : null;
  if (!image) throw new VtoError(502, 'Layanan AI alternatif tidak mengembalikan hasil.');
  const file = await fetchFile(image, app);
  return { ...file, provider: 'fallback' };
}

/**
 * Menjalankan provider sesuai VTO_PROVIDER.
 * auto     : HairFastGAN lalu fallback bila gagal (default)
 * hairfastgan : hanya HairFastGAN
 * fallback : hanya fallback
 *
 * Saat provider utama gagal di mode auto, provider utama dilewati sementara
 * (VTO_PRIMARY_COOLDOWN_MS) agar permintaan berikutnya tidak menunggu lama.
 */
let primaryDownUntil = 0;

async function generate({ face, style }) {
  const tasks = [];
  if (PROVIDER !== 'fallback' && (PROVIDER !== 'auto' || Date.now() >= primaryDownUntil)) {
    tasks.push(['hairfastgan', runHairFastGan]);
  }
  if ((PROVIDER === 'fallback' || PROVIDER === 'auto') && (FALLBACK_SPACE || FALLBACK_URL)) {
    tasks.push(['fallback', runFallback]);
  }
  if (!tasks.length) {
    throw new VtoError(503, 'Layanan AI belum dikonfigurasi. Hubungi admin.');
  }

  let lastError;
  for (const [name, runner] of tasks) {
    try {
      const result = await runner(face, style);
      if (name === 'hairfastgan') primaryDownUntil = 0;
      return { ...result, provider: name };
    } catch (error) {
      lastError = error;
      if (name === 'hairfastgan' && PROVIDER === 'auto' && PRIMARY_COOLDOWN > 0) {
        primaryDownUntil = Date.now() + PRIMARY_COOLDOWN;
      }
      console.warn(`[VTO] Provider ${name} gagal: ${error.message}`);
    }
  }
  throw lastError || new VtoError(503, 'Layanan AI tidak tersedia.');
}

function saveResult(buffer, mime, id) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const ext = /png/.test(mime) ? 'png' : /webp/.test(mime) ? 'webp' : 'jpg';
  const name = `${id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(STORAGE_DIR, name), buffer);
  return name;
}

function resultPath(name) {
  if (!/^\d+-[a-f0-9]+\.(png|jpg|jpeg|webp)$/i.test(String(name || ''))) return null;
  return path.join(STORAGE_DIR, name);
}

function removeResult(name) {
  const file = resultPath(name);
  if (!file) return;
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}

/** Status ringan (di-cache 60 detik) untuk ditampilkan di UI/admin. */
let statusCache = { at: 0, data: null };

async function checkSpace(target) {
  if (!target) return null;
  if (/^https?:\/\//i.test(target)) return { id: target, stage: 'custom' };
  try {
    const response = await withTimeout(
      fetch('https://huggingface.co/api/spaces/' + target),
      6000,
      'status timeout'
    );
    if (!response.ok) return { id: target, stage: 'unknown' };
    const json = await response.json();
    return {
      id: target,
      stage: (json.runtime && json.runtime.stage) || 'unknown',
      hardware: (json.runtime && json.runtime.hardware && json.runtime.hardware.current) || null,
    };
  } catch {
    return { id: target, stage: 'unknown' };
  }
}

async function status() {
  const now = Date.now();
  if (statusCache.data && now - statusCache.at < 60000) return statusCache.data;
  const [primary, fallback] = await Promise.all([
    checkSpace(PRIMARY_URL || PRIMARY_SPACE),
    (FALLBACK_SPACE || FALLBACK_URL) ? checkSpace(FALLBACK_URL || FALLBACK_SPACE) : Promise.resolve(null),
  ]);
  const data = { provider: PROVIDER, primary, fallback, align: ALIGN, primaryCooldownMs: Math.max(0, primaryDownUntil - now) };
  statusCache = { at: now, data };
  return data;
}

module.exports = {
  VtoError,
  STYLES,
  publicStyles,
  styleBySlug,
  decodeImage,
  generate,
  saveResult,
  resultPath,
  removeResult,
  status,
  maxUploadBytes: MAX_UPLOAD_BYTES,
};
