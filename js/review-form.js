/* Форма отзыва выпускника: проверка полей, локальный предпросмотр фото и экран «Спасибо».
   Список направлений — из js/data/history.js.
   Данные никуда не отправляются: вся отправка собрана в submitReview() ниже. */

window.ReviewForm = (function () {
  'use strict';

  var MIN_TEXT = 30;    /* минимальная длина отзыва, символов */

  var CONFIG = window.CONFIG;
  var T = CONFIG.texts;

  var root = null;
  var form = null;
  var hooks = {};
  var shown = false;    /* ошибки показываются после первой попытки отправить */
  var agree = false;
  var photo = null;     /* { file, url } — выбранное фото, только для предпросмотра */

  /* ОТПРАВКА ОТЗЫВА — СЮДА ПОДКЛЮЧАЕТСЯ БЭКЕНД.
     Сейчас функция ничего не отправляет: данные остаются в браузере, после неё сразу
     показывается экран «Спасибо». Адрес сервера — CONFIG.reviewEndpoint в js/config.js.

     review = { name, year, direction, text, date, photo }
       photo — объект File или null; сам файл тоже никуда не загружается.

     Когда появится сервер, здесь нужно отправить review на CONFIG.reviewEndpoint
     и вернуть Promise, например:

       var body = new FormData();
       Object.keys(review).forEach(function (k) { if (review[k] != null) body.append(k, review[k]); });
       return fetch(CONFIG.reviewEndpoint, { method: 'POST', body: body })
         .then(function (res) { if (!res.ok) throw new Error(res.status); });

     По file:// запросы к серверу браузер может блокировать — для этого страницу
     придётся открывать через веб-сервер. */
  function submitReview(review) {
    return Promise.resolve();
  }

  /* Поля формы */

  function field(name) { return form.elements[name]; }

  function values() {
    return {
      name: field('name').value.trim(),
      year: field('year').value,
      direction: field('direction').value,
      text: field('text').value.trim(),
    };
  }

  function validate(v) {
    return {
      name: v.name ? '' : T.errName,
      year: /^\d{4}$/.test(v.year) ? '' : T.errYear,
      direction: v.direction ? '' : T.errDirection,
      text: v.text.length >= MIN_TEXT ? '' : T.errText.replace('{n}', MIN_TEXT),
      agree: agree ? '' : T.errAgree,
    };
  }

  function fillDirections() {
    var select = field('direction');
    var first = document.createElement('option');
    first.value = '';
    first.textContent = T.directionPlaceholder;
    select.replaceChildren(first);

    window.HISTORY_DATA.branches.forEach(function (b) {
      var o = document.createElement('option');
      o.value = b.title;
      o.textContent = b.title;
      select.appendChild(o);
    });
  }

  function renderErrors() {
    var err = shown ? validate(values()) : {};
    var count = 0;

    root.querySelectorAll('[data-err]').forEach(function (el) {
      var msg = err[el.dataset.err] || '';
      el.textContent = msg;
      if (msg) count++;
    });
    ['name', 'year', 'direction', 'text'].forEach(function (k) {
      field(k).classList.toggle('is-invalid', !!err[k]);
    });
    root.querySelector('#rform-agree').classList.toggle('is-invalid', !!err.agree);

    var summary = root.querySelector('#rform-summary');
    summary.hidden = count === 0;
    root.querySelector('#rform-summary-text').textContent =
      T.errSummary + ' ' + count + ' ' + Screens.plural(count, T.errFieldForms) + ' ' + T.errWrong;
  }

  function renderCount() {
    root.querySelector('#rform-count').textContent = field('text').value.length + ' / 1000';
  }

  function renderSelect() {
    field('direction').classList.toggle('is-empty', !field('direction').value);
  }

  function setAgree(on) {
    agree = on;
    var btn = root.querySelector('#rform-agree');
    btn.setAttribute('aria-checked', String(on));
    btn.classList.toggle('is-on', on);
    if (shown) renderErrors();
  }

  /* Фото: только предпросмотр в браузере. Ссылку на файл освобождаем, когда фото убирают. */

  function setPhoto(file) {
    clearPhoto();
    if (!file || !/^image\//.test(file.type)) return;
    photo = { file: file, url: URL.createObjectURL(file) };
    root.querySelector('#rform-thumb').src = photo.url;
    root.querySelector('#rform-filename').textContent = file.name;
    root.querySelector('#rform-drop').hidden = true;
    root.querySelector('#rform-attached').hidden = false;
  }

  function clearPhoto() {
    if (photo) URL.revokeObjectURL(photo.url);
    photo = null;
    if (!root) return;
    root.querySelector('#rform-file').value = '';
    root.querySelector('#rform-thumb').removeAttribute('src');
    root.querySelector('#rform-drop').hidden = false;
    root.querySelector('#rform-attached').hidden = true;
  }

  /* Состояния */

  function reset() {
    form.reset();
    shown = false;
    setAgree(false);
    clearPhoto();
    renderSelect();
    renderCount();
    renderErrors();
    form.hidden = false;
    root.querySelector('#rform-thanks').hidden = true;
  }

  function onSubmit(e) {
    e.preventDefault();
    var v = values();
    var err = validate(v);
    var bad = Object.keys(err).some(function (k) { return err[k]; });

    if (bad) {
      shown = true;
      renderErrors();
      if (hooks.invalid) hooks.invalid();
      return;
    }

    v.date = new Date().toISOString().slice(0, 10);
    v.photo = photo ? photo.file : null;
    submitReview(v).then(function () {
      clearPhoto();
      form.hidden = true;
      root.querySelector('#rform-thanks').hidden = false;
      if (hooks.sent) hooks.sent();
    });
  }

  function onInput(e) {
    var t = e.target;
    if (t === field('year')) t.value = t.value.replace(/\D/g, '').slice(0, 4);
    if (t === field('text')) renderCount();
    if (t === field('direction')) renderSelect();
    if (shown) renderErrors();
  }

  function onClick(e) {
    var el = e.target;
    if (el.closest('#rform-agree')) { setAgree(!agree); return; }
    if (el.closest('#rform-clear')) { clearPhoto(); return; }
    if (el.closest('#rform-again')) reset();
  }

  function bindDrop() {
    var drop = root.querySelector('#rform-drop');
    drop.addEventListener('dragover', function (e) {
      e.preventDefault();
      drop.classList.add('is-over');
    });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('is-over');
      setPhoto(e.dataTransfer.files[0]);
    });
    root.querySelector('#rform-file').addEventListener('change', function (e) {
      setPhoto(e.target.files[0]);
    });
  }

  function init(el, h) {
    clearPhoto();
    root = el;
    form = root.querySelector('#rform-card');
    hooks = h || {};
    fillDirections();
    form.addEventListener('submit', onSubmit);
    form.addEventListener('input', onInput);
    form.addEventListener('change', onInput);
    root.addEventListener('click', onClick);
    bindDrop();
    reset();
  }

  /* Escape возвращает к ленте отзывов. */
  function key(e) {
    if (e.key !== 'Escape') return false;
    if (hooks.back) hooks.back();
    return true;
  }

  return { init: init, key: key };
})();
