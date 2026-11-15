/* Музей: анфилада залов с витринами и экспонат крупно. Данные — js/data/museum.js. */

window.Museum = (function () {
  'use strict';

  var T = window.CONFIG.texts;

  var root = null;
  var hooks = {};
  var hall = 0;
  var ex = 0;
  var onExhibit = false;
  var hallScroll = 0;   /* мобильный режим: где была страница зала до открытия экспоната */
  var silent = false;   /* состояние меняет адрес страницы (set), а не пользователь */

  /* Сообщает main.js, что изменилось состояние для адреса: 'push' — новый шаг истории
     браузера, 'replace' — тот же шаг, 'close' — закрыли то, что открывали. */
  function nav(kind) {
    if (!silent && hooks.nav) hooks.nav(kind);
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function halls() { return window.MUSEUM_DATA; }
  function exCode(h, e) { return (h + 1) + '.' + pad(e + 1); }

  /* Снимок экспоната, а если пути нет — серая заглушка. kind — 'thumb' в витрине,
     'full' на странице экспоната, см. Screens.setPhoto. */
  function putPhoto(el, x, kind) {
    el.classList.remove('is-stub');
    if (x.photo) {
      el.replaceChildren(Screens.photo(x.photo, kind, 'glass__img', x.name));
    } else {
      el.classList.add('is-stub');
      el.textContent = T.exhibitStub;
    }
  }

  /* Зал */

  function renderArches() {
    var box = root.querySelector('#arches');
    box.replaceChildren();
    halls().forEach(function (h, i) {
      var frag = Screens.clone('tpl-museum-arch');
      var arch = frag.firstElementChild;
      arch.dataset.hall = i;
      arch.classList.toggle('is-active', i === hall);
      arch.querySelector('[data-slot="num"]').textContent = T.hall + ' ' + pad(i + 1);
      arch.querySelector('[data-slot="name"]').textContent = h.name;
      arch.querySelector('[data-slot="years"]').textContent = h.years;
      box.appendChild(frag);
    });
    var active = box.querySelector('.is-active');
    /* В мобильном режиме scrollIntoView сдвинул бы и страницу; ленту прокручиваем сами. */
    if (active && Screens.isMobile()) Screens.centerIn(box, active);
    else if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderPanel() {
    var h = halls()[hall];
    var n = h.exhibits.length;
    root.querySelector('#hall-label').textContent = T.hall + ' ' + pad(hall + 1) + ' ' + T.of + ' ' + pad(halls().length);
    root.querySelector('#hall-name').textContent = h.name;
    root.querySelector('#hall-years').textContent = h.years;
    root.querySelector('#hall-about').textContent = h.about;
    root.querySelector('#hall-count').textContent = n + ' ' + Screens.plural(n, T.exhibitForms) + ' ' + T.inHall;
    root.querySelector('#hall-prev').disabled = hall === 0;
    root.querySelector('#hall-next').disabled = hall === halls().length - 1;
  }

  function renderCases() {
    var box = root.querySelector('#cases');
    box.replaceChildren();
    box.scrollTop = 0;
    halls()[hall].exhibits.forEach(function (x, i) {
      var frag = Screens.clone('tpl-museum-case');
      var card = frag.firstElementChild;
      card.dataset.ex = i;
      putPhoto(card.querySelector('[data-slot="photo"]'), x, 'thumb');
      card.querySelector('[data-slot="year"]').textContent = x.year;
      card.querySelector('[data-slot="name"]').textContent = x.name;
      card.querySelector('[data-slot="code"]').textContent = T.exhibitShort + ' ' + exCode(hall, i);
      box.appendChild(frag);
    });
  }

  function renderHall() {
    renderArches();
    renderPanel();
    renderCases();
  }

  function showHall() {
    onExhibit = false;
    root.replaceChildren(Screens.clone('tpl-museum-hall'));
    renderHall();
  }

  function goHall(i) {
    if (i < 0 || i >= halls().length || i === hall) return;
    hall = i;
    renderHall();
    if (hooks.pick) hooks.pick();
    nav('replace');
  }

  /* Экспонат */

  function addRow(box, label, value, mono) {
    if (!value) return;   /* необязательное поле не заполнено — строки нет */
    var row = document.createElement('div');
    row.className = 'label__row';
    row.innerHTML = '<span class="label__key"></span><span class="label__value"></span>';
    row.firstChild.textContent = label;
    row.lastChild.textContent = value;
    if (mono) row.lastChild.classList.add('label__value--mono');
    box.appendChild(row);
  }

  function renderExhibit() {
    var h = halls()[hall];
    var x = h.exhibits[ex];

    root.querySelector('#exhibit-kicker').textContent = T.museumTitle + ' · ' + T.hall + ' ' + pad(hall + 1);
    root.querySelector('#exhibit-code').textContent =
      T.hall + ' ' + pad(hall + 1) + ' · ' + T.exhibitShort + ' ' + exCode(hall, ex);
    root.querySelector('#exhibit-name').textContent = x.name;
    root.querySelector('#exhibit-year').textContent = x.year;
    root.querySelector('#exhibit-about').textContent = x.about;
    putPhoto(root.querySelector('#exhibit-photo'), x, 'full');

    var rows = root.querySelector('#exhibit-rows');
    rows.replaceChildren();
    addRow(rows, T.rowHall, h.name);
    addRow(rows, T.rowSource, x.source);
    addRow(rows, T.rowInventory, x.inventory, true);

    var thumbs = root.querySelector('#exhibit-thumbs');
    thumbs.replaceChildren();
    h.exhibits.forEach(function (n, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'neighbour' + (i === ex ? ' is-active' : '');
      b.dataset.ex = i;
      b.title = n.name;
      b.setAttribute('aria-label', n.name);
      if (n.photo) b.appendChild(Screens.photo(n.photo, 'thumb', 'glass__img', ''));
      thumbs.appendChild(b);
    });

    root.querySelector('#exhibit-prev').disabled = ex === 0;
    root.querySelector('#exhibit-next').disabled = ex === h.exhibits.length - 1;
  }

  function showExhibit(i) {
    ex = i;
    onExhibit = true;
    hallScroll = window.scrollY;
    root.replaceChildren(Screens.clone('tpl-museum-exhibit'));
    if (Screens.isMobile()) {
      window.scrollTo(0, 0);
      Screens.swipe(root.querySelector('.exhibit__stage'), stepExhibit);
    }
    renderExhibit();
    if (hooks.open) hooks.open();
    nav('push');
  }

  function stepExhibit(d) {
    var i = ex + d;
    if (i < 0 || i >= halls()[hall].exhibits.length) return;
    ex = i;
    renderExhibit();
    if (hooks.step) hooks.step();
    nav('replace');
  }

  function backToHall() {
    showHall();
    if (Screens.isMobile()) window.scrollTo(0, hallScroll);
    if (hooks.close) hooks.close();
    nav('close');
  }

  function onClick(e) {
    var el = e.target;

    if (onExhibit) {
      if (el.closest('#btn-to-hall')) { backToHall(); return; }
      if (el.closest('#exhibit-prev')) { stepExhibit(-1); return; }
      if (el.closest('#exhibit-next')) { stepExhibit(1); return; }
      var nb = el.closest('.neighbour');
      if (nb) { ex = Number(nb.dataset.ex); renderExhibit(); nav('replace'); }
      return;
    }

    var arch = el.closest('.arch');
    if (arch) { goHall(Number(arch.dataset.hall)); return; }
    if (el.closest('#hall-prev')) { goHall(hall - 1); return; }
    if (el.closest('#hall-next')) { goHall(hall + 1); return; }
    var card = el.closest('.case');
    if (card) showExhibit(Number(card.dataset.ex));
  }

  /* Годы зала из строки: '1930 — 1945' — диапазон, 'с 2010' — без конца, '1950' — один год. */
  function yearRange(s) {
    var m = String(s).match(/\d{4}/g);
    if (!m) return null;
    var from = Number(m[0]);
    if (m[1]) return [from, Number(m[1])];
    return [from, /^\s*с\s/i.test(s) ? Infinity : from];
  }

  /* Индекс зала с годом year или null. Год на границе двух залов относится к более позднему. */
  function hallForYear(year) {
    var found = null;
    halls().forEach(function (h, i) {
      var r = yearRange(h.years);
      if (r && year >= r[0] && year <= r[1]) found = i;
    });
    return found;
  }

  /* startHall — необязательно: индекс зала, который открыть. */
  function init(el, h, startHall) {
    silent = false;
    root = el;
    hooks = h || {};
    hall = startHall || 0;
    ex = 0;
    root.addEventListener('click', onClick);
    showHall();
  }

  /* Зал и открытый экспонат (индексы с 0, экспонат — null) — для адреса страницы. */
  function state() {
    return { hall: hall, exhibit: onExhibit ? ex : null };
  }

  /* Привести музей к адресу. Номера вне диапазона прижимаются к краю. Адрес не трогаем. */
  function set(h, x) {
    var n = halls().length;
    if (!n) return;
    silent = true;
    h = Math.max(0, Math.min(n - 1, h || 0));
    if (x === null || x === undefined) {
      if (onExhibit) { hall = h; backToHall(); }
      else goHall(h);
    } else {
      hall = h;
      x = Math.max(0, Math.min(halls()[h].exhibits.length - 1, x));
      if (x < 0) { if (onExhibit) backToHall(); else showHall(); }
      else if (onExhibit) { ex = x; renderExhibit(); }
      else showExhibit(x);
    }
    silent = false;
  }

  /* Возвращает true, если клавиша обработана здесь. ←/→ листают залы или экспонаты,
     Escape на экспонате возвращает в зал. */
  function key(e) {
    var d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (onExhibit) {
      if (e.key === 'Escape') { backToHall(); return true; }
      if (d) { stepExhibit(d); return true; }
      return false;
    }
    if (d) { goHall(hall + d); return true; }
    return false;
  }

  return { init: init, key: key, hallForYear: hallForYear, state: state, set: set };
})();
