(function () {
  'use strict';

  var CONFIG = window.CONFIG;
  var S = window.Screens;

  var sound = false;
  var audio = null;
  var branchSnap = null;   /* раздел открыт из фокуса ветки: куда вернуться, иначе null */

  /* Отдельных звуковых файлов нет — короткий писк синтезируется осциллятором. */
  function blip(freq = 660, dur = 0.06, type = 'sine', vol = 0.06) {
    if (!sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator();
      var g = audio.createGain();
      var t = audio.currentTime;

      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);

      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.06);
    } catch (e) {
      /* Браузер может не дать создать AudioContext без жеста пользователя. */
    }
  }

  function show(name, mode) {
    S.show(name, mode);
    S.setSound(sound);
    /* Класс показывает кнопку «К ветке» в шапках раздела, включая вложенные экраны. */
    document.getElementById('screen-slot').classList.toggle('from-branch', !!branchSnap);
  }

  function goMenu() {
    blip(440);
    branchSnap = null;
    show('menu');
  }

  function backToBranch() {
    var snap = branchSnap;
    blip(440);
    branchSnap = null;
    SECTIONS.history(snap);
  }

  /* Разделы, у которых уже есть свой экран; остальные пока ведут на заглушку «Скоро». */
  var SECTIONS = {
    gallery: function (startYear) {
      show('gallery');
      window.Gallery.init(document.querySelector('.gallery'), {
        flip: function () { blip(520, 0.12, 'triangle', 0.04); },
        open: function () { blip(880, 0.08); },
        close: function () { blip(440); },
        step: function () { blip(660, 0.05); },
      }, startYear);
    },
    history: function (snap) {
      show('history');
      window.HistoryTree.init(document.getElementById('history'), {
        pick: function () { blip(700, 0.05); },
        open: function () { blip(880, 0.08); },
        close: function () { blip(440); },
        step: function () { blip(660, 0.05); },
        link: function (section, value, from) {
          blip(880, 0.1);
          branchSnap = from;
          branchSnap.value = value;
          SECTIONS[section](value);
        },
      }, snap);
    },
    museum: function (startHall) {
      show('museum');
      window.Museum.init(document.getElementById('museum'), {
        pick: function () { blip(700, 0.05); },
        open: function () { blip(880, 0.08); },
        close: function () { blip(440); },
        step: function () { blip(660, 0.05); },
      }, startHall);
    },
    reviews: function () {
      show('reviews');
      window.Reviews.init(document.getElementById('reviews'), {
        pick: function () { blip(700, 0.05); },
        more: function () { blip(660, 0.05); },
        write: function () { blip(880, 0.08); SECTIONS['review-form'](); },
      }, branchSnap ? branchSnap.value : null);   /* и после формы отзыва фильтр ветки остаётся */
    },
    'review-form': function () {
      show('review-form');
      window.ReviewForm.init(document.getElementById('review-form'), {
        back: function () { blip(440); SECTIONS.reviews(); },
        invalid: function () { blip(300, 0.12, 'triangle', 0.05); },
        sent: function () { blip(990, 0.15); },
      });
    },
  };

  function openMode(mode) {
    blip(880, 0.1);
    if (SECTIONS[mode]) SECTIONS[mode]();
    else show('stub', mode);
  }

  function toggleSound() {
    sound = !sound;
    S.setSound(sound);
    /* Писк слышен только при включении: при выключении sound уже false. */
    blip(760, 0.08);
  }

  function openAbout() {
    blip(700);
    S.openAbout();
  }

  function closeAbout() {
    blip(440);
    S.closeAbout();
  }

  function hover() {
    blip(620, 0.04, 'sine', 0.03);
  }

  /* Делегирование: экраны монтируются и удаляются, вешать обработчики на сами кнопки нельзя. */
  document.addEventListener('click', function (e) {
    var el = e.target;

    var mode = el.closest('.mode');
    if (mode) { openMode(mode.dataset.mode); return; }

    if (el.closest('#btn-back, [data-go="menu"]')) { goMenu(); return; }
    if (el.closest('[data-go="branch"]')) { backToBranch(); return; }
    if (el.closest('[data-go="reviews"]')) { blip(440); SECTIONS.reviews(); return; }
    if (el.closest('#btn-about')) { openAbout(); return; }
    if (el.closest('#btn-sound')) { toggleSound(); return; }
    if (el.closest('#btn-about-ok')) { closeAbout(); return; }

    if (el.closest('#about-overlay') && !el.closest('#about-dialog')) {
      closeAbout();
    }
  });

  /* mouseover, в отличие от mouseenter, всплывает; отсеиваем перемещения внутри кнопки. */
  var HOVER_SELECTOR = '.mode, #btn-back, #btn-about, #btn-about-ok, .chip, .round, .viewer__all, .pair__btn, .btn-write, .feed__more-btn, .rform__submit, .thanks__primary, .thanks__again, .tree-stage, .tree-label, .tree-card__row, .tree-focus__nav, .tree-detail__thumb, .tree-link, .tree-today__link, .tree-event.is-linked, .tree-menu__item';
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest(HOVER_SELECTOR);
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    hover();
  });

  window.addEventListener('resize', function () {
    S.applyLayout();
  });

  window.addEventListener('pointermove', function (e) {
    var nx = e.clientX / window.innerWidth - 0.5;
    var ny = e.clientY / window.innerHeight - 0.5;
    S.parallax(nx, ny);
  });

  window.addEventListener('keydown', function (e) {
    var screen = S.currentScreen();
    if (screen === 'gallery' && window.Gallery.key(e)) return;
    if (screen === 'history' && window.HistoryTree.key(e)) return;
    if (screen === 'museum' && window.Museum.key(e)) return;
    if (screen === 'review-form' && window.ReviewForm.key(e)) return;

    if (e.key !== 'Escape') return;
    if (S.isAboutOpen()) closeAbout();
    else if (branchSnap) backToBranch();
    else if (screen !== 'menu' && screen !== 'loading') goMenu();
  });

  function preload() {
    Object.keys(CONFIG.images).forEach(function (key) {
      var img = new Image();
      img.src = CONFIG.images[key];
    });
  }

  function startLoader() {
    var t0 = performance.now();

    function tick(t) {
      var p = Math.min(1, (t - t0) / CONFIG.loaderMs);
      /* Замедление к концу — кривая из исходной версии. */
      S.setProgress(1 - Math.pow(1 - p, 2.2));

      if (p < 1) requestAnimationFrame(tick);
      else setTimeout(function () { show('menu'); }, 250);
    }

    requestAnimationFrame(tick);
  }

  S.checkDirections();
  S.applyLayout();
  S.buildBackground();
  show('loading');
  S.setProgress(0);
  preload();
  startLoader();
})();
