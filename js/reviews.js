/* Отзывы выпускников: лента в колонках и фильтры по направлениям.
   Отзывы — js/data/reviews.js, список направлений — js/data/history.js. */

window.Reviews = (function () {
  'use strict';

  var PAGE = 9;         /* сколько карточек добавляет «Показать ещё» */

  var T = window.CONFIG.texts;

  var root = null;
  var hooks = {};
  var filter = null;    /* название направления или null — все отзывы */
  var shown = PAGE;

  /* Свежие сверху. Даты в формате ГГГГ-ММ-ДД сравниваются как строки. */
  function sorted() {
    return window.REVIEWS_DATA.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  }

  function visible() {
    return sorted().filter(function (r) { return !filter || r.direction === filter; });
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w[0].toUpperCase(); }).join('');
  }

  function renderFilters() {
    var row = root.querySelector('#filters');
    row.replaceChildren();

    var names = [null].concat(window.HISTORY_DATA.branches.map(function (b) { return b.title; }));
    names.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill' + (name === filter ? ' is-active' : '');
      b.dataset.direction = name || '';
      b.textContent = name || T.allReviews;
      row.appendChild(b);
    });

    var active = row.querySelector('.is-active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function makeCard(r) {
    var frag = Screens.clone('tpl-review');
    var slot = function (name) { return frag.querySelector('[data-slot="' + name + '"]'); };

    /* Поля photo нет — фото у отзыва нет; пустой путь — серая заглушка. */
    if (r.photo !== undefined) {
      var photo = slot('photo');
      photo.hidden = false;
      if (r.photo) {
        var img = document.createElement('img');
        img.className = 'review__img';
        img.src = r.photo;
        img.alt = T.reviewPhoto + ' ' + r.year;
        photo.appendChild(img);
      } else {
        photo.classList.add('is-stub');
        photo.textContent = T.reviewPhoto + ' ' + r.year;
      }
    }

    slot('text').textContent = r.text;
    slot('initials').textContent = initials(r.name);
    slot('name').textContent = r.name;
    slot('meta').textContent = T.release + ' ' + r.year + ' · ' + r.direction;
    return frag;
  }

  function renderFeed() {
    var list = visible();
    var cols = root.querySelector('#feed-cols');
    cols.replaceChildren();
    list.slice(0, shown).forEach(function (r) { cols.appendChild(makeCard(r)); });

    root.querySelector('#feed-empty').hidden = list.length > 0;
    root.querySelector('#btn-more').hidden = shown >= list.length;
    root.querySelector('#reviews-count').textContent =
      list.length + ' ' + Screens.plural(list.length, T.reviewForms) + ' · ' + T.newestFirst;
  }

  function setFilter(name) {
    if (name === filter) return;
    filter = name;
    shown = PAGE;
    root.querySelector('#feed').scrollTop = 0;
    renderFilters();
    renderFeed();
    if (hooks.pick) hooks.pick();
  }

  function onClick(e) {
    var el = e.target;
    var pill = el.closest('.pill');
    if (pill) { setFilter(pill.dataset.direction || null); return; }
    if (el.closest('#btn-write')) { if (hooks.write) hooks.write(); return; }
    if (el.closest('#btn-more')) {
      shown += PAGE;
      renderFeed();
      if (hooks.more) hooks.more();
    }
  }

  /* Ряд фильтров прокручивается вбок; колесо мыши крутит его так же, как ленту. */
  function onWheel(e) {
    var row = e.currentTarget;
    if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    row.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  /* Карточки n самых свежих отзывов направления. */
  function latestCards(direction, n) {
    return sorted()
      .filter(function (r) { return r.direction === direction; })
      .slice(0, n)
      .map(makeCard);
  }

  /* startFilter — необязательно: направление, выбранное сразу. */
  function init(el, h, startFilter) {
    root = el;
    hooks = h || {};
    filter = startFilter || null;
    shown = PAGE;
    root.addEventListener('click', onClick);
    root.querySelector('#filters').addEventListener('wheel', onWheel, { passive: false });
    renderFilters();
    renderFeed();
  }

  return { init: init, latestCards: latestCards };
})();
