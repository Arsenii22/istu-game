#!/usr/bin/env node
/* Сборка данных игры из таблиц.

   node tools/build-data.js            обрабатывает фото из photos-src/ (tools/photos.js), затем
                                       читает data-src/*.csv, проверяет и пишет js/data/*.js
   node tools/build-data.js --export   выгружает текущие js/data/*.js в data-src/*.csv
   node tools/build-data.js --check    проверка «туда-обратно»: выгрузить → собрать →
                                       сравнить с текущими данными (файлы не меняются)

   Для обработки фото нужна библиотека sharp (npm install один раз), для --export и
   --check — только Node. Таблицы читаются с разделителем «;» или «,»
   (определяется по строке заголовков), в UTF-8 с BOM или без. Пишутся с BOM и «;» —
   так их правильно открывает русский Excel. Инструкция для участников — docs/как-заполнять.md. */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const photos = require('./photos');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data-src');
const OUT = path.join(ROOT, 'js', 'data');

/* Таблицы и их колонки. Порядок колонок в файле может быть любым — ищем по названию. */
const TABLES = {
  stages: ['год', 'название'],
  branches: ['type', 'название', 'сегодня_текст', 'сегодня_ссылка'],
  events: ['направление', 'подветка', 'год', 'событие', 'описание', 'фото'],
  gallery: ['год', 'файл_фото', 'подпись', 'направление'],
  halls: ['название', 'годы', 'описание'],
  exhibits: ['зал', 'название', 'год', 'описание', 'фото', 'источник', 'инв_номер'],
  reviews: ['имя', 'год', 'направление', 'дата', 'текст', 'фото'],
};

/* Где лежат оригиналы фото: в таблице пишется только имя файла, папка внутри photos-src/
   достраивается по разделу. Если в ячейке уже есть «/», это путь внутри photos-src/
   (начало «assets/» или «photos-src/» тоже понимается). На сайт попадает обработанный
   WebP по тому же пути в assets/ — см. tools/photos.js. */
const PHOTO_DIR = {
  events: () => 'history/',
  gallery: (row) => 'gallery/' + row.get('год') + '/',
  exhibits: () => 'museum/',
  reviews: () => 'reviews/',
};

/* Основные фото, на которые ссылаются данные последней сборки, — для js/data/photos.js. */
let usedPhotos = new Set();

/* У отзыва три варианта фото: нет фото, серая заглушка, снимок. Заглушку обозначает это слово. */
const STUB = 'заглушка';

/* CSV */

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = count(firstLine, ';') >= count(firstLine, ',') ? ';' : ',';

  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        if (ch !== '\r') cell += ch;
      }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { cells.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      rows.push({ cells: cells, line: rowLine });
      cells = [];
      cell = '';
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== '' || cells.length) { cells.push(cell); rows.push({ cells: cells, line: rowLine }); }
  return rows;
}

function count(s, ch) {
  let n = 0;
  let quoted = false;
  for (const c of s) {
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) n++;
  }
  return n;
}

