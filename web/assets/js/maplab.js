/* ============================================================
   以下犯上 · 跑图（Map Lab）
   - 不依赖外部图片读像素：碰撞来自 data/maps/maps.json 的网格
   - 第一人称俯视：WASD 走位、鼠标转视角、滚轮缩放、小地图、点位提示
   - 点位坐标来自 valorant-api.com，经 pipeline/calibrate_maps.py 标定
   ============================================================ */
(function () {
'use strict';

var MAPS = (window.VD_MAPS || {}).maps || {};
var VIEW_FIT = 1.0;    // 视距系数：越大看得越远（测试可通过 ML.setFit 调整）
var ORDER = ['ascent', 'split', 'bind', 'haven', 'lotus', 'sunset', 'pearl', 'icebox', 'breeze',
             'fracture', 'abyss', 'corrode', 'summit'];
var SITES_CN = { A: 'A 点', B: 'B 点', C: 'C 点', Mid: '中路', 'Attacker Side': '进攻方出生点', 'Defender Side': '防守方出生点' };

var S = {
  slug: null, map: null, grid: null,
  px: 0, py: 0, yaw: 0, pitch: 0,
  keys: {}, zoom: 1, running: false,
  showPoints: true, showPaths: false, showMinimap: true,
  speed: 0, lastT: 0, raf: null, mode: 'top', locked: false,
  marked: [], // 走过的轨迹
};

function $(s, r) { return (r || document).querySelector(s); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 世界坐标 <-> 像素
   method='official' 是官方标定（轴对调）：u = y*xMultiplier + xScalarToAdd，v = x*yMultiplier + yScalarToAdd
   method='fitted'   是几何拟合：px = (x - x0)/s + dx，py = (y0 - y)/s + dy */
function w2p(m, x, y) {
  if (m.method === 'official') {
    return [(y * m.xMultiplier + m.xScalarToAdd) * m.size[0],
            (x * m.yMultiplier + m.yScalarToAdd) * m.size[1]];
  }
  return [(x - m.x0) / m.s + m.dx, (m.y0 - y) / m.s + m.dy];
}
function p2w(m, px, py) {
  if (m.method === 'official') {
    return [(py / m.size[1] - m.yScalarToAdd) / m.yMultiplier,
            (px / m.size[0] - m.xScalarToAdd) / m.xMultiplier];
  }
  return [m.x0 + (px - m.dx) * m.s, m.y0 - (py - m.dy) * m.s];
}
function inb(m, x, y) { return x >= 0 && y >= 0 && x < m.size[0] && y < m.size[1]; }

/* 碰撞：世界坐标 -> 网格 -> 是否实心 */
function blocked(m, x, y) {
  var p = w2p(m, x, y);
  var g = m.grid;
  var c = Math.floor(p[0] / m.size[0] * g.w);
  var r = Math.floor(p[1] / m.size[1] * g.h);
  if (r < 0 || c < 0 || r >= g.h || c >= g.w) return true;    // 网格外 = 不可走（不让人跑出地图）
  return g.rows[r].charCodeAt(c) === 49;
}

/* 出生点：优先官方 Spawn 点位，否则用离点位质心最远的可走点 */
function nearestWalkable(m, wx, wy) {
  var g = m.grid, best = null, bd = Infinity;
  for (var r = 0; r < g.h; r++) {
    var row = g.rows[r];
    for (var c = 0; c < g.w; c++) {
      if (row.charCodeAt(c) === 49) continue;
      var px = (c + .5) / g.w * m.size[0], py = (r + .5) / g.h * m.size[1];
      var w = p2w(m, px, py);
      var d = (w[0] - wx) * (w[0] - wx) + (w[1] - wy) * (w[1] - wy);
      if (d < bd) { bd = d; best = [px, py]; }
    }
  }
  return best;
}

function spawnOf(m, side) {
  var want = side === 'def' ? 'Defender Side' : 'Attacker Side';
  var c = m.callouts.filter(function (x) { return x.s === want; })[0];
  if (c) {
    // 官方出生点坐标 -> 吸附到最近的可走格（坐标可能落在实心/图外）
    var np = nearestWalkable(m, c.x, c.y);
    if (np) return np;
  }
  // 兜底：可走区里离地图中心最近的格
  var g = m.grid, cx = Math.floor(g.w / 2), cy = Math.floor(g.h / 2);
  for (var rad = 0; rad < Math.max(g.w, g.h); rad++) {
    for (var dy = -rad; dy <= rad; dy++) {
      for (var dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
        var r = cy + dy, cc = cx + dx;
        if (r < 0 || cc < 0 || r >= g.h || cc >= g.w) continue;
        if (g.rows[r][cc] === '0') return [(cc + .5) / g.w * m.size[0], (r + .5) / g.h * m.size[1]];
      }
    }
  }
  return [m.size[0] / 2, m.size[1] / 2];
}

function spawnOfOld(m, side) {
  var want = side === 'def' ? 'Defender Side' : 'Attacker Side';
  var cs = m.callouts.filter(function (c) { return c.s === want; });   // 图外也拿来当锚点
  if (cs.length) {
    var c = cs[0], p = w2p(m, c.x, c.y), g = m.grid;
    if (inb(m, p[0], p[1]) && !blocked(m, c.x, c.y) && p[0] > 0 && p[1] > 0) return p;
    // 官方坐标落在图外/实心区时：在可走区里找最近的点
    var best = null, bd = 1e18;
    for (var r = 1; r < g.h - 1; r++) {
      for (var cc = 1; cc < g.w - 1; cc++) {
        if (g.rows[r].charCodeAt(cc) === 49) continue;
        var px = (cc + .5) / g.w * m.size[0], py = (r + .5) / g.h * m.size[1];
        var w = p2w(m, px, py);
        var d = (w[0] - c.x) * (w[0] - c.x) + (w[1] - c.y) * (w[1] - c.y);
        if (d < bd) { bd = d; best = [px, py]; }
      }
    }
    if (best) return best;
  }
  // 退化：在地图可走区域里，找离「所有点位质心」最远的可走点
  var g = m.grid, cx = 0, cy = 0, n = 0;
  m.callouts.forEach(function (c) { var p = w2p(m, c.x, c.y); if (inb(m, p[0], p[1])) { cx += p[0]; cy += p[1]; n++; } });
  cx = n ? cx / n : m.size[0] / 2; cy = n ? cy / n : m.size[1] / 2;
  var best = null, bd = -1;
  for (var r = 2; r < g.h - 2; r += 2) {
    for (var cc = 2; cc < g.w - 2; cc += 2) {
      if (g.rows[r].charCodeAt(cc) === 49) continue;
      var px = (cc + .5) / g.w * m.size[0], py = (r + .5) / g.h * m.size[1];
      var d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d > bd) { bd = d; best = [px, py]; }
    }
  }
  return best || [m.size[0] / 2, m.size[1] / 2];
}

/* ---------------- 渲染 ---------------- */
var view, ctx, mini, mctx, imgCache = {};

function proxySrc(rel) {
  // 原生 App 里走同源代理（绕开 file:// 的 canvas 污染与跨域），网页版直接相对路径
  if (window.__NATIVE_HOST__ || location.protocol === 'http:' || location.protocol === 'https:') {
    try {
      var abs = new URL(rel, location.href).href;
      return '/proxy?u=' + encodeURIComponent(abs);
    } catch (e) { return rel; }
  }
  return rel;
}

function loadImg(src) {
  if (imgCache[src]) return imgCache[src];
  var im = new Image();
  im.onload = function () { if (S.running) { draw(); drawMini(); } };
  im.onerror = function () {
    // 代理失败/网络异常时回退直连
    if (!im.__fallback && im.src.indexOf('/proxy') >= 0) { im.__fallback = true; im.src = src; }
  };
  im.src = proxySrc(src);
  imgCache[src] = im;
  return im;
}

function clampZoom(z) { return Math.max(0.45, Math.min(3.2, z)); }

function draw() {
  window.__drawCalls = (window.__drawCalls || 0) + 1;
  if (!S.map || !view) return;
  var W = view.width, H = view.height, m = S.map;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#05080a';
  ctx.fillRect(0, 0, W, H);

  // 第一人称俯视：相机在玩家位置，视野朝 yaw
  // 画布像素 → 世界像素的缩放：视口窄边放大约 1.4 倍地图宽度
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var scale = clampZoom(S.zoom) * VIEW_FIT * (Math.min(W / dpr, H / dpr) / (m.size[0] * 1.05)) * dpr;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(S.yaw);
  ctx.scale(scale, scale);
  ctx.translate(-S.px, -S.py);
  var im = loadImg(m.img);
  if (im.complete && im.naturalWidth) ctx.drawImage(im, 0, 0, m.size[0], m.size[1]);
  else { ctx.fillStyle = '#20292e'; ctx.fillRect(0, 0, m.size[0], m.size[1]); }

  // 点位：只给离玩家最近的几个画文字，其余只画点
  var near6 = [];
  if (S.showPoints && m.calibrated) {
    var sorted = m.callouts.filter(function (c) { return !c.o; }).map(function (c) {
      var p0 = w2p(m, c.x, c.y);
      return { c: c, p: p0, d: (p0[0] - S.px) * (p0[0] - S.px) + (p0[1] - S.py) * (p0[1] - S.py) };
    }).sort(function (a, b) { return a.d - b.d; });
    near6 = sorted.slice(0, 6).map(function (x) { return x.c; });
  }
  if (S.showPoints && m.calibrated) {
    m.callouts.forEach(function (c) {
      if (c.o) return;
      var p = w2p(m, c.x, c.y);
      ctx.beginPath();
      ctx.arc(p[0], p[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = c.ok ? 'rgba(79,227,200,.18)' : 'rgba(255,70,85,.16)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = c.ok ? 'rgba(79,227,200,.85)' : 'rgba(255,70,85,.7)';
      ctx.stroke();
      if (near6.indexOf(c) < 0) return;   // 只画点，不画文字（外层 save/restore 在循环外）
      ctx.save();
      ctx.translate(p[0] + 13, p[1] + 6);
      ctx.rotate(-S.yaw);
      ctx.font = '600 15px "PingFang SC","Avenir Next",sans-serif';
      var label = c.zh || c.n;
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(5,8,10,.62)';
      ctx.fillRect(-3, -13, tw + 8, 19);
      ctx.fillStyle = c.ok ? 'rgba(234,229,218,.95)' : 'rgba(255,140,130,.95)';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });
  }
  ctx.restore();

  // 屏幕中心的准星与方向标
  ctx.save();
  ctx.strokeStyle = 'rgba(255,70,85,.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 9); ctx.lineTo(W / 2, H / 2 - 3);
  ctx.moveTo(W / 2, H / 2 + 3); ctx.lineTo(W / 2, H / 2 + 9);
  ctx.moveTo(W / 2 - 9, H / 2); ctx.lineTo(W / 2 - 3, H / 2);
  ctx.moveTo(W / 2 + 3, H / 2); ctx.lineTo(W / 2 + 9, H / 2);
  ctx.stroke();
  // 视野扇形
  ctx.beginPath();
  ctx.moveTo(W / 2, H / 2);
  ctx.arc(W / 2, H / 2, H * 0.42, -Math.PI / 2 - Math.PI / 6, -Math.PI / 2 + Math.PI / 6);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,70,85,.05)';
  ctx.fill();
  ctx.restore();

  drawMini();
  drawHud();
}

function drawMini() {
  if (!mini || !S.map) return;
  var m = S.map, w = mini.width, h = mini.height;
  mctx.clearRect(0, 0, w, h);
  mctx.drawImage(loadImg(m.img), 0, 0, w, h);
  // 点位：只给离玩家最近的几个画文字，其余只画点
  var near6 = [];
  if (S.showPoints && m.calibrated) {
    var sorted = m.callouts.filter(function (c) { return !c.o; }).map(function (c) {
      var p0 = w2p(m, c.x, c.y);
      return { c: c, p: p0, d: (p0[0] - S.px) * (p0[0] - S.px) + (p0[1] - S.py) * (p0[1] - S.py) };
    }).sort(function (a, b) { return a.d - b.d; });
    near6 = sorted.slice(0, 6).map(function (x) { return x.c; });
  }
  if (S.showPoints && m.calibrated) {
    m.callouts.forEach(function (c) {
      if (c.o) return;
      var p = w2p(m, c.x, c.y);
      mctx.beginPath(); mctx.arc(p[0] / m.size[0] * w, p[1] / m.size[1] * h, 2.2, 0, Math.PI * 2);
      mctx.fillStyle = c.ok ? '#4fe3c8' : '#ff4655';
      mctx.fill();
    });
  }
  // 玩家
  var px = S.px / m.size[0] * w, py = S.py / m.size[1] * h;
  mctx.save();
  mctx.translate(px, py);
  mctx.rotate(S.yaw);
  mctx.beginPath();
  mctx.moveTo(0, -7); mctx.lineTo(5, 6); mctx.lineTo(0, 3); mctx.lineTo(-5, 6); mctx.closePath();
  mctx.fillStyle = '#ff4655';
  mctx.fill();
  mctx.restore();
}

function nearestPoint() {
  var m = S.map, best = null, bd = 1e18;
  if (!m.calibrated) return null;
  m.callouts.forEach(function (c) {
    if (c.o) return;
    var p = w2p(m, c.x, c.y);
    var d = (p[0] - S.px) * (p[0] - S.px) + (p[1] - S.py) * (p[1] - S.py);
    if (d < bd) { bd = d; best = c; }
  });
  return best ? { c: best, dist: Math.sqrt(bd) * m.s } : null;
}

function drawHud() {
  var near = nearestPoint();
  var el = $('#mlZone');
  if (el) el.textContent = near ? (near.c.zh || near.c.n) + ' · ' + Math.round(near.dist) + 'u' : '—';
  var sp = $('#mlSpeed');
  if (sp) sp.textContent = Math.round(S.speed) + ' u/s';
}

/* ---------------- 移动 ---------------- */
function loop(t) {
  if (!S.running) return;
  
  var dt = S.lastT ? Math.min(0.05, (t - S.lastT) / 1000) : 0;
  S.lastT = t;
  if (dt > 0 && S.map) {
    var ax = 0, ay = 0;
    if (S.keys.w) ay -= 1;
    if (S.keys.s) ay += 1;
    if (S.keys.a) ax -= 1;
    if (S.keys.d) ax += 1;
    var moving = ax || ay;
    var len = Math.hypot(ax, ay) || 1;
    var spd = (S.keys.shift ? 8.6 : 6.75) * 1000 / S.map.s;  // 世界单位/秒
    S.speed = moving ? spd : 0;
    if (moving) {
      // 以 yaw 为朝向：前 = 屏幕上方
      var ca = Math.cos(-S.yaw), sa = Math.sin(-S.yaw);
      var wx = (ax / len) * ca - (ay / len) * sa;
      var wy = (ax / len) * sa + (ay / len) * ca;
      var nx = S.px + wx * spd * dt, ny = S.py + wy * spd * dt;
      var w = p2w(S.map, nx, ny);
      // 分轴尝试，可贴墙滑动
      if (!blocked(S.map, w[0], w[1])) { S.px = nx; S.py = ny; }
      else {
        var w1 = p2w(S.map, nx, S.py);
        if (!blocked(S.map, w1[0], w1[1])) S.px = nx;
        var w2 = p2w(S.map, S.px, ny);
        if (!blocked(S.map, w2[0], w2[1])) S.py = ny;
      }
    }
  }
  draw();
  window.__drawn = (window.__drawn || 0) + 1;
  window.__lastView = view ? view.width + 'x' + view.height : 'noview';
  window.__lastCtx = ctx ? 'ctx' : 'noctx';
  S.raf = requestAnimationFrame(loop);
}

/* ---------------- 外壳 ---------------- */
function enter(slug) {
  S.slug = slug;
  S.map = MAPS[slug];
  if (!S.map) return;
  var sp = spawnOf(S.map, 'atk');
  S.px = sp[0]; S.py = sp[1]; S.yaw = 0; S.pitch = 0; S.zoom = 1.25;
  S.keys = {}; S.speed = 0; S.lastT = 0;
  render();
  sizeCanvas();
  S.running = true;
  // 图片可能在首次绘制之后才解码完成（离屏 WKWebView 里 onload 会晚到），兜底轮询重绘
  var im0 = loadImg(S.map.img);
  var tries = 0;
  clearInterval(S._poll);
  S._poll = setInterval(function () {
    if (!S.running) { clearInterval(S._poll); return; }
    tries++;
    if (im0.complete && im0.naturalWidth) {
      draw(); drawMini();
      if (tries > 2) clearInterval(S._poll);
    } else if (tries > 40) { clearInterval(S._poll); }
  }, 120);
  try { draw(); } catch (e) {
    window.__errs = window.__errs || []; window.__errs.push('draw:' + (e && e.message)); throw e;
  }
  if (S.raf) cancelAnimationFrame(S.raf);
  S.raf = requestAnimationFrame(loop);
  // 焦点，让键盘生效
  var v = $('#mlView');
  if (v) v.focus();
}

function exit() {
  S.running = false;
  if (S.raf) cancelAnimationFrame(S.raf);
  S.raf = null;
  releasePointer();
}

function sizeCanvas() {
  var v = $('#mlView');
  if (!v) return;
  var r = v.getBoundingClientRect();
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  v.width = Math.max(320, Math.round(r.width * dpr));
  v.height = Math.max(240, Math.round(r.height * dpr));
  var mi = $('#mlMini');
  if (mi) { mi.width = 176 * dpr; mi.height = 176 * dpr; }
}

function render() {
  var m = S.map;
  var zone = $('#ml-zone');
  if (zone) {
    zone.innerHTML =
      '<div class="ml-zone-head"><div class="kicker"><span></span>MAP LAB / 跑图</div>' +
        '<div class="mz-title"><h2>' + esc(m.zh) + '</h2><em>' + esc(m.name) + ' · ' + esc(m.place) + '</em></div>' +
        '<p class="mz-sub">' + esc(m.sites) + '　·　碰撞网格 ' + m.grid.w + '×' + m.grid.h + ' @' + m.grid.cell + 'u' +
          '　·　点位标定 ' + (m.calibrated ? (m.calib * 100).toFixed(0) + '%' :
            '<span style="color:#ff7a6d">未达标 ' + (m.calib * 100).toFixed(0) + '%（本图暂不显示点位）</span>') + '</p></div>' +
      '<div class="ml-panel"><div class="ml-panel-h">点位 / CALLOUTS' +
        (m.calibrated ? ' <span class="tag t">' + m.callouts.filter(function (c) { return c.ok; }).length + ' 已标定</span>' : '') +
        '</div><div class="ml-points">' +
        (m.calibrated ? m.callouts.filter(function (c) { return !c.o; }).map(function (c) {
          return '<button class="ml-pt' + (c.ok ? '' : ' bad') + '" data-jump="' + esc(c.n) + '" data-x="' + c.x + '" data-y="' + c.y + '">' +
            '<span>' + esc(c.zh || c.n) + '</span><small>' + esc(SITES_CN[c.s] || c.s) + '</em></small></button>';
        }).join('') : '<div class="empty" style="padding:14px;text-align:left">这张图的点位坐标与俯视图对不上（标定 ' + (m.calib * 100).toFixed(0) +
          '% < 70% 门槛），为了不给你错的位置，这里不显示点位。走图本身可用。</div>') +
        '</div></div>' +
      '<div class="ml-tips"><b>操作</b><br>WASD 走位 · Shift 疾跑<br>鼠标 / ←→↑↓ 转视角<br>滚轮缩放 · Q/E 视角斜切<br>' +
      '<b>提示</b><br>点位 <span style="color:#4fe3c8">青色</span> = 坐标落在实心地面；<span style="color:#ff7a6d">红色</span> = 坐标不在实心区（可能是空中点位或标定偏差）</div>';
  }
  var list = ORDER.filter(function (k) { return MAPS[k]; });
  var bar = $('#ml-bar');
  if (bar) {
    bar.innerHTML = list.map(function (k) {
      var x = MAPS[k];
      return '<button class="ml-chip' + (k === S.slug ? ' on' : '') + '" data-map="' + k + '">' +
        '<b>' + esc(x.zh) + '</b><span>' + esc(x.name) + '</span></button>';
    }).join('');
  }
}

function jumpTo(x, y) {
  var p = w2p(S.map, x, y);
  S.px = p[0]; S.py = p[1];
}

/* ---------------- 输入 ---------------- */
function releasePointer() {
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
}

function bindInput() {
  document.addEventListener('keydown', function (e) {
    if (S.view !== 'maplab' || !S.running) return;
    var k = e.key.toLowerCase();
    if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'shift') { S.keys[k] = true; if (k !== 'shift') e.preventDefault(); }
    if (k === 'arrowleft') { S.yaw -= 0.06; e.preventDefault(); }
    if (k === 'arrowright') { S.yaw += 0.06; e.preventDefault(); }
    if (k === 'arrowup') { S.zoom = Math.min(3, S.zoom * 1.08); e.preventDefault(); }
    if (k === 'arrowdown') { S.zoom = Math.max(0.45, S.zoom / 1.08); e.preventDefault(); }
  });
  document.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (k in S.keys) S.keys[k] = false;
  });
}

