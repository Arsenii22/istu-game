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

  /* Эти экраны свёрстаны только под альбомную сцену; в портретном окне она просто уменьшается. */
  var LANDSCAPE_ONLY = ['gallery', 'history', 'museum', 'reviews', 'review-form'];

  /* Кнопки «Об игре» и «Звук» есть только на этих экранах; на остальных угол занят шапкой. */
  var WITH_CORNER = ['menu', 'stub'];

  function applyLayout() {
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
    layer1.style.transform = 'translate(' + nx * -14 + 'px, ' + ny * -10 + 'px)';
    layer2.style.transform = 'translate(' + nx * -30 + 'px, ' + ny * -20 + 'px)';
  }

  function mount(slotId, tplId) {
    var slot = document.getElementById(slotId);
    slot.replaceChildren();
    if (!tplId) return;
    slot.appendChild(clone(tplId));
  }

  /* Экран каждый раз монтируется заново, поэтому анимация появления проигрывается при каждом входе. */
  function show(name, mode) {
    current = name;
    applyLayout();
    mount('screen-slot', 'tpl-' + name);

    if (name === 'stub') {
      var T = window.CONFIG.texts;
      document.getElementById('stub-badge').textContent = T[mode + 'Title'];
      document.getElementById('stub-text').textContent = 'Здесь будет ' + T[mode + 'Soon'];
    }

    if (WITH_CORNER.indexOf(name) < 0) mount('corner-slot', null);
    else if (!document.getElementById('corner')) mount('corner-slot', 'tpl-corner');
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

  function openAbout() { mount('modal-slot', 'tpl-about'); }
  function closeAbout() { mount('modal-slot', null); }
  function isAboutOpen() { return !!document.getElementById('about-overlay'); }

  return {
    applyLayout: applyLayout,
    buildBackground: buildBackground,
    parallax: parallax,
    show: show,
    clone: clone,
    checkDirections: checkDirections,
    plural: plural,
    currentScreen: function () { return current; },
    setProgress: setProgress,
    setSound: setSound,
    openAbout: openAbout,
    closeAbout: closeAbout,
    isAboutOpen: isAboutOpen,
  };
})();