function toCSV(header, rows) {
  const cell = (v) => {
    v = v === undefined || v === null ? '' : String(v);
    return /[;"\r\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return '﻿' + [header].concat(rows).map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/* Название колонки без разницы в регистре, пробелах вместо «_» и «ё». */
function norm(s) {
  return String(s).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '_');
}

/* Таблица из текста: строки-объекты с get(колонка) и номером строки файла. */
function table(name, text, errors) {
  const file = 'data-src/' + name + '.csv';
  const rows = parseCSV(text);
  if (!rows.length) { errors.push(file + ': файл пустой, нет даже строки заголовков'); return []; }

  const head = rows[0].cells.map(norm);
  const index = {};
  const missing = [];
  TABLES[name].forEach((col) => {
    const i = head.indexOf(norm(col));
    if (i < 0) missing.push(col);
    index[col] = i;
  });
  if (missing.length) {
    errors.push(file + ', строка 1: нет колонок ' + missing.map((c) => '«' + c + '»').join(', ') +
      '. Нужны колонки: ' + TABLES[name].join('; '));
    return [];
  }

  return rows.slice(1)
    .filter((r) => r.cells.some((c) => c.trim() !== ''))   /* пустые строки Excel пропускаем */
    .map((r) => ({
      file: file,
      line: r.line,
      get: (col) => (r.cells[index[col]] || '').trim(),
    }));
}

/* Проверки */

function where(row) { return row.file + ', строка ' + row.line + ': '; }

function required(row, cols, errors) {
  let ok = true;
  cols.forEach((col) => {
    if (row.get(col) === '') { errors.push(where(row) + 'пустая колонка «' + col + '» — её нужно заполнить'); ok = false; }
  });
  return ok;
}

function year4(row, col, errors) {
  const v = row.get(col);
  if (v === '' || /^\d{4}$/.test(v)) return true;
  errors.push(where(row) + 'год «' + v + '» в колонке «' + col + '» — нужны ровно четыре цифры, например 1975');
  return false;
}

function known(row, col, names, errors) {
  const v = row.get(col);
  if (v === '' || names.indexOf(v) >= 0) return true;
  errors.push(where(row) + 'неизвестное направление «' + v + '». Направления из data-src/branches.csv: ' +
    names.map((n) => '«' + n + '»').join(', '));
  return false;
}

/* Дата в виде ГГГГ-ММ-ДД. Excel при сохранении переделывает её в ДД.ММ.ГГГГ (иногда
   без ведущих нулей: 4.8.2026) — принимаем и такую. Пустая остаётся пустой (её ловит
   проверка обязательных колонок), неверная или несуществующая дата — null. */
function normDate(v) {
  if (v === '') return '';
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let y, mo, d;
  if (m) { y = m[1]; mo = m[2]; d = m[3]; }
  else {
    m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return null;
    y = m[3]; mo = m[2].padStart(2, '0'); d = m[1].padStart(2, '0');
  }
  const t = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (t.getUTCMonth() !== Number(mo) - 1 || t.getUTCDate() !== Number(d)) return null;   /* 31.02, 13-й месяц */
  return y + '-' + mo + '-' + d;
}

/* Есть ли файл — с учётом регистра букв: GitHub Pages различает «Foto.jpg» и «foto.jpg». */
function fileExists(rel) {
  let dir = ROOT;
  for (const part of rel.split('/')) {
    if (!fs.existsSync(dir)) return 'нет';
    const names = fs.readdirSync(dir);
    if (names.indexOf(part) < 0) {
      return names.some((n) => n.toLowerCase() === part.toLowerCase()) ? 'регистр' : 'нет';
    }
    dir = path.join(dir, part);
  }
  return 'есть';
}

function photo(row, col, table, errors) {
  const v = row.get(col);
  if (v === '') return '';
  const rel = v.indexOf('/') >= 0 ? v.replace(/^\.?\//, '').replace(/^(assets|photos-src)\//, '') : PHOTO_DIR[table](row) + v;
  const out = photos.outputs(rel).full;
  const state = fileExists('photos-src/' + rel);
  if (state === 'регистр') {
    errors.push(where(row) + 'файл фото photos-src/' + rel + ' есть, но большие и маленькие буквы в имени не совпадают — исправьте имя файла или ячейку');
  } else if (state === 'нет' && fileExists(out) !== 'есть') {
    /* Без оригинала можно, если фото уже обработано: его обработал другой участник и оно
       пришло через git, а photos-src в репозиторий не попадает. */
    errors.push(where(row) + 'файл фото не найден: photos-src/' + rel);
  }
  usedPhotos.add(out);
  return out;
}

/* Таблицы → данные */

function build(texts, errors) {
  usedPhotos = new Set();
  const t = {};
  Object.keys(TABLES).forEach((name) => {
    if (texts[name] === undefined) errors.push('нет файла data-src/' + name + '.csv');
    else t[name] = table(name, texts[name], errors);
  });
  if (errors.length) return null;

  /* История */
  const stages = [];
  t.stages.forEach((r) => {
    if (required(r, ['год', 'название'], errors) && year4(r, 'год', errors)) stages.push({ year: r.get('год'), name: r.get('название') });
  });

  const branches = [];
  const byTitle = {};
  t.branches.forEach((r) => {
    if (!required(r, ['type', 'название'], errors)) return;
    const type = r.get('type');
    const title = r.get('название');
    if (!/^[a-z][a-z0-9-]*$/.test(type)) errors.push(where(r) + 'type «' + type + '» — только латинские строчные буквы, цифры и дефис, например mountain');
    if (byTitle[title]) { errors.push(where(r) + 'направление «' + title + '» уже есть в строке ' + byTitle[title].line); return; }
    if (branches.some((b) => b.type === type)) errors.push(where(r) + 'type «' + type + '» уже занят другим направлением');
    const b = { title: title, type: type, today: { text: r.get('сегодня_текст'), link: r.get('сегодня_ссылка') }, items: [] };
    byTitle[title] = { branch: b, line: r.line, subs: {} };
    branches.push(b);
  });
  const titles = branches.map((b) => b.title);

  t.events.forEach((r) => {
    const ok = [required(r, ['направление', 'событие'], errors), known(r, 'направление', titles, errors), year4(r, 'год', errors)];
    const src = photo(r, 'фото', 'events', errors);
    if (ok.indexOf(false) >= 0) return;

    const entry = byTitle[r.get('направление')];
    const item = [r.get('год'), r.get('событие')];
    if (r.get('описание') || src) item.push({ about: r.get('описание'), photo: src });

    const subTitle = r.get('подветка');
    if (!subTitle) { entry.branch.items.push(item); return; }
    if (!entry.subs[subTitle]) {
      entry.subs[subTitle] = { title: subTitle, items: [] };
      entry.branch.subbranches = entry.branch.subbranches || [];
      entry.branch.subbranches.push(entry.subs[subTitle]);
    }
    entry.subs[subTitle].items.push(item);
  });

  /* Галерея: строки одного года собираются в один выпуск, порядок — как в таблице. */
  const gallery = [];
  t.gallery.forEach((r) => {
    const ok = [required(r, ['год', 'подпись', 'направление'], errors), year4(r, 'год', errors), known(r, 'направление', titles, errors)];
    const src = ok[1] ? photo(r, 'файл_фото', 'gallery', errors) : '';
    if (ok.indexOf(false) >= 0) return;
    const year = Number(r.get('год'));
    let y = gallery.find((g) => g.year === year);
    if (!y) { y = { year: year, photos: [] }; gallery.push(y); }
    y.photos.push({ src: src, caption: r.get('подпись'), direction: r.get('направление') });
  });

  /* Музей */
  const museum = [];
  const halls = {};
  t.halls.forEach((r) => {
    if (!required(r, ['название', 'годы', 'описание'], errors)) return;
    const name = r.get('название');
    if (halls[name]) { errors.push(where(r) + 'зал «' + name + '» уже есть в строке ' + halls[name].line); return; }
    halls[name] = { hall: { name: name, years: r.get('годы'), about: r.get('описание'), exhibits: [] }, line: r.line };
    museum.push(halls[name].hall);
  });
  t.exhibits.forEach((r) => {
    const ok = [required(r, ['зал', 'название', 'год', 'описание'], errors), year4(r, 'год', errors)];
    const src = photo(r, 'фото', 'exhibits', errors);
    if (r.get('зал') && !halls[r.get('зал')]) {
      errors.push(where(r) + 'неизвестный зал «' + r.get('зал') + '». Залы из data-src/halls.csv: ' +
        Object.keys(halls).map((n) => '«' + n + '»').join(', '));
      return;
    }
    if (ok.indexOf(false) >= 0) return;
    halls[r.get('зал')].hall.exhibits.push({
      name: r.get('название'), year: Number(r.get('год')), about: r.get('описание'), photo: src,
      source: r.get('источник'), inventory: r.get('инв_номер'),
    });
  });

  /* Отзывы */
  const reviews = [];
  t.reviews.forEach((r) => {
    const ok = [required(r, ['имя', 'год', 'направление', 'дата', 'текст'], errors), year4(r, 'год', errors), known(r, 'направление', titles, errors)];
    const date = normDate(r.get('дата'));
    if (date === null) {
      errors.push(where(r) + 'дата «' + r.get('дата') + '» не распознана: нужен вид ГГГГ-ММ-ДД или ДД.ММ.ГГГГ, например 2026-10-24 или 24.10.2026, и такой день должен быть в календаре');
      ok.push(false);
    }
    const v = r.get('фото');
    const src = v.toLowerCase() === STUB ? '' : photo(r, 'фото', 'reviews', errors);
    if (ok.indexOf(false) >= 0) return;
    const review = { name: r.get('имя'), year: Number(r.get('год')), direction: r.get('направление'), date: date, text: r.get('текст') };
    if (v !== '') review.photo = src;
    reviews.push(review);
  });

  return { history: { stages: stages, branches: branches }, gallery: gallery, museum: museum, reviews: reviews };
}

/* Данные → таблицы */

/* Путь обработанного фото → ячейка таблицы: имя оригинала, если фото лежит в папке
   раздела, иначе путь внутри photos-src. Оригинал ищется по имени без расширения;
   если его нет на этом компьютере, пишется имя WebP — сборка поймёт и его. */
function photoName(src, dir) {
  if (!src) return src;
  const rel = src.replace(/^assets\//, '');
  const d = path.posix.dirname(rel) + '/';
  const stem = path.posix.basename(rel, path.posix.extname(rel));
  let name = path.posix.basename(rel);
  const srcDir = path.join(photos.SRC, ...d.split('/'));
  if (fs.existsSync(srcDir)) {
    const orig = fs.readdirSync(srcDir).filter((n) => photos.isPhoto(n) && path.parse(n).name === stem);
    if (orig.length === 1) name = orig[0];
  }
  return d === dir ? name : d + name;
}

function exportTables(d) {
  const rows = {};
  rows.stages = d.history.stages.map((s) => [s.year, s.name]);
  rows.branches = d.history.branches.map((b) => [b.type, b.title, (b.today || {}).text || '', (b.today || {}).link || '']);

  rows.events = [];
  const event = (b, sub, it) => {
    const x = it[2] || {};
    rows.events.push([b.title, sub, it[0], it[1], x.about || '', photoName(x.photo || '', PHOTO_DIR.events())]);
  };
  d.history.branches.forEach((b) => {
    b.items.forEach((it) => event(b, '', it));
    (b.subbranches || []).forEach((s) => s.items.forEach((it) => event(b, s.title, it)));
  });

  rows.gallery = [];
  d.gallery.forEach((y) => y.photos.forEach((p) => {
    rows.gallery.push([y.year, photoName(p.src, 'gallery/' + y.year + '/'), p.caption, p.direction]);
  }));

  rows.halls = d.museum.map((h) => [h.name, h.years, h.about]);
  rows.exhibits = [];
  d.museum.forEach((h) => h.exhibits.forEach((x) => {
    rows.exhibits.push([h.name, x.name, x.year, x.about, photoName(x.photo, PHOTO_DIR.exhibits()), x.source || '', x.inventory || '']);
  }));

  rows.reviews = d.reviews.map((r) => [r.name, r.year, r.direction, r.date, r.text,
    r.photo === undefined ? '' : r.photo === '' ? STUB : photoName(r.photo, PHOTO_DIR.reviews())]);

  const texts = {};
  Object.keys(TABLES).forEach((name) => { texts[name] = toCSV(TABLES[name], rows[name]); });
  return texts;
}

/* Данные → js/data/*.js */

function q(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'";
}

const BANNER =
  ' * Файл собран из таблиц data-src/*.csv командой node tools/build-data.js.\n' +
  ' * Правьте таблицы, а не этот файл: при следующей сборке он перезапишется.\n' +
  ' * Как заполнять таблицы — docs/как-заполнять.md.\n';

function renderItem(it) {
  const parts = [q(it[0]), q(it[1])];
  if (it[2]) parts.push('{ about: ' + q(it[2].about || '') + ', photo: ' + q(it[2].photo || '') + ' }');
  return '[' + parts.join(', ') + ']';
}

function renderHistory(h) {
  const out = [];
  out.push('/* История: этапы университета и направления.\n *\n' + BANNER + ' *\n' +
    ' * stages   — этапы университета снизу вверх: year (строка) и name;\n' +
    ' * branches — направления:\n' +
    ' *   title       — название; его же используют фильтры отзывов и форма отзыва;\n' +
    ' *   type        — ключ направления, по нему цвет ветки --branch-<type>;\n' +
    ' *   items       — события [год, название]; год — строка, \'\' — год не известен;\n' +
    ' *                 третий элемент { about, photo } — описание и фото события;\n' +
    ' *   subbranches — необязательно, подветки: title и items;\n' +
    ' *   today       — блок «Сегодня» в конце фокуса ветки: { text, link }.\n */\n');
  out.push('window.HISTORY_DATA = {');
  out.push('  stages: [');
  h.stages.forEach((s) => out.push('    { year: ' + q(s.year) + ', name: ' + q(s.name) + ' },'));
  out.push('  ],', '', '  branches: [');
  h.branches.forEach((b) => {
    out.push('    {');
    out.push('      title: ' + q(b.title) + ',');
    out.push('      type: ' + q(b.type) + ',');
    out.push('      today: { text: ' + q(b.today.text) + ', link: ' + q(b.today.link) + ' },');
    out.push('      items: [');
    b.items.forEach((it) => out.push('        ' + renderItem(it) + ','));
    out.push('      ],');
    if (b.subbranches) {
      out.push('      subbranches: [');
      b.subbranches.forEach((s) => {
        out.push('        {', '          title: ' + q(s.title) + ',', '          items: [');
        s.items.forEach((it) => out.push('            ' + renderItem(it) + ','));
        out.push('          ],', '        },');
      });
      out.push('      ],');
    }
    out.push('    },');
  });
  out.push('  ],', '};', '');
  return out.join('\n');
}

function renderGallery(g) {
  const out = ['/* Фото галереи выпускников.\n *\n' + BANNER + ' *\n' +
    ' * Каждый элемент — год выпуска: year и photos в порядке альбома (первое — на титульной).\n' +
    ' * У фото: src — путь от index.html (\'\' — серая заглушка), caption — подпись,\n' +
    ' * direction — направление, дословно как title в js/data/history.js.\n */\n', 'window.GALLERY_DATA = ['];
  g.forEach((y) => {
    out.push('  {', '    year: ' + y.year + ',', '    photos: [');
    y.photos.forEach((p) => out.push('      { src: ' + q(p.src) + ', caption: ' + q(p.caption) + ', direction: ' + q(p.direction) + ' },'));
    out.push('    ],', '  },');
  });
  out.push('];', '');
  return out.join('\n');
}

function renderMuseum(m) {
  const out = ['/* Музей: залы и экспонаты.\n *\n' + BANNER + ' *\n' +
    ' * Зал: name, years (строкой, например \'1930 — 1945\'), about, exhibits.\n' +
    ' * Экспонат: name, year, about, photo (\'\' — серая заглушка),\n' +
    ' * source и inventory — необязательно, пусто — строки на этикетке нет.\n */\n', 'window.MUSEUM_DATA = ['];
  m.forEach((h) => {
    out.push('  {', '    name: ' + q(h.name) + ',', '    years: ' + q(h.years) + ',', '    about: ' + q(h.about) + ',', '    exhibits: [');
    h.exhibits.forEach((x) => {
      out.push('      {', '        name: ' + q(x.name) + ',', '        year: ' + x.year + ',', '        about: ' + q(x.about) + ',',
        '        photo: ' + q(x.photo) + ',', '        source: ' + q(x.source) + ',', '        inventory: ' + q(x.inventory) + ',', '      },');
    });
    out.push('    ],', '  },');
  });
  out.push('];', '');
  return out.join('\n');
}

function renderReviews(r) {
  const out = ['/* Отзывы выпускников.\n *\n' + BANNER + ' *\n' +
    ' * name, year, direction (дословно как title в js/data/history.js), date \'ГГГГ-ММ-ДД\', text.\n' +
    ' * photo — необязательно: нет поля — нет фото, \'\' — серая заглушка, путь — снимок.\n */\n', 'window.REVIEWS_DATA = ['];
  r.forEach((x) => {
    out.push('  {', '    name: ' + q(x.name) + ',', '    year: ' + x.year + ',', '    direction: ' + q(x.direction) + ',',
      '    date: ' + q(x.date) + ',', '    text: ' + q(x.text) + ',');
    if (x.photo !== undefined) out.push('    photo: ' + q(x.photo) + ',');
    out.push('  },');
  });
  out.push('];', '');
  return out.join('\n');
}

/* Размеры обработанных фото: сайт ставит их в width/height, чтобы при загрузке ничего не прыгало,
   и берёт отсюда путь к превью. Фото, которого здесь нет, показывается как есть, без размеров. */
function renderPhotos(sizes) {
  const out = ['/* Обработанные фото: основное (до 1600 px) → превью (до 400 px) и размеры в пикселях.\n *\n' + BANNER +
    ' * Пишется сборкой по фото из таблиц, руками не правится.\n */\n', 'window.PHOTOS_DATA = {'];
  Object.keys(sizes).sort().forEach((full) => {
    const s = sizes[full];
    out.push('  ' + q(full) + ': { thumb: ' + q(photos.thumbOf(full)) + ', w: ' + s.w + ', h: ' + s.h + ', tw: ' + s.tw + ', th: ' + s.th + ' },');
  });
  out.push('};', '');
  return out.join('\n');
}

function render(d) {
  return {
    'history.js': renderHistory(d.history),
    'gallery.js': renderGallery(d.gallery),
    'museum.js': renderMuseum(d.museum),
    'reviews.js': renderReviews(d.reviews),
  };
}

/* Текущие данные: выполняем js/data/*.js так же, как браузер, только без браузера. */
function loadData(files) {
  const box = { window: {} };
  vm.createContext(box);
  Object.keys(files).forEach((name) => vm.runInContext(files[name], box, { filename: name }));
  const w = box.window;
  /* JSON убирает различие между объектами из песочницы и обычными — для сравнения. */
  return JSON.parse(JSON.stringify({ history: w.HISTORY_DATA, gallery: w.GALLERY_DATA, museum: w.MUSEUM_DATA, reviews: w.REVIEWS_DATA }));
}

function readDataDir() {
  const files = {};
  ['history.js', 'gallery.js', 'museum.js', 'reviews.js'].forEach((n) => { files[n] = fs.readFileSync(path.join(OUT, n), 'utf8'); });
  return files;
}

/* Первое расхождение двух значений: путь и оба значения, или null. */
function diff(a, b, at) {
  at = at || 'данные';
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return at + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b);
  if (a && typeof a === 'object') {
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    for (const k of keys) {
      if (!(k in a) || !(k in b)) return at + '.' + k + ': поле есть только с одной стороны';
      const d = diff(a[k], b[k], at + (Array.isArray(a) ? '[' + k + ']' : '.' + k));
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : at + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b);
}

function summary(d) {
  const events = d.history.branches.reduce((n, b) => n + b.items.length + (b.subbranches || []).reduce((m, s) => m + s.items.length, 0), 0);
  const photos = d.gallery.reduce((n, y) => n + y.photos.length, 0);
  const exhibits = d.museum.reduce((n, h) => n + h.exhibits.length, 0);
  return d.history.stages.length + ' этапов, ' + d.history.branches.length + ' направлений, ' + events + ' событий, ' +
    d.gallery.length + ' выпусков и ' + photos + ' фото, ' + d.museum.length + ' залов и ' + exhibits + ' экспонатов, ' +
    d.reviews.length + ' отзывов';
}

function fail(errors, title) {
  console.error((title || 'Ошибки в таблицах') + ' — js/data не изменён:\n');
  errors.forEach((e) => console.error('  • ' + e));
  console.error('\nИсправьте и запустите сборку ещё раз.');
  process.exit(1);
}

async function main() {
  const mode = process.argv[2] || '';

  if (mode === '--export') {
    const texts = exportTables(loadData(readDataDir()));
    fs.mkdirSync(SRC, { recursive: true });
    Object.keys(texts).forEach((name) => fs.writeFileSync(path.join(SRC, name + '.csv'), texts[name]));
    console.log('Выгружено в data-src/: ' + Object.keys(texts).map((n) => n + '.csv').join(', '));
    return;
  }

  if (mode === '--check') {
    const current = loadData(readDataDir());
    const errors = [];
    const built = build(exportTables(current), errors);
    if (errors.length) fail(errors);
    const d1 = diff(current, built);
    /* И ещё раз — через сгенерированные файлы, как их увидит браузер. */
    const d2 = d1 || diff(current, loadData(render(built)));
    if (d1 || d2) {
      console.error('Не совпадает: ' + (d1 || d2));
      process.exit(1);
    }
    console.log('Туда-обратно совпадает: ' + summary(current));
    return;
  }

  if (mode) {
    console.error('Неизвестный ключ ' + mode + '. Можно: без ключа, --export или --check.');
    process.exit(1);
  }

  /* Сначала фото: сборка данных проверяет, что каждое фото из таблиц есть. */
  const ph = await photos.processAll();
  if (ph.done || ph.skipped) console.log('Фото: обработано ' + ph.done + ', без изменений ' + ph.skipped);
  if (ph.errors.length) fail(ph.errors, 'Ошибки в фото');

  const texts = {};
  const errors = [];
  Object.keys(TABLES).forEach((name) => {
    const file = path.join(SRC, name + '.csv');
    if (!fs.existsSync(file)) return;
    texts[name] = fs.readFileSync(file, 'utf8');
    /* Байты не в UTF-8 превращаются в «�»: так бывает, если Excel сохранил «CSV» без «UTF-8». */
    if (texts[name].indexOf('�') >= 0) {
      errors.push('data-src/' + name + '.csv: файл не в кодировке UTF-8, русские буквы прочитаются неверно. ' +
        'В Excel: «Сохранить как» → тип «CSV UTF-8 (разделитель — запятая)»');
    }
  });
  if (errors.length) fail(errors);
  const data = build(texts, errors);
  if (errors.length) fail(errors);

  const files = render(data);
  files['photos.js'] = renderPhotos(await photos.sizesOf(Array.from(usedPhotos).sort(), ph.sizes));
  Object.keys(files).forEach((name) => fs.writeFileSync(path.join(OUT, name), files[name]));
  console.log('Собрано: ' + summary(data));
}

main().catch((e) => { console.error(e); process.exit(1); });
