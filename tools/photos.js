/* Обработка фото для сайта. Вызывается из tools/build-data.js перед сборкой данных.

   Оригиналы лежат в photos-src/ (в репозиторий не попадают) в тех же подпапках, что и на
   сайте: gallery/<год>/, history/, museum/, reviews/. Из каждого оригинала получаются два
   файла WebP в assets/ по тому же пути:

     photos-src/gallery/1985/01.jpg  →  assets/gallery/1985/01.webp          основное, до 1600 px
                                        assets/gallery/1985/thumbs/01.webp   превью, до 400 px

   Фото поворачивается по EXIF (снимки с телефона часто лежат набок), все метаданные —
   EXIF, GPS-координаты, сведения о камере — удаляются. Оригинал, который не менялся с
   прошлой обработки, пропускается: размер и время изменения файла запоминаются в
   photos-src/.обработано.json.

   Нужна библиотека sharp: один раз выполнить npm install в папке проекта. */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'photos-src');
const OUT = path.join(ROOT, 'assets');
const MANIFEST = path.join(SRC, '.обработано.json');

const FULL = 1600;      /* основное фото: длинная сторона, px */
const THUMB = 400;      /* превью */
const QUALITY = 80;     /* качество WebP */
const THUMBS = 'thumbs';

/* Какие файлы считаются фото. Остальное в photos-src (Thumbs.db, заметки) пропускается. */
const EXT = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.gif', '.avif', '.heic', '.heif'];
const SECTIONS = ['gallery', 'history', 'museum', 'reviews'];

function loadSharp() {
  try {
    return require('sharp');
  } catch (e) {
    return null;
  }
}

/* Путь оригинала внутри photos-src (через «/») → пути обработанных файлов от index.html. */
function outputs(rel) {
  const dir = path.posix.dirname(rel);
  const name = path.posix.basename(rel, path.posix.extname(rel)) + '.webp';
  return {
    full: 'assets/' + dir + '/' + name,
    thumb: 'assets/' + dir + '/' + THUMBS + '/' + name,
  };
}

function isPhoto(name) {
  return EXT.indexOf(path.extname(name).toLowerCase()) >= 0;
}

/* Все фото в photos-src/<раздел>/ с подпапками, пути через «/». Папки превью не обходим. */
function listSources() {
  const found = [];
  function walk(abs, rel) {
    fs.readdirSync(abs, { withFileTypes: true }).forEach((d) => {
      const r = rel + '/' + d.name;
      if (d.isDirectory()) { if (d.name !== THUMBS) walk(path.join(abs, d.name), r); }
      else if (d.isFile() && isPhoto(d.name)) found.push(r);
    });
  }
  SECTIONS.forEach((s) => {
    const abs = path.join(SRC, s);
    if (fs.existsSync(abs)) walk(abs, s);
  });
  return found.sort();
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (e) {
    return {};
  }
}

function abs(rel) { return path.join(ROOT, ...rel.split('/')); }

async function convert(sharp, srcAbs, outAbs, size) {
  const dir = path.dirname(outAbs);
  const base = path.basename(outAbs);
  fs.mkdirSync(dir, { recursive: true });
  /* В Windows запись поверх «Foto.webp» оставила бы старое имя вместо «foto.webp», а GitHub Pages
     большие и маленькие буквы различает. Поэтому файл с тем же именем в другом регистре удаляем. */
  fs.readdirSync(dir).forEach((n) => {
    if (n !== base && n.toLowerCase() === base.toLowerCase()) fs.unlinkSync(path.join(dir, n));
  });
  /* rotate() без аргументов — поворот по EXIF. sharp не переносит метаданные в новый файл,
     если не попросить об этом явно (withMetadata/keepExif), — их здесь нет. */
  const info = await sharp(srcAbs, { failOn: 'none' })
    .rotate()
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(outAbs);
  return [info.width, info.height];
}

/* Обрабатывает новые и изменённые оригиналы. Возвращает { done, skipped, errors, sizes },
   sizes — размеры по пути основного фото: { w, h, tw, th }. */
async function processAll() {
  const result = { done: 0, skipped: 0, errors: [], sizes: {} };
  if (!fs.existsSync(SRC)) return result;

  const sharp = loadSharp();
  const sources = listSources();
  if (!sources.length) return result;
  if (!sharp) {
    result.errors.push('для обработки фото нужна библиотека sharp. Один раз выполните в папке проекта: npm install');
    return result;
  }

  const old = readManifest();
  const manifest = {};
  const byOutput = {};

  for (const rel of sources) {
    const out = outputs(rel);
    if (byOutput[out.full]) {
      result.errors.push('photos-src/' + rel + ' и photos-src/' + byOutput[out.full] +
        ' дают один и тот же файл ' + out.full + ' — переименуйте один из них');
      continue;
    }
    byOutput[out.full] = rel;

    const st = fs.statSync(abs('photos-src/' + rel));
    const stamp = { size: st.size, mtime: Math.round(st.mtimeMs) };
    const prev = old[rel];
    const fresh = prev && prev.size === stamp.size && prev.mtime === stamp.mtime &&
      fs.existsSync(abs(out.full)) && fs.existsSync(abs(out.thumb));

    if (fresh) {
      manifest[rel] = prev;
      result.sizes[out.full] = { w: prev.w, h: prev.h, tw: prev.tw, th: prev.th };
      result.skipped++;
      continue;
    }

    try {
      const full = await convert(sharp, abs('photos-src/' + rel), abs(out.full), FULL);
      const thumb = await convert(sharp, abs('photos-src/' + rel), abs(out.thumb), THUMB);
      manifest[rel] = Object.assign(stamp, { w: full[0], h: full[1], tw: thumb[0], th: thumb[1] });
      result.sizes[out.full] = { w: full[0], h: full[1], tw: thumb[0], th: thumb[1] };
      result.done++;
    } catch (e) {
      result.errors.push('photos-src/' + rel + ': не удалось обработать фото (' + e.message.split('\n')[0] +
        '). Если это HEIC с iPhone — сохраните его как JPG');
    }
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  return result;
}

/* Размеры уже обработанных фото, которых нет среди оригиналов на этом компьютере
   (например, их обработал другой участник и они пришли через git). */
async function sizesOf(fulls, known) {
  const sharp = loadSharp();
  const sizes = {};
  for (const full of fulls) {
    if (known[full]) { sizes[full] = known[full]; continue; }
    const thumb = thumbOf(full);
    if (!sharp || !fs.existsSync(abs(full))) continue;
    try {
      const a = await sharp(abs(full)).metadata();
      const b = fs.existsSync(abs(thumb)) ? await sharp(abs(thumb)).metadata() : null;
      sizes[full] = { w: a.width, h: a.height, tw: b ? b.width : 0, th: b ? b.height : 0 };
    } catch (e) {
      /* размеров не будет — сайт покажет фото и без них */
    }
  }
  return sizes;
}

function thumbOf(full) {
  return path.posix.dirname(full) + '/' + THUMBS + '/' + path.posix.basename(full);
}

module.exports = { processAll, sizesOf, outputs, thumbOf, isPhoto, SRC };
