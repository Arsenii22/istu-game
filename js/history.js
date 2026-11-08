/* История: схема «печатная плата» (институты вокруг центрального чипа) и страница направления.
   Данные — js/data/history.js. */

window.HistoryBoard = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Плата 1060×730, чип в центре, институты вокруг него. */
  var BOARD_W = 1060;
  var CX = 530;
  var CY = 365;
  var RX = 385;
  var RY = 255;
  var CORE_HW = 120;    /* половина ширины чипа (с запасом под выводы) */
  var CORE_HH = 65;     /* половина высоты чипа */
  var NODE_W = 230;     /* ширина узла; узкие варианты — для большого числа институтов */
  var NARROW_W = [170, 150];
  var NODE_HH = 32;     /* половина высоты узла */
  var PINS_H = 22;      /* ряд «пинов» под узлом вместе с отступом */
  var EDGE = 14;        /* отступ узлов от краёв платы */
  var TRACK_TOP = 68;   /* центры верхнего и нижнего ряда узлов на контуре */
  var TRACK_BOTTOM = 640;
  var MIN_GAP = 8;      /* меньший зазор между узлами считается наложением */
  var PHASES = 40;      /* сколько сдвигов вдоль контура перебирать */

  var T = window.CONFIG.texts;

  var root = null;
  var hooks = {};
  var inst = 0;
  var dir = 0;
  var onPage = false;

  function pad(n) { return String(n).padStart(2, '0'); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function institutes() { return window.HISTORY_BOARD_DATA.institutes; }
  function dirCode(i, j) { return pad(i + 1) + '.' + pad(j + 1); }
  function dirCount(n) { return n + ' ' + Screens.plural(n, T.directionForms); }

  /* Дорожка только из горизонталей, вертикалей и диагоналей под 45°, как на плате. */
  function route(sx, sy, tx, ty) {
    var dx = tx - sx;
    var dy = ty - sy;
    var gx = Math.sign(dx) || 1;
    var gy = Math.sign(dy) || 1;
    var ax = Math.abs(dx);
    var ay = Math.abs(dy);
    var m;
    if (ax >= ay) {
      m = sx + gx * (ax - ay) / 2;
      return 'M' + sx + ' ' + sy + ' H' + m + ' L' + (m + gx * ay) + ' ' + ty + ' H' + tx;
    }
    m = sy + gy * (ay - ax) / 2;
    return 'M' + sx + ' ' + sy + ' V' + m + ' L' + tx + ' ' + (m + gy * ax) + ' V' + ty;
  }

  /* Центры узлов по эллипсу из макета. Первый узел сверху, дальше по часовой стрелке. */
  function ellipsePoints(n) {
    var angles = [];
    if (n === 1) angles = [0];
    else if (n === 2) angles = [180, 0];
    else for (var i = 0; i < n; i++) angles.push(-90 + i * 360 / n);

    return angles.map(function (a) {
      var r = a * Math.PI / 180;
      return { x: Math.round(CX + RX * Math.cos(r)), y: Math.round(CY + RY * Math.sin(r)) };
    });
  }

  /* Центры узлов на прямоугольном контуре вдоль краёв платы, на равных расстояниях.
     Отсчёт — от середины верхней стороны по часовой стрелке, phase сдвигает все узлы вдоль контура. */
  function trackPoints(n, w, phase) {
    var x0 = w / 2 + EDGE;
    var x1 = BOARD_W - w / 2 - EDGE;
    var W = x1 - x0;
    var H = TRACK_BOTTOM - TRACK_TOP;
    var P = 2 * (W + H);
    var pts = [];

    for (var i = 0; i < n; i++) {
      var s = ((i / n + phase) % 1 * P + W / 2) % P;
      var x, y;
      if (s < W) { x = x0 + s; y = TRACK_TOP; }
      else if (s < W + H) { x = x1; y = TRACK_TOP + s - W; }
      else if (s < 2 * W + H) { x = x1 - (s - W - H); y = TRACK_BOTTOM; }
      else { x = x0; y = TRACK_BOTTOM - (s - 2 * W - H); }
      pts.push({ x: Math.round(x), y: Math.round(y) });
    }
    return pts;
  }

  function pinsAbove(p) { return p.y < CY - 100; }

  /* Наименьший зазор между прямоугольниками узлов вместе с рядом «пинов»; отрицательный — наложение. */
  function minGap(pts, w) {
    var boxes = pts.map(function (p) {
      var up = pinsAbove(p);
      return {
        l: p.x - w / 2,
        r: p.x + w / 2,
        t: p.y - NODE_HH - (up ? PINS_H : 0),
        b: p.y + NODE_HH + (up ? 0 : PINS_H),
      };
    });
    var gap = Infinity;
    for (var i = 0; i < boxes.length; i++) {
      for (var j = i + 1; j < boxes.length; j++) {
        var a = boxes[i];
        var c = boxes[j];
        var gx = Math.max(c.l - a.r, a.l - c.r);
        var gy = Math.max(c.t - a.b, a.t - c.b);
        gap = Math.min(gap, Math.max(gx, gy));
      }
    }
    return gap;
  }

  /* Лучшее положение на контуре для узлов ширины w: перебираем сдвиги, берём самый просторный. */
  function bestTrack(n, w) {
    var best = null;
    for (var k = 0; k < PHASES; k++) {
      var pts = trackPoints(n, w, k / PHASES / n);
      var gap = minGap(pts, w);
      if (!best || gap > best.gap) best = { w: w, pts: pts, gap: gap };
    }
    return best;
  }

  /* Пока узлам хватает места на эллипсе — раскладка из макета. Дальше — контур вдоль краёв платы,
     сначала с обычными узлами, потом с узкими. Берётся первый вариант без наложений;
     если такого нет, самый просторный из всех. */
  function placeNodes(n) {
    var pts = ellipsePoints(n);
    var options = [{ w: NODE_W, pts: pts, gap: minGap(pts, NODE_W) }];
    [NODE_W].concat(NARROW_W).forEach(function (w) { options.push(bestTrack(n, w)); });

    for (var i = 0; i < options.length; i++) if (options[i].gap >= MIN_GAP) return options[i];
    return options.reduce(function (a, b) { return b.gap > a.gap ? b : a; });
  }

  /* Положение узлов и дорожек для n институтов. Дорожка выходит из ближайшей к узлу
     стороны чипа и входит в ближайшую сторону узла. */
  function layout(n) {
    var place = placeNodes(n);
    var hw = place.w / 2;

    return place.pts.map(function (p) {
      var nx = p.x;
      var ny = p.y;
      var side = Math.abs(nx - CX) / CORE_HW > Math.abs(ny - CY) / CORE_HH;
      var sx, sy, tx, ty, g;

      if (side) {
        g = Math.sign(nx - CX);
        sx = CX + g * CORE_HW;
        sy = CY + clamp(Math.round((ny - CY) * 0.3), -50, 50);
        tx = nx - g * hw;
        ty = ny;
      } else {
        g = Math.sign(ny - CY) || -1;
        sy = CY + g * CORE_HH;
        sx = CX + clamp(Math.round((nx - CX) * 0.3), -100, 100);
        tx = nx;
        ty = ny - g * NODE_HH;
      }

      return { nx: nx, ny: ny, w: place.w, sx: sx, sy: sy, d: route(sx, sy, tx, ty), pinsAbove: pinsAbove(p) };
    });
  }

  function svg(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /* Схема */

  /* Дорожки и бегущие по ним импульсы рисуются один раз при входе на схему,
     иначе при каждом выборе узла анимация начиналась бы заново. */
  function drawTraces(L) {
    var box = root.querySelector('#board-traces');
    box.replaceChildren();

    L.forEach(function (l) { box.appendChild(svg('path', { d: l.d, class: 'trace' })); });
    L.forEach(function (l, i) {
      var p = svg('path', { d: l.d, class: 'trace-pulse' });
      p.style.animation = 'pp-trace ' + (6 + (i % 4) * 1.5) + 's linear ' + (-i * 1.3) + 's infinite';
      box.appendChild(p);
    });

    box.appendChild(svg('g', { id: 'board-active' }));

    /* Выводы чипа: по восемь сверху и снизу, с промежутком посередине. */
    var legs = '';
    [-100, -80, -60, -40, 40, 60, 80, 100].forEach(function (dx) {
      var x = CX + dx;
      legs += 'M' + x + ' ' + (CY - CORE_HH - 12) + ' V' + (CY - CORE_HH) +
        ' M' + x + ' ' + (CY + CORE_HH) + ' V' + (CY + CORE_HH + 12) + ' ';
    });
    box.appendChild(svg('path', { d: legs, class: 'core-legs' }));
  }

  /* Подсветка дорожки выбранного института и переходные отверстия у чипа. */
  function renderActive(L) {
    var g = root.querySelector('#board-active');
    g.replaceChildren(svg('path', { d: L[inst].d, class: 'trace-active' }));
    L.forEach(function (l, i) {
      g.appendChild(svg('circle', { cx: l.sx, cy: l.sy, r: 5, class: 'via' + (i === inst ? ' is-active' : '') }));
    });
  }

  function renderNodes(L) {
    var box = root.querySelector('#board-nodes');
    box.replaceChildren();

    institutes().forEach(function (it, i) {
      var l = L[i];
      var frag = Screens.clone('tpl-history-node');
      var node = frag.firstElementChild;
      var active = i === inst;

      node.dataset.inst = i;
      node.classList.toggle('is-active', active);
      node.classList.toggle('node--pins-above', l.pinsAbove);
      node.classList.toggle('node--narrow', l.w < NODE_W);
      node.style.width = l.w + 'px';
      node.style.left = (l.nx - l.w / 2) + 'px';
      node.style.top = (l.ny - NODE_HH - (l.pinsAbove ? PINS_H : 0)) + 'px';
      node.querySelector('[data-slot="label"]').textContent = it.short || T.instituteNode + ' ' + pad(i + 1);
      node.querySelector('[data-slot="sub"]').textContent = dirCount(it.directions.length);
      node.setAttribute('aria-label', it.name);

      var pins = node.querySelector('[data-slot="pins"]');
      it.directions.forEach(function (d, j) {
        var pin = document.createElement('span');
        pin.className = 'node__pin' + (active && j === dir ? ' is-current' : '');
        pins.appendChild(pin);
      });

      box.appendChild(frag);
    });
  }

  function renderPanel() {
    var it = institutes()[inst];
    root.querySelector('#inst-code').textContent = 'INST_' + pad(inst + 1);
    root.querySelector('#inst-name').textContent = it.name;
    root.querySelector('#inst-about').textContent = it.about;
    root.querySelector('#inst-count').textContent = dirCount(it.directions.length);
    root.querySelector('#read-label').textContent = T.readHistory + ' ' + dirCode(inst, dir);

    var list = root.querySelector('#inst-dirs');
    list.replaceChildren();
    it.directions.forEach(function (d, j) {
      var frag = Screens.clone('tpl-history-dir');
      var row = frag.firstElementChild;
      row.dataset.dir = j;
      row.classList.toggle('is-active', j === dir);
      row.querySelector('[data-slot="code"]').textContent = dirCode(inst, j);
      row.querySelector('[data-slot="name"]').textContent = d.name;
      list.appendChild(frag);
    });
    var current = list.querySelector('.is-active');
    if (current) current.scrollIntoView({ block: 'nearest' });
  }

  function renderBoard() {
    var L = layout(institutes().length);
    renderActive(L);
    renderNodes(L);
    renderPanel();
  }

  function showBoard() {
    var list = institutes();
    var total = list.reduce(function (n, it) { return n + it.directions.length; }, 0);

    onPage = false;
    root.replaceChildren(Screens.clone('tpl-history-board'));
    root.querySelector('#core-name').textContent = window.HISTORY_BOARD_DATA.core.name;
    root.querySelector('#core-sub').textContent = 'CORE · ' + window.HISTORY_BOARD_DATA.core.year;
    root.querySelector('#legend-inst').textContent = T.legendInst + ' ' + list.length;
    root.querySelector('#legend-dir').textContent = T.legendDir + ' ' + total;
    drawTraces(layout(list.length));
    renderBoard();
  }

  /* Страница направления */

  /* Все направления подряд, по институтам — для кнопок «Предыдущее» и «Следующее». */
  function flat() {
    var all = [];
    institutes().forEach(function (it, i) {
      it.directions.forEach(function (d, j) { all.push({ i: i, j: j }); });
    });
    return all;
  }

  function flatIndex(all) {
    for (var k = 0; k < all.length; k++) if (all[k].i === inst && all[k].j === dir) return k;
    return 0;
  }

  function renderPage() {
    var it = institutes()[inst];
    var d = it.directions[dir];

    root.querySelector('#page-inst').textContent = it.name;
    root.querySelector('#page-title').textContent = d.name;

    var text = root.querySelector('#page-text');
    text.replaceChildren();
    d.history.forEach(function (para) {
      var p = document.createElement('p');
      p.className = 'dir-page__para';
      p.textContent = para;
      text.appendChild(p);
    });

    var stages = root.querySelector('#page-stages');
    stages.replaceChildren();
    d.stages.forEach(function (st) {
      var row = document.createElement('div');
      row.className = 'dir-page__stage';
      row.innerHTML = '<span class="dir-page__stage-year"></span><span class="dir-page__stage-text"></span>';
      row.firstChild.textContent = st.year;
      row.lastChild.textContent = st.text;
      stages.appendChild(row);
    });

    var photo = root.querySelector('#page-photo');
    photo.className = 'dir-page__photo';
    if (d.photo && d.photo.src) {
      var img = document.createElement('img');
      img.className = 'dir-page__img';
      img.src = d.photo.src;
      img.alt = d.photo.caption;
      photo.replaceChildren(img);
    } else {
      photo.classList.add('is-stub');
      photo.textContent = T.illustration;
    }
    root.querySelector('#page-caption').textContent = d.photo ? d.photo.caption : '';

    var all = flat();
    var k = flatIndex(all);
    root.querySelector('#dir-prev').disabled = k === 0;
    root.querySelector('#dir-next').disabled = k === all.length - 1;
  }

  function showPage() {
    onPage = true;
    root.replaceChildren(Screens.clone('tpl-history-page'));
    renderPage();
    if (hooks.open) hooks.open();
  }

  function stepPage(d) {
    var all = flat();
    var k = flatIndex(all) + d;
    if (k < 0 || k >= all.length) return;
    inst = all[k].i;
    dir = all[k].j;
    /* Перемонтируем, чтобы новая страница появилась с той же анимацией и прокрутилась к началу. */
    root.replaceChildren(Screens.clone('tpl-history-page'));
    renderPage();
    if (hooks.step) hooks.step();
  }

  function backToBoard() {
    showBoard();
    if (hooks.close) hooks.close();
  }

  function onClick(e) {
    var el = e.target;

    if (onPage) {
      if (el.closest('#btn-all-dirs')) { backToBoard(); return; }
      if (el.closest('#dir-prev')) { stepPage(-1); return; }
      if (el.closest('#dir-next')) stepPage(1);
      return;
    }

    var node = el.closest('.node');
    if (node) {
      inst = Number(node.dataset.inst);
      dir = 0;
      renderBoard();
      if (hooks.pick) hooks.pick();
      return;
    }

    var row = el.closest('.dir-row');
    if (row) {
      dir = Number(row.dataset.dir);
      renderBoard();
      if (hooks.pick) hooks.pick();
      return;
    }

    if (el.closest('#btn-read')) showPage();
  }

  function init(el, h) {
    root = el;
    hooks = h || {};
    inst = 0;
    dir = 0;
    root.addEventListener('click', onClick);
    showBoard();
  }

  /* Возвращает true, если клавиша обработана здесь. Escape на странице направления ведёт к схеме. */
  function key(e) {
    if (!onPage) return false;
    if (e.key === 'Escape') { backToBoard(); return true; }
    if (e.key === 'ArrowLeft') { stepPage(-1); return true; }
    if (e.key === 'ArrowRight') { stepPage(1); return true; }
    return false;
  }

  return { init: init, key: key };
})();
