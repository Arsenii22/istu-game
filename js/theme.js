/* Тема оформления: светлая или тёмная. Подключается в <head>, до отрисовки страницы,
   поэтому тёмная тема не мигает светлой при загрузке.

   По умолчанию тема как в системе (prefers-color-scheme) и меняется вместе с ней.
   Кнопка рядом со звуком выбирает тему явно; выбор запоминается в браузере
   (localStorage, ключ pp-theme). Цвета обеих тем — в css/variables.css. */

window.Theme = (function () {
  'use strict';

  var KEY = 'pp-theme';
  var system = window.matchMedia('(prefers-color-scheme: dark)');
  var saved = null;
  var listeners = [];

  /* В приватном окне или с запретом сайтам хранить данные localStorage бросает исключение:
     тогда тема просто не запоминается. */
  try { saved = window.localStorage.getItem(KEY); } catch (e) { saved = null; }
  if (saved !== 'dark' && saved !== 'light') saved = null;

  function current() {
    return saved || (system.matches ? 'dark' : 'light');
  }

  function apply() {
    var theme = current();
    var root = document.documentElement;
    root.dataset.theme = theme;
    /* Цвет панели браузера на телефоне — как фон сцены. */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var bg = getComputedStyle(root).getPropertyValue('--c-bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }
    listeners.forEach(function (fn) { fn(theme); });
  }

  function toggle() {
    saved = current() === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(KEY, saved); } catch (e) { /* не запомним — не беда */ }
    apply();
    return saved;
  }

  system.addEventListener('change', function () {
    if (!saved) apply();
  });

  apply();

  return {
    current: current,
    toggle: toggle,
    onChange: function (fn) { listeners.push(fn); },
  };
})();
