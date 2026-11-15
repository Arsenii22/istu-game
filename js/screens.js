window.Screens = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var current = null;
  var layer1 = null;
  var layer2 = null;

  function fill(root) {
    var T = window.CONFIG.texts;
    var IMG = window.CONFIG.images;

    root.querySelectorAll('[data-text]').forEach(function (el) {
      el.textContent = T[el.dataset.text];
    });

    root.querySelectorAll('[data-img]').forEach(function (el) {
      el.src = IMG[el.dataset.img];
      el.alt = T[el.dataset.alt];
    });

    root.querySelectorAll('[data-placeholder]').forEach(function (el) {
      el.placeholder = T[el.dataset.placeholder];
    });

    /* Подсказка для кнопок без текста: её читает скринридер и показывает браузер при наведении. */
    root.querySelectorAll('[data-alt-text]').forEach(function (el) {
      el.title = T[el.dataset.altText];
      el.setAttribute('aria-label', T[el.dataset.altText]);
    });
  }

  /* Фото из данных. Сборка кладёт рядом с основным фото (до 1600 px) превью (до 400 px), а их
     размеры пишет в js/data/photos.js. kind: 'thumb' — превью (альбом, миниатюры, списки),
     'full' — основное (фото крупно). Размеры ставятся в width/height, чтобы место под
     картинку было занято до загрузки; --ar — соотношение сторон для стилей. Фото, которого
     нет в js/data/photos.js (путь вписан руками), показывается как есть. */
  function setPhoto(img, src, kind) {
    var info = (window.PHOTOS_DATA || {})[src];
    var thumb = info && kind === 'thumb' && info.thumb && info.tw;
    img.loading = 'lazy';
    img.decoding = 'async';
    if (info) {
      img.width = thumb ? info.tw : info.w;
      img.height = thumb ? info.th : info.h;
      img.style.setProperty('--ar', String(info.w / info.h));
    } else {
      img.removeAttribute('width');
      img.removeAttribute('height');
      img.style.removeProperty('--ar');
    }
    img.src = thumb ? info.thumb : src;
    return img;
  }

  function photo(src, kind, className, alt) {
    var img = document.createElement('img');
    img.className = className;
    img.alt = alt;
    return setPhoto(img, src, kind);
  }

  /* Форма слова после числа: forms — ['фотография', 'фотографии', 'фотографий']. */
  function plural(n, forms) {
    var a = n % 100;
    var b = n % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b === 1) return forms[0];
    if (b > 1 && b < 5) return forms[1];
    return forms[2];
  }

  /* Направление в галерее и отзывах должно дословно совпадать с title в js/data/history.js.
     Опечатка не ломает игру, поэтому только предупреждаем в консоли. */
  function checkDirections() {
    var known = window.HISTORY_DATA.branches.map(function (b) { return b.title; });

    function check(name, place) {
      if (known.indexOf(name) >= 0) return;
      console.warn('Направления нет в js/data/history.js: «' + name + '» (' + place + ')');
    }

    window.GALLERY_DATA.forEach(function (y) {
      y.photos.forEach(function (p, i) {
        check(p.direction, 'js/data/gallery.js, ' + y.year + ', фото ' + (i + 1));
      });
    });
    window.REVIEWS_DATA.forEach(function (r, i) {
      check(r.direction, 'js/data/reviews.js, отзыв ' + (i + 1));
    });
  }

  function clone(tplId) {
    var frag = document.getElementById(tplId).content.cloneNode(true);
    fill(frag);
    return frag;
  }

  /* Мобильный режим: окно уже 760 px. Граница та же, что у @media в CSS. */
  var MOBILE = window.matchMedia('(max-width: 759.98px)');
  function isMobile() { return MOBILE.matches; }

  /* Эти экраны свёрстаны только под альбомную сцену; в портретном окне она просто уменьшается. */
  var LANDSCAPE_ONLY = ['gallery', 'history', 'museum', 'reviews', 'review-form'];

  /* Кнопки «Об игре» и «Звук» есть только на этих экранах; на остальных угол занят шапкой. */
  var WITH_CORNER = ['menu', 'stub'];

  function applyLayout() {
    /* В мобильном режиме сцена не масштабируется: размеры задаёт CSS, а не эти переменные. */
    if (isMobile()) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var portrait = vw / vh < 0.85 && LANDSCAPE_ONLY.indexOf(current) < 0;

    var W = portrait ? 900 : 1600;
    var H = portrait ? 1600 : 900;
    /* На совсем маленьких окнах поля вокруг сцены не оставляем. */
    var scale = Math.min(vw / W, vh / H) * (vw < 700 || vh < 500 ? 1 : 0.96);

    var s = document.documentElement.style;
    s.setProperty('--stage-w', W + 'px');
    s.setProperty('--stage-h', H + 'px');
    s.setProperty('--stage-scale', String(scale));
    s.setProperty('--menu-dir', portrait ? 'column' : 'row');
    s.setProperty('--brand-align', portrait ? 'center' : 'flex-start');
    s.setProperty('--mode-w', portrait ? '760px' : '700px');
    s.setProperty('--mark-h', portrait ? '200px' : '150px');
    s.setProperty('--menu-gap', portrait ? '64px' : '60px');
    s.setProperty('--foot-w', portrait ? '600px' : '340px');
  }

  /* Зерно 11 и порядок вызовов rnd взяты из исходной версии — фон всегда получается одинаковым. */
  function buildBackground() {
    var bg = document.getElementById('bg');

    var seed = 11;
    var rnd = function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    var colText = function () {
      return Array.from({ length: 40 }, function () {
        return Array.from({ length: 1 + Math.floor(rnd() * 3) }, function () {
          return rnd() > 0.5 ? '1' : '0';
        }).join('');
      }).join('\n');
    };

    var code = document.createElement('div');
    code.className = 'bg__code';

    [3, 9, 16, 84, 91, 97].forEach(function (x) {
      var txt = colText();
      var dur = 60 + rnd() * 50;
      var delay = -rnd() * dur;

      var col = document.createElement('div');
      col.className = 'bg__col';
      col.style.left = x + '%';
      col.style.animation = 'pp-code ' + dur + 's linear ' + delay + 's infinite';
      col.textContent = txt + '\n' + txt;
      code.appendChild(col);
    });

    function trace(svg, d, k) {
      var base = document.createElementNS(SVG_NS, 'path');
      base.setAttribute('d', d);
      base.setAttribute('class', 'bg__trace');
      svg.appendChild(base);

      var pulse = document.createElementNS(SVG_NS, 'path');
      pulse.setAttribute('d', d);
      pulse.setAttribute('class', 'bg__trace-pulse');
      pulse.style.animation =
        'pp-trace ' + (9 + k * 2) + 's linear ' + (-k * 3) + 's infinite';
      svg.appendChild(pulse);
    }

    function node(svg, x, y) {
      var c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', x);
      c.setAttribute('cy', y);
      c.setAttribute('r', '4');
      c.setAttribute('class', 'bg__node');
      svg.appendChild(c);
    }

    function circuit(modifier, parts) {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', '560');
      svg.setAttribute('height', '380');
      svg.setAttribute('viewBox', '0 0 560 380');
      svg.setAttribute('class', 'bg__circuit bg__circuit--' + modifier);
      parts.forEach(function (p) {
        trace(svg, p.d, p.k);
        node(svg, p.x, p.y);
      });
      return svg;
    }

    var circuitTL = circuit('tl', [
      { d: 'M0 90 H180 L230 140 H420', k: 0, x: 420, y: 140 },
      { d: 'M0 150 H120 L200 230 H300 L340 270', k: 1, x: 340, y: 270 },
      { d: 'M120 0 V50 L160 90', k: 2, x: 160, y: 90 },
    ]);

    var circuitBR = circuit('br', [
      { d: 'M560 290 H380 L330 240 H140', k: 3, x: 140, y: 240 },
      { d: 'M560 230 H440 L360 150 H260 L220 110', k: 4, x: 220, y: 110 },
      { d: 'M440 380 V330 L400 290', k: 5, x: 400, y: 290 },
    ]);

    layer1 = document.createElement('div');
    layer1.className = 'bg__layer';
    var gridSm = document.createElement('div');
    gridSm.className = 'bg__grid bg__grid--sm';
    var gridLg = document.createElement('div');
    gridLg.className = 'bg__grid bg__grid--lg';
    layer1.append(gridSm, gridLg, code);

    layer2 = document.createElement('div');
    layer2.className = 'bg__layer';
    layer2.append(circuitTL, circuitBR);

    var vignette = document.createElement('div');
    vignette.className = 'bg__vignette';

    bg.append(layer1, layer2, vignette);
  }

  function parallax(nx, ny) {
    if (isMobile()) return;
    layer1.style.transform = 'translate(' + nx * -14 + 'px, ' + ny * -10 + 'px)';
    layer2.style.transform = 'translate(' + nx * -30 + 'px, ' + ny * -20 + 'px)';
  }

  function mount(slotId, tplId) {
    var slot = document.getElementById(slotId);
    slot.replaceChildren();
    if (!tplId) return;
    slot.appendChild(clone(tplId));
  }

  /* Переход между разделами.

     Компьютер — «плата»: новый экран сразу на месте и сразу принимает клики, а старый
     на FX_MS лежит поверх него в слое .fx и стирается шторкой; вдоль края шторки по
     экрану пробегают дорожки с импульсами. Вглубь (из меню в раздел) шторка идёт слева
     направо, назад в меню — справа налево. Телефон — облегчённый вариант: новый экран
     проявляется. При prefers-reduced-motion перехода нет. Всё на Web Animations API,
     цвета — из переменных темы, поэтому работает в обеих темах. */

  var FX_MS = 460;
  var FX_EASE = 'cubic-bezier(.65,0,.35,1)';
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fx = null;   /* идущий переход: { el, anims } */

  /* Дорожки перехода: горизонтальные линии с изломами под 45°, как на плате. */
  var FX_TRACES = [
    { y: 92, j: [[260, -1], [980, 1]] },
    { y: 196, j: [[520, 1], [1240, -1]] },
    { y: 300, j: [[180, 1], [760, -1], [1380, 1]] },
    { y: 418, j: [[420, -1], [1100, 1]] },
    { y: 520, j: [[300, 1], [900, 1], [1300, -1]] },
    { y: 636, j: [[640, -1], [1180, -1]] },
    { y: 742, j: [[220, -1], [820, 1]] },
    { y: 830, j: [[480, 1], [1420, -1]] },
  ];
  var FX_JOG = 34;   /* высота излома */

  function tracePath(t) {
    var y = t.y;
    var d = 'M-40 ' + y;
    t.j.forEach(function (p) {
      d += ' H' + p[0] + ' L' + (p[0] + FX_JOG) + ' ' + (y + p[1] * FX_JOG);
      y += p[1] * FX_JOG;
    });
    return d + ' H1640';
  }

  function endFx() {
    if (!fx) return;
    fx.anims.forEach(function (a) { a.cancel(); });
    fx.el.remove();
    fx = null;
  }

  /* old — узлы старого экрана (и угла с кнопками, если он исчезает); back — назад в меню. */
  function boardTransition(old, back) {
    var el = document.createElement('div');
    el.className = 'fx';
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');

    /* Старый экран — со своим фоном сцены, иначе сквозь него просвечивал бы новый. */
    var oldBox = document.createElement('div');
    oldBox.className = 'fx__old';
    if (document.getElementById('screen-slot').classList.contains('from-branch')) oldBox.classList.add('from-branch');
    var bg = document.getElementById('bg').cloneNode(true);
    bg.removeAttribute('id');
    oldBox.appendChild(bg);
    old.forEach(function (n) { oldBox.appendChild(n); });
    el.appendChild(oldBox);

    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'fx__traces');
    svg.setAttribute('viewBox', '0 0 1600 900');
    svg.setAttribute('preserveAspectRatio', 'none');
    el.appendChild(svg);

    var front = document.createElement('div');
    front.className = 'fx__front';
    el.appendChild(front);

    /* Слой — сразу после слота экрана: getElementById по-прежнему находит новый экран первым. */
    document.getElementById('screen-slot').after(el);

    var anims = [];
    var timing = { duration: FX_MS, easing: FX_EASE, fill: 'forwards' };
    anims.push(oldBox.animate(
      back ? [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 100% 0 0)' }]
           : [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], timing));
    anims.push(front.animate(
      back ? [{ transform: 'translateX(1600px)', opacity: 1 }, { transform: 'translateX(0)', opacity: .2 }]
           : [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(1600px)', opacity: .2 }], timing));

    FX_TRACES.forEach(function (t, i) {
      var d = tracePath(t);
      var base = document.createElementNS(SVG_NS, 'path');
      base.setAttribute('d', d);
      base.setAttribute('class', 'fx__trace');
      var pulse = document.createElementNS(SVG_NS, 'path');
      pulse.setAttribute('d', d);
      pulse.setAttribute('class', 'fx__pulse' + (i % 3 === 1 ? ' fx__pulse--teal' : ''));
      svg.append(base, pulse);

      var len = pulse.getTotalLength();
      var seg = 220;
      pulse.style.strokeDasharray = seg + ' ' + (len + seg);
      /* Импульс бежит вместе со шторкой; дорожки чуть разнесены по времени. */
      var delay = (i * 37) % 70;
      var from = back ? -len : seg;
      var to = back ? seg : -len;
      anims.push(pulse.animate([{ strokeDashoffset: from }, { strokeDashoffset: to }],
        { duration: FX_MS - delay, delay: delay, easing: FX_EASE, fill: 'both' }));
      anims.push(base.animate([{ opacity: 0 }, { opacity: 1, offset: .35 }, { opacity: 0 }],
        { duration: FX_MS, easing: 'ease-out', fill: 'forwards' }));
    });

    fx = { el: el, anims: anims };
    var mine = fx;
    anims[0].finished.then(function () { if (fx === mine) endFx(); }, function () {});
  }

  /* Мобильный вариант: новый экран проявляется. Только прозрачность: сдвиг сломал бы
     position:fixed внутри экрана (плавающая кнопка «Оставить отзыв»). */
  function fadeIn() {
    var anims = [];
    Array.prototype.forEach.call(document.getElementById('screen-slot').children, function (n) {
      anims.push(n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }));
    });
    fx = { el: document.createElement('div'), anims: anims };
  }

  /* Экран каждый раз монтируется заново, поэтому анимация появления проигрывается при каждом входе. */
  function show(name, mode) {
    var prev = current;
    var animate = prev && prev !== name && !REDUCE.matches;
    endFx();

    /* Старый экран не удаляем, а переносим в слой перехода — до монтирования нового. */
    var old = [];
    if (animate && !isMobile()) {
      old = Array.prototype.slice.call(document.getElementById('screen-slot').childNodes);
      if (WITH_CORNER.indexOf(name) < 0) {
        old = old.concat(Array.prototype.slice.call(document.getElementById('corner-slot').childNodes));
      }
      old.forEach(function (n) { n.remove(); });
    }

    current = name;
    applyLayout();
    mount('screen-slot', 'tpl-' + name);
    /* В мобильном режиме прокручивается вся страница: новый экран открываем с начала. */
    if (isMobile()) window.scrollTo(0, 0);

    if (name === 'stub') {
      var T = window.CONFIG.texts;
      document.getElementById('stub-badge').textContent = T[mode + 'Title'];
      document.getElementById('stub-text').textContent = 'Здесь будет ' + T[mode + 'Soon'];
    }

    if (WITH_CORNER.indexOf(name) < 0) mount('corner-slot', null);
    else if (!document.getElementById('corner')) mount('corner-slot', 'tpl-corner');

    if (!animate) return;
    if (isMobile()) fadeIn();
    else if (old.length) boardTransition(old, name === 'menu');
  }

  /* Кнопка темы показывает, что она сделает: луна — включит тёмную, солнце — светлую. */
  function setTheme(theme) {
    var btn = document.getElementById('btn-theme');
    if (!btn) return;   /* кнопка есть только в меню и на заглушке */
    var label = theme === 'dark' ? window.CONFIG.texts.themeToLight : window.CONFIG.texts.themeToDark;
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  function setProgress(value) {
    var pct = Math.round(value * 100);
    document.documentElement.style.setProperty('--progress', pct + '%');
    document.getElementById('progress-label').textContent = String(pct).padStart(3, '0') + '%';
  }

  function setSound(on) {
    var corner = document.getElementById('corner');
    if (!corner) return;   /* на экране загрузки кнопок ещё нет */
    corner.dataset.sound = on ? 'on' : 'off';
    document.getElementById('btn-sound').setAttribute('aria-pressed', String(on));
    document.getElementById('sound-label').textContent =
      on ? window.CONFIG.texts.soundOn : window.CONFIG.texts.soundOff;
  }

  /* Свайп влево-вправо по элементу: fn(1) — к следующему, fn(-1) — к предыдущему.
     Вертикальную прокрутку страницы оставляем браузеру (touch-action: pan-y в CSS). */
  var SWIPE = 40;   /* минимальный сдвиг пальца, px */

  function swipe(el, fn) {
    var x0 = null;
    var y0 = 0;
    el.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary) return;
      x0 = e.clientX;
      y0 = e.clientY;
    });
    el.addEventListener('pointerup', function (e) {
      if (x0 === null) return;
      var dx = e.clientX - x0;
      var dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) fn(dx < 0 ? 1 : -1);
    });
    el.addEventListener('pointercancel', function () { x0 = null; });
  }

  /* Прокручивает горизонтальную ленту box так, чтобы item оказался посередине. */
  function centerIn(box, item) {
    if (!box || !item) return;
    var left = item.offsetLeft - (box.clientWidth - item.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }

  function openAbout() { mount('modal-slot', 'tpl-about'); }
  function closeAbout() { mount('modal-slot', null); }
  function isAboutOpen() { return !!document.getElementById('about-overlay'); }

  return {
    applyLayout: applyLayout,
    isMobile: isMobile,
    onModeChange: function (fn) { MOBILE.addEventListener('change', fn); },
    buildBackground: buildBackground,
    parallax: parallax,
    show: show,
    clone: clone,
    checkDirections: checkDirections,
    plural: plural,
    photo: photo,
    setPhoto: setPhoto,
    swipe: swipe,
    centerIn: centerIn,
    currentScreen: function () { return current; },
    setProgress: setProgress,
    setSound: setSound,
    setTheme: setTheme,
    openAbout: openAbout,
    closeAbout: closeAbout,
    isAboutOpen: isAboutOpen,
  };
})();
