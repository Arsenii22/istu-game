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
    S.setTheme(window.Theme.current());
    markBranch();
  }

  /* Класс показывает кнопку «К ветке» в шапках раздела, включая вложенные экраны. */
  function markBranch() {
    document.getElementById('screen-slot').classList.toggle('from-branch', !!branchSnap);
  }

  /* Разделы, у которых уже есть свой экран; остальные пока ведут на заглушку «Скоро».
     Здесь только отрисовка: адрес и историю браузера ведут go, sync и apply ниже. */
  var SECTIONS = {
    gallery: function (startYear) {
      show('gallery');
      window.Gallery.init(document.querySelector('.gallery'), {
        flip: function () { blip(520, 0.12, 'triangle', 0.04); },
        open: function () { blip(880, 0.08); },
        close: function () { blip(440); },
        step: function () { blip(660, 0.05); },
        nav: sync,
      }, startYear);
    },
    history: function (snap) {
      show('history');
      window.HistoryTree.init(document.getElementById('history'), {
        pick: function () { blip(700, 0.05); },
        open: function () { blip(880, 0.08); },
        close: function () { blip(440); },
        step: function () { blip(660, 0.05); },
        nav: sync,
        link: followLink,
      }, snap);
    },
    museum: function (startHall) {
      show('museum');
      window.Museum.init(document.getElementById('museum'), {
        pick: function () { blip(700, 0.05); },
        open: function () { blip(880, 0.08); },
        close: function () { blip(440); },
        step: function () { blip(660, 0.05); },
        nav: sync,
      }, clampHall(startHall));
    },
    reviews: function (filter) {
      show('reviews');
      window.Reviews.init(document.getElementById('reviews'), {
        pick: function () { blip(700, 0.05); },
        more: function () { blip(660, 0.05); },
        write: function () { blip(880, 0.08); go(function () { SECTIONS['review-form'](); }); },
        nav: sync,
      }, filter);
    },
    'review-form': function () {
      show('review-form');
      window.ReviewForm.init(document.getElementById('review-form'), {
        back: toReviews,
        invalid: function () { blip(300, 0.12, 'triangle', 0.05); },
        sent: function () { blip(990, 0.15); },
      });
    },
  };

  function clampHall(i) {
    return Math.max(0, Math.min(window.MUSEUM_DATA.length - 1, i || 0));
  }

  function branchByType(type) {
    return window.HISTORY_DATA.branches.find(function (b) { return b.type === type; }) || null;
  }

  function branchByTitle(title) {
    return window.HISTORY_DATA.branches.find(function (b) { return b.title === title; }) || null;
  }

  /* Адреса экранов.

     У каждого экрана свой адрес после «#»: gallery/1985, gallery/1985/photo/3, history,
     history/it, museum/2, museum/2/exhibit/4, reviews, reviews/it, review-form, game;
     пусто — меню. Номера фото, залов и экспонатов — с 1, как на экране.

     Переходы записываются в историю браузера (pushState), поэтому «Назад» и «Вперёд»
     браузера и системная «Назад» телефона ходят по экранам. Фото крупно, нижние панели
     и «Об игре» своего адреса не имеют, но тоже получают шаг истории (state.layer) —
     «Назад» сначала закрывает их. В state шага ещё лежат parent — адрес предыдущего
     шага, from — снимок ветки, из которой открыт раздел (кнопка «К ветке»), и snap —
     где была ветка, когда из неё ушли по ссылке (возврат на то же место). */

  var cur = null;       /* адрес, который сейчас на экране; null — идёт загрузка */
  var popping = false;  /* ждём popstate после своего history.back() */
  var queue = [];       /* переходы, которые ждут этого popstate */
  var reviewsRoute = 'reviews';   /* куда вернуться из формы отзыва: лента с тем же фильтром */

  /* Адрес по тому, что сейчас на экране. */
  function routeNow() {
    switch (S.currentScreen()) {
      case 'menu': return '';
      case 'stub': return 'game';
      case 'gallery': {
        var g = window.Gallery.state();
        if (g.year === null) return 'gallery';
        return 'gallery/' + g.year + (g.photo === null ? '' : '/photo/' + (g.photo + 1));
      }
      case 'history': {
        var t = window.HistoryTree.state();
        return 'history' + (t ? '/' + t : '');
      }
      case 'museum': {
        var m = window.Museum.state();
        return 'museum/' + (m.hall + 1) + (m.exhibit === null ? '' : '/exhibit/' + (m.exhibit + 1));
      }
      case 'reviews': {
        var b = branchByTitle(window.Reviews.state());
        return 'reviews' + (b ? '/' + b.type : '');
      }
      case 'review-form': return 'review-form';
      default: return null;
    }
  }

  function hashRoute() {
    var h = location.hash.replace(/^#\/?/, '').replace(/\/+$/, '');
    try { return decodeURIComponent(h); } catch (e) { return h; }
  }

  function href(route) {
    return route ? '#' + route : location.href.split('#')[0];
  }

  function entry() { return history.state || {}; }

  function setCur(route) {
    cur = route;
    if (route && route.indexOf('reviews') === 0) reviewsRoute = route;
  }

  function back() {
    popping = true;
    history.back();
  }

  /* Переход, пока ждём свой popstate, откладываем до него: иначе pushState попадёт
     в историю раньше, чем браузер вернётся на шаг назад. */
  function after(fn) {
    if (popping) queue.push(fn);
    else fn();
  }

  /* Открытые слои без адреса: фото крупно и нижние панели дерева, «Об игре». */
  function layerOpen() {
    return S.isAboutOpen() || (S.currentScreen() === 'history' && window.HistoryTree.hasLayer());
  }

  function closeLayers() {
    if (S.isAboutOpen()) S.closeAbout();
    if (S.currentScreen() === 'history') window.HistoryTree.closeLayer();
  }

  /* Экран уже изменился — записать это в адрес и историю браузера.
     kind: 'push' — новый шаг; 'replace' — тот же шаг (листание альбома, фильтр);
     'close' — вернулись туда, откуда пришли: если предыдущий шаг истории и есть это
     место, просто шагаем назад, чтобы «Вперёд» не множил шаги, а «Назад» не открывал
     закрытое снова; 'layer' / 'unlayer' — открыли или закрыли слой без адреса. */
  function sync(kind) {
    if (popping) { queue.push(function () { sync(kind); }); return; }
    var route = routeNow();
    if (route === null) return;
    var st = entry();

    if (kind === 'layer') {
      if (!st.layer) history.pushState({ layer: true, parent: route, from: branchSnap }, '', href(route));
      setCur(route);
      return;
    }
    if (kind === 'unlayer') {
      if (st.layer && !layerOpen()) back();
      return;
    }
    if (route === cur) return;
    if (kind === 'close' && st.parent === route && !st.layer) {
      setCur(route);
      back();
      return;
    }
    if (kind === 'replace') history.replaceState(Object.assign({}, st, { from: branchSnap }), '', href(route));
    else history.pushState({ parent: cur, from: branchSnap }, '', href(route));
    setCur(route);
  }

  /* Переход по действию пользователя: отрисовать и записать в историю. */
  function go(render, kind) {
    after(function () {
      render();
      sync(kind || 'push');
    });
  }

  /* Открыть экран по адресу: ссылка, «Назад» / «Вперёд» браузера, начало работы.
     Если экран уже открыт, меняется только его состояние, без перерисовки: «Назад»
     закрывает фото или фокус ветки так же, как кнопка на экране. force — открыть
     экран заново (окно перешло через границу мобильного режима). */
  function apply(route, st, force) {
    st = st || {};
    var p = route.split('/');
    var screen = S.currentScreen();
    var keep = function (name) { return !force && screen === name; };
    var num = function (i) { return /^\d+$/.test(p[i] || '') ? Number(p[i]) : null; };

    branchSnap = st.from || null;
    if (S.isAboutOpen()) S.closeAbout();

    switch (p[0]) {
      case 'gallery': {
        var year = num(1);
        var photo = p[2] === 'photo' && num(3) ? num(3) - 1 : null;
        if (!keep('gallery')) SECTIONS.gallery(year);
        window.Gallery.set(year, photo);
        break;
      }
      case 'history': {
        var b = branchByType(p[1]);
        if (keep('history')) { window.HistoryTree.set(b ? b.type : null); break; }
        var snap = null;
        if (b) {
          var index = window.HISTORY_DATA.branches.indexOf(b);
          /* Вернулись на шаг, с которого ушли по ссылке, — на то же место; иначе фокус открыт сразу. */
          snap = st.snap && st.snap.focus === index ? st.snap : { focus: index, origin: ['800', '450'], body: 0, tree: 0 };
        }
        SECTIONS.history(snap);
        break;
      }
      case 'museum': {
        var hall = num(1) ? clampHall(num(1) - 1) : 0;
        var ex = p[2] === 'exhibit' && num(3) ? num(3) - 1 : null;
        if (!keep('museum')) SECTIONS.museum(hall);
        window.Museum.set(hall, ex);
        break;
      }
      case 'reviews': {
        var rb = branchByType(p[1]);
        if (keep('reviews')) window.Reviews.set(rb ? rb.title : null);
        else SECTIONS.reviews(rb ? rb.title : null);
        break;
      }
      case 'review-form':
        if (!keep('review-form')) SECTIONS['review-form']();
        break;
      case 'game':
        if (!keep('stub')) show('stub', 'games');
        break;
      default:
        if (!keep('menu')) show('menu');
    }
    markBranch();

    /* Неполный или неверный адрес (#gallery, #museum/99) заменяем тем, что открылось. */
    var canon = routeNow();
    if (canon !== route) history.replaceState(st, '', href(canon));
    setCur(canon);
  }

  function onPop() {
    var route = hashRoute();
    if (popping) {
      popping = false;
      setCur(route);
      /* Свой шаг назад: экран уже показывает нужное, остаётся выполнить отложенное. */
      if (queue.length) {
        while (queue.length && !popping) queue.shift()();
        return;
      }
      if (route === routeNow()) return;
    }
    loaded = true;
    closeLayers();
    apply(route, entry());
  }

  window.addEventListener('popstate', onPop);
  /* Адрес поправили руками: браузер пришлёт popstate, но на всякий случай — и hashchange. */
  window.addEventListener('hashchange', function () {
    if (!popping && hashRoute() !== cur) onPop();
  });

  /* Действия пользователя */

  function goMenu() {
    blip(440);
    go(function () { branchSnap = null; show('menu'); }, 'close');
  }

  function backToBranch() {
    var snap = branchSnap;
    blip(440);
    go(function () { branchSnap = null; SECTIONS.history(snap); }, 'close');
  }

  /* Переход из фокуса ветки в другой раздел. Где была ветка, запоминаем в текущем шаге
     истории (snap) — «Назад» вернёт туда же — и в новом шаге (from) — для «К ветке». */
  function followLink(section, value, from) {
    blip(880, 0.1);
    after(function () {
      history.replaceState(Object.assign({}, entry(), { snap: from }), '', location.href);
      branchSnap = from;
      SECTIONS[section](value);
      sync('push');
    });
  }

  /* Из формы отзыва — к ленте с тем же фильтром, что был. */
  function toReviews() {
    blip(440);
    var b = branchByType(reviewsRoute.split('/')[1]);
    go(function () { SECTIONS.reviews(b ? b.title : null); }, 'close');
  }

  function openMode(mode) {
    blip(880, 0.1);
    go(function () {
      branchSnap = null;
      if (SECTIONS[mode]) SECTIONS[mode]();
      else show('stub', mode);
    });
  }

  function toggleSound() {
    sound = !sound;
    S.setSound(sound);
    /* Писк слышен только при включении: при выключении sound уже false. */
    blip(760, 0.08);
  }

  function toggleTheme() {
    blip(700, 0.06);
    window.Theme.toggle();
  }

  /* Тему меняют и кнопкой, и система (если тема не выбрана явно). */
  window.Theme.onChange(function (theme) { S.setTheme(theme); });

  function openAbout() {
    blip(700);
    after(function () {
      S.openAbout();
      sync('layer');
    });
  }

  function closeAbout() {
    blip(440);
    S.closeAbout();
    sync('unlayer');
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
    if (el.closest('[data-go="reviews"]')) { toReviews(); return; }
    if (el.closest('#btn-about')) { openAbout(); return; }
    if (el.closest('#btn-sound')) { toggleSound(); return; }
    if (el.closest('#btn-theme')) { toggleTheme(); return; }
    if (el.closest('#btn-about-ok')) { closeAbout(); return; }

    if (el.closest('#about-overlay') && !el.closest('#about-dialog')) {
      closeAbout();
    }
  });

  /* mouseover, в отличие от mouseenter, всплывает; отсеиваем перемещения внутри кнопки. */
  var HOVER_SELECTOR = '.mode, #btn-back, #btn-about, #btn-theme, #btn-about-ok, .chip, .round, .viewer__all, .pair__btn, .btn-write, .feed__more-btn, .rform__submit, .thanks__primary, .thanks__again, .tree-stage, .tree-label, .tree-card__row, .tree-focus__nav, .tree-detail__thumb, .tree-link, .tree-today__link, .tree-event.is-linked, .tree-menu__item';
  document.addEventListener('mouseover', function (e) {
    /* На телефоне mouseover приходит вместе с касанием — второй писк был бы лишним. */
    if (S.isMobile()) return;
    var el = e.target.closest(HOVER_SELECTOR);
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    hover();
  });

  window.addEventListener('resize', function () {
    S.applyLayout();
  });

  /* Окно перешло через границу 760 px (поворот телефона, изменение размера): разделы
     раскладываются по-разному, поэтому текущий экран открываем заново по его адресу. */
  S.onModeChange(function () {
    var screen = S.currentScreen();
    S.applyLayout();
    if (screen === 'loading' || cur === null) return;
    var st = Object.assign({}, entry());
    var snap = screen === 'history' ? window.HistoryTree.snapshot() : null;
    if (snap) st.snap = snap;
    closeLayers();
    apply(cur, st, true);
    if (entry().layer) sync('unlayer');
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

  var loaded = false;   /* экран загрузки закончился или его пропустили */

  function startLoader() {
    var t0 = performance.now();

    function tick(t) {
      if (loaded) return;
      var p = Math.min(1, (t - t0) / CONFIG.loaderMs);
      /* Замедление к концу — кривая из исходной версии. */
      S.setProgress(1 - Math.pow(1 - p, 2.2));

      if (p < 1) requestAnimationFrame(tick);
      else setTimeout(function () {
        if (loaded) return;
        loaded = true;
        show('menu');
        setCur('');
      }, 250);
    }

    requestAnimationFrame(tick);
  }

  S.checkDirections();
  S.applyLayout();
  S.buildBackground();
  preload();

  /* Экран загрузки — только когда сайт открывают с начала. Ссылка на экран (#museum/2)
     открывает его сразу, без загрузки. */
  var start = hashRoute();
  if (start) {
    loaded = true;
    apply(start, entry());
  } else {
    show('loading');
    S.setProgress(0);
    startLoader();
  }
})();