function bindCanvas() {
  var v = $('#mlView');
  if (!v) return;
  v.addEventListener('mousemove', function (e) {
    if (!S.running) return;
    if (document.pointerLockElement === v) {
      S.yaw += e.movementX * 0.0026;
      S.zoom = Math.max(0.45, Math.min(3, S.zoom * (1 - e.movementY * 0.0012)));
    }
  });
  v.addEventListener('click', function () {
    if (!S.running) return;
    try { v.requestPointerLock(); } catch (e) {}
  });
  v.addEventListener('wheel', function (e) {
    if (!S.running) return;
    e.preventDefault();
    S.zoom = Math.max(0.45, Math.min(3, S.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
  }, { passive: false });
  document.addEventListener('pointerlockchange', function () {
    S.locked = document.pointerLockElement === v;
    var hint = $('#mlLock'); if (hint) hint.textContent = S.locked ? '鼠标视角已锁定 · ESC 释放' : '点击画面锁定鼠标';
  });
}

window.addEventListener('resize', function () { if (S.running) sizeCanvas(); });

bindInput();

window.__ML_LOADED = true;
window.ML = {
  enter: enter,
  exit: exit,
  rebind: function () { var v = $('#mlView'); if (v && !v.__bound) { bindCanvas(); v.__bound = true; } },
  map: function () { return S.map; },
  jump: jumpTo,
  set: function (props) {
    if (!S.map) return;
    // 只接受白名单字段，调试/测试用：把「世界坐标」映射到像素
    if (props.world) { var p = w2p(S.map, props.world[0], props.world[1]); S.px = p[0]; S.py = p[1]; }
    if (props.x != null) S.px = props.x;
    if (props.y != null) S.py = props.y;
    if (props.yaw != null) S.yaw = props.yaw;
    if (props.zoom != null) S.zoom = clampZoom(props.zoom);
    draw(); drawMini();
  },
  state: function () { return { slug: S.slug, px: S.px, py: S.py, yaw: S.yaw, zoom: S.zoom, speed: S.speed, running: S.running }; },
  advance: function (ms) {   // 手动推进模拟这么久（离屏渲染不跑 rAF 时用来验证移动/碰撞）
    var dt = Math.min(0.05, ms / 1000);
    var ax = 0, ay = 0;
    if (S.keys.w) ay -= 1;
    if (S.keys.s) ay += 1;
    if (S.keys.a) ax -= 1;
    if (S.keys.d) ax += 1;
    var spd = (S.keys.shift ? 8.6 : 6.75) * 1000 / S.map.s;
    if (ax || ay) {
      var len = Math.hypot(ax, ay);
      var ca = Math.cos(-S.yaw), sa = Math.sin(-S.yaw);
      var wx = (ax / len) * ca - (ay / len) * sa;
      var wy = (ax / len) * sa + (ay / len) * ca;
      var nx = S.px + wx * spd * dt, ny = S.py + wy * spd * dt;
      var w = p2w(S.map, nx, ny);
      if (!blocked(S.map, w[0], w[1])) { S.px = nx; S.py = ny; }
      else {
        var w1 = p2w(S.map, nx, S.py);
        if (!blocked(S.map, w1[0], w1[1])) S.px = nx;
        var w2 = p2w(S.map, S.px, ny);
        if (!blocked(S.map, w2[0], w2[1])) S.py = ny;
      }
    }
    draw(); drawMini();
    return { px: S.px, py: S.py, speed: (ax || ay) ? spd : 0 };
  },
  press: function (k, down) { S.keys[k] = !!down; },
  blockedAt: function (x, y) { var w = p2w(S.map, x, y); return blocked(S.map, w[0], w[1]); },
  setView: function (el, mEl) { view = el; ctx = el && el.getContext('2d'); mini = mEl; mctx = mEl && mEl.getContext('2d'); },
  blocked: function (x, y) { return blocked(S.map, x, y); },
  resize: sizeCanvas,
  spawn: function (side) { return spawnOf(S.map, side); },
  setFit: function (f) { VIEW_FIT = Math.max(0.4, Math.min(4, f)); draw(); drawMini(); },
  draw: draw
};
})();
