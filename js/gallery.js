/* Галерея выпускников: шкала лет, альбом с перелистыванием и просмотр одного фото.
   Данные — js/data/gallery.js. */

window.Gallery = (function () {
  'use strict';

  var WIN = 9;          /* сколько лет помещается на шкале */
  var FLIP_MS = 820;
  var PER_PAGE = 3;     /* фото на обычной странице; на титульной — одно */

  var T = window.CONFIG.texts;

  var years = [];       /* { year, photos, pages, spreads } по возрастанию года */
  var spreads = [];     /* все развороты альбома подряд: { y, k, n } */

  var root = null;
  var hooks = {};
  var cur = 0;          /* индекс текущего разворота */
  var dir = 0;          /* направление идущего перелистывания, 0 — не листаем */
  var win = 0;          /* первый год, видимый на шкале */
  var timer = null;
  var view = null;      /* открытое фото: { yi, index }, null — просмотр закрыт */

  function pad(n) { return String(n).padStart(2, '0'); }

  /* Раскладка по страницам: титульная с первым фото, дальше по PER_PAGE фото на страницу. */
  function build() {
    years = window.GALLERY_DATA.slice().sort(function (a, b) { return a.year - b.year; })
      .map(function (y) {
        var pages = [{ title: true, start: 0 }];
        for (var i = 1; i < y.photos.length; i += PER_PAGE) pages.push({ start: i });
        return { year: y.year, photos: y.photos, pages: pages, spreads: Math.ceil(pages.length / 2) };
      });

    spreads = [];
    years.forEach(function (y, yi) {
      for (var k = 0; k < y.spreads; k++) spreads.push({ y: yi, k: k, n: y.spreads });
    });
  }

  function firstSpreadOf(yi) {
    for (var i = 0; i < spreads.length; i++) if (spreads[i].y === yi) return i;
    return 0;
  }

  /* Сдвигает окно шкалы ровно настолько, чтобы год yi стал виден. */
  function ensureVisible(yi) {
    if (yi < win) win = yi;
    else if (yi >= win + WIN) win = yi - WIN + 1;
  }

  /* Снимок, а если путь пустой — серая заглушка с подписью label. */
  function putPhoto(el, photo, label) {
    if (photo.src) {
      var img = document.createElement('img');
      img.className = 'photo__img';
      img.src = photo.src;
      img.alt = photo.caption;
      el.replaceChildren(img);
    } else {
      el.classList.add('photo--stub');
      el.textContent = label;
    }
  }

  function fillPhoto(btn, yi, index) {
    var y = years[yi];
    var photo = y.photos[index];
    if (!photo) { btn.hidden = true; return; }

    btn.dataset.yi = yi;
    btn.dataset.index = index;
    putPhoto(btn, photo, T.photoStub + ' ' + y.year);
  }

  function makePage(idx, side) {
    var sp = spreads[idx];
    if (!sp) return Screens.clone('tpl-page-end');

    var y = years[sp.y];
    var pn = sp.k * 2 + (side === 'R' ? 1 : 0);
    var page = y.pages[pn];
    var frag;
    var slot = function (name) { return frag.querySelector('[data-slot="' + name + '"]'); };

    if (page && page.title) {
      frag = Screens.clone('tpl-page-title');
      var count = y.photos.length;
      slot('num').textContent = pad(sp.y + 1) + ' / ' + pad(years.length);
      slot('year').textContent = y.year;
      slot('meta').textContent = sp.n + ' ' + Screens.plural(sp.n, T.spreadForms) + ' · ' +
        count + ' ' + Screens.plural(count, T.photoForms);
      fillPhoto(slot('photo0'), sp.y, 0);
      slot('caption').textContent = y.photos[0] ? y.photos[0].caption : '';
    } else {
      /* Нечётное число страниц: последняя правая страница года остаётся пустой, с одной шапкой. */
      var start = page ? page.start : y.photos.length;
      frag = Screens.clone('tpl-page-photos');
      slot('release').textContent = T.release + ' ' + y.year;
      slot('num').textContent = T.pageShort + ' ' + pad(pn + 1) + ' / ' + pad(sp.n * 2);
      for (var i = 0; i < PER_PAGE; i++) fillPhoto(slot('photo' + i), sp.y, start + i);
      slot('caption').textContent = y.photos[start] ? y.photos[start].caption : '';
    }

    frag.firstElementChild.classList.add(side === 'L' ? 'page--l' : 'page--r');
    return frag;
  }

  function put(id, idx, side) {
    root.querySelector('#' + id).replaceChildren(makePage(idx, side));
  }

  /* Год, который показываем на шкале и в подвале: во время перелистывания — уже тот, куда листаем. */
  function target() { return spreads[cur + dir]; }

  function renderTimeline() {
    var active = target().y;
    var box = root.querySelector('#tl-years');
    box.replaceChildren();

    for (var i = win; i < Math.min(years.length, win + WIN); i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tl__year' + (i === active ? ' is-active' : '');
      b.dataset.yi = i;
      b.innerHTML = '<span class="tl__dot"></span><span class="tl__label"></span>';
      b.lastChild.textContent = years[i].year;
      box.appendChild(b);
    }

    root.querySelector('#tl-prev').disabled = win === 0;
    root.querySelector('#tl-next').disabled = win >= years.length - WIN;
  }

  function renderFoot() {
    var t = target();
    root.querySelector('#foot-year').textContent = T.release + ' ' + years[t.y].year;
    root.querySelector('#foot-spread').textContent = T.spread + ' ' + (t.k + 1) + ' ' + T.of + ' ' + t.n;
    root.querySelector('#foot-no').textContent = T.yearShort + ' ' + pad(t.y + 1) + ' / ' + pad(years.length);

    var dots = root.querySelector('#foot-dots');
    dots.replaceChildren();
    for (var i = 0; i < t.n; i++) {
      var d = document.createElement('span');
      d.className = 'album-foot__dot' + (i === t.k ? ' is-active' : '');
      dots.appendChild(d);
    }
  }

  function renderNav() {
    var atStart = cur === 0;
    var atEnd = cur === spreads.length - 1;
    root.querySelector('#album-prev').disabled = atStart;
    root.querySelector('#corner-prev').disabled = atStart;
    root.querySelector('#album-next').disabled = atEnd;
    root.querySelector('#corner-next').disabled = atEnd;
  }

  function renderSpread() {
    put('page-l', cur, 'L');
    put('page-r', cur, 'R');
    root.querySelector('#album').classList.remove('is-flipping', 'is-back');
    renderTimeline();
    renderFoot();
    renderNav();
  }

  /* Лист лежит поверх половины, с которой уходит. Под ним уже нарисована страница,
     которая откроется, а на обороте — страница, которая ляжет на другую половину. */
  function flip(d) {
    if (dir) return;
    var nx = cur + d;
    if (nx < 0 || nx >= spreads.length) return;

    dir = d;
    var fwd = d > 0;
    var album = root.querySelector('#album');
    var leaf = root.querySelector('#album-leaf');

    if (fwd) {
      put('page-r', nx, 'R');
      put('leaf-front', cur, 'R');
      put('leaf-back', nx, 'L');
    } else {
      put('page-l', nx, 'L');
      put('leaf-front', cur, 'L');
      put('leaf-back', nx, 'R');
    }

    album.classList.toggle('is-back', !fwd);
    album.classList.remove('is-flipping');
    album.classList.add('is-turning');
    leaf.getBoundingClientRect();   /* фиксируем начальное положение, иначе переход не запустится */
    album.classList.add('is-flipping');

    ensureVisible(spreads[nx].y);
    renderTimeline();
    renderFoot();
    if (hooks.flip) hooks.flip();

    timer = setTimeout(function () {
      cur = nx;
      dir = 0;
      album.classList.remove('is-turning');
      renderSpread();
    }, FLIP_MS);
  }

  function selectYear(yi) {
    if (dir) return;
    cur = firstSpreadOf(yi);
    ensureVisible(yi);
    renderSpread();
  }

  function shiftWindow(d) {
    win = Math.max(0, Math.min(years.length - WIN, win + d));
    renderTimeline();
  }

  /* Просмотр одного фото */

  function renderView() {
    var y = years[view.yi];
    var photo = y.photos[view.index];
    var v = root.querySelector('#viewer');

    v.querySelector('#viewer-kicker').textContent = T.galleryFull + ' · ' + T.release + ' ' + y.year;
    v.querySelector('#viewer-num').textContent = pad(view.index + 1) + ' / ' + pad(y.photos.length);
    v.querySelector('#viewer-name').textContent = T.photoStub + ' ' + y.year;
    v.querySelector('#viewer-caption').textContent = photo.caption;
    v.querySelector('#viewer-direction').textContent = photo.direction;

    var frame = v.querySelector('#viewer-frame');
    frame.className = 'viewer__frame';
    putPhoto(frame, photo, T.photoStub + ' ' + y.year);

    var thumbs = v.querySelector('#viewer-thumbs');
    thumbs.replaceChildren();
    y.photos.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb' + (i === view.index ? ' is-active' : '');
      b.dataset.index = i;
      b.setAttribute('aria-label', p.caption);
      putPhoto(b, p, y.year);
      thumbs.appendChild(b);
    });
    var active = thumbs.querySelector('.is-active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function openView(yi, index) {
    view = { yi: yi, index: index };
    root.appendChild(Screens.clone('tpl-viewer'));
    root.classList.add('is-viewing');
    renderView();
    if (hooks.open) hooks.open();
  }

  function closeView() {
    view = null;
    root.querySelector('#viewer').remove();
    root.classList.remove('is-viewing');
    if (hooks.close) hooks.close();
  }

  /* Внутри года фото листаются по кругу. */
  function step(d) {
    var n = years[view.yi].photos.length;
    view.index = (view.index + d + n) % n;
    renderView();
    if (hooks.step) hooks.step();
  }

  function onViewerClick(el) {
    if (el.closest('#viewer-close, #viewer-all')) { closeView(); return; }
    if (el.closest('#viewer-prev')) { step(-1); return; }
    if (el.closest('#viewer-next')) { step(1); return; }
    var thumb = el.closest('.thumb');
    if (thumb) {
      view.index = Number(thumb.dataset.index);
      renderView();
    }
  }

  function onClick(e) {
    var el = e.target;
    if (view) { onViewerClick(el); return; }

    var photo = el.closest('.photo');
    if (photo) { openView(Number(photo.dataset.yi), Number(photo.dataset.index)); return; }

    var year = el.closest('.tl__year');
    if (year) { selectYear(Number(year.dataset.yi)); return; }
    if (el.closest('#tl-prev')) { shiftWindow(-1); return; }
    if (el.closest('#tl-next')) { shiftWindow(1); return; }
    if (el.closest('#album-prev, #corner-prev')) { flip(-1); return; }
    if (el.closest('#album-next, #corner-next')) { flip(1); }
  }

  function init(el, h) {
    clearTimeout(timer);
    root = el;
    hooks = h || {};
    build();
    cur = 0;
    dir = 0;
    win = 0;
    view = null;
    root.addEventListener('click', onClick);
    renderSpread();
  }

  /* Возвращает true, если клавиша обработана здесь. Escape при открытом фото ведёт к альбому, а не в меню. */
  function key(e) {
    var d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (view) {
      if (e.key === 'Escape') { closeView(); return true; }
      if (d) { step(d); return true; }
      return false;
    }
    if (d) { flip(d); return true; }
    return false;
  }

  return { init: init, key: key };
})();
