/* История: растущее дерево направлений.
   Ствол — этапы университета снизу вверх, ветки — направления от этапа первого события.
   Данные — js/data/history.js, цвета веток — --branch-* в css/variables.css. */

window.HistoryTree = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Геометрия дерева. */
  var CX = 800;         /* ось ствола */
  var LEN = 372;        /* вылет ветки от ствола */
  var BAND0 = 76;       /* высота полосы одной ветки */
  var SUBH = 54;        /* добавка к полосе за каждую подветку */
  var RISE = 34;        /* подъём кончика ветки */
  var BASE = 124;       /* минимальная высота участка ствола */
  var OFF0 = 62;        /* от узла этапа до первой ветки */
  var PAD_B = 90;
  var PAD_T = 70;

  /* Рост и камера, секунды. */
  var START = 0.4;      /* пауза перед ростом */
  var GROW = 7;         /* за сколько фронт роста проходит ствол снизу доверху */
  var FOLLOW = 0.42;    /* где держать фронт роста: доля высоты окна от верха */
  var SMOOTH = 0.35;    /* постоянная сглаживания камеры */

  var T = window.CONFIG.texts;

  var root = null;
  var hooks = {};
  var L = null;         /* раскладка */
  var scroller = null;
  var canvas = null;
  var hotItems = [];    /* всё, что подсвечивается вместе с веткой */
  var leaves = [];      /* листья: { node, year } */
  var stageNodes = [];  /* узлы этапов на стволе */
  var stageButtons = [];
  var stage = null;     /* индекс открытого этапа или null */
  var hover = null;
  var raf = 0;

  /* Данные */

  function yearOf(v) {
    var m = String(v || '').match(/\d{4}/);
    return m ? Number(m[0]) : null;
  }

  function allItems(b) {
    return (b.subbranches || []).reduce(function (a, s) { return a.concat(s.items); }, b.items.slice());
  }

  function firstYear(b) {
    var ys = allItems(b).map(function (it) { return yearOf(it[0]); }).filter(function (y) { return y !== null; });
    return ys.length ? Math.min.apply(null, ys) : null;
  }

  function byFirstYear(a, b) {
    var x = firstYear(a);
    var y = firstYear(b);
    return (x === null ? 9999 : x) - (y === null ? 9999 : y);
  }

  function band(b) { return BAND0 + SUBH * (b.subbranches || []).length; }

  /* Кривая Безье: точка и запись для атрибута d. */

  function bz(p, t) {
    var u = 1 - t;
    return [0, 1].map(function (i) {
      return u * u * u * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t * t * t * p[3][i];
    });
  }

  function pathD(p) {
    return 'M' + p[0][0] + ' ' + p[0][1] +
      ' C' + p[1][0] + ' ' + p[1][1] + ' ' + p[2][0] + ' ' + p[2][1] + ' ' + p[3][0] + ' ' + p[3][1];
  }

  /* Раскладка */

  /* Делит ветки участка на левую и правую стороны так, чтобы стороны были близки по высоте. */
  function place(list) {
    var sides = { L: [], R: [] };
    var ls = 0;
    var rs = 0;
    list.slice().sort(function (a, b) { return band(b) - band(a); }).forEach(function (b) {
      if (ls <= rs) { sides.L.push(b); ls += band(b); }
      else { sides.R.push(b); rs += band(b); }
    });
    return { L: sides.L.sort(byFirstYear), R: sides.R.sort(byFirstYear), h: Math.max(ls, rs) };
  }

  function layout() {
    var data = window.HISTORY_DATA;
    var stages = data.stages.map(function (s, i) {
      var n = data.stages[i + 1];
      return { year: s.year, name: s.name, i: i, start: Number(s.year), end: n ? Number(n.year) : Infinity, next: n ? n.year : null };
    });

    function stageIndex(y) {
      return stages.reduce(function (k, s, i) { return y >= s.start ? i : k; }, 0);
    }

    var segs = stages.map(function () { return []; });
    var crown = [];
    data.branches.forEach(function (b) {
      var fy = firstYear(b);
      if (fy === null) crown.push(b);
      else segs[stageIndex(fy)].push(b);
    });

    var placed = segs.map(place);
    var crownPlaced = place(crown);
    var segH = placed.map(function (p) { return Math.max(BASE, p.h ? OFF0 + p.h + 10 : BASE); });
    var crownH = OFF0 + crownPlaced.h + 30;
    var height = PAD_B + segH.reduce(function (a, b) { return a + b; }, 0) + crownH + PAD_T;

    var nodeY = [];
    var y = height - PAD_B;
    segH.forEach(function (h) { nodeY.push(y); y -= h; });

    var last = nodeY.length - 1;
    var crownY = nodeY[last] - segH[last];
    var result = {
      stages: stages, segs: segs, crown: crown, height: height, nodeY: nodeY, last: last, crownY: crownY,
      top: crownY - crownH + 20, bottom: nodeY[0] + 50, rows: [],
    };

    function build(pl, baseY, dashed) {
      [['L', -1], ['R', 1]].forEach(function (side) {
        var dir = side[1];
        var c = 0;
        pl[side[0]].forEach(function (b) {
          var by = baseY - OFF0 - c;
          c += band(b);
          var pts = [[CX + dir * 7, by], [CX + dir * LEN * 0.42, by + 4], [CX + dir * LEN * 0.72, by - RISE], [CX + dir * LEN, by - RISE]];
          var subs = (b.subbranches || []).map(function (sb, si) {
            var s = bz(pts, 0.62 - 0.22 * si);
            var e = [CX + dir * LEN * 0.97, by - RISE - SUBH * (si + 1)];
            return { title: sb.title, items: sb.items, pts: [s, [s[0] + dir * 34, s[1] - (s[1] - e[1]) * 0.7], [e[0] - dir * 110, e[1]], e] };
          });
          result.rows.push({ b: b, dir: dir, y: by, pts: pts, subs: subs, dashed: dashed });
        });
      });
    }
    placed.forEach(function (p, i) { build(p, nodeY[i], false); });
    build(crownPlaced, crownY, true);
    return result;
  }

  /* Через сколько секунд фронт роста доходит до высоты y. */
  function growDelay(y) {
    return START + (L.bottom - y) / (L.bottom - L.top) * GROW;
  }

  /* SVG */

  function svgEl(name, attrs, cls, delay) {
    var n = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (cls) n.setAttribute('class', cls);
    if (delay !== undefined) n.style.animationDelay = delay + 's';
    return n;
  }

  function addLeaves(g, pts, list, t0, t1, delay) {
    list.forEach(function (it, j) {
      var p = bz(pts, list.length === 1 ? (t0 + t1) / 2 : t0 + (t1 - t0) * j / (list.length - 1));
      var year = yearOf(it[0]);
      var leaf = svgEl('circle', { cx: p[0], cy: p[1], r: 5.5 },
        'tree-leaf' + (year === null ? ' tree-leaf--open' : ''), delay + 0.05 * j);
      g.appendChild(leaf);
      leaves.push({ node: leaf, year: year });
    });
  }

  function drawBranch(svg, r) {
    var d0 = growDelay(r.y);
    var g = svgEl('g', {}, 'tree-branch');
    g.dataset.branch = r.b.type;
    setColor(g, r.b.type);
    hotItems.push(g);

    g.appendChild(r.dashed
      ? svgEl('path', { d: pathD(r.pts) }, 'tree-line tree-line--main tree-line--dashed', d0)
      : svgEl('path', { d: pathD(r.pts), pathLength: 1 }, 'tree-line tree-line--main tree-draw', d0));

    r.subs.forEach(function (sb) {
      g.appendChild(svgEl('path', { d: pathD(sb.pts), pathLength: 1 }, 'tree-line tree-line--sub tree-draw tree-draw--sub', d0 + 0.45));
    });

    addLeaves(g, r.pts, r.b.items, 0.3, 0.93, d0 + 0.75);
    r.subs.forEach(function (sb) { addLeaves(g, sb.pts, sb.items, 0.4, 0.94, d0 + 1.1); });

    g.appendChild(svgEl('circle', { cx: CX + r.dir * 7, cy: r.y, r: 5 }, 'tree-joint', d0));
    g.appendChild(svgEl('path', { d: pathD(r.pts) }, 'tree-hit'));
    r.subs.forEach(function (sb) { g.appendChild(svgEl('path', { d: pathD(sb.pts) }, 'tree-hit')); });
    svg.appendChild(g);
  }

  function drawStageNode(trunk, s) {
    var y = L.nodeY[s.i];
    var g = svgEl('g', {}, 'tree-node', growDelay(y));
    var ring = svgEl('circle', { cx: CX, cy: y, r: 15 }, 'tree-node__ring');
    g.appendChild(ring);
    g.appendChild(svgEl('circle', { cx: CX, cy: y, r: 5 }, 'tree-node__core'));
    g.appendChild(svgEl('circle', { cx: CX, cy: y, r: 25 }, 'tree-node__halo'));
    trunk.appendChild(g);
    stageNodes.push({ group: g, ring: ring });
  }

  function drawSvg() {
    var svg = canvas.querySelector('#tree-svg');
    svg.setAttribute('width', 1600);
    svg.setAttribute('height', L.height);

    var b = L.bottom;
    var lastY = L.nodeY[L.last];
    var trunk = svgEl('g', {}, 'tree-trunk');
    trunk.appendChild(svgEl('path', {
      d: 'M' + (CX - 60) + ' ' + (b + 6) + ' Q' + (CX - 14) + ' ' + (b - 4) + ' ' + CX + ' ' + (b - 40) +
         ' Q' + (CX + 14) + ' ' + (b - 4) + ' ' + (CX + 60) + ' ' + (b + 6),
    }, 'tree-root', 0));
    trunk.appendChild(svgEl('line', { x1: CX - 140, x2: CX + 140, y1: b + 8, y2: b + 8 }, 'tree-ground'));

    /* Ствол растёт равномерно, чтобы фронт совпадал с задержками веток и камерой. */
    var bar = svgEl('path', { d: 'M' + CX + ' ' + b + ' V' + lastY, pathLength: 1 }, 'tree-bar tree-draw', START);
    bar.style.animationDuration = (b - lastY) / (b - L.top) * GROW + 's';
    bar.style.animationTimingFunction = 'linear';
    trunk.appendChild(bar);

    trunk.appendChild(svgEl('path', { d: 'M' + CX + ' ' + (lastY - 14) + ' V' + L.top }, 'tree-bar tree-bar--open', growDelay(lastY)));
    svg.appendChild(trunk);

    L.rows.forEach(function (r) { drawBranch(svg, r); });

    var nodes = svgEl('g', {}, 'tree-trunk');
    L.stages.forEach(function (s) { drawStageNode(nodes, s); });
    if (L.crown.length) nodes.appendChild(svgEl('circle', { cx: CX, cy: L.crownY, r: 9 }, 'tree-crown', growDelay(L.crownY)));
    svg.appendChild(nodes);
  }

  function setColor(el, type) {
    el.style.setProperty('--b', 'var(--branch-' + type + ', var(--c-blue-deep))');
  }

  /* HTML поверх рисунка */

  function renderStages() {
    var box = canvas.querySelector('#tree-stages');
    L.stages.forEach(function (s) {
      var frag = Screens.clone('tpl-tree-stage');
      var btn = frag.querySelector('.tree-stage');
      btn.style.left = CX - 300 + 'px';
      btn.style.top = L.nodeY[s.i] - 26 + 'px';
      btn.style.animationDelay = growDelay(L.nodeY[s.i]) + 's';
      btn.dataset.stage = s.i;
      frag.querySelector('[data-slot="year"]').textContent = s.year;
      frag.querySelector('[data-slot="name"]').textContent = s.name;
      stageButtons.push(btn);
      box.appendChild(frag);
    });

    var crown = canvas.querySelector('#tree-crown');
    crown.hidden = !L.crown.length;
    crown.style.left = CX + 24 + 'px';
    crown.style.top = L.crownY - 17 + 'px';
    crown.style.animationDelay = growDelay(L.crownY) + 's';
  }

  function addLabel(box, r, end, title, meta, main, delay) {
    var frag = Screens.clone('tpl-tree-label');
    var btn = frag.querySelector('.tree-label');
    btn.dataset.branch = r.b.type;
    setColor(btn, r.b.type);
    btn.classList.add(main ? 'tree-label--main' : 'tree-label--sub');
    if (r.dir < 0) btn.classList.add('tree-label--left');
    btn.style.left = (r.dir < 0 ? end[0] - 18 - 300 : end[0] + 18) + 'px';
    btn.style.top = end[1] - 14 + 'px';
    btn.style.animationDelay = delay + 's';
    frag.querySelector('[data-slot="title"]').textContent = title;
    frag.querySelector('[data-slot="meta"]').textContent = meta;
    hotItems.push(btn);
    box.appendChild(frag);
  }

  function renderLabels() {
    var box = canvas.querySelector('#tree-labels');
    L.rows.forEach(function (r) {
      var d0 = growDelay(r.y);
      var n = allItems(r.b).length;
      addLabel(box, r, r.pts[3], r.b.title, n + ' ' + Screens.plural(n, T.eventForms), true, d0 + 0.7);
      r.subs.forEach(function (sb) {
        addLabel(box, r, sb.pts[3], sb.title, String(sb.items.length), false, d0 + 1.05);
      });
    });
  }

  /* Подсветка ветки */

  function setHover(type) {
    if (type === hover) return;
    hover = type;
    canvas.classList.toggle('has-hover', !!type);
    hotItems.forEach(function (el) { el.classList.toggle('is-hot', el.dataset.branch === type); });
  }

  function onOver(e) {
    var el = e.target.closest ? e.target.closest('[data-branch]') : null;
    setHover(el ? el.dataset.branch : null);
  }

  /* Карточка этапа */

  function renderCard() {
    var box = canvas.querySelector('#tree-card');
    box.replaceChildren();

    stageNodes.forEach(function (n, i) {
      n.group.classList.toggle('is-on', i === stage);
      n.ring.setAttribute('r', i === stage ? 17 : 15);
      stageButtons[i].classList.toggle('is-on', i === stage);
    });

    var cur = stage === null ? null : L.stages[stage];
    leaves.forEach(function (l) {
      var hot = cur && l.year !== null && l.year >= cur.start && l.year < cur.end;
      l.node.setAttribute('r', hot ? 7 : 5.5);
    });
    if (!cur) return;

    var frag = Screens.clone('tpl-tree-card');
    var card = frag.querySelector('.tree-card');
    card.style.left = CX - 44 - 390 + 'px';
    card.style.bottom = L.height - L.nodeY[stage] - 40 + 'px';
    frag.querySelector('[data-slot="period"]').textContent =
      cur.next ? cur.year + ' — ' + cur.next : T.treeSince + ' ' + cur.year;
    frag.querySelector('[data-slot="name"]').textContent = cur.name;

    var list = L.segs[stage].slice().sort(byFirstYear);
    frag.querySelector('[data-slot="head"]').textContent = list.length ? T.treeStageBranches : T.treeStageEmpty;

    var rows = frag.querySelector('[data-slot="list"]');
    list.forEach(function (b) {
      var row = Screens.clone('tpl-tree-card-row');
      var btn = row.querySelector('.tree-card__row');
      btn.dataset.pick = b.type;
      setColor(btn, b.type);
      row.querySelector('[data-slot="title"]').textContent = b.title;
      row.querySelector('[data-slot="year"]').textContent = String(firstYear(b));
      rows.appendChild(row);
    });
    box.appendChild(frag);
  }

  function pickStage(i) {
    var opening = stage !== i;
    stage = opening ? i : null;
    renderCard();
    if (opening) {
      var top = L.nodeY[i] - 520;
      if (top < scroller.scrollTop) scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      if (hooks.pick) hooks.pick();
    } else if (hooks.close) hooks.close();
  }

  function closeCard() {
    stage = null;
    renderCard();
    if (hooks.close) hooks.close();
  }

  /* Камера: держит фронт роста в окне и плавно поднимается до самого верха. */

  function startCamera() {
    var view = scroller.clientHeight;
    var pos = scroller.scrollHeight - view;
    scroller.scrollTop = pos;

    var t0 = performance.now();
    var prev = t0;

    function step(now) {
      if (!scroller.isConnected) return;
      var t = (now - t0) / 1000;
      var p = Math.max(0, Math.min(1, (t - START) / GROW));
      var front = L.bottom - p * (L.bottom - L.top);
      var target = Math.max(0, Math.min(pos, front - view * FOLLOW));
      var dt = (now - prev) / 1000;
      prev = now;
      pos += (target - pos) * (1 - Math.exp(-dt / SMOOTH));

      if (p >= 1 && pos < 0.5) {
        scroller.scrollTop = 0;
        raf = 0;
        return;
      }
      scroller.scrollTop = pos;
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
  }

  function stopCamera() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* События */

  function onClick(e) {
    var el = e.target;
    var stageBtn = el.closest('[data-stage]');
    if (stageBtn) { pickStage(Number(stageBtn.dataset.stage)); return; }
    if (el.closest('#tree-card-close')) closeCard();
  }

  function init(el, h) {
    stopCamera();
    root = el;
    hooks = h || {};
    L = layout();
    stage = null;
    hover = null;
    hotItems = [];
    leaves = [];
    stageNodes = [];
    stageButtons = [];

    root.replaceChildren(Screens.clone('tpl-history-tree'));
    scroller = root.querySelector('#tree-scroll');
    canvas = root.querySelector('#tree-canvas');
    canvas.style.height = L.height + 'px';

    drawSvg();
    renderStages();
    renderLabels();

    root.addEventListener('click', onClick);
    canvas.addEventListener('mouseover', onOver);
    canvas.addEventListener('mouseleave', function () { setHover(null); });

    /* Любое действие пользователя сразу отдаёт ему камеру; рост дерева при этом продолжается. */
    ['wheel', 'pointerdown', 'touchstart'].forEach(function (name) {
      root.addEventListener(name, stopCamera, { passive: true, capture: true });
    });

    startCamera();
  }

  var SCROLL_KEYS = { ArrowUp: -80, ArrowDown: 80, PageUp: -600, PageDown: 600 };

  function key(e) {
    stopCamera();
    if (SCROLL_KEYS[e.key]) {
      scroller.scrollBy({ top: SCROLL_KEYS[e.key], behavior: 'smooth' });
      return true;
    }
    if (e.key === 'Home') { scroller.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
    if (e.key === 'End') { scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }); return true; }
    if (e.key === 'Escape' && stage !== null) { closeCard(); return true; }
    return false;
  }

  return { init: init, key: key };
})();
