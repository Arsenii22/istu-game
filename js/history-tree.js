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

  /* Мобильное дерево (окно уже 760 px): ствол у левого края, все ветки вправо,
     подпись — над своей веткой во всю ширину. Высоты подписей измеряются, поэтому
     длинные названия переносятся и ни на что не наезжают. */
  var M = {
    TX: 30,           /* ось ствола */
    EDGE: 14,         /* от кончика ветки до края экрана */
    RISE: 12,         /* подъём кончика ветки */
    LABEL_IN: 48,     /* от ствола до начала подписи: здесь поднимаются подветки */
    LABEL_GAP: 10,    /* от ветки до низа её подписи */
    SUB_GAP: 16,      /* от подписи до следующей подветки */
    STEP: 18,         /* от подписи до следующей ветки или плашки */
    ELBOW: 14,        /* радиус изгиба подветки */
    STAGE_IN: 28,     /* от ствола до плашки этапа */
    PAD_T: 40,
    PAD_B: 70,
  };

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
  var focus = null;     /* индекс направления в фокусе или null */
  var focusEl = null;   /* слой фокуса; пока он закрывается, focus уже null */
  var closeTimer = 0;
  var photoEl = null;   /* открытое крупно фото события или null */
  var menuEl = null;    /* открытое меню переходов или null */
  var menuRow = null;   /* строка события, к которой оно открыто */
  var mobile = false;
  var menuSheet = null; /* мобильный режим: нижняя панель с меню переходов */
  var cardSheet = null; /* мобильный режим: нижняя панель с карточкой этапа */

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

  /* Этапы и ветки по участкам ствола: ветка растёт от этапа своего самого раннего года. */
  function segments() {
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
    return { stages: stages, segs: segs, crown: crown };
  }

  function layout() {
    var sg = segments();
    var stages = sg.stages;
    var segs = sg.segs;
    var crown = sg.crown;

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
      top: crownY - crownH + 20, bottom: nodeY[0] + 50, rows: [], cx: CX, width: 1600,
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

  /* Высота элемента из шаблона при заданной ширине: клон кладётся в дерево невидимым и сразу убирается. */
  function measure(tplId, fill, width) {
    var frag = Screens.clone(tplId);
    var el = frag.firstElementChild;
    fill(el);
    el.style.cssText = 'left:0;top:0;visibility:hidden;animation:none;width:' + width + 'px';
    canvas.appendChild(el);
    var h = el.offsetHeight;
    el.remove();
    return h;
  }

  function labelHeight(title, meta, main, width) {
    return measure('tpl-tree-label', function (el) {
      el.classList.add(main ? 'tree-label--main' : 'tree-label--sub');
      el.querySelector('[data-slot="title"]').textContent = title;
      el.querySelector('[data-slot="meta"]').textContent = meta;
    }, width);
  }

  function mainMeta(b) {
    var n = allItems(b).length;
    return n + ' ' + Screens.plural(n, T.eventForms);
  }

  /* Мобильная раскладка: снизу вверх — плашка этапа, над ней ветки этого этапа по году,
     у каждой ветки сверху подпись, над подписью — подветки со своими подписями. */
  function layoutMobile(W) {
    var sg = segments();
    var cx = M.TX;
    var tipX = W - M.EDGE;
    var len = tipX - cx;
    var labelX = cx + M.LABEL_IN;
    var labelW = W - M.EDGE + 4 - labelX;
    var stageX = cx + M.STAGE_IN;
    var stageW = W - 16 - stageX;
    var crownH = canvas.querySelector('#tree-crown').offsetHeight || 32;

    var stageH = sg.stages.map(function (s) {
      return measure('tpl-tree-stage', function (el) {
        el.querySelector('[data-slot="year"]').textContent = s.year;
        el.querySelector('[data-slot="name"]').textContent = s.name;
      }, stageW);
    });

    /* Ветки участка снизу вверх; top — верхняя занятая точка, возвращается новая. */
    function stack(list, top, dashed, rows) {
      list.slice().sort(byFirstYear).forEach(function (b) {
        var by = top - M.STEP;
        var tipY = by - M.RISE;
        var pts = [[cx + 5, by], [cx + len * 0.3, by + 2], [cx + len * 0.7, tipY], [tipX, tipY]];
        var h = labelHeight(b.title, mainMeta(b), true, labelW);
        var lab = { x: labelX, y: tipY - M.LABEL_GAP - h, w: labelW };
        top = lab.y;

        var s = bz(pts, 0.04);
        var subs = (b.subbranches || []).map(function (sb) {
          var e = top - M.SUB_GAP;
          var x0 = s[0] + M.ELBOW;
          var x1 = tipX - 6;
          var sh = labelHeight(sb.title, String(sb.items.length), false, labelW);
          var sub = {
            title: sb.title,
            items: sb.items,
            /* Вверх вдоль ствола, плавный изгиб, дальше горизонтально — подписи не пересекает. */
            d: 'M' + s[0] + ' ' + s[1] + ' V' + (e + M.ELBOW) + ' Q' + s[0] + ' ' + e + ' ' + x0 + ' ' + e + ' H' + x1,
            at: function (t) { return [x0 + (x1 - x0) * t, e]; },
            end: [x1, e],
            lab: { x: labelX, y: e - M.LABEL_GAP - sh, w: labelW },
          };
          top = sub.lab.y;
          return sub;
        });
        rows.push({ b: b, dir: 1, y: by, pts: pts, subs: subs, dashed: dashed, lab: lab });
      });
      return top;
    }

    function build(y0) {
      var r = { stages: sg.stages, segs: sg.segs, crown: sg.crown, nodeY: [], chipY: [], rows: [], last: sg.stages.length - 1,
        cx: cx, width: W, stageX: stageX, stageW: stageW, mobile: true };
      var top = y0;
      sg.stages.forEach(function (s, i) {
        var y = i === 0 ? y0 : top - M.STEP - stageH[i] / 2;
        r.nodeY.push(y);
        r.chipY.push(y - stageH[i] / 2);
        top = stack(sg.segs[i], y - stageH[i] / 2, false, r.rows);
      });
      r.crownY = top - M.STEP - crownH / 2;
      top = sg.crown.length ? stack(sg.crown, r.crownY - crownH / 2, true, r.rows) : r.crownY - crownH / 2;
      r.top = top - 20;
      r.bottom = y0 + 50;
      r.height = y0 + M.PAD_B;
      return r;
    }

    /* Первый проход узнаёт высоту, второй строит с нужным отступом сверху. */
    var probe = build(0);
    return build(-probe.top + M.PAD_T);
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

  /* at(t) — точка ветки при t от 0 до 1. */
  function addLeaves(g, at, list, t0, t1, delay) {
    list.forEach(function (it, j) {
      var p = at(list.length === 1 ? (t0 + t1) / 2 : t0 + (t1 - t0) * j / (list.length - 1));
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

    /* У мобильной подветки путь и точки листьев готовые (sb.d, sb.at), у обычной — кривая sb.pts. */
    var subD = function (sb) { return sb.d || pathD(sb.pts); };

    r.subs.forEach(function (sb) {
      g.appendChild(svgEl('path', { d: subD(sb), pathLength: 1 }, 'tree-line tree-line--sub tree-draw tree-draw--sub', d0 + 0.45));
    });

    addLeaves(g, function (t) { return bz(r.pts, t); }, r.b.items, 0.3, 0.93, d0 + 0.75);
    r.subs.forEach(function (sb) {
      if (sb.at) addLeaves(g, sb.at, sb.items, 0.12, 0.96, d0 + 1.1);
      else addLeaves(g, function (t) { return bz(sb.pts, t); }, sb.items, 0.4, 0.94, d0 + 1.1);
    });

    g.appendChild(svgEl('circle', { cx: L.cx + r.dir * 7, cy: r.y, r: 5 }, 'tree-joint', d0));
    g.appendChild(svgEl('path', { d: pathD(r.pts) }, 'tree-hit'));
    r.subs.forEach(function (sb) { g.appendChild(svgEl('path', { d: subD(sb) }, 'tree-hit')); });
    svg.appendChild(g);
  }

  function drawStageNode(trunk, s) {
    var y = L.nodeY[s.i];
    var g = svgEl('g', {}, 'tree-node', growDelay(y));
    var ring = svgEl('circle', { cx: L.cx, cy: y, r: 15 }, 'tree-node__ring');
    g.appendChild(ring);
    g.appendChild(svgEl('circle', { cx: L.cx, cy: y, r: 5 }, 'tree-node__core'));
    g.appendChild(svgEl('circle', { cx: L.cx, cy: y, r: 25 }, 'tree-node__halo'));
    trunk.appendChild(g);
    stageNodes.push({ group: g, ring: ring });
  }

  function drawSvg() {
    var svg = canvas.querySelector('#tree-svg');
    svg.setAttribute('width', L.width);
    svg.setAttribute('height', L.height);

    var b = L.bottom;
    var cx = L.cx;
    var lastY = L.nodeY[L.last];
    var root = L.mobile ? 22 : 60;     /* у ствола у края корни уже, чтобы не уходили за экран */
    var ground = L.mobile ? 24 : 140;
    var trunk = svgEl('g', {}, 'tree-trunk');
    trunk.appendChild(svgEl('path', {
      d: 'M' + (cx - root) + ' ' + (b + 6) + ' Q' + (cx - 14) + ' ' + (b - 4) + ' ' + cx + ' ' + (b - 40) +
         ' Q' + (cx + 14) + ' ' + (b - 4) + ' ' + (cx + root) + ' ' + (b + 6),
    }, 'tree-root', 0));
    trunk.appendChild(svgEl('line', { x1: cx - ground, x2: cx + (L.mobile ? 120 : ground), y1: b + 8, y2: b + 8 }, 'tree-ground'));

    /* Ствол растёт равномерно, чтобы фронт совпадал с задержками веток и камерой. */
    var bar = svgEl('path', { d: 'M' + cx + ' ' + b + ' V' + lastY, pathLength: 1 }, 'tree-bar tree-draw', START);
    bar.style.animationDuration = (b - lastY) / (b - L.top) * GROW + 's';
    bar.style.animationTimingFunction = 'linear';
    trunk.appendChild(bar);

    trunk.appendChild(svgEl('path', { d: 'M' + cx + ' ' + (lastY - 14) + ' V' + L.top }, 'tree-bar tree-bar--open', growDelay(lastY)));
    svg.appendChild(trunk);

    L.rows.forEach(function (r) { drawBranch(svg, r); });

    var nodes = svgEl('g', {}, 'tree-trunk');
    L.stages.forEach(function (s) { drawStageNode(nodes, s); });
    if (L.crown.length) nodes.appendChild(svgEl('circle', { cx: cx, cy: L.crownY, r: 9 }, 'tree-crown', growDelay(L.crownY)));
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
      if (L.mobile) {
        btn.style.left = L.stageX + 'px';
        btn.style.top = L.chipY[s.i] + 'px';
        btn.style.width = L.stageW + 'px';
      } else {
        btn.style.left = CX - 300 + 'px';
        btn.style.top = L.nodeY[s.i] - 26 + 'px';
      }
      btn.style.animationDelay = growDelay(L.nodeY[s.i]) + 's';
      btn.dataset.stage = s.i;
      frag.querySelector('[data-slot="year"]').textContent = s.year;
      frag.querySelector('[data-slot="name"]').textContent = s.name;
      stageButtons.push(btn);
      box.appendChild(frag);
    });

    var crown = canvas.querySelector('#tree-crown');
    crown.hidden = !L.crown.length;
    crown.style.left = L.cx + 24 + 'px';
    crown.style.top = L.crownY - (L.mobile ? crown.offsetHeight / 2 : 17) + 'px';
    crown.style.animationDelay = growDelay(L.crownY) + 's';
  }

  /* lab — место подписи из мобильной раскладки; без него подпись стоит у кончика ветки. */
  function addLabel(box, r, end, title, meta, main, delay, lab) {
    var frag = Screens.clone('tpl-tree-label');
    var btn = frag.querySelector('.tree-label');
    btn.dataset.branch = r.b.type;
    setColor(btn, r.b.type);
    btn.classList.add(main ? 'tree-label--main' : 'tree-label--sub');
    if (r.dir < 0) btn.classList.add('tree-label--left');
    if (lab) {
      btn.style.left = lab.x + 'px';
      btn.style.top = lab.y + 'px';
      btn.style.width = lab.w + 'px';
    } else {
      btn.style.left = (r.dir < 0 ? end[0] - 18 - 300 : end[0] + 18) + 'px';
      btn.style.top = end[1] - 14 + 'px';
    }
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
      addLabel(box, r, r.pts[3], r.b.title, mainMeta(r.b), true, d0 + 0.7, r.lab);
      r.subs.forEach(function (sb) {
        addLabel(box, r, sb.end || sb.pts[3], sb.title, String(sb.items.length), false, d0 + 1.05, sb.lab);
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

  /* Нижняя панель (мобильный режим): затемнение на весь экран и панель снизу. */
  function sheet(panel) {
    var el = document.createElement('div');
    el.className = 'tree-sheet';
    el.appendChild(panel);
    root.querySelector('.tree-screen').appendChild(el);
    return el;
  }

  function renderCard() {
    var box = canvas.querySelector('#tree-card');
    box.replaceChildren();
    if (cardSheet) { cardSheet.remove(); cardSheet = null; }

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
    if (!mobile) {
      card.style.left = CX - 44 - 390 + 'px';
      card.style.bottom = L.height - L.nodeY[stage] - 40 + 'px';
    }
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
    if (mobile) cardSheet = sheet(card);
    else box.appendChild(frag);
  }

  function pickStage(i) {
    var opening = stage !== i;
    stage = opening ? i : null;
    renderCard();
    if (opening) {
      /* Мобильный режим: карточка в панели снизу, этап поднимаем в верхнюю часть экрана. */
      var top = mobile ? L.nodeY[i] - scroller.clientHeight * 0.25 : L.nodeY[i] - 520;
      if (mobile || top < scroller.scrollTop) scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      if (hooks.pick) hooks.pick();
    } else if (hooks.close) hooks.close();
  }

  function closeCard() {
    stage = null;
    renderCard();
    if (hooks.close) hooks.close();
  }

  /* Фокус на ветке. Слой лежит поверх дерева, само дерево не трогается —
     поэтому возврат приходится на то же место. */

  var FOCUS_MS = 620;   /* совпадает с transition у .tree-focus */
  var REVIEWS_SHOWN = 3;
  var MENU_GAP = 4;     /* зазор между строкой события и меню */

  function circle(r, o) { return 'circle(' + r + 'px at ' + o[0] + 'px ' + o[1] + 'px)'; }

  /* Точка клика в координатах сцены: сцена масштабирована под окно. */
  function originOf(e) {
    if (!e || !e.detail) return [800, 450];
    var r = root.getBoundingClientRect();
    var k = mobile ? 1 : r.width / 1600;
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  }

  /* Третий элемент события — { about, photo }. Если оба пусты, событие выглядит как обычно. */
  function addDetail(box, it) {
    var d = it[2] || {};
    if (!d.about && !d.photo) return;

    var frag = Screens.clone('tpl-tree-detail');
    var thumb = frag.querySelector('[data-slot="thumb"]');
    var about = frag.querySelector('[data-slot="about"]');
    thumb.hidden = !d.photo;
    if (d.photo) {
      thumb.dataset.photo = d.photo;
      thumb.dataset.caption = it[1];
      frag.querySelector('[data-slot="img"]').src = d.photo;
    }
    about.hidden = !d.about;
    about.textContent = d.about || '';
    box.appendChild(frag);
  }

  /* Переходы события: только те, что реально откроются. */
  function eventLinks(year) {
    var list = [];
    var release = window.Gallery.nearestYear(year);
    var hall = window.Museum.hallForYear(year);
    if (release !== null) {
      list.push({ section: 'gallery', value: release, label: T.treeMenuGallery.replace('{year}', release) });
    }
    if (hall !== null) {
      list.push({ section: 'museum', value: hall, label: T.treeMenuMuseum.replace('{name}', window.MUSEUM_DATA[hall].name) });
    }
    return list;
  }

  /* Строка с переходами кликабельна; без них остаётся обычной. */
  function markLinked(row, year) {
    if (!eventLinks(year).length) return;
    row.classList.add('is-linked');
    row.dataset.year = year;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-haspopup', 'menu');
  }

  /* Меню лежит в прокручиваемом теле фокуса: едет вместе со строкой и не вылезает на шапку. */
  function openMenu(row, byKeyboard) {
    var body = focusEl.querySelector('#tree-focus-body');
    var frag = Screens.clone('tpl-tree-menu');
    menuEl = frag.firstElementChild;
    menuRow = row;
    row.classList.add('is-open');

    eventLinks(Number(row.dataset.year)).forEach(function (l) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'tree-menu__item';
      item.setAttribute('role', 'menuitem');
      item.dataset.link = l.section;
      item.dataset.value = l.value;
      item.textContent = l.label;
      menuEl.appendChild(item);
    });

    /* Мобильный режим: меню — нижней панелью, сверху год и название события. */
    if (mobile) {
      var head = document.createElement('span');
      head.className = 'tree-menu__head';
      head.textContent = row.querySelector('[data-slot="year"]').textContent + ' · ' +
        row.querySelector('[data-slot="name"]').textContent;
      menuEl.prepend(head);
      menuSheet = sheet(menuEl);
      document.addEventListener('click', onOutsideClick);
      if (byKeyboard) menuEl.querySelector('.tree-menu__item').focus();
      if (hooks.pick) hooks.pick();
      return;
    }
    body.appendChild(frag);

    /* Сцена масштабирована: экранные координаты переводим в координаты сцены. */
    var k = root.getBoundingClientRect().width / 1600;
    var r = row.getBoundingClientRect();
    var b = body.getBoundingClientRect();
    var h = menuEl.offsetHeight;
    var y = (r.bottom - b.top) / k + body.scrollTop + MENU_GAP;
    if (y + h > body.scrollTop + body.clientHeight) {
      y = Math.max(body.scrollTop, (r.top - b.top) / k + body.scrollTop - h - MENU_GAP);
    }
    menuEl.style.top = y + 'px';
    menuEl.style.left = (r.right - b.left) / k - menuEl.offsetWidth + 'px';

    document.addEventListener('click', onOutsideClick);
    if (byKeyboard) menuEl.firstElementChild.focus();
    if (hooks.pick) hooks.pick();
  }

  function closeMenu() {
    if (!menuEl) return;
    (menuSheet || menuEl).remove();
    menuSheet = null;
    menuRow.classList.remove('is-open');
    menuEl = null;
    menuRow = null;
    document.removeEventListener('click', onOutsideClick);
  }

  /* Поля вокруг сцены: клики внутри раздела разбирает onClick. */
  function onOutsideClick(e) {
    if (!root.contains(e.target)) closeMenu();
  }

  /* Что запомнить, чтобы вернуться в фокус той же ветки на то же место. */
  function snapshot() {
    return {
      focus: focus,
      origin: focusEl.dataset.origin.split(','),
      body: focusEl.querySelector('#tree-focus-body').scrollTop,
      tree: scroller.scrollTop,
    };
  }

  function followLink(btn) {
    var from = snapshot();
    closeMenu();
    if (hooks.link) hooks.link(btn.dataset.link, Number(btn.dataset.value), from);
  }

  function openPhoto(thumb) {
    var frag = Screens.clone('tpl-tree-photo');
    var img = frag.querySelector('[data-slot="img"]');
    img.src = thumb.dataset.photo;
    img.alt = thumb.dataset.caption;
    frag.querySelector('[data-slot="caption"]').textContent = thumb.dataset.caption;
    focusEl.appendChild(frag);
    photoEl = focusEl.querySelector('#tree-photo');
    if (hooks.open) hooks.open();
  }

  function closePhoto() {
    photoEl.remove();
    photoEl = null;
    if (hooks.close) hooks.close();
  }

  function focusCard(title, items, isSub, order) {
    var frag = Screens.clone('tpl-tree-focus-card');
    frag.querySelector('[data-slot="title"]').textContent = title;
    frag.querySelector('[data-slot="meta"]').textContent = items.length + ' ' + Screens.plural(items.length, T.eventForms);
    frag.querySelector('[data-slot="icon"]').hidden = !isSub;

    var dated = items.filter(function (it) { return yearOf(it[0]) !== null; });
    var pending = items.filter(function (it) { return yearOf(it[0]) === null; });

    var rows = frag.querySelector('[data-slot="rows"]');
    dated.forEach(function (it, j) {
      var row = Screens.clone('tpl-tree-focus-row');
      var el = row.querySelector('.tree-event');
      el.style.animationDelay = 0.35 + 0.05 * order.n++ + 's';
      el.classList.toggle('is-first', j === 0);
      el.classList.toggle('is-last', j === dated.length - 1);
      row.querySelector('[data-slot="year"]').textContent = it[0];
      row.querySelector('[data-slot="name"]').textContent = it[1];
      addDetail(row.querySelector('[data-slot="body"]'), it);
      markLinked(el, yearOf(it[0]));
      rows.appendChild(row);
    });

    var box = frag.querySelector('[data-slot="pending"]');
    box.hidden = !pending.length;
    box.style.animationDelay = 0.35 + 0.05 * order.n++ + 's';
    var list = frag.querySelector('[data-slot="pending-list"]');
    pending.forEach(function (it) {
      var row = Screens.clone('tpl-tree-focus-pending');
      row.querySelector('[data-slot="name"]').textContent = it[1];
      addDetail(row.querySelector('[data-slot="body"]'), it);
      list.appendChild(row);
    });
    return frag;
  }

  /* Свежие отзывы направления; если их нет, блока нет. */
  function reviewsBlock(b, order) {
    var cards = window.Reviews.latestCards(b.title, REVIEWS_SHOWN);
    if (!cards.length) return null;

    var frag = Screens.clone('tpl-tree-reviews');
    var block = frag.firstElementChild;
    block.style.animationDelay = 0.35 + 0.05 * order.n++ + 's';
    cards.forEach(function (c) { frag.querySelector('[data-slot="list"]').appendChild(c); });
    return block;
  }

  /* Блок «Сегодня»: без text его нет, без link нет кнопки. */
  function todayBlock(b, order) {
    var today = b.today || {};
    if (!today.text) return null;

    var frag = Screens.clone('tpl-tree-today');
    frag.firstElementChild.style.animationDelay = 0.35 + 0.05 * order.n++ + 's';
    frag.querySelector('[data-slot="text"]').textContent = today.text;
    var link = frag.querySelector('[data-slot="link"]');
    link.hidden = !today.link;
    if (today.link) link.href = today.link;
    return frag.firstElementChild;
  }

  /* Подсказка с полным названием — только если оно обрезано. */
  function setNavName(el, title) {
    el.textContent = title;
    el.closest('button').title = el.scrollWidth > el.clientWidth ? title : '';
  }

  function renderFocus() {
    var branches = window.HISTORY_DATA.branches;
    var n = branches.length;
    var b = branches[focus];
    var slot = function (name) { return focusEl.querySelector('[data-slot="' + name + '"]'); };
    var fy = firstYear(b);

    closeMenu();
    setColor(focusEl, b.type);
    slot('kicker').textContent = T.treeDirection + ' · ' + String(focus + 1).padStart(2, '0') + ' / ' + n + ' · ' +
      (fy !== null ? T.treeFirstEvent + ' ' + fy : T.treeStartPending);
    slot('title').textContent = b.title;
    setNavName(slot('prev'), branches[(focus + n - 1) % n].title);
    setNavName(slot('next'), branches[(focus + 1) % n].title);

    var order = { n: 0 };
    var subs = b.subbranches || [];
    var grid = slot('grid');
    grid.classList.toggle('is-two', subs.length > 0);

    var main = document.createElement('div');
    main.className = 'tree-focus__col';
    main.appendChild(focusCard(T.treeMainBranch, b.items, false, order));
    var cols = [main];

    if (subs.length) {
      var side = document.createElement('div');
      side.className = 'tree-focus__col';
      subs.forEach(function (sb) { side.appendChild(focusCard(sb.title, sb.items, true, order)); });
      cols.push(side);
    }

    var reviews = reviewsBlock(b, order);
    if (reviews) cols.push(reviews);

    var today = todayBlock(b, order);
    if (today) cols.push(today);

    grid.replaceChildren.apply(grid, cols);
    focusEl.querySelector('#tree-focus-body').scrollTop = 0;
  }

  function mountFocus(index, origin) {
    root.querySelector('.tree-screen').appendChild(Screens.clone('tpl-tree-focus'));
    focusEl = root.querySelector('.tree-focus');
    focusEl.dataset.origin = origin.join(',');
    focus = index;
    renderFocus();
  }

  /* Возврат из другого раздела: рост и раскрытие не проигрываем, всё сразу на прежнем месте. */
  function restore(snap) {
    canvas.classList.add('is-static');
    scroller.scrollTop = snap.tree;
    mountFocus(snap.focus, snap.origin);
    focusEl.classList.add('is-static');
    focusEl.style.clipPath = circle(2000, snap.origin);
    focusEl.querySelector('#tree-focus-body').scrollTop = snap.body;
  }

  function openFocus(type, e) {
    var index = window.HISTORY_DATA.branches.findIndex(function (b) { return b.type === type; });
    var origin = originOf(e);

    stopCamera();
    clearTimeout(closeTimer);
    if (focusEl) focusEl.remove();
    setHover(null);
    if (stage !== null) { stage = null; renderCard(); }

    mountFocus(index, origin);
    focusEl.style.clipPath = circle(0, origin);

    /* Два кадра: первое значение clip-path должно попасть в отрисовку, иначе перехода не будет. */
    var el = focusEl;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.style.clipPath = circle(2000, origin); });
    });
    if (hooks.open) hooks.open();
  }

  function closeFocus() {
    if (focus === null) return;
    var el = focusEl;
    focus = null;
    el.style.clipPath = circle(0, el.dataset.origin.split(','));
    closeTimer = setTimeout(function () {
      el.remove();
      if (focusEl === el) focusEl = null;
    }, FOCUS_MS);
    if (hooks.close) hooks.close();
  }

  function stepFocus(delta) {
    if (focus === null) return;
    var n = window.HISTORY_DATA.branches.length;
    focus = (focus + delta + n) % n;
    focusEl.classList.remove('is-static');
    renderFocus();
    if (hooks.step) hooks.step();
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
    if (photoEl) {
      if (!el.closest('.tree-photo__img')) closePhoto();
      return;
    }
    /* Касание затемнения вокруг нижней панели закрывает её. */
    if (el.classList.contains('tree-sheet')) {
      if (menuEl) closeMenu();
      else closeCard();
      return;
    }
    var link = el.closest('[data-link]');
    if (link) { followLink(link); return; }
    if (el.closest('#tree-menu')) return;

    /* Клик мимо закрывает меню и срабатывает как обычно; по той же строке — только закрывает. */
    var wasOpen = menuRow;
    closeMenu();

    var thumb = el.closest('.tree-detail__thumb');
    if (thumb) { openPhoto(thumb); return; }
    var row = el.closest('.tree-event.is-linked');
    if (row) {
      if (row !== wasOpen) openMenu(row, false);
      return;
    }
    if (el.closest('#tree-reviews-all')) {
      if (hooks.link) hooks.link('reviews', window.HISTORY_DATA.branches[focus].title, snapshot());
      return;
    }

    if (el.closest('#tree-focus-back')) { closeFocus(); return; }
    if (el.closest('#tree-focus-prev')) { stepFocus(-1); return; }
    if (el.closest('#tree-focus-next')) { stepFocus(1); return; }

    var stageBtn = el.closest('[data-stage]');
    if (stageBtn) { pickStage(Number(stageBtn.dataset.stage)); return; }
    if (el.closest('#tree-card-close')) { closeCard(); return; }

    var pick = el.closest('[data-pick]');
    if (pick) { openFocus(pick.dataset.pick, e); return; }
    var branch = el.closest('[data-branch]');
    if (branch) openFocus(branch.dataset.branch, e);
  }

  /* snap — необязательно: снимок snapshot(), чтобы вернуться в фокус ветки. */
  function init(el, h, snap) {
    stopCamera();
    clearTimeout(closeTimer);
    root = el;
    hooks = h || {};
    mobile = Screens.isMobile();
    stage = null;
    hover = null;
    focus = null;
    focusEl = null;
    photoEl = null;
    menuEl = null;
    menuSheet = null;
    cardSheet = null;
    hotItems = [];
    leaves = [];
    stageNodes = [];
    stageButtons = [];

    root.replaceChildren(Screens.clone('tpl-history-tree'));
    scroller = root.querySelector('#tree-scroll');
    canvas = root.querySelector('#tree-canvas');
    /* Мобильной раскладке нужна ширина экрана и уже отрисованные подписи для замера. */
    L = mobile ? layoutMobile(scroller.clientWidth) : layout();
    canvas.style.height = L.height + 'px';

    drawSvg();
    renderStages();
    renderLabels();

    root.addEventListener('click', onClick);
    /* Подсветка ветки — только под мышью: на телефоне касание оставило бы её включённой. */
    if (!mobile) {
      canvas.addEventListener('mouseover', onOver);
      canvas.addEventListener('mouseleave', function () { setHover(null); });
    }

    /* Любое действие пользователя сразу отдаёт ему камеру; рост дерева при этом продолжается. */
    ['wheel', 'pointerdown', 'touchstart'].forEach(function (name) {
      root.addEventListener(name, stopCamera, { passive: true, capture: true });
    });

    if (snap) restore(snap);
    else startCamera();
  }

  var SCROLL_KEYS = { ArrowUp: -80, ArrowDown: 80, PageUp: -600, PageDown: 600 };

  function key(e) {
    stopCamera();
    if (photoEl) {
      if (e.key === 'Escape') closePhoto();
      return true;
    }
    if (menuEl && e.key === 'Escape') {
      var openRow = menuRow;
      closeMenu();
      openRow.focus({ preventScroll: true });
      return true;
    }
    var active = document.activeElement;
    if ((e.key === 'Enter' || e.key === ' ') && active && active.matches('.tree-event.is-linked')) {
      e.preventDefault();
      closeMenu();
      openMenu(active, true);
      return true;
    }
    if (focus !== null) {
      if (e.key === 'Escape') { closeFocus(); return true; }
      if (e.key === 'ArrowLeft') { stepFocus(-1); return true; }
      if (e.key === 'ArrowRight') { stepFocus(1); return true; }
    }
    /* Клавиши прокрутки двигают то, что сейчас на экране: карточки фокуса или дерево. */
    var view = focus !== null ? focusEl.querySelector('#tree-focus-body') : scroller;
    if (SCROLL_KEYS[e.key]) {
      view.scrollBy({ top: SCROLL_KEYS[e.key], behavior: 'smooth' });
      return true;
    }
    if (e.key === 'Home') { view.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
    if (e.key === 'End') { view.scrollTo({ top: view.scrollHeight, behavior: 'smooth' }); return true; }
    if (e.key === 'Escape' && stage !== null) { closeCard(); return true; }
    return false;
  }

  return { init: init, key: key };
})();
