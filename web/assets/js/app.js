/* ============================================================
   以下犯上 · VALORANT INTEL — 前端主程序
   ============================================================ */
(function () {
'use strict';

var META = window.VD_META || {};
var CORE = window.VD_CORE || { players: [], teams: [] };
var INTEL = window.VD_INTEL || { upcoming: [], news: [] };
var ROSTER = window.VD_ROSTER || {};

/* ---------------- 工具 ---------------- */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function num(n) { return String(n == null ? 0 : n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function pct(x) { return (x * 100).toFixed(x >= 0.995 || x <= 0.005 ? 0 : 1); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function flag(code) {
  if (!code || !/^[a-z]{2}$/i.test(code)) return '';
  var c = code.toLowerCase(), base = 0x1F1E6;
  return String.fromCodePoint(base + c.charCodeAt(0) - 97, base + c.charCodeAt(1) - 97);
}
function isoToday() { return new Date().toISOString().slice(0, 10); }
function dateCn(iso) {
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00');
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}
function md(iso) { return iso ? iso.slice(5).replace('-', '.') : ''; }
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function teamTag(t) {
  if (!t) return '?';
  if (typeof t === 'string') { var o = teamOf(t); return o.tag || String(o.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase(); }
  return t.tag || String(t.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
}
function accentOf(name) {
  var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ['', 't', 'g', 'b'][h % 4];
}
function badge(t, cls) {
  var o = typeof t === 'string' ? teamOf(t) : (t || {});
  var nm = o.name || '?';
  var acc = accentOf(nm);
  return '<span class="badge ' + (cls || '') + '" data-accent="' + acc + '">' + esc(teamTag(o)) + '</span>';
}

/* ---------------- 数据 ---------------- */
var TEAMS = CORE.teams.map(function (t) {
  return { name: t[0], zh: t[1], tag: t[2], country: t[3], flag: t[4], region: t[5],
           elo: t[6], n: t[7], w: t[8], l: t[9], first: t[10], last: t[11],
           en: t[12], created: t[13], disbanded: t[14], form: t[15] || 0, lastDate: t[16] || '' };
});
var PLAYERS = CORE.players.map(function (p) {
  return { handle: p[0], real: p[1], country: p[2], status: p[3], years: p[4],
           birth: p[5], retired: p[6], vlr: p[7], team: p[8], aliases: p[9],
           n: p[10], wr: p[11], vct: p[12] || 0 };
});
var TMAP = {}, TNORM = {};
TEAMS.forEach(function (t) { TMAP[t.name] = t; TNORM[norm(t.name)] = t; });
var PMAP = {};
PLAYERS.forEach(function (p) { PMAP[p.handle] = p; });

function teamOf(name) {
  return TMAP[name] || TNORM[norm(name)] || { name: name || '—', tag: (name || '?').slice(0, 4).toUpperCase(),
    country: '', flag: '', region: '其他', elo: 1400, n: 0, w: 0, l: 0, form: 0, lastDate: '' };
}

/* 比赛：按年懒加载 */
var MATCHES = [], MIDX = {}, loadedYears = {};
function loadYear(y) {
  y = String(y);
  if (loadedYears[y]) return Promise.resolve();
  return new Promise(function (res) {
    var s = document.createElement('script');
    s.src = 'assets/data/matches-' + y + '.js';
    s.onload = function () {
      loadedYears[y] = true;
      var rows = (window.VD_MATCHES || {})['y' + y] || [];
      rows.forEach(function (m) { if (!MIDX[m[0]]) { MIDX[m[0]] = m; MATCHES.push(m); } });
      res();
    };
    s.onerror = function () { loadedYears[y] = true; res(); };
    document.head.appendChild(s);
  });
}
function ensureYears(list) {
  return Promise.all(list.map(loadYear)).then(function () {
    MATCHES.sort(function (a, b) { return a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0; });
  });
}
function ensureAllYears() {
  var ys = META.seasons || ['2020', '2021', '2022', '2023', '2024', '2025', '2026'];
  return ensureYears(ys).then(function () {
    MATCHES.sort(function (a, b) { return a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0; });
  });
}
function allMatches() { return MATCHES; }
function matchOf(id) { return MIDX[id] || null; }

/* 新闻 / 待赛 */
var NEWS_KEY = 'vintel.news.v1';
function mergeNews(base, extra) {
  var by = {}, out = [];
  (extra || []).forEach(function (n) { if (n && n.id) by[n.id] = n; });
  (base || []).forEach(function (n) { if (n && n.id) by[n.id] = n; });
  Object.keys(by).forEach(function (k) { out.push(by[k]); });
  out.sort(function (a, b) { return (a.date < b.date) ? 1 : a.date > b.date ? -1 : (String(b.id) > String(a.id) ? 1 : -1); });
  return out;
}
try {
  var _saved = JSON.parse(localStorage.getItem(NEWS_KEY) || '[]');
  if (_saved && _saved.length) INTEL.news = mergeNews(INTEL.news, _saved);
} catch (e) {}
function news() { return (INTEL.news || []).slice(); }
function cnIntel() { return (INTEL.cn || []).slice(); }
var REGIONS = ['CN', 'EMEA', 'Americas', 'Pacific'];
var REGION_CN = { CN: 'CN', EMEA: 'EMEA', Americas: 'Americas', Pacific: 'Pacific' };
var VCTCN = (META.vctCN || {});
function isCNTeam(t) { return t && t.region === 'CN'; }
function regionMatches(r) {
  var tot = 0;
  var ms = allMatches();
  for (var i = 0; i < ms.length; i++) {
    if (teamOf(ms[i][4]).region === r || teamOf(ms[i][5]).region === r) tot++;
  }
  return tot;
}
function cnTeamList(minN) {
  return TEAMS.filter(function (t) { return t.region === 'CN' && t.n >= (minN || 20); })
    .sort(function (a, b) { return b.elo - a.elo; });
}
function nativeFetch(url) {
  return new Promise(function (res, rej) {
    var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.app;
    if (!h) { rej(new Error('NO_BRIDGE')); return; }
    var id = 'f' + Date.now() + Math.floor(Math.random() * 1000);
    window.__vFetch[id] = { res: res, rej: rej };
    h.postMessage({ type: 'fetch', url: url, reqId: id });
    setTimeout(function () {
      if (window.__vFetch[id]) { delete window.__vFetch[id]; rej(new Error('TIMEOUT')); }
    }, 20000);
  });
}
window.__vFetch = {};
window.__valorFetchDone = function (id, ok, body) {
  var p = window.__vFetch[id];
  if (!p) return;
  delete window.__vFetch[id];
  if (ok) p.res(body); else p.rej(new Error(body || 'FETCH_FAIL'));
};
function parseNewsHtml(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var out = [];
  doc.querySelectorAll('a.wf-module-item').forEach(function (a) {
    var href = a.getAttribute('href') || '';
    var m = href.match(/^\/(\d+)\//);
    if (!m) return;
    var box = a.firstElementChild;
    if (!box) return;
    var title = '', summary = '', meta = '', region = '';
    Array.prototype.forEach.call(box.children, function (el) {
      var st = el.getAttribute('style') || '';
      if (st.indexOf('font-weight: 700') >= 0) title = el.textContent.replace(/\s+/g, ' ').trim();
      else if (st.indexOf('font-size: 13px') >= 0) summary = el.textContent.replace(/\s+/g, ' ').trim();
      else if ((el.className || '').indexOf('ge-text-light') >= 0) meta = el.textContent.replace(/\s+/g, ' ').trim();
    });
    if (!title) return;
    var dm = meta.match(/([A-Z][a-z]+ \d{1,2}, \d{4})/);
    var date = '';
    if (dm) { var d = new Date(dm[1] + ' 00:00:00'); if (!isNaN(d)) date = d.toISOString().slice(0, 10); }
    var au = meta.match(/by\s+(.+)$/);
    var fl = a.querySelector('.flag');
    if (fl) { var cm = (fl.className || '').match(/mod-([a-z]{2,3})/); if (cm) region = cm[1]; }
    var text = (title + ' ' + summary).toLowerCase(), tag = '动态';
    if (/sign|depart|parts ways|part ways|release|free agent|joins|roster|bench|acquire|adds|welcomes|retire|coach|trade/.test(text)) tag = '转会';
    else if (/champions|masters|vct|playoff|grand final|qualif|stage|league|split|ascension|game changers|cup|invitational/.test(text)) tag = '赛事';
    else if (/patch|agent|map pool|meta|update|nerf|buff|skin/.test(text)) tag = '版本';
    out.push({ id: m[1], url: 'https://www.vlr.gg' + href, title: title, summary: summary,
               date: date, author: (au ? au[1].trim() : ''), region: region, tag: tag,
               titleCn: '', summaryCn: '' });
  });
  return out;
}
function refreshIntel() {
  var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.app;
  if (!h) { toast('当前为离线快照 · 原生 App 内可在线更新'); return; }
  toast('正在连接 vlr.gg …');
  nativeFetch('https://www.vlr.gg/news').then(function (html) {
    var items = parseNewsHtml(html);
    if (!items.length) { toast('没有解析到新闻，稍后再试'); return; }
    var before = {};
    INTEL.news.forEach(function (n) { before[n.id] = 1; });
    var added = items.filter(function (n) { return !before[n.id]; }).length;
    INTEL.news = mergeNews(INTEL.news, items);
    try { localStorage.setItem(NEWS_KEY, JSON.stringify(INTEL.news.slice(0, 300))); } catch (e) {}
    fillTicker();
    if (S.view === 'intel') intelView();
    else if (S.view === 'home') renderView();
    toast(added ? '情报已更新 · 新增 ' + added + ' 条' : '已是最新 · 没有新增情报');
  }).catch(function (e) {
    toast('更新失败：' + (e && e.message ? e.message : '网络不可用'));
  });
}
function upcoming() { return (INTEL.upcoming || []).slice(); }
function tierOf(ev) {
  ev = String(ev || '').toLowerCase();
  if (ev.indexOf('game changers') >= 0) return 1;
  if (ev.indexOf('challengers') >= 0 || ev.indexOf('ascension') >= 0 ||
      ev.indexOf('qualifier') >= 0 || ev.indexOf('open') >= 0) return 1;
  if ((ev.indexOf('champions') >= 0 && ev.indexOf('tour') < 0) ||
      ev.indexOf('masters') >= 0 || ev.indexOf('world cup') >= 0) return 3;
  if (ev.indexOf('vct') >= 0 || ev.indexOf('valorant champions tour') >= 0 ||
      ev.indexOf('first strike') >= 0) return 2;
  return 0;
}
var TIER_CN = { 0: '其他', 1: '挑战者', 2: 'VCT', 3: '国际大赛' };

/* ---------------- 预测 ---------------- */
var COEF = (META.model && META.model.coef) || [0, 2.302585, 0, 0, 0, 0, 0, 0, 0];
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function formOf(t, date) {
  var v = t.form || 0;
  if (t.lastDate && date && daysBetween(t.lastDate, date) > 400) return v * 0.5;
  return v;
}
function h2hOf(aName, bName, date) {
  var A = teamOf(aName), B = teamOf(bName), cur = date || isoToday();
  var tot = 0, wsum = 0, cnt = 0;
  var ms = allMatches();
  for (var i = 0; i < ms.length; i++) {
    var m = ms[i];
    if (m[1] > cur) continue;
    var age = daysBetween(m[1], cur);
    if (age > 1095) continue;
    var isA = m[4] === A.name && m[5] === B.name;
    var isB = m[4] === B.name && m[5] === A.name;
    if (!isA && !isB) continue;
    var aWin = isA ? (m[8] === 0) : (m[8] === 1);
    var w = Math.exp(-age / 365);
    tot += w * (aWin ? 1 : -1);
    wsum += w; cnt++;
  }
  if (!wsum) return { v: 0, n: 0 };
  return { v: clamp(tot / wsum * 40, -40, 40), n: cnt };
}
function predict(aName, bName, opts) {
  opts = opts || {};
  var A = teamOf(aName), B = teamOf(bName);
  var date = opts.date || isoToday();
  var bo = opts.bo || 3;
  var tier = opts.tier != null ? opts.tier : 0;
  var eloDiff = (A.elo || 1400) - (B.elo || 1400);
  var ed = eloDiff / 400;
  var conf = Math.min(1, Math.min(A.n, B.n) / 10);
  var formDiff = formOf(A, date) - formOf(B, date);
  var hh = h2hOf(A.name, B.name, date);
  var da = A.lastDate ? Math.max(0, daysBetween(A.lastDate, date)) : 365;
  var db = B.lastDate ? Math.max(0, daysBetween(B.lastDate, date)) : 365;
  var rest = (Math.log1p(Math.min(da, 365)) - Math.log1p(Math.min(db, 365))) / 4;
  var x = [1, ed, formDiff / 400, hh.v / 400, tier >= 3 ? 1 : 0,
           bo === 5 ? 1 : 0, bo === 1 ? 1 : 0, ed * (1 - conf), rest];
  var z = 0;
  for (var i = 0; i < x.length; i++) z += x[i] * (COEF[i] || 0);
  var p = sigmoid(z);
  return { p: p, pB: 1 - p, A: A, B: B, eloDiff: eloDiff, formDiff: formDiff,
           h2h: hh.v, h2hN: hh.n, conf: conf, bo: bo, tier: tier,
           da: da, db: db, score: scorePick(p, bo) };
}
function scorePick(p, bo) {
  var key = bo === 5 ? '3' : bo === 1 ? '1' : '2';
  var bins = ((META.model || {}).scoreModel || {})[key] || [];
  var fav = p >= 0.5 ? p : 1 - p;
  var bin = null;
  for (var i = 0; i < bins.length; i++) {
    if (fav >= bins[i].lo && fav < bins[i].hi) { bin = bins[i]; break; }
  }
  if (!bin && bins.length) bin = bins[bins.length - 1];
  if (!bin) {
    var s = bo === 5 ? (fav > 0.7 ? '3-1' : '3-2') : (fav > 0.7 ? '2-0' : '2-1');
    return { s: p >= 0.5 ? s : s.split('-').reverse().join('-'), prob: 0 };
  }
  var best = null;
  Object.keys(bin.dist).forEach(function (k) {
    if (!best || bin.dist[k] > best[1]) best = [k, bin.dist[k]];
  });
  var sc = best[0];
  if (p < 0.5) sc = sc.split('-').reverse().join('-');
  return { s: sc, prob: best[1] };
}
function confidenceOf(p, minN) {
  if (minN < 5) return { k: 'low', cn: '低', en: 'LOW' };
  var edge = Math.abs(p - 0.5);
  if (minN >= 20 && edge >= 0.14) return { k: 'high', cn: '高', en: 'HIGH' };
  if (edge < 0.05) return { k: 'low', cn: '低', en: 'LOW' };
  return { k: 'mid', cn: '中', en: 'MID' };
}

/* ---------------- 状态 / 导航 ---------------- */
var S = {
  view: 'home',
  matchTab: 'upcoming', matchFilter: 9, matchYear: '2026',
  dbTab: 'players', dbQuery: '', dbStatus: '', dbRegion: '', dbScope: 'active',
  dbYear: '2026', dbPage: 1, matchPage: 1,
  intelTag: '全部', intelSrc: 'cn',
  watch: { cn: true, emea: true, americas: true, pacific: true },
  sim: { a: null, b: null, bo: 3 }
};
var VIEW_CN = { home: '总览', matches: '赛程', predict: '预测', intel: '情报', db: '数据库', maplab: '跑图' };
var VIEW_EN = { home: 'OVERVIEW', matches: 'MATCHES', predict: 'PREDICTION', intel: 'INTEL', db: 'DATABASE', maplab: 'MAP LAB' };

function go(view, opts) {
  if (S.view === 'maplab' && window.ML) window.ML.exit();
  S.view = view;
  try { history.replaceState(null, '', '#' + view); } catch (e) {}
  if (opts && opts.tab) S.matchTab = opts.tab;
  $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === view); });
  $('#crumb').textContent = VIEW_CN[view] + ' / ' + VIEW_EN[view];
  var el = $('#view');
  el.innerHTML = '<div class="view-inner"><div class="empty">LOADING / 正在读取档案…</div></div>';
  el.scrollTop = 0;
  renderView();
}
function renderView() {
  var el = $('#view');
  if (S.view === 'home') { home(); return; }
  if (S.view === 'matches') { matchesView(); return; }
  if (S.view === 'predict') { predictView(); return; }
  if (S.view === 'intel') { intelView(); return; }
  if (S.view === 'db') { dbView(); return; }
  if (S.view === 'maplab') { maplabView(); return; }
}
function setView(html) { $('#view').innerHTML = '<div class="view-inner">' + html + '</div>'; }

/* ---------------- 总览 ---------------- */
function home() {
  var ups = upcoming().slice().sort(function (a, b) { return (a.utc || '') < (b.utc || '') ? -1 : 1; });
  var real = ups.filter(function (u) {
    return teamOf(u.teams[0].name).n >= 10 && teamOf(u.teams[1].name).n >= 10;
  })[0] || null;
  var heroA, heroB, heroBo, heroEvent, heroSeries, heroDate, heroMode, heroNote;
  if (real) {
    heroA = teamOf(real.teams[0].name); heroB = teamOf(real.teams[1].name);
    heroBo = parseInt((real.bo || 'Bo3').replace(/\D/g, ''), 10) || 3;
    heroEvent = real.event; heroSeries = real.series;
    heroDate = real.isoDate + ' · ' + dateCn(real.isoDate) + ' · BO' + heroBo;
    heroMode = 'NEXT DEPLOYMENT / 下一场';
    heroNote = '';
  } else {
    var top = TEAMS.filter(function (t) {
      return t.n >= 30 && t.lastDate && daysBetween(t.lastDate, isoToday()) < 400;
    }).sort(function (a, b) { return b.elo - a.elo; });
    heroA = top[0]; heroB = top[1]; heroBo = 3;
    heroEvent = 'ELO POWER MATCHUP'; heroSeries = '榜首对决';
    heroDate = '赛程待定 · 休赛期模拟';
    heroMode = 'OFFSEASON SIM / 休赛期推演';
    heroNote = '当前 VCT 正赛无排期：以下为 ELO 前二的假设对阵，不是官方赛程。';
  }
  S.hero = { a: heroA.name, b: heroB.name, bo: heroBo };
  var pr = predict(heroA.name, heroB.name, { bo: heroBo, date: real ? real.isoDate : isoToday(), tier: real ? tierOf(real.event) : 0 });
  var fav = pr.p >= 0.5 ? heroA : heroB;
  var fp = Math.max(pr.p, pr.pB) * 100;
  var heroHtml =
    '<section class="panel hero">' +
      '<div class="hero-top">' +
        '<div class="hero-event"><span class="line"></span><b>' + esc(heroMode) + '</b><span>/ ' + esc(heroEvent) + ' · ' + esc(heroSeries) + '</span></div>' +
        '<div class="hero-date">' + esc(heroDate) + '</div>' +
      '</div>' +
      '<div class="hero-match">' +
        '<div class="hero-team">' + badge(heroA, 'lg') +
          '<div class="ht-name">' + esc(heroA.name) + '</div>' +
          '<div class="ht-sub">' + flag(heroA.flag) + ' ' + esc(heroA.region) + ' · ELO <b>' + heroA.elo + '</b></div>' +
        '</div>' +
        '<div class="hero-mid"><span class="vs">VS</span><span class="pct">' + fp.toFixed(0) + '<small>%</small></span>' +
          '<span class="bo">' + esc(fav.tag) + ' 胜率</span></div>' +
        '<div class="hero-team right">' + badge(heroB, 'lg') +
          '<div class="ht-name">' + esc(heroB.name) + '</div>' +
          '<div class="ht-sub">ELO <b>' + heroB.elo + '</b> · ' + esc(heroB.region) + ' ' + flag(heroB.flag) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="hero-prob"><i style="width:' + (pr.p * 100).toFixed(1) + '%"></i><b style="width:' + (pr.pB * 100).toFixed(1) + '%"></b></div>' +
      '<div class="hero-foot">' +
        '<div class="hero-factors">' +
          '<div><span>推演比分</span><b>' + esc(pr.score.s) + '</b></div>' +
          '<div><span>ELO 差</span><b>' + (pr.eloDiff > 0 ? '+' : '') + pr.eloDiff + '</b></div>' +
          '<div><span>近期状态</span><b>' + (pr.formDiff > 0 ? '+' : '') + pr.formDiff.toFixed(0) + '</b></div>' +
          '<div><span>交手</span><b>' + (pr.h2hN ? (pr.h2h > 0 ? '+' : '') + pr.h2h.toFixed(0) + ' / ' + pr.h2hN + ' 场' : '无记录') + '</b></div>' +
        '</div>' +
        '<button class="btn primary" data-hero="1">进入推演<span>→</span></button>' +
      '</div>' +
      (heroNote ? '<div class="hero-note">' + esc(heroNote) + '</div>' : '') +
    '</section>';

  var acc = ((META.model || {}).metrics || {}).test || {};
  var base = ((META.model || {}).metrics || {}).baseline_elo || {};
  var statHtml =
    '<section class="panel flat stat-grid">' +
      '<div class="stat"><span>PLAYERS</span><b>' + num((META.counts || {}).players) + '</b><small>收录选手</small><i></i></div>' +
      '<div class="stat t"><span>TEAMS</span><b>' + num((META.counts || {}).teams) + '</b><small>战队档案</small><i></i></div>' +
      '<div class="stat g"><span>MATCHES</span><b>' + num((META.counts || {}).matches) + '</b><small>历史比赛</small><i></i></div>' +
      '<div class="stat"><span>DETAILS</span><b>' + num((META.counts || {}).details) + '</b><small>逐图战绩</small><i></i></div>' +
    '</section>' +
    '<section class="panel teal model-card">' +
      '<div class="model-top"><div><div class="kicker t" style="margin-bottom:8px"><span></span>MODEL / 预测引擎</div>' +
        '<div class="big">' + (acc.acc ? (acc.acc * 100).toFixed(1) : '—') + '<small>%</small></div></div>' +
        '<div class="cap">2026 留出集<br>' + num(acc.n) + ' 场 · 未参与训练</div></div>' +
      '<div class="model-scale"><i style="width:' + (acc.acc * 100) + '%"></i>' +
        '<u class="base" style="left:' + ((base.acc || 0) * 100) + '%"></u></div>' +
      '<div class="model-legend"><span>纯 ELO <b>' + (base.acc ? (base.acc * 100).toFixed(1) + '%' : '—') + '</b></span>' +
        '<span>LOG LOSS <b>' + (acc.logloss ? acc.logloss.toFixed(3) : '—') + '</b></span></div>' +
      '<div class="model-note">概率来自逻辑回归：ELO 差 · 近期状态 · 交手记录 · 样本修正。<br>数据截至 ' + esc((META.generated || '').slice(0, 10)) + '，非实时赔率。</div>' +
    '</section>';

  var cnSide = '';
  var cnUp = cnTeamList(20);
  var cnRanks = cnUp.slice(0, 8).map(function (t, i) {
    return '<div class="rank-row" data-team="' + esc(t.name) + '">' +
      '<div class="rr-no">' + String(i + 1).padStart(2, '0') + '</div>' + badge(t, 'sm') +
      '<div class="rr-name">' + esc(t.name) + '<small>' + esc(t.tag) + ' · ' + t.n + ' 场</small></div>' +
      '<div class="rr-elo">' + t.elo + '</div>' +
      '<div class="rr-region">' + (t.form >= 0 ? '+' : '') + (t.form || 0).toFixed(0) + '</div></div>';
  }).join('');
  var cnNewsHtml = cnIntel().filter(function (n) { return n.lang !== 'zh' || true; }).slice(0, 7).map(function (n) {
    return '<div class="nm" data-cnnews="' + esc(n.id) + '">' +
      '<div class="nm-date">' + md(n.date) + '</div>' +
      '<div class="nm-body"><h4>' + esc(n.title) + '</h4>' +
      '<p>' + esc((n.summary || '').slice(0, 120)) + '</p></div>' +
      '<div class="nm-tag">' + esc(n.tag) + '</div></div>';
  }).join('') || '<div class="empty">暂无 CN 资讯</div>';
  var newsHtml = news().slice(0, 5).map(function (n) {
    return '<div class="nm" data-news="' + n.id + '">' +
      '<div class="nm-date">' + md(n.date) + '</div>' +
      '<div class="nm-body"><h4>' + esc(n.titleCn || n.title) + '</h4>' +
      '<p>' + esc(n.summaryCn || n.summary) + '</p></div>' +
      '<div class="nm-tag">' + esc(n.tag) + '</div></div>';
  }).join('') || '<div class="empty">暂无情报</div>';

  var ranks = TEAMS.filter(function (t) {
    return t.n >= 20 && t.lastDate && daysBetween(t.lastDate, isoToday()) < 400;
  }).sort(function (a, b) { return b.elo - a.elo; }).slice(0, 8);
  var rankHtml = ranks.map(function (t, i) {
    return '<div class="rank-row" data-team="' + esc(t.name) + '">' +
      '<div class="rr-no">' + String(i + 1).padStart(2, '0') + '</div>' + badge(t, 'sm') +
      '<div class="rr-name">' + esc(t.name) + '<small>' + esc(t.region) + ' · ' + flag(t.flag) + '</small></div>' +
      '<div class="rr-elo">' + t.elo + '</div>' +
      '<div class="rr-region">' + (t.form >= 0 ? '+' : '') + (t.form || 0).toFixed(0) + '</div></div>';
  }).join('');

  var recent = allMatches().filter(function (m) { return m[1] >= '2026-09-01'; }).slice(0, 7);
  if (!recent.length) recent = allMatches().slice(0, 7);
  var predMap = {};
  ((META.model || {}).recent || []).forEach(function (r) { predMap[r.id] = r; });
  var resHtml = recent.map(function (m) {
    var A = teamOf(m[4]), B = teamOf(m[5]);
    var winA = m[8] === 0, aw = winA ? 'w' : 'l', bw = winA ? 'l' : 'w';
    var pr = predMap[m[0]];
    var hit = pr ? ((pr.p >= 0.5) === (m[8] === 0)) : null;
    return '<div class="result-row" data-match="' + m[0] + '">' +
      '<div class="res-date">' + md(m[1]) + '</div>' +
      '<div class="res-teams"><span class="' + aw + '">' + esc(m[4]) + '</span>' +
        '<b>' + m[6] + ' : ' + m[7] + '</b><span class="' + bw + '">' + esc(m[5]) + '</span></div>' +
      '<div class="res-score">' + esc(m[3] || m[2]) + '</div>' +
      '<div class="hit ' + (hit === null ? '' : hit ? 'y' : 'n') + '">' +
        (hit === null ? '—' : hit ? '✓ 预测命中' : '✗ 预测偏差') + '</div></div>';
  }).join('') || '<div class="empty">暂无赛果</div>';

  var yc = META.yearCounts || {};
  var maxY = Math.max.apply(null, Object.keys(yc).map(function (y) { return yc[y]; }).concat([1]));
  var yearBars = Object.keys(yc).sort().map(function (y) {
    return '<div class="yearbar"><span>' + y + '</span><div class="yb"><i style="width:' + (yc[y] / maxY * 100) + '%"></i></div><em>' + num(yc[y]) + '</em></div>';
  }).join('');

  var regionBar = '<div class="region-bar"><span class="rb-label">赛区</span>' + REGIONS.map(function (r) {
    var n = (META.regionCounts || {})[r] || 0;
    var on = S.watch[r.charAt(0).toLowerCase() + r.slice(1)] !== false;
    return '<button class="rb-chip' + (on ? ' on' : '') + (r === 'CN' ? ' cn' : '') + '" data-region="' + r + '">' +
      '<b>' + r + '</b><span>' + num(n) + ' 队 · ' + num(regionMatches(r)) + ' 场</span></button>';
  }).join('') +
    '<span class="rb-note">四大赛区口径 · CN 生态含中国全部联赛与次级赛事</span></div>';

  setView(
    regionBar +
    '<div class="home-top">' + heroHtml + '<div class="home-side">' + statHtml + '</div></div>' +
    '<div class="home-grid">' +
      '<section><div class="sec-head"><div class="sec-title"><span class="no">01</span><h2>情报流</h2><em>INTEL FEED</em></div>' +
        '<button class="more" data-go="intel">全部情报 →</button></div>' +
        '<div class="panel flat news-mini">' + newsHtml + '</div></section>' +
      '<section><div class="sec-head"><div class="sec-title"><span class="no">02</span><h2>ELO 榜首</h2><em>POWER RANKING</em></div>' +
        '<span class="mono" style="font-size:8px;letter-spacing:.14em;color:#4f5b61">ACTIVE / 近 12 个月</span></div>' +
        '<div class="panel flat rank-list">' + rankHtml + '</div></section>' +
    '</div>' +
    '<div class="home-grid">' +
      '<section><div class="sec-head"><div class="sec-title"><span class="no">03</span><h2>CN 资讯</h2><em>CN INTEL · VCTCN</em></div>' +
        '<button class="more" data-go="intel" data-src="cn">查看更多 →</button></div>' +
        '<div class="panel flat news-mini cn-mini">' + cnNewsHtml + '</div></section>' +
      '<section><div class="sec-head"><div class="sec-title"><span class="no">04</span><h2>CN 战力榜</h2><em>CN POWER RANKING</em></div>' +
        '<span class="mono" style="font-size:8px;letter-spacing:.14em;color:#4f5b61">' + cnUp.length + ' TEAMS</span></div>' +
        '<div class="panel flat rank-list">' + cnRanks + '</div></section>' +
    '</div>' +
    '<div class="home-grid">' +
      '<section><div class="sec-head"><div class="sec-title"><span class="no">05</span><h2>近期战果</h2><em>RECENT RESULTS</em></div>' +
        '<button class="more" data-go="matches" data-tab="results">全部赛果 →</button></div>' +
        '<div class="panel flat result-list">' + resHtml + '</div></section>' +
      '<section><div class="sec-head"><div class="sec-title"><span class="no">06</span><h2>数据覆盖</h2><em>ARCHIVE DEPTH</em></div>' +
        '<span class="mono" style="font-size:8px;letter-spacing:.14em;color:#4f5b61">' + esc((META.range || []).join(' → ')) + '</span></div>' +
        '<div class="panel flat panel-pad"><div class="kicker" style="margin-bottom:12px"><span></span>SEASON VOLUME / 赛季场次</div>' +
        '<div class="yearbars">' + yearBars + '</div>' +
        '<div class="hr"></div>' +
        '<div style="display:flex;justify-content:space-between;font:500 8px var(--mono);letter-spacing:.1em;color:#5f6b71">' +
          '<span>赛事 <b style="color:#aeb8bc">' + num((META.counts || {}).events) + '</b></span>' +
          '<span>赛区 <b style="color:#aeb8bc">' + Object.keys(META.regionCounts || {}).length + '</b></span>' +
          '<span>逐图详情 <b style="color:#aeb8bc">' + num((META.counts || {}).details) + '</b></span>' +
        '</div></div></section>' +
    '</div>'
  );
}

/* ---------------- 赛程 ---------------- */
function matchesView() {
  var isUp = S.matchTab === 'upcoming';
  var full = isUp ? upcoming().slice() : allMatches().filter(function (m) {
    if (S.matchFilter !== 9 && m[9] !== S.matchFilter) return false;
    if (S.matchYear && m[1].slice(0, 4) !== S.matchYear) return false;
    return true;
  });
  var total = full.length;
  var list = isUp ? full : full.slice(0, S.matchPage * 120);
  if (isUp) {
    list = list.filter(function (u) { return S.matchFilter === 9 || tierOf(u.event) === S.matchFilter; });
    list.sort(function (a, b) { return (a.utc || '') < (b.utc || '') ? -1 : 1; });
  }

  var groups = {}, order = [];
  list.forEach(function (x) {
    var d = isUp ? x.isoDate : x[1];
    if (!groups[d]) { groups[d] = []; order.push(d); }
    groups[d].push(x);
  });
  if (!isUp) order.sort().reverse(); else order.sort();

  var html = order.map(function (d) {
    var rows = groups[d].map(function (x) { return isUp ? upRow(x) : resultRow(x); }).join('');
    return '<div class="match-date"><span>' + md(d) + ' / ' + dateCn(d) + '</span><i></i>' +
      '<em>' + groups[d].length + ' ' + (isUp ? 'SCHEDULED' : 'RESULTS') + '</em></div>' +
      '<div class="match-list">' + rows + '</div>';
  }).join('') || '<div class="empty">当前筛选下没有比赛</div>';

  var chips = [[9, '全部'], [3, '国际大赛'], [2, 'VCT'], [1, '挑战者'], [0, '其他']].map(function (c) {
    return '<button class="chip ' + (S.matchFilter === c[0] ? 'on' : '') + '" data-mfilter="' + c[0] + '">' + c[1] + '</button>';
  }).join('');
  if (!isUp) {
    chips += '<span style="width:10px"></span>' + ['2026', '2025', '2024', ''].map(function (y) {
      return '<button class="chip ' + (S.matchYear === y ? 'on' : '') + '" data-myear="' + y + '">' + (y || '全部年份') + '</button>';
    }).join('');
  }

  var lowOnly = isUp && !upcoming().some(function (u) {
    return teamOf(u.teams[0].name).n >= 10 && teamOf(u.teams[1].name).n >= 10;
  });
  var note = (isUp && lowOnly) ? '<div class="match-note"><b>休赛期</b> · 当前 VCT 正赛无排期，列表以次级赛事为主；多数队伍样本不足，概率只作参考。想要有数据支撑的对阵，去 <button class="link" data-go="predict">推演台</button> 任选两支战队。</div>' : '';
  var stats = isUp
    ? '<div><span>SCHEDULED</span><b>' + num(upcoming().length) + '</b></div><div><span>WINDOW</span><b>' + (upcoming().length ? md(upcoming().slice().sort(function(a,b){return a.isoDate<b.isoDate?-1:1})[0].isoDate) : '—') + '</b></div>'
    : '<div><span>ARCHIVED</span><b>' + num((META.counts || {}).matches) + '</b></div><div><span>SEASON</span><b>2020—26</b></div>';

  setView(
    '<div class="page-head"><div><div class="kicker"><span></span>MATCH CENTER / 赛事中心</div>' +
      '<div class="ph-title" style="margin-top:12px"><h2>赛程<em>SCHEDULE &amp; RESULTS</em></h2>' +
      '<p>待赛按开赛时间排序，胜率由 ELO 模型现算；赛果可按赛事级别筛选，点开任意一场查看逐图与选手数据。</p></div></div>' +
      '<div class="ph-meta">' + stats + '</div></div>' +
    '<div class="filterbar"><div class="seg">' +
      '<button class="' + (isUp ? 'on' : '') + '" data-mtab="upcoming">待赛</button>' +
      '<button class="' + (!isUp ? 'on' : '') + '" data-mtab="results">赛果</button></div>' + chips +
      '<span class="spacer"></span><span class="db-count">' + num(total) + ' MATCHES</span></div>' + note +
    html +
    (!isUp && list.length < total ? '<div class="db-more" style="margin-top:14px"><button class="btn ghost sm" id="matchMoreBtn">加载更多 / ' + num(total - list.length) + ' 剩余</button></div>' : '')
  );
}

function upRow(u) {
  var A = teamOf(u.teams[0].name), B = teamOf(u.teams[1].name);
  var bo = parseInt((u.bo || 'Bo3').replace(/\D/g, ''), 10) || 3;
  var pr = predict(A.name, B.name, { bo: bo, date: u.isoDate, tier: tierOf(u.event) });
  var dt = '';
  if (u.utc) {
    var d = new Date(u.utc.replace(' ', 'T') + 'Z');
    dt = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  var fav = pr.p >= 0.5;
  var known = A.n >= 3 && B.n >= 3;
  return '<div class="mrow" data-up="' + u.id + '">' +
    '<div class="mrow-time">' + dt + '<br><span style="color:#4f5b61">' + esc(u.bo || '') + '</span></div>' +
    '<div class="mrow-team">' + badge(A, 'sm') + '<div class="nm">' + esc(A.name) + '<small>' + esc(A.tag) + ' · ' + A.elo + '</small></div></div>' +
    '<div class="mrow-score up">VS</div>' +
    '<div class="mrow-team right"><div class="nm">' + esc(B.name) + '<small>' + B.elo + ' · ' + esc(B.tag) + '</small></div>' + badge(B, 'sm') + '</div>' +
    '<div class="mrow-event"><b>' + esc(u.event) + '</b><span>' + esc(u.series) + '</span></div>' +
    '<div class="mrow-pred">' + (known
      ? '<div class="pb"><i style="width:' + (pr.p * 100).toFixed(0) + '%"></i></div>' +
        '<span class="' + (fav ? 'win' : '') + '">' + (fav ? A.tag : B.tag) + ' ' + ((Math.max(pr.p, pr.pB) * 100) | 0) + '%</span>'
      : '<span style="color:#4f5b61;font-size:7.5px">样本不足</span><div class="pb" style="opacity:.25"><i style="width:50%"></i></div>') + '</div></div>';
}

function resultRow(m) {
  var A = teamOf(m[4]), B = teamOf(m[5]), winA = m[8] === 0;
  var pd = null;
  ((META.model || {}).recent || []).forEach(function (r) { if (r.id === m[0]) pd = r; });
  var hit = pd ? ((pd.p >= 0.5) === winA) : null;
  return '<div class="mrow" data-match="' + m[0] + '">' +
    '<div class="mrow-time">FINAL<br><span style="color:#4f5b61">' + TIER_CN[m[9]] + '</span></div>' +
    '<div class="mrow-team">' + badge(A, 'sm') + '<div class="nm" style="color:' + (winA ? '#eae5da' : '#6d797f') + '">' + esc(A.name) + '<small>' + esc(A.tag) + '</small></div></div>' +
    '<div class="mrow-score">' + m[6] + ' <span style="color:#4f5b61">:</span> ' + m[7] + '</div>' +
    '<div class="mrow-team right"><div class="nm" style="color:' + (!winA ? '#eae5da' : '#6d797f') + '">' + esc(B.name) + '<small>' + esc(B.tag) + '</small></div>' + badge(B, 'sm') + '</div>' +
    '<div class="mrow-event"><b>' + esc(m[2]) + '</b><span>' + esc(m[3]) + '</span></div>' +
    '<div class="mrow-pred">' + (hit === null ? '<span style="color:#3f4a50">无预测</span>' :
      '<span class="' + (hit ? 'win' : '') + '" style="color:' + (hit ? '#4fe3c8' : '#ff7a6d') + '">' + (hit ? '✓ 命中' : '✗ 偏差') + ' · ' + (pd.p * 100).toFixed(0) + '%</span>') + '</div></div>';
}

/* ---------------- 预测 ---------------- */
function pickHtml(side, name) {
  var t = name ? teamOf(name) : null;
  return '<div class="pick ' + (t ? '' : 'emptypick') + '" data-pick="' + side + '">' +
    '<div class="plabel">' + (side === 'a' ? 'TEAM A / 主队' : 'TEAM B / 客队') + '</div>' +
    (t ? '<div class="pname">' + badge(t) + '<div><b>' + esc(t.name) + '</b>' +
      '<small>' + esc(t.tag) + ' · ELO ' + t.elo + ' · ' + esc(t.region) + '</small></div></div>'
       : '<div class="pname"><div><b style="color:#5f6b71">选择战队</b><small>点击检索 · 任意战队</small></div></div>') +
    '</div>';
}
function factorRow(label, v, max, unit, raw) {
  var w = clamp(Math.abs(v) / max * 50, 0, 50);
  var left = v >= 0 ? 50 : 50 - w;
  return '<div class="factor"><span>' + label + '</span><div class="ft">' +
    '<i class="' + (v < 0 ? 'neg' : '') + '" style="left:' + left + '%;width:' + w + '%"></i></div>' +
    '<b>' + (raw != null ? raw : ((v > 0 ? '+' : '') + v.toFixed(0) + (unit || ''))) + '</b></div>';
}
function simResultHtml(pr) {
  var A = pr.A, B = pr.B;
  var conf = confidenceOf(pr.p, Math.min(A.n, B.n));
  var fav = pr.p >= 0.5 ? A : B;
  return '<div class="sr-top"><div><div class="kicker" style="margin-bottom:8px"><span></span>SIMULATION RESULT / 推演结果</div>' +
    '<div class="sr-prob"><b style="color:' + (pr.p >= 0.5 ? 'var(--coral)' : 'var(--ink)') + '">' + (pr.p * 100).toFixed(1) + '<small style="font-size:18px">%</small></b>' +
    '<span>' + esc(A.tag) + ' 胜率</span></div></div>' +
    '<div class="sr-meta">推演比分 <b>' + esc(pr.score.s) + '</b><br>置信度 <b>' + conf.cn + ' / ' + conf.en + '</b><br>样本 ' + Math.min(A.n, B.n) + ' 场</div></div>' +
    '<div class="sr-bar"><i style="width:' + (pr.p * 100).toFixed(1) + '%"></i></div>' +
    '<div class="sr-labels"><span>' + esc(A.tag) + ' ' + (pr.p * 100).toFixed(1) + '%</span><span>' + (pr.pB * 100).toFixed(1) + '% ' + esc(B.tag) + '</span></div>' +
    '<div class="sr-score"><span>PREDICTED SCORE</span><b>' + esc(pr.score.s) + '</b>' +
      '<em>比分由同胜率区间的历史样本给出<br>' + (pr.score.prob ? '该比分占 ' + (pr.score.prob * 100).toFixed(0) + '%' : '样本不足，启发式') + '</em></div>' +
    '<div class="factors">' +
      factorRow('ELO 差', pr.eloDiff / 4, 100, ' 分', (pr.eloDiff > 0 ? '+' : '') + pr.eloDiff + ' 分') +
      factorRow('近期状态', pr.formDiff, 120, ' 分', (pr.formDiff > 0 ? '+' : '') + pr.formDiff.toFixed(0) + ' 分') +
      factorRow('交手记录', pr.h2h, 40, ' 分', pr.h2hN ? (pr.h2h > 0 ? '+' : '') + pr.h2h.toFixed(0) + ' 分 / ' + pr.h2hN + ' 场' : '无记录') +
      factorRow('休整差', Math.log1p(Math.min(pr.da, 365)) - Math.log1p(Math.min(pr.db, 365)), 3, ' 天', pr.da + ' / ' + pr.db + ' 天') +
    '</div>' +
    '<p class="mp-note">中性假设：不区分赛事级别与主客场；样本不足 10 场的一方会向 50% 收缩。<br>推演仅供分析，不构成任何投注建议。</p>';
}
function titleOdds() {
  var teams = TEAMS.filter(function (t) {
    return t.n >= 30 && t.lastDate && daysBetween(t.lastDate, isoToday()) < 400;
  }).sort(function (a, b) { return b.elo - a.elo; }).slice(0, 8);
  if (teams.length < 8) return { teams: teams, odds: {}, sims: 0 };
  var cache = {};
  function pair(a, b, bo) {
    var k = a + '|' + b + '|' + bo;
    if (cache[k] == null) cache[k] = predict(a, b, { bo: bo, tier: 3 }).p;
    return cache[k];
  }
  var seed = 20261105;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  var wins = {};
  teams.forEach(function (t) { wins[t.name] = 0; });
  var N = 12000;
  for (var i = 0; i < N; i++) {
    // 1v8 / 4v5 / 2v7 / 3v6
    var qf = [[0, 7], [3, 4], [1, 6], [2, 5]].map(function (p) {
      var a = teams[p[0]], b = teams[p[1]];
      return rnd() < pair(a.name, b.name, 3) ? a : b;
    });
    var sf1 = rnd() < pair(qf[0].name, qf[1].name, 3) ? qf[0] : qf[1];
    var sf2 = rnd() < pair(qf[2].name, qf[3].name, 3) ? qf[2] : qf[3];
    var ch = rnd() < pair(sf1.name, sf2.name, 5) ? sf1 : sf2;
    wins[ch.name]++;
  }
  return { teams: teams, odds: wins, sims: N };
}
function oddsHtml() {
  var o = titleOdds();
  if (!o.sims) return '';
  var maxp = Math.max.apply(null, o.teams.map(function (t) { return o.odds[t.name]; }).concat([1]));
  var rows = o.teams.map(function (t, i) {
    var p = o.odds[t.name] / o.sims * 100;
    return '<div class="odds-row" data-team="' + esc(t.name) + '">' +
      '<span class="odds-no">' + (i + 1) + '</span>' + badge(t, 'sm') +
      '<span class="odds-name">' + esc(t.name) + '</span>' +
      '<span class="odds-bar"><i style="width:' + (o.odds[t.name] / maxp * 100) + '%"></i></span>' +
      '<b>' + p.toFixed(1) + '%</b></div>';
  }).join('');
  return '<section class="panel" style="margin-top:16px"><div class="panel-head"><div class="ph-l"><i>◆</i>TITLE ODDS / 夺冠推演</div>' +
    '<div class="ph-r">8 TEAMS · BO3 → BO5 · ' + num(o.sims) + ' SIMS</div></div>' +
    '<div class="panel-pad" style="padding:18px 20px 16px">' +
    '<p style="font:400 10.5px/1.8 var(--sans);color:#7c888e;margin-bottom:14px">假设现在举办一届 8 队单败国际赛：按当前 ELO 与状态、1v8 种子排位、1/4 与半决赛 BO3、决赛 BO5，用固定随机种子模拟 ' + num(o.sims) + ' 届。结果只反映模型当前认知，不是官方赛程。</p>' +
    '<div class="odds-grid">' + rows + '</div></div></section>';
}
function cnPredPanel() {
  var cn = cnTeamList(20).slice(0, 8);
  if (cn.length < 2) return '';
  var seed = 20261106;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  var cache = {}, N = 8000, wins = {};
  cn.forEach(function (t) { wins[t.name] = 0; });
  function P(a, b, bo) {
    var k = a + '|' + b + '|' + bo;
    if (cache[k] == null) cache[k] = predict(a, b, { bo: bo, tier: 2 }).p;
    return cache[k];
  }
  for (var i = 0; i < N; i++) {
    var qf = [[0, 7], [3, 4], [1, 6], [2, 5]].map(function (p) {
      return rnd() < P(cn[p[0]].name, cn[p[1]].name, 3) ? cn[p[0]] : cn[p[1]];
    });
    var s1 = rnd() < P(qf[0].name, qf[1].name, 3) ? qf[0] : qf[1];
    var s2 = rnd() < P(qf[2].name, qf[3].name, 3) ? qf[2] : qf[3];
    var ch = rnd() < P(s1.name, s2.name, 5) ? s1 : s2;
    wins[ch.name]++;
  }
  var maxp = Math.max.apply(null, cn.map(function (t) { return wins[t.name]; }).concat([1]));
  var rows = cn.map(function (t, i) {
    var p = wins[t.name] / N * 100;
    return '<div class="odds-row" data-team="' + esc(t.name) + '"><span class="odds-no">' + (i + 1) + '</span>' + badge(t, 'sm') +
      '<span class="odds-name">' + esc(t.name) + '</span><span class="odds-bar"><i style="width:' + (wins[t.name] / maxp * 100) + '%"></i></span>' +
      '<b>' + p.toFixed(1) + '%</b></div>';
  }).join('');
  return '<section class="panel" style="margin-bottom:14px"><div class="panel-head"><div class="ph-l"><i>◆</i>VCT CN 冠军推演</div>' +
    '<div class="ph-r">CN 前 8 · ' + num(N) + ' SIMS</div></div>' +
    '<div class="panel-pad" style="padding:14px 16px 10px">' +
    '<p style="font:400 10px/1.75 var(--sans);color:#7c888e;margin-bottom:12px">只取 CN 赛区 ELO 前八，按 1v8 种子打 8 队单败（BO3，决赛 BO5）。不含国际赛，也不含尚未登场的新阵容。</p>' +
    '<div class="odds-grid" style="grid-template-columns:1fr">' + rows + '</div></div></section>';
}
function predictView() {
  var ups = upcoming().sort(function (a, b) { return (a.utc || '') < (b.utc || '') ? -1 : 1; });
  if (!S.sim.a) {
    if (S.hero && teamOf(S.hero.a).n >= 10 && teamOf(S.hero.b).n >= 10) {
      S.sim.a = S.hero.a; S.sim.b = S.hero.b; S.sim.bo = S.hero.bo || 3;
    } else {
      var top = TEAMS.filter(function (t) { return t.n >= 30 && t.lastDate && daysBetween(t.lastDate, isoToday()) < 400; })
        .sort(function (a, b) { return b.elo - a.elo; });
      S.sim.a = top[0] ? top[0].name : null;
      S.sim.b = top[1] ? top[1].name : null;
      S.sim.bo = 3;
    }
  }
  var pr = (S.sim.a && S.sim.b && S.sim.a !== S.sim.b) ? predict(S.sim.a, S.sim.b, { bo: S.sim.bo, tier: 0 }) : null;
  var m = META.model || {}, mt = m.metrics || {}, test = mt.test || {}, base = mt.baseline_elo || {};
  var cal = test.calibration || [];
  var calHtml = cal.map(function (c) {
    return '<div class="cb" title="预测 ' + (c.pred * 100).toFixed(0) + '% / 实际 ' + (c.hit * 100).toFixed(0) + '% / ' + c.n + ' 场">' +
      '<i style="height:' + (c.pred * 100).toFixed(0) + '%"></i><u style="bottom:' + (c.hit * 100).toFixed(0) + '%"></u></div>';
  }).join('');
  var coef = m.coef || [];
  var coefRows = [
    ['ELO 差', coef[1]], ['近期状态', coef[2]], ['交手记录', coef[3]],
    ['国际大赛', coef[4]], ['Bo5', coef[5]], ['Bo1', coef[6]],
    ['低样本修正', coef[7]], ['休整差', coef[8]]
  ].map(function (r) {
    return '<div class="kv"><span>' + r[0] + '</span><b>' + (r[1] >= 0 ? '+' : '') + Number(r[1]).toFixed(3) + '</b></div>';
  }).join('');

  var upHtml = ups.slice(0, 6).map(function (u) {
    var A = teamOf(u.teams[0].name), B = teamOf(u.teams[1].name);
    var bo = parseInt((u.bo || 'Bo3').replace(/\D/g, ''), 10) || 3;
    var p = predict(A.name, B.name, { bo: bo, date: u.isoDate, tier: tierOf(u.event) }).p;
    var known = A.n >= 3 && B.n >= 3;
    return '<div class="up-row" data-up="' + u.id + '">' +
      '<div class="ur-date">' + md(u.isoDate) + '<br>' + esc(u.bo || '') + '</div>' +
      '<div class="ur-nm">' + esc(A.name) + '</div>' +
      '<div class="ur-pct">' + (known ? (p * 100).toFixed(0) + '%' : '—') + '</div>' +
      '<div class="ur-nm r">' + esc(B.name) + '</div>' +
      '<div class="ur-date" style="text-align:right;color:#5f6b71">' + esc(A.tag) + ' / ' + esc(B.tag) + '</div></div>';
  }).join('') || '<div class="empty">暂无待赛</div>';

  setView(
    '<div class="page-head"><div><div class="kicker"><span></span>PREDICTION ENGINE / 推演台</div>' +
      '<div class="ph-title" style="margin-top:12px"><h2>赛事预测<em>MATCH SIMULATOR</em></h2>' +
      '<p>任选两支战队，模型按赛前 ELO、近期状态、交手记录与样本量给出胜率。所有系数来自 2026 年留出集之外的训练数据，页面上的命中率是真实回测。</p></div></div>' +
      '<div class="ph-meta"><div><span>TEST 2026</span><b>' + (test.acc * 100).toFixed(1) + '%</b></div>' +
      '<div><span>LOG LOSS</span><b>' + (test.logloss || 0).toFixed(3) + '</b></div></div></div>' +
    '<div class="predict-grid">' +
      '<div>' +
      '<section class="panel sim">' +
        '<div class="kicker"><span></span>SIMULATION DESK / 对阵推演</div>' +
        '<div class="sim-picks">' + pickHtml('a', S.sim.a) + '<div class="sim-vs">VS</div>' + pickHtml('b', S.sim.b) + '</div>' +
        '<div class="sim-opts"><div class="bo">' +
          [1, 3, 5].map(function (b) { return '<button class="chip ' + (S.sim.bo === b ? 'on' : '') + '" data-bo="' + b + '">BO' + b + '</button>'; }).join('') +
        '</div><button class="btn primary" id="runSim">运行推演<span>→</span></button></div>' +
        '<div class="sim-result ' + (pr ? 'on' : '') + '">' + (pr ? simResultHtml(pr) : '<div class="empty">选择两支不同战队后开始推演</div>') + '</div>' +
      '</section>' + oddsHtml() + '</div>' +
      '<aside style="display:flex;flex-direction:column;gap:14px">' +
        cnPredPanel() +
        '<section class="panel teal model-panel">' +
          '<div class="kicker t"><span></span>MODEL CARD / 模型档案</div>' +
          '<div class="mp-head" style="margin-top:14px"><div class="big">' + (test.acc * 100).toFixed(1) + '<small>%</small></div>' +
            '<div class="lbl">2026 留出集<br>命中率 / ' + num(test.n) + ' 场</div></div>' +
          '<div class="mp-grid">' +
            '<div class="mp-cell"><span>LOG LOSS</span><b>' + (test.logloss || 0).toFixed(3) + '</b></div>' +
            '<div class="mp-cell"><span>BRIER</span><b>' + (test.brier || 0).toFixed(3) + '</b></div>' +
            '<div class="mp-cell"><span>纯 ELO 基线</span><b>' + (base.acc * 100).toFixed(1) + '%</b></div>' +
            '<div class="mp-cell"><span>TRAIN / VALID</span><b>' + num((m.counts || {}).train) + ' / ' + num((m.counts || {}).valid) + '</b></div>' +
          '</div>' +
          '<div style="font:500 8px var(--mono);letter-spacing:.14em;color:#5a666c;margin-top:4px">CALIBRATION / 校准</div>' +
          '<div class="calib">' + calHtml + '</div>' +
          '<div class="calib-x"><span>50%</span><span>预测概率</span><span>100%</span></div>' +
          '<div class="mp-note">红线 = 实际命中率，柱 = 预测概率。贴近红线表示概率可信。<br>训练集 ' + num((m.counts || {}).train) + ' 场，验证 ' + num((m.counts || {}).valid) + ' 场，2026 全年 ' + num(test.n) + ' 场从未参与拟合。</div>' +
        '</section>' +
        '<section class="panel flat"><div class="panel-head"><div class="ph-l"><i>◆</i>系数 / COEFFICIENTS</div><div class="ph-r">LOGIT</div></div>' +
          '<div class="panel-pad" style="padding-top:6px">' + coefRows + '</div></section>' +
        '<section class="panel flat"><div class="panel-head"><div class="ph-l"><i>◆</i>待赛预测 / UPCOMING</div><div class="ph-r">' + ups.length + ' 场</div></div>' +
          '<div class="panel-pad" style="padding:4px 16px 8px">' + upHtml + '</div></section>' +
      '</aside>' +
    '</div>'
  );
}

/* ---------------- 情报 ---------------- */
function intelView() {
  var srcAll = S.intelSrc === 'cn' ? cnIntel() : news();
  var all = srcAll;
  var tags = S.intelSrc === 'cn' ? ['全部', '转会', '赛事', '版本', '动态'] : ['全部', '转会', '赛事', '版本', '动态'];
  var counts = {};
  all.forEach(function (n) { counts[n.tag] = (counts[n.tag] || 0) + 1; });
  var list = S.intelTag === '全部' ? all : all.filter(function (n) { return n.tag === S.intelTag; });
  if (S.intelSrc === 'cn' && S.intelTag === '全部') list = list.slice(0, 120);
  var chips = tags.filter(function (t) { return t === '全部' || (counts[t] || 0) > 0; }).map(function (t) {
    var c = t === '全部' ? all.length : (counts[t] || 0);
    return '<button class="chip ' + (S.intelTag === t ? 'on' : '') + '" data-itag="' + t + '">' + t + '<span class="n">' + c + '</span></button>';
  }).join('');
  var cards = list.map(function (n) {
    var hasCn = !!n.titleCn;
    if (S.intelSrc === 'cn') {
      return '<article class="news-card' + (n.lang === 'en' ? ' en' : '') + '" data-cnnews="' + esc(n.id) + '">' +
        '<div class="nc-top"><span class="nc-date">' + esc(n.date) + '</span><span class="tag ' + (n.tag === '赛事' ? 't' : n.tag === '版本' ? 'g' : '') + '">' + esc(n.tag) + '</span></div>' +
        '<div class="nc-title">' + esc(n.title) + '</div>' +
        '<div class="nc-sum">' + esc(n.summary) + '</div>' +
        '<div class="nc-foot"><span class="src">' + esc(n.src || 'VLR') + '</span><span>' + (n.lang === 'zh' ? '中文' : '源文') + ' →</span></div>' +
      '</article>';
    }
    return '<article class="news-card" data-news="' + n.id + '">' +
      '<div class="nc-top"><span class="nc-date">' + esc(n.date) + '</span><span class="tag ' + (n.tag === '赛事' ? 't' : n.tag === '版本' ? 'g' : '') + '">' + esc(n.tag) + '</span></div>' +
      '<div class="nc-title">' + esc(hasCn ? n.titleCn : n.title) + (hasCn ? '<small>' + esc(n.title) + '</small>' : '') + '</div>' +
      '<div class="nc-sum">' + esc(n.summaryCn || n.summary) + '</div>' +
      '<div class="nc-foot"><span class="src">' + flag(n.region) + ' ' + esc(n.author || 'VLR') + '</span><span>READ →</span></div>' +
    '</article>';
  }).join('') || '<div class="empty">没有这一类情报</div>';

  var tally = tags.slice(1).filter(function (t) { return (counts[t] || 0) > 0; }).map(function (t) {
    var c = counts[t] || 0, w = all.length ? c / all.length * 100 : 0;
    return '<div><span>' + t + '</span><b>' + c + '</b><div class="bar"><i style="width:' + w + '%"></i></div></div>';
  }).join('');
  var watch = TEAMS.filter(function (t) { return t.n >= 30 && t.lastDate && daysBetween(t.lastDate, isoToday()) < 400; })
    .sort(function (a, b) { return b.elo - a.elo; }).slice(0, 6);
  var watchHtml = watch.map(function (t) {
    return '<button data-team="' + esc(t.name) + '">' + badge(t, 'sm') +
      '<div><div class="wl-name">' + esc(t.name) + '</div><div class="wl-sub">' + t.elo + ' ELO · ' + esc(t.region) + '</div></div></button>';
  }).join('');

  setView(
    '<div class="page-head"><div><div class="kicker"><span></span>INTEL FEED / 情报流</div>' +
      '<div class="ph-title" style="margin-top:12px"><h2>无畏契约情报<em>NEWS &amp; ROSTER MOVES</em></h2>' +
      '<p>采集自 vlr.gg 新闻流，按转会、赛事、版本分类。标题与摘要为人工中文编译，原文链接保留在详情页。</p></div></div>' +
      '<div class="ph-meta"><div><span>ARTICLES</span><b>' + all.length + '</b></div>' +
      '<div><span>LATEST</span><b>' + (all[0] ? md(all[0].date) : '—') + '</b></div></div></div>' +
    '<div class="filterbar"><div class="seg">' +
      '<button class="' + (S.intelSrc !== 'cn' ? 'on' : '') + '" data-isrc="global">全球资讯</button>' +
      '<button class="' + (S.intelSrc === 'cn' ? 'on' : '') + '" data-isrc="cn">CN 资讯 ' + cnIntel().length + '</button></div>' +
      chips + '<span class="spacer"></span><span class="db-count">' + list.length + ' ITEMS</span></div>' +
    '<div class="intel-layout"><div class="intel-list">' + cards + '</div>' +
      '<aside class="intel-side">' +
        '<section class="panel side-block"><h4>分类统计 / BY TAG</h4><div class="tally">' + tally + '</div></section>' +
        '<section class="panel side-block"><h4>战力观察 / WATCHLIST</h4><div class="watch-list">' + watchHtml + '</div></section>' +
        '<section class="panel side-block"><h4>情报说明</h4><p style="font:400 10px/1.8 var(--sans);color:#6d797f">快照时间 ' + esc(META.generated) + '。<br>新闻摘要由人工编译，不替代原文；点击卡片可查看完整摘要与来源链接。</p></section>' +
      '</aside></div>'
  );
}

/* ---------------- 数据库 ---------------- */
function maplabView() {
  var M = window.VD_MAPS || { maps: {} };
  var maps = M.maps || {};
  var ordered = ['ascent','split','bind','haven','lotus','sunset','pearl','icebox','breeze','fracture','abyss','corrode','summit']
    .filter(function (k) { return maps[k]; });
  var slug = S.mapSlug && maps[S.mapSlug] ? S.mapSlug : (ordered[0] || null);
  if (!slug) {
    setView('<div class="empty">地图数据未加载（web/assets/data/maps.js）</div>');
    return;
  }
  S.mapSlug = slug;
  var m = maps[slug];
  var calibrated = m.calibrated;
  var goodPts = m.callouts.filter(function (c) { return c.ok; }).length;
  var inPts = m.callouts.filter(function (c) { return !c.o; }).length;
  setView(
    '<div class="page-head"><div><div class="kicker"><span></span>MAP LAB / 跑图</div>' +
      '<div class="ph-title" style="margin-top:12px"><h2>跑图<em>ENTER &amp; WALK THE MAP</em></h2>' +
      '<p>点地图进入：WASD 走位、鼠标转视角、滚轮缩放，右侧小地图实时跟着你。地面碰撞来自俯视图的实心区域，点位来自 valorant-api 的官方坐标。</p></div></div>' +
      '<div class="ph-meta"><div><span>MAPS</span><b>' + ordered.length + '</b></div>' +
      '<div><span>CALLOUTS 已标定</span><b>' + Object.keys(maps).reduce(function (a, k) { return a + maps[k].callouts.filter(function (c) { return c.ok; }).length; }, 0) + '</b></div></div></div>' +
    '<div class="ml-bar">' + ordered.map(function (k) {
      var x = maps[k];
      return '<button class="ml-chip' + (k === S.mapSlug ? ' on' : '') + '" data-mapsel="' + k + '">' +
        '<b>' + esc(x.zh) + '</b><span>' + esc(x.name) + '</span>' +
        (x.calibrated ? '' : '<i title="点位未标定">!</i>') + '</button>';
    }).join('') + '</div>' +
    '<div class="ml-layout">' +
      '<div class="ml-main">' +
        '<div class="ml-viewwrap"><canvas id="mlView" class="ml-view" tabindex="0"></canvas>' +
          '<div class="ml-overlay"><div class="ml-zone">区域 <b id="mlZone">—</b></div>' +
          '<div class="ml-speed">速度 <b id="mlSpeed">0 u/s</b></div>' +
          '<div class="ml-lock" id="mlLock">点击画面锁定鼠标</div></div>' +
          '<canvas id="mlMini" class="ml-mini"></canvas>' +
        '</div>' +
        '<div class="ml-legend"><span>点位 <b>' + (calibrated ? goodPts : 0) + '</b> 已标定</span>' +
          '<span>坐标在图内 <b>' + inPts + '/' + m.callouts.length + '</b></span>' +
          '<span>碰撞网格 <b>' + m.grid.w + '×' + m.grid.h + '</b> @' + m.grid.cell + 'u</span>' +
          '<span>点位标定 <b style="color:' + (calibrated ? 'var(--teal)' : 'var(--coral2)') + '">' + (m.calib * 100).toFixed(0) + '%</b></span></div>' +
      '</div>' +
      '<div id="ml-zone" class="ml-side"></div>' +
    '</div>'
  );
  var v = $('#mlView'), mi = $('#mlMini');
  if (window.ML) {
    try {
      window.ML.setView(v, mi);
      window.ML.rebind();
      window.ML.enter(slug);
      setTimeout(function () { if (S.view === 'maplab' && window.ML) window.ML.resize(); }, 30);
    } catch (e) {
      window.__errs = window.__errs || [];
      window.__errs.push('maplab:' + (e && e.message) + ' :: ' + (e && e.stack && e.stack.split('\n').slice(0,2).join(' | ')));
      toast('跑图初始化失败：' + (e && e.message ? e.message : e));
    }
  }
}
function dbView() {
  var c = META.counts || {};
  var cnTeams = TEAMS.filter(function (t) { return t.region === 'CN'; });
  var cnPlayers = PLAYERS.filter(function (p) { return p.country === '中国' || p.country === '中国香港' || p.country === '中国台湾'; });
  var tabs = [['cn', 'CN 专区', cnTeams.length], ['players', '选手', c.players], ['teams', '战队', c.teams], ['matches', '比赛', c.matches]];
  var tabHtml = tabs.map(function (t) {
    return '<button class="' + (S.dbTab === t[0] ? 'on' : '') + '" data-dbtab="' + t[0] + '">' + t[1] + '<b>' + num(t[2]) + '</b></button>';
  }).join('');

  var filterHtml = '';
  if (S.dbTab === 'cn') {
    setView(cnZoneHtml());
    return;
  }
  if (S.dbTab === 'players') {
    filterHtml = ['全部', '现役', '退役', '不活跃'].map(function (s) {
      var key = s === '全部' ? '' : s;
      return '<button class="chip ' + (S.dbStatus === key ? 'on' : '') + '" data-dbstatus="' + key + '">' + s + '</button>';
    }).join('');
  } else if (S.dbTab === 'teams') {
    filterHtml = [['active', '活跃'], ['rated', '有战绩'], ['all', '全部']].map(function (s) {
      return '<button class="chip ' + (S.dbScope === s[0] ? 'on' : '') + '" data-dbscope="' + s[0] + '">' + s[1] + '</button>';
    }).join('') + '<span style="width:8px"></span>' +
      ['全部'].concat(REGIONS).map(function (r) {
        var key = r === '全部' ? '' : r;
        return '<button class="chip ' + (S.dbRegion === key ? 'on' : '') + '" data-dbregion="' + key + '">' + r + '</button>';
      }).join('');
  } else {
    filterHtml = ['全部', '2026', '2025', '2024', '2023', '2022', '2021', '2020'].map(function (y) {
      var key = y === '全部' ? '' : y;
      return '<button class="chip ' + (S.dbYear === key ? 'on' : '') + '" data-dbyear="' + key + '">' + y + '</button>';
    }).join('');
  }

  var thead = '';
  if (S.dbTab === 'players') thead = '<div class="db-thead players"><span>选手 / PLAYER</span><span>国家</span><span>状态</span><span>最近效力</span><span>生涯场次</span><span>胜率</span></div>';
  if (S.dbTab === 'teams') thead = '<div class="db-thead teams"><span>#</span><span>战队 / TEAM</span><span>赛区</span><span>ELO</span><span>战绩</span><span>胜率</span></div>';
  if (S.dbTab === 'matches') thead = '<div class="db-thead matches"><span>日期</span><span>对阵 / MATCH</span><span>比分</span><span>级别</span><span>赛事</span></div>';

  setView(
    '<div class="page-head"><div><div class="kicker"><span></span>ARCHIVE / 大型数据库</div>' +
      '<div class="ph-title" style="margin-top:12px"><h2>数据库<em>PLAYERS · TEAMS · MATCHES</em></h2>' +
      '<p>选手档案来自 Liquipedia（含退役），比赛与生涯记录来自 vlr.gg。中国赛区 ' + num(c.details) + ' 场带逐图与选手数据。</p></div></div>' +
      '<div class="ph-meta"><div><span>RANGE</span><b>' + esc((META.range || []).join('—')) + '</b></div>' +
      '<div><span>EVENTS</span><b>' + num(c.events) + '</b></div></div></div>' +
    '<div class="db-tabs">' + tabHtml + '</div>' +
    '<div class="filterbar">' + filterHtml + '</div>' +
    '<div class="db-tools"><div class="db-search"><span>⌕</span>' +
      '<input id="dbSearch" placeholder="搜索' + (S.dbTab === 'players' ? '选手 ID 或真名' : S.dbTab === 'teams' ? '战队名或缩写' : '队名、赛事名') + '…" value="' + esc(S.dbQuery) + '">' +
      '<kbd>⌘K</kbd></div><div class="db-count" id="dbCount">—</div></div>' +
    thead + '<div class="db-list ' + S.dbTab + '" id="dbList"><div class="empty">读取中…</div></div>' +
    '<div class="db-more" id="dbMore"></div>' +
    '<div class="db-foot"><span>数据来源：VLR.GG / LIQUIPEDIA</span><span>点击任意行查看档案</span></div>'
  );
  if (S.dbTab === 'matches' && !loadedYears['2020']) {
    $('#dbList').innerHTML = '<div class="empty">正在展开全部赛季…</div>';
    ensureAllYears().then(function () { if (S.view === 'db' && S.dbTab === 'matches') refreshDbList(); });
  } else {
    refreshDbList();
  }
}

function cnZoneHtml() {
  var cnT = TEAMS.filter(function (t) { return t.region === 'CN'; })
    .sort(function (a, b) { return (b.n >= 20 ? 1 : 0) - (a.n >= 20 ? 1 : 0) || b.elo - a.elo; });
  var active = cnT.filter(function (t) { return t.n >= 20; });
  var players = PLAYERS.filter(function (p) { return p.country === '中国' || p.country === '中国香港' || p.country === '中国台湾'; })
    .sort(function (a, b) { return (b.vct - a.vct) || (b.n - a.n); }).slice(0, 24);
  var cnIntelList = cnIntel().filter(function (n) { return n.tag === '转会' || n.tag === '赛事'; }).slice(0, 10);
  var sys = [
    ['合作伙伴 8 队', (VCTCN.partners || []).map(function (n) { return teamTag(teamOf(n)); }).join(' / ')],
    ['晋升赛出线 2 队', (VCTCN.ascended || []).map(function (n) { return teamTag(teamOf(n)); }).join(' / ')],
    ['预选池', '全国大赛（12 月）产生最后名额'],
    ['CN 赛程节奏', '启点赛 → 联赛阶段 → 进化者积分 → 晋升赛/Threshold → 冠军赛席位'],
  ];
  var teamRows = active.slice(0, 24).map(function (t, i) {
    var wr = t.n ? (t.w / t.n * 100).toFixed(1) : '0.0';
    return '<div class="db-row" data-team="' + esc(t.name) + '" style="grid-template-columns:34px minmax(0,1.3fr) 74px 70px 84px 70px">' +
      '<div class="rr-no" style="font-size:11px">' + (i + 1) + '</div>' +
      '<div class="dr-main">' + esc(t.name) + '<small>' + esc(t.tag) + '</small></div>' +
      '<div class="dr-mid">' + flag(t.flag) + ' ' + esc(t.country || 'CN') + '</div>' +
      '<div class="dr-num" style="color:var(--teal)">' + t.elo + '</div>' +
      '<div class="dr-num" style="font-size:9px;color:#8b979d">' + t.w + '–' + t.l + '</div>' +
      '<div class="dr-num">' + wr + '%</div></div>';
  }).join('');
  var plRows = players.map(function (p) {
    return '<div class="db-row" data-player="' + esc(p.handle) + '" style="grid-template-columns:minmax(0,1fr) 74px 90px 70px">' +
      '<div class="dr-main">' + esc(p.handle) + (p.vct ? '<span class="tag t" style="height:13px;font-size:6.5px;padding:0 4px;margin-left:6px;vertical-align:1px">VCT</span>' : '') +
      '<small>' + esc(p.real || '') + '</small></div>' +
      '<div class="dr-mid">' + esc(p.team || '—') + '</div>' +
      '<div class="dr-num">' + num(p.n) + ' 场</div>' +
      '<div class="dr-num" style="color:' + (p.wr >= 55 ? 'var(--teal)' : '#b7b1a6') + '">' + (p.wr ? p.wr + '%' : '—') + '</div></div>';
  }).join('');
  var intelRows = cnIntelList.map(function (n) {
    return '<div class="dw-match" data-cnnews="' + esc(n.id) + '" style="padding:8px 0"><div class="dm-date">' + md(n.date) + '</div>' +
      '<div class="dm-teams">' + esc(n.title.slice(0, 90)) + '</div><div class="dm-score" style="font-size:9px">' + esc(n.tag) + '</div><div class="dm-res">→</div></div>';
  }).join('');
  return '<div class="page-head"><div><div class="kicker"><span></span>CN ZONE / CN 专区</div>' +
    '<div class="ph-title" style="margin-top:12px"><h2>CN 战区<em>VCT CN · 2026 → 2027</em></h2>' +
    '<p>CN 赛区单独成册：合作伙伴与晋升赛名额、联赛节奏、CN 战队与选手排行榜、CN 转会与赛事速报。四大赛区口径下 CN 与 EMEA / Americas / Pacific 平级。</p></div></div>' +
    '<div class="ph-meta"><div><span>CN TEAMS</span><b>' + cnT.length + '</b></div>' +
    '<div><span>ACTIVE</span><b>' + active.length + '</b></div><div><span>INTEL</span><b>' + cnIntel().length + '</b></div></div></div>' +
    '<div class="cn-sys">' + sys.map(function (x) {
      return '<div class="cn-sys-item"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>';
    }).join('') + '</div>' +
    '<div class="cn-zone-grid">' +
      '<section class="panel flat"><div class="panel-head"><div class="ph-l"><i>◆</i>CN 战队榜 / POWER RANKING</div><div class="ph-r">' + active.length + ' 队（≥20 场）</div></div>' +
        '<div class="db-thead" style="grid-template-columns:34px minmax(0,1.3fr) 74px 70px 84px 70px;border:0"><span>#</span><span>战队</span><span>国家</span><span>ELO</span><span>战绩</span><span>胜率</span></div>' +
        '<div class="db-list">' + teamRows + '</div></section>' +
      '<section class="panel flat"><div class="panel-head"><div class="ph-l"><i>◆</i>CN 选手榜 / PLAYERS</div><div class="ph-r">现役优先</div></div>' +
        '<div class="db-thead" style="grid-template-columns:minmax(0,1fr) 74px 90px 70px;border:0"><span>选手</span><span>战队</span><span>生涯</span><span>胜率</span></div>' +
        '<div class="db-list">' + plRows + '</div></section>' +
    '</div>' +
    '<section class="panel flat" style="margin-top:16px"><div class="panel-head"><div class="ph-l"><i>◆</i>CN 速报 / LATEST</div>' +
      '<div class="ph-r"><button class="more" data-go="intel" data-src="cn">全部 →</button></div></div>' +
      '<div class="panel-pad" style="padding:6px 20px 14px">' + (intelRows || '<div class="empty">暂无</div>') + '</div></section>';
}
function dbFiltered() {
  var q = S.dbQuery.trim().toLowerCase();
  if (S.dbTab === 'players') {
    return PLAYERS.filter(function (p) {
      if (S.dbStatus && p.status !== S.dbStatus) return false;
      if (!q) return true;
      return p.handle.toLowerCase().indexOf(q) >= 0 || (p.real || '').toLowerCase().indexOf(q) >= 0 ||
        (p.team || '').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return (b.vct - a.vct) || (b.n - a.n); });
  }
  if (S.dbTab === 'teams') {
    return TEAMS.filter(function (t) {
      if (t.n < 1) return false;
      if (S.dbScope === 'active' && (!t.lastDate || daysBetween(t.lastDate, isoToday()) > 400 || t.n < 10)) return false;
      if (S.dbScope === 'rated' && t.n < 10) return false;
      if (S.dbRegion && t.region !== S.dbRegion) return false;
      if (!q) return true;
      return t.name.toLowerCase().indexOf(q) >= 0 || (t.tag || '').toLowerCase().indexOf(q) >= 0 ||
        (t.zh || '').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return (b.elo - a.elo) || (b.n - a.n); });
  }
  var list = allMatches().filter(function (m) {
    if (S.dbYear && m[1].slice(0, 4) !== S.dbYear) return false;
    if (!q) return true;
    return m[4].toLowerCase().indexOf(q) >= 0 || m[5].toLowerCase().indexOf(q) >= 0 ||
      m[2].toLowerCase().indexOf(q) >= 0;
  });
  return list;
}

function refreshDbList() {
  var list = dbFiltered();
  var per = S.dbTab === 'matches' ? 80 : 64;
  var show = list.slice(0, S.dbPage * per);
  var el = $('#dbList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="empty">没有匹配的档案</div>'; }
  else if (S.dbTab === 'players') {
    el.innerHTML = show.map(function (p) {
      return '<div class="db-row" data-player="' + esc(p.handle) + '">' +
        '<div class="dr-main">' + esc(p.handle) + (p.vct ? '<span class="tag t" style="height:13px;font-size:6.5px;padding:0 4px;margin-left:6px;vertical-align:1px">VCT</span>' : '') + '<small>' + esc(p.real || '—') + '</small></div>' +
        '<div class="dr-mid">' + esc(p.country || '—') + '</div>' +
        '<div class="dr-tag">' + esc(p.status) + '</div>' +
        '<div class="dr-mid">' + esc(p.team || '—') + '</div>' +
        '<div class="dr-num">' + num(p.n) + '</div>' +
        '<div class="dr-num" style="color:' + (p.wr >= 55 ? 'var(--teal)' : '#b7b1a6') + '">' + (p.wr ? p.wr + '%' : '—') + '</div></div>';
    }).join('');
  } else if (S.dbTab === 'teams') {
    el.innerHTML = show.map(function (t, i) {
      var wr = t.n ? (t.w / t.n * 100).toFixed(1) : '0.0';
      return '<div class="db-row" data-team="' + esc(t.name) + '">' +
        '<div class="rr-no" style="font-size:11px">' + (i + 1) + '</div>' +
        '<div class="dr-main">' + esc(t.name) + '<small>' + esc(t.tag) + ' · ' + esc(t.zh || '') + '</small></div>' +
        '<div class="dr-mid">' + flag(t.flag) + ' ' + esc(t.region) + '</div>' +
        '<div class="dr-num" style="color:var(--teal)">' + t.elo + '</div>' +
        '<div class="dr-num" style="font-size:9px;color:#8b979d">' + t.w + '–' + t.l + '</div>' +
        '<div class="dr-num">' + wr + '%</div></div>';
    }).join('');
  } else {
    el.innerHTML = show.map(function (m) {
      var winA = m[8] === 0;
      return '<div class="db-row" data-match="' + m[0] + '">' +
        '<div class="dr-mid" style="font-family:var(--mono);font-size:8.5px">' + m[1] + '</div>' +
        '<div class="dr-main">' + esc(m[4]) + ' <span style="color:#4f5b61">vs</span> ' + esc(m[5]) +
          '<small>' + esc(m[3] || '') + '</small></div>' +
        '<div class="dr-num" style="color:' + '#d8d2c6' + '">' + m[6] + ' : ' + m[7] + '</div>' +
        '<div class="dr-tag">' + TIER_CN[m[9]] + '</div>' +
        '<div class="dr-mid">' + esc(m[2]) + '</div></div>';
    }).join('');
  }
  var count = $('#dbCount');
  if (count) count.textContent = num(list.length) + ' RECORDS';
  var more = $('#dbMore');
  if (more) {
    more.innerHTML = show.length < list.length
      ? '<button class="btn ghost sm" id="dbMoreBtn">加载更多 / ' + num(list.length - show.length) + ' 剩余</button>' : '';
  }
}

/* ---------------- 抽屉：战队 ---------------- */
var drawerToken = 0;
function openDrawer(html) {
  drawerToken++;
  var d = $('#drawer');
  d.innerHTML = '<button class="drawer-x" id="drawerX" aria-label="关闭">×</button><div class="drawer-inner">' + html + '</div>';
  d.classList.add('on');
  d.setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('on');
  $('#drawerX').onclick = closeDrawer;
  d.scrollTop = 0;
}
function closeDrawer() {
  drawerToken++;
  $('#drawer').classList.remove('on');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('on');
}
function activeRank(t) {
  var arr = TEAMS.filter(function (x) { return x.n >= 20 && x.lastDate && daysBetween(x.lastDate, isoToday()) < 400; })
    .sort(function (a, b) { return b.elo - a.elo; });
  for (var i = 0; i < arr.length; i++) if (arr[i].name === t.name) return i + 1;
  return 0;
}
function openTeam(name) {
  var t = teamOf(name);
  openDrawer('<div class="empty">LOADING TEAM DOSSIER / 正在调取战队档案…</div>');
  var token = drawerToken;
  ensureAllYears().then(function () {
    if (token !== drawerToken) return;
    var rows = MATCHES.filter(function (m) { return m[4] === t.name || m[5] === t.name; });
    var years = {};
    rows.forEach(function (m) {
      var y = m[1].slice(0, 4), won = (m[4] === t.name) === (m[8] === 0);
      if (!years[y]) years[y] = [0, 0, 0];
      years[y][0]++; years[y][won ? 1 : 2]++;
    });
    var n = rows.length, w = rows.filter(function (m) { return (m[4] === t.name) === (m[8] === 0); }).length;
    var wr = n ? (w / n * 100).toFixed(1) : '0.0';
    var maxY = Math.max.apply(null, Object.keys(years).map(function (y) { return years[y][0]; }).concat([1]));
    var yearHtml = Object.keys(years).sort().map(function (y) {
      var g = years[y];
      return '<div class="yearbar"><span>' + y + '</span><div class="yb">' +
        '<i style="width:' + (g[1] / maxY * 100) + '%"></i><b style="width:' + (g[2] / maxY * 100) + '%"></b></div>' +
        '<em>' + g[0] + ' 场 · ' + (g[1] / g[0] * 100).toFixed(0) + '%</em></div>';
    }).join('');
    var recent = rows.slice().sort(function (a, b) { return a[1] < b[1] ? 1 : -1; }).slice(0, 10);
    var recentHtml = recent.map(function (m) {
      var isA = m[4] === t.name, opp = isA ? m[5] : m[4], won = isA ? m[8] === 0 : m[8] === 1;
      var sc = isA ? (m[6] + ':' + m[7]) : (m[7] + ':' + m[6]);
      return '<div class="dw-match" data-match="' + m[0] + '"><div class="dm-date">' + md(m[1]) + '</div>' +
        '<div class="dm-teams">vs <b>' + esc(opp) + '</b><br><span style="font:500 8px var(--mono);color:#4f5b61">' + esc(m[2]) + '</span></div>' +
        '<div class="dm-score">' + sc + '</div><div class="dm-res ' + (won ? 'w' : 'l') + '">' + (won ? 'WIN' : 'LOSS') + '</div></div>';
    }).join('') || '<div class="empty">暂无比赛</div>';

    var opp = {};
    rows.forEach(function (m) {
      var isA = m[4] === t.name, o = isA ? m[5] : m[4];
      if (!opp[o]) opp[o] = [0, 0];
      opp[o][0]++;
      if ((isA && m[8] === 0) || (!isA && m[8] === 1)) opp[o][1]++;
    });
    var h2h = Object.keys(opp).sort(function (a, b) { return opp[b][0] - opp[a][0]; }).slice(0, 6);
    var h2hHtml = h2h.map(function (o) {
      var g = opp[o], p = g[1] / g[0] * 100;
      return '<div style="margin-bottom:9px"><div class="h2h-nums"><span>' + esc(o) + '</span><span>' + g[1] + ' 胜 / ' + (g[0] - g[1]) + ' 负</span></div>' +
        '<div class="h2h-bar"><i style="width:' + p + '%"></i></div></div>';
    }).join('');

    var rObj = ROSTER[t.name];
    var roster = (rObj && (rObj.p || rObj.list)) ? rObj.p.slice() : [];
    if (!roster.length) {
      PLAYERS.forEach(function (p) { if (p.team === t.name) roster.push([p.handle, p.n, '', '']); });
    }
    roster.sort(function (a, b) { return b[1] - a[1]; });
    var rosterLabel = rObj && rObj.s === 'vlr' ? '现役阵容 / CURRENT' : '历史出场 / APPEARANCES';
    var rosterHtml = roster.slice(0, 12).map(function (r) {
      return '<div class="roster-row" data-player="' + esc(r[0]) + '"><span class="badge sm" data-accent="t">' + esc(String(r[0]).slice(0, 2).toUpperCase()) + '</span><b>' + esc(r[0]) + '</b><small class="roster-real">' + esc(r[2] || '') + '</small><span>' + (r[1] ? num(r[1]) + ' 场' : '') + '</span></div>';
    }).join('') || '<div class="empty" style="padding:14px">未收录阵容（该队不在世界排名页，且无中国赛区逐场数据）</div>';

    var rank = activeRank(t);
    var html =
      '<div class="dw-kicker"><span></span>TEAM DOSSIER / 战队档案</div>' +
      '<div class="dw-title">' + badge(t, 'lg') + '<h2>' + esc(t.name) + '</h2></div>' +
      '<div class="dw-sub">' + [esc(t.tag), (t.zh && t.zh !== t.tag) ? esc(t.zh) : '',
        (flag(t.flag) + ' ' + esc(t.country || '')).trim(),
        (t.region && t.region !== t.country) ? esc(t.region) : ''].filter(Boolean).join(' · ') + '</div>' +
      '<div class="dw-stats">' +
        '<div class="dw-stat"><span>ELO</span><b>' + t.elo + '</b></div>' +
        '<div class="dw-stat"><span>RANK</span><b>' + (rank ? '#' + rank : '—') + '</b></div>' +
        '<div class="dw-stat"><span>RECORD</span><b>' + w + '<small>–' + (n - w) + '</small></b></div>' +
        '<div class="dw-stat"><span>WIN RATE</span><b>' + wr + '<small>%</small></b></div>' +
      '</div>' +
      '<div class="dw-sec"><h3><i>01</i>逐年战绩 / BY SEASON<em>' + n + ' MATCHES</em></h3><div class="yearbars">' + yearHtml + '</div></div>' +
      '<div class="dw-sec"><h3><i>02</i>最近比赛 / RECENT<em>CLICK TO OPEN</em></h3>' + recentHtml + '</div>' +
      '<div class="dw-grid2" style="margin-top:6px">' +
        '<div class="dw-sec"><h3><i>03</i>常用对手 / H2H</h3>' + (h2hHtml || '<div class="empty">暂无</div>') + '</div>' +
        '<div class="dw-sec"><h3><i>04</i>阵容 / ROSTER<em>' + rosterLabel + '</em></h3><div class="roster-grid" style="grid-template-columns:1fr">' + rosterHtml + '</div></div>' +
      '</div>' +
      '<div class="dw-sec"><h3><i>05</i>档案信息 / FILE</h3>' +
        '<div class="kv"><span>成立 / 解散</span><b>' + esc(t.created || '未知') + ' / ' + esc(t.disbanded || '—') + '</b></div>' +
        '<div class="kv"><span>首次 / 最近比赛</span><b>' + esc(t.first || '—') + ' / ' + esc(t.last || '—') + '</b></div>' +
        '<div class="kv"><span>近期状态</span><b>' + (t.form > 0 ? '+' : '') + (t.form || 0).toFixed(1) + ' ELO</b></div>' +
      '</div>';
    openDrawer(html);
  });
}

/* ---------------- 抽屉：选手 ---------------- */
var recordsPromise = null, detailsPromise = null;
function loadRecords() {
  if (window.VD_PR) return Promise.resolve();
  if (recordsPromise) return recordsPromise;
  recordsPromise = new Promise(function (res) {
    var s = document.createElement('script');
    s.src = 'assets/data/records.js';
    s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  });
  return recordsPromise;
}
function loadDetails() {
  if (window.VD_DETAIL) return Promise.resolve();
  if (detailsPromise) return detailsPromise;
  detailsPromise = new Promise(function (res) {
    var s = document.createElement('script');
    s.src = 'assets/data/details.js';
    s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  });
  return detailsPromise;
}
function openPlayer(handle) {
  var p = PMAP[handle] || { handle: handle, real: '', country: '', status: '', years: '', n: 0, wr: 0, team: '' };
  openDrawer('<div class="empty">LOADING PLAYER FILE / 正在调取选手档案…</div>');
  var token = drawerToken;
  Promise.all([loadRecords(), ensureAllYears(), loadDetails()]).then(function () {
    if (token !== drawerToken) return;
    var PR = (window.VD_PR || {}).p || {};
    var rec = PR[p.handle];
    if (!rec) {
      var lk = Object.keys(PR).filter(function (k) { return k.toLowerCase() === p.handle.toLowerCase(); })[0];
      if (lk) rec = PR[lk];
    }
    var n = rec ? rec.n : p.n, w = rec ? rec.w : Math.round(p.n * p.wr / 100);
    var wr = n ? (w / n * 100).toFixed(1) : '0.0';
    var tm = (rec && rec.tm) || [];
    var tmHtml = tm.slice(0, 10).map(function (x) {
      return '<div class="kv"><span>' + esc(x[2] === x[3] ? x[2] : x[2] + '–' + x[3]) + '</span><b>' + esc(x[0]) + ' · ' + x[1] + ' 场</b></div>';
    }).join('') || '<div class="empty" style="padding:10px">无战队履历</div>';

    var agents = {};
    var DET = window.VD_DETAIL || {};
    Object.keys(DET).forEach(function (id) {
      DET[id][1].forEach(function (row) {
        if (String(row[0]).toLowerCase() === p.handle.toLowerCase()) {
          (row[3] || []).forEach(function (a) { agents[a] = (agents[a] || 0) + 1; });
        }
      });
    });
    var agArr = Object.keys(agents).sort(function (a, b) { return agents[b] - agents[a]; }).slice(0, 8);
    var agTotal = agArr.reduce(function (s, a) { return s + agents[a]; }, 0) || 1;
    var agHtml = agArr.map(function (a) {
      var cn = (META.agents || {})[a] || '';
      return '<div style="margin-bottom:8px"><div class="h2h-nums"><span>' + esc(a.toUpperCase()) + (cn ? ' · ' + esc(cn) : '') + '</span><span>' + agents[a] + ' 次</span></div>' +
        '<div class="h2h-bar"><i style="width:' + (agents[a] / agTotal * 100) + '%"></i></div></div>';
    }).join('') || '<div class="empty" style="padding:10px">仅中国赛区逐场档案含特工数据</div>';

    var recent = [], ys = rec ? Object.keys(rec.y || {}).sort().reverse().slice(0, 3) : [];
    ys.forEach(function (y) {
      (rec.y[y] || []).forEach(function (sid) {
        var m = matchOf(Math.abs(sid));
        if (m) recent.push({ m: m, side: sid > 0 ? 0 : 1 });
      });
    });
    recent.sort(function (a, b) { return a.m[1] < b.m[1] ? 1 : -1; });
    var recentHtml = recent.slice(0, 16).map(function (r) {
      var m = r.m, isA = r.side === 0, opp = isA ? m[5] : m[4];
      var won = isA ? m[8] === 0 : m[8] === 1;
      return '<div class="dw-match" data-match="' + m[0] + '"><div class="dm-date">' + md(m[1]) + '</div>' +
        '<div class="dm-teams">vs <b>' + esc(opp) + '</b><br><span style="font:500 8px var(--mono);color:#4f5b61">' + esc(m[2]) + '</span></div>' +
        '<div class="dm-score">' + m[6] + ':' + m[7] + '</div><div class="dm-res ' + (won ? 'w' : 'l') + '">' + (won ? 'WIN' : 'LOSS') + '</div></div>';
    }).join('') || '<div class="empty">本档案未收录其近期比赛</div>';

    var html =
      '<div class="dw-kicker"><span></span>PLAYER FILE / 选手档案</div>' +
      '<div class="dw-title"><h2>' + esc(p.handle) + '</h2><span class="tag ' + (p.status === '现役' ? 't' : 'n') + '">' + esc(p.status || '未知') + '</span></div>' +
      '<div class="dw-sub">' + esc(p.real || '真名未公开') + ' · ' + flag((META.playerFlags || {})[p.country] || '') + ' ' + esc(p.country || '—') + '</div>' +
      '<div class="dw-stats">' +
        '<div class="dw-stat"><span>MATCHES</span><b>' + num(n) + '</b></div>' +
        '<div class="dw-stat"><span>WIN RATE</span><b>' + wr + '<small>%</small></b></div>' +
        '<div class="dw-stat"><span>WINS</span><b>' + num(w) + '</b></div>' +
        '<div class="dw-stat"><span>LOSSES</span><b>' + num(n - w) + '</b></div>' +
      '</div>' +
      '<div class="dw-sec"><h3><i>01</i>身份 / IDENTITY</h3>' +
        '<div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">' +
        '<div class="kv"><span>活跃年份</span><b>' + esc(p.years || '—') + '</b></div>' +
        '<div class="kv"><span>出生日期</span><b>' + esc(p.birth || '未公开') + '</b></div>' +
        '<div class="kv"><span>VLR ID</span><b>' + esc(p.vlr || '—') + '</b></div>' +
        '<div class="kv"><span>曾用 ID</span><b>' + esc(p.aliases || '—') + '</b></div>' +
        '<div class="kv"><span>最近效力</span><b>' + esc(p.team || '—') + '</b></div>' +
        '<div class="kv"><span>退役日期</span><b>' + esc(p.retired || '—') + '</b></div></div></div>' +
      '<div class="dw-grid2">' +
        '<div class="dw-sec"><h3><i>02</i>战队履历 / TEAMS</h3>' + tmHtml + '</div>' +
        '<div class="dw-sec"><h3><i>03</i>常用特工 / AGENTS<em>CN 赛事</em></h3>' + agHtml + '</div>' +
      '</div>' +
      '<div class="dw-sec"><h3><i>04</i>比赛记录 / MATCH LOG<em>仅列本档案收录场次</em></h3>' + recentHtml + '</div>' +
      '<div class="dw-sec"><h3><i>05</i>口径说明</h3><p class="dw-body">生涯场次与胜率来自 vlr.gg 选手页完整出场记录；比赛清单只列本档案收录的场次，因此可能少于生涯总数。特工数据来自中国赛区逐场详情。</p></div>';
    openDrawer(html);
  });
}

/* ---------------- 抽屉：比赛 / 新闻 / 赛事 ---------------- */
function openMatch(id, upcomingObj) {
  var m = matchOf(id);
  var up = upcomingObj || upcoming().filter(function (u) { return String(u.id) === String(id); })[0] || null;
  openDrawer('<div class="empty">LOADING MATCH SHEET / 正在调取比赛…</div>');
  var token = drawerToken;
  ensureAllYears().then(function () {
    if (token !== drawerToken) return;
    if (!m) m = matchOf(id);
    if (!m && up) {
      // 待赛
      var A = teamOf(up.teams[0].name), B = teamOf(up.teams[1].name);
      var bo = parseInt((up.bo || 'Bo3').replace(/\D/g, ''), 10) || 3;
      var pr = predict(A.name, B.name, { bo: bo, date: up.isoDate, tier: tierOf(up.event) });
      var html = matchHead(up.event, up.series, up.isoDate, bo, up.veto) +
        '<div class="dw-stats" style="margin-top:18px"><div class="dw-stat"><span>TEAM A</span><b style="font-size:15px">' + esc(A.name) + '</b></div>' +
          '<div class="dw-stat"><span>WIN PROB</span><b>' + (pr.p * 100).toFixed(1) + '<small>%</small></b></div>' +
          '<div class="dw-stat"><span>PREDICT</span><b>' + esc(pr.score.s) + '</b></div>' +
          '<div class="dw-stat"><span>TEAM B</span><b style="font-size:15px">' + esc(B.name) + '</b></div></div>' +
        '<div class="dw-sec"><h3><i>01</i>赛前推演 / FORECAST</h3>' +
          ((A.n < 3 || B.n < 3) ? '<p class="mp-note" style="border:0;padding:0;margin:0 0 10px;color:#ff7a6d">注意：' + esc(A.n < 3 ? A.name : B.name) + ' 在本档案中的比赛样本不足 3 场，概率会强烈向 50% 收缩。</p>' : '') +
          '<div class="h2h-nums" style="margin-bottom:6px"><span>' + esc(A.tag) + ' ' + (pr.p * 100).toFixed(1) + '%</span><span>' + (pr.pB * 100).toFixed(1) + '% ' + esc(B.tag) + '</span></div>' +
          '<div class="h2h-bar" style="height:6px"><i style="width:' + (pr.p * 100) + '%"></i></div>' +
          '<div class="factors" style="margin-top:16px">' + factorRow('ELO 差', pr.eloDiff / 4, 100, ' 分', (pr.eloDiff > 0 ? '+' : '') + pr.eloDiff) +
            factorRow('近期状态', pr.formDiff, 120, ' 分', (pr.formDiff > 0 ? '+' : '') + pr.formDiff.toFixed(0)) +
            factorRow('交手记录', pr.h2h, 40, ' 分', pr.h2hN ? (pr.h2h > 0 ? '+' : '') + pr.h2h.toFixed(0) + ' / ' + pr.h2hN + ' 场' : '无记录') + '</div>' +
        '</div>' +
        '<div class="dw-sec"><h3><i>02</i>赛制与信息</h3>' +
          '<div class="kv"><span>赛事</span><b>' + esc(up.event) + '</b></div>' +
          '<div class="kv"><span>阶段</span><b>' + esc(up.series) + '</b></div>' +
          '<div class="kv"><span>开赛（UTC）</span><b>' + esc(up.utc || '') + '</b></div>' +
          '<div class="kv"><span>赛制</span><b>' + esc(up.bo || '—') + '</b></div>' +
          (up.veto ? '<div class="kv"><span>地图 BP</span><b style="white-space:normal;text-align:right">' + esc(up.veto) + '</b></div>' : '') + '</div>' +
        (up.url ? '<a class="read-link" href="' + esc(up.url) + '" target="_blank">在 vlr.gg 打开赛程 →</a>' : '');
      openDrawer(html);
      return;
    }
    if (!m) { openDrawer('<div class="empty">未找到这场比赛</div>'); return; }
    var A = teamOf(m[4]), B = teamOf(m[5]), winA = m[8] === 0;
    var pred = null;
    ((META.model || {}).recent || []).forEach(function (r) { if (r.id === m[0]) pred = r; });
    var hasDetail = (META.detailIds || []).indexOf(m[0]) >= 0;
    var draw = function (det) {
      if (token !== drawerToken) return;
      var html = matchHead(m[2], m[3], m[1], '', '') +
        '<div class="dw-stats" style="margin-top:18px">' +
          '<div class="dw-stat"><span>RESULT</span><b style="font-size:15px">' + esc(A.name) + '</b></div>' +
          '<div class="dw-stat"><span>SCORE</span><b>' + m[6] + '–' + m[7] + '</b></div>' +
          '<div class="dw-stat"><span>WINNER</span><b style="font-size:13px;color:var(--teal)">' + esc(winA ? A.tag : B.tag) + '</b></div>' +
          '<div class="dw-stat"><span>LEVEL</span><b style="font-size:13px">' + TIER_CN[m[9]] + '</b></div></div>' +
        (pred ? '<div class="dw-sec"><h3><i>01</i>模型复盘 / HINDSIGHT</h3>' +
          '<div class="h2h-nums" style="margin-bottom:6px"><span>' + esc(A.tag) + ' 赛前 ' + (pred.p * 100).toFixed(1) + '% · 模型看好 ' + esc(pred.p >= 0.5 ? A.tag : B.tag) + '</span>' +
          '<span style="color:' + (((pred.p >= 0.5) === winA) ? 'var(--teal)' : 'var(--coral2)') + '">' + (((pred.p >= 0.5) === winA) ? '✓ 命中' : '✗ 偏差') + '</span></div>' +
          '<div class="h2h-bar" style="height:6px"><i style="width:' + (pred.p * 100) + '%"></i></div></div>' : '') +
        (det ? '<div class="dw-sec"><h3><i>02</i>地图 / MAPS</h3>' +
          det[0].map(function (mp) {
            var z = (META.maps || {})[mp[0]] || '';
            return '<div class="maprow"><span>' + esc(mp[0]) + (z ? ' · ' + esc(z) : '') + '</span><b>' + mp[1] + ' : ' + mp[2] + '</b></div>';
          }).join('') + '</div>' +
          '<div class="dw-sec"><h3><i>03</i>选手数据 / SCOREBOARD<em>全场合计</em></h3>' +
          '<table class="scoretable"><thead><tr><th>选手</th><th>评分</th><th>ACS</th><th>K</th><th>D</th><th>A</th><th>KAST</th><th>ADR</th><th>HS%</th><th>+/-</th></tr></thead><tbody>' +
          det[1].slice().sort(function (a, b) { return (Number(b[4]) || 0) - (Number(a[4]) || 0); }).map(function (r) {
            function sv(v, dec, suffix) {
              if (v === null || v === undefined || v === '') return '—';
              var n = Number(v);
              if (!isFinite(n)) return '—';
              return (dec != null ? n.toFixed(dec) : Math.round(n)) + (suffix || '');
            }
            var hasKD = r[6] !== null && r[7] !== null && r[6] !== '' && r[7] !== '';
            var kd = hasKD ? Number(r[6]) - Number(r[7]) : null;
            return '<tr><td><span class="hl">' + esc(r[0]) + '</span> <span style="color:#4f5b61;font-size:7px">' + esc(r[1]) + '</span></td>' +
              '<td class="' + (Number(r[4]) >= 1.1 ? 'hl' : '') + '">' + sv(r[4], 2) + '</td><td>' + sv(r[5]) + '</td>' +
              '<td>' + sv(r[6]) + '</td><td>' + sv(r[7]) + '</td><td>' + sv(r[8]) + '</td><td>' + sv(r[9], 0, '%') + '</td>' +
              '<td>' + sv(r[10]) + '</td><td>' + sv(r[11], 0, '%') + '</td>' +
              '<td style="color:' + (kd == null ? '#5f6b71' : kd >= 0 ? 'var(--teal)' : 'var(--coral2)') + '">' + (kd == null ? '—' : (kd > 0 ? '+' : '') + kd) + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<p class="mp-note" style="margin-top:10px">数据来自 vlr.gg 单场页；列含义：Rating 2.0 / ACS 每回合伤害 / K-D-A / KAST 参与率 / ADR / 爆头率 / 首杀首死差。</p></div>'
          : '<div class="dw-sec"><h3><i>02</i>逐图数据</h3><div class="empty">本场没有收录逐图/选手数据。逐图详情覆盖 ' +
            (META.counts || {}).details + ' 场' + ((META.detailRange || []).length ? '（' + META.detailRange[0] + ' → ' + META.detailRange[1] + '）' : '') + '。</div></div>') +
        '<div class="dw-sec"><h3><i>' + (det ? '04' : '03') + '</i>比赛信息</h3>' +
          '<div class="kv"><span>日期</span><b>' + esc(m[1]) + ' · ' + dateCn(m[1]) + '</b></div>' +
          '<div class="kv"><span>赛事</span><b>' + esc(m[2]) + '</b></div>' +
          '<div class="kv"><span>阶段</span><b>' + esc(m[3] || '—') + '</b></div>' +
          '<div class="kv"><span>比赛 ID</span><b>' + m[0] + '</b></div></div>';
      openDrawer(html);
    };
    if (hasDetail) loadDetails().then(function () { draw((window.VD_DETAIL || {})[m[0]] || null); });
    else draw(null);
  });
}
function matchHead(event, series, date, bo, veto) {
  return '<div class="dw-kicker"><span></span>MATCH SHEET / 比赛档案</div>' +
    '<div class="dw-title"><h2 style="font-size:24px;max-width:520px;line-height:1.2">' + esc(event) + '</h2></div>' +
    '<div class="dw-sub">' + esc(series || '') + ' · ' + esc(date || '') + (bo ? ' · Bo' + bo : '') + '</div>';
}
function openNews(id) {
  var n = news().filter(function (x) { return String(x.id) === String(id); })[0];
  if (!n) return;
  openDrawer(
    '<div class="dw-kicker"><span></span>' + esc(n.tag) + ' / INTEL REPORT</div>' +
    '<div class="dw-title"><h2 style="font-size:28px;line-height:1.3">' + esc(n.titleCn || n.title) + '</h2></div>' +
    (n.titleCn ? '<div class="dw-sub" style="font-size:10px;line-height:1.6;color:#7c888e">' + esc(n.title) + '</div>' : '') +
    '<div class="read-meta"><span>' + esc(n.date) + '</span><span>' + flag(n.region) + ' ' + esc(n.author || 'VLR') + '</span><span>VLR.GG</span></div>' +
    '<div class="news-read"><p class="lead">' + esc(n.summaryCn || n.summary) + '</p>' +
    (n.summaryCn ? '<p style="color:#6d797f;font-size:11px;line-height:1.8">' + esc(n.summary) + '</p>' : '') +
    '<p style="color:#5f6b71;font-size:10px">说明：本页为摘要编译。完整报道、引语与后续更新请查看 vlr.gg 原文。</p></div>' +
    '<a class="read-link" href="' + esc(n.url) + '" target="_blank">阅读原文 / VLR.GG →</a>' +
    relatedTeams(n) + relatedNews(n)
  );
}
function openCnNews(id) {
  var n = cnIntel().filter(function (x) { return String(x.id) === String(id); })[0];
  if (!n) return;
  var linked = TEAMS.filter(function (t) {
    return t.region === 'CN' && t.n >= 20 && (n.summary || '').indexOf(t.tag) >= 0;
  }).slice(0, 5);
  openDrawer(
    '<div class="dw-kicker"><span></span>' + esc(n.tag) + ' / CN 资讯 · ' + esc(n.src || '') + '</div>' +
    '<div class="dw-title"><h2 style="font-size:22px;line-height:1.45">' + esc(n.title) + '</h2></div>' +
    '<div class="read-meta"><span>' + esc(n.date) + '</span><span>' + esc(n.author || '') + '</span><span>源文为英文，保留原样</span></div>' +
    '<div class="news-read"><p class="lead">' + esc(n.summary) + '</p>' +
      (n.full && n.full.length > (n.summary || '').length ?
        '<p style="color:#8b979d;font-size:11px;line-height:1.9">' + esc(n.full.slice(Math.min((n.summary || '').length, n.full.length))) + '</p>' : '') +
      '<p style="color:#5f6b71;font-size:10px">来源：VLR.gg 论坛 CN 转会/赛事汇总帖（社区整理，非官方公告）。逐楼内容不保证准确，正式消息以俱乐部公告为准。</p></div>' +
    (linked.length ? '<div class="dw-sec"><h3><i>01</i>相关战队 / CN TEAMS</h3>' + linked.map(function (t) {
      return '<div class="dw-match" data-team="' + esc(t.name) + '"><div class="dm-date" style="width:42px">' + esc(t.tag) + '</div>' +
        '<div class="dm-teams"><b>' + esc(t.name) + '</b></div><div class="dm-score">' + t.elo + '</div><div class="dm-res">ELO</div></div>';
    }).join('') + '</div>' : '') +
    '<a class="read-link" href="' + esc(n.url) + '" target="_blank">查看原帖 / VLR.GG →</a>'
  );
}
function relatedTeams(n) {
  var text = ((n.title || '') + ' ' + (n.summary || '') + ' ' + (n.titleCn || '') + ' ' + (n.summaryCn || '')).toLowerCase();
  var hits = TEAMS.filter(function (t) {
    if (!t.name || t.name.length < 2 || t.n < 20 || t.elo <= 0) return false;
    var esc_ = t.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return new RegExp('(^|[^a-z0-9])' + esc_ + '([^a-z0-9]|$)').test(text); } catch (e) { return false; }
  }).sort(function (a, b) { return b.elo - a.elo; }).slice(0, 4);
  if (!hits.length) return '';
  return '<div class="dw-sec"><h3><i>01</i>涉及战队 / TEAMS</h3>' + hits.map(function (t) {
    var wr = t.n ? (t.w / t.n * 100).toFixed(0) : '0';
    return '<div class="dw-match" data-team="' + esc(t.name) + '">' +
      '<div class="dm-date" style="width:42px">' + esc(t.tag) + '</div>' +
      '<div class="dm-teams"><b>' + esc(t.name) + '</b><br><span style="font:500 8px var(--mono);color:#4f5b61">' + esc(t.region) + ' · ' + t.n + ' 场 · ' + wr + '%</span></div>' +
      '<div class="dm-score">' + t.elo + '</div><div class="dm-res">ELO</div></div>';
  }).join('') + '</div>';
}
function relatedNews(n) {
  var list = news().filter(function (x) { return String(x.id) !== String(n.id) && x.tag === n.tag; }).slice(0, 4);
  if (!list.length) return '';
  return '<div class="dw-sec"><h3><i>02</i>同类情报 / RELATED<em>' + esc(n.tag) + '</em></h3>' + list.map(function (x) {
    return '<div class="dw-match" data-news="' + x.id + '"><div class="dm-date">' + md(x.date) + '</div>' +
      '<div class="dm-teams">' + esc(x.titleCn || x.title) + '</div><div class="dm-score" style="font-size:9px">' + esc(x.tag) + '</div><div class="dm-res">→</div></div>';
  }).join('') + '</div>';
}
function openEvent(name) {
  openDrawer('<div class="empty">LOADING EVENT / 正在调取赛事…</div>');
  var token = drawerToken;
  ensureAllYears().then(function () {
    if (token !== drawerToken) return;
    var rows = MATCHES.filter(function (m) { return m[2] === name; });
    var years = {};
    rows.forEach(function (m) { years[m[1].slice(0, 4)] = (years[m[1].slice(0, 4)] || 0) + 1; });
    var list = rows.slice(0, 80).map(function (m) {
      var winA = m[8] === 0;
      return '<div class="dw-match" data-match="' + m[0] + '"><div class="dm-date">' + md(m[1]) + '</div>' +
        '<div class="dm-teams"><b style="color:' + (winA ? '#eae5da' : '#8b979d') + '">' + esc(m[4]) + '</b> vs <b style="color:' + (!winA ? '#eae5da' : '#8b979d') + '">' + esc(m[5]) + '</b><br>' +
        '<span style="font:500 8px var(--mono);color:#4f5b61">' + esc(m[3] || '') + '</span></div>' +
        '<div class="dm-score">' + m[6] + ':' + m[7] + '</div><div class="dm-res">' + m[1].slice(0, 4) + '</div></div>';
    }).join('');
    openDrawer('<div class="dw-kicker"><span></span>EVENT ARCHIVE / 赛事档案</div>' +
      '<div class="dw-title"><h2 style="font-size:26px;line-height:1.25">' + esc(name) + '</h2></div>' +
      '<div class="dw-sub">' + rows.length + ' 场收录 · ' + Object.keys(years).sort().join(' / ') + '</div>' +
      '<div class="dw-stats"><div class="dw-stat"><span>MATCHES</span><b>' + rows.length + '</b></div>' +
        '<div class="dw-stat"><span>YEARS</span><b style="font-size:14px">' + Object.keys(years).sort().join(' ') + '</b></div>' +
        '<div class="dw-stat"><span>FIRST</span><b style="font-size:12px">' + (rows.length ? rows[rows.length - 1][1] : '—') + '</b></div>' +
        '<div class="dw-stat"><span>LAST</span><b style="font-size:12px">' + (rows.length ? rows[0][1] : '—') + '</b></div></div>' +
      '<div class="dw-sec"><h3><i>01</i>比赛列表<em>' + (rows.length > 80 ? '仅显示前 80 场' : 'ALL') + '</em></h3>' + (list || '<div class="empty">暂无</div>') + '</div>');
  });
}

/* ---------------- 全局检索 ---------------- */
var searchMode = 'global', searchCb = null, searchItems = [], searchSel = 0;
function openSearch(mode, cb) {
  searchMode = mode || 'global';
  searchCb = cb || null;
  $('#searchModal').hidden = false;
  $('#searchModal').querySelector('.kicker').innerHTML = '<span></span>' +
    (searchMode === 'team' ? 'SELECT TEAM / 选择战队' : 'GLOBAL SEARCH / 全局检索');
  var inp = $('#searchInput');
  inp.value = '';
  inp.placeholder = searchMode === 'team' ? '输入战队名或缩写…' : '输入选手 ID、战队名或赛事名…';
  inp.focus();
  renderSearch('');
}
function closeSearch() { $('#searchModal').hidden = true; searchItems = []; }
function renderSearch(q) {
  q = (q || '').trim().toLowerCase();
  var items = [];
  if (searchMode === 'team') {
    var ts = TEAMS.filter(function (t) {
      return t.n > 0 && (!q || t.name.toLowerCase().indexOf(q) >= 0 || (t.tag || '').toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return b.elo - a.elo; }).slice(0, 40);
    items = ts.map(function (t) {
      return { kind: 'team', id: t.name, label: t.name, sub: t.tag + ' · ' + t.region + ' · ELO ' + t.elo, right: t.w + '–' + t.l };
    });
  } else if (!q) {
    items = news().slice(0, 6).map(function (n) {
      return { kind: 'news', id: n.id, label: n.titleCn || n.title, sub: n.date + ' · ' + n.tag, right: 'NEWS' };
    });
  } else {
    PLAYERS.filter(function (p) { return p.handle.toLowerCase().indexOf(q) >= 0 || (p.real || '').toLowerCase().indexOf(q) >= 0; })
      .slice(0, 8).forEach(function (p) {
        items.push({ kind: 'player', id: p.handle, label: p.handle, sub: p.real || '真名未公开', right: p.status });
      });
    TEAMS.filter(function (t) { return t.name.toLowerCase().indexOf(q) >= 0 || (t.tag || '').toLowerCase().indexOf(q) >= 0; })
      .slice(0, 8).forEach(function (t) {
        items.push({ kind: 'team', id: t.name, label: t.name, sub: t.tag + ' · ' + t.region, right: 'ELO ' + t.elo });
      });
    (META.events || []).filter(function (e) { return e[0].toLowerCase().indexOf(q) >= 0; }).slice(0, 6).forEach(function (e) {
      items.push({ kind: 'event', id: e[0], label: e[0], sub: '赛事档案', right: e[1] + ' 场' });
    });
  }
  searchItems = items;
  searchSel = 0;
  var el = $('#searchResults');
  el.innerHTML = items.length ? items.map(function (it, i) {
    return '<div class="sr-row ' + (i === 0 ? 'sel' : '') + '" data-si="' + i + '">' +
      '<span class="sr-kind ' + it.kind + '">' + it.kind.toUpperCase() + '</span>' +
      '<div class="sr-main">' + esc(it.label) + '<small>' + esc(it.sub) + '</small></div>' +
      '<span class="sr-right">' + esc(it.right || '') + '</span></div>';
  }).join('') : '<div class="sr-empty">没有找到匹配项</div>';
}
function pickSearch(i) {
  var it = searchItems[i];
  if (!it) return;
  closeSearch();
  if (searchCb && it.kind === 'team') { searchCb(it.id); return; }
  if (it.kind === 'player') openPlayer(it.id);
  else if (it.kind === 'team') openTeam(it.id);
  else if (it.kind === 'event') openEvent(it.id);
  else if (it.kind === 'news') openNews(it.id);
}

/* ---------------- 外壳 ---------------- */
function fillRail() {
  var acc = (((META.model || {}).metrics || {}).test || {}).acc || 0;
  $('#railAcc').textContent = (acc * 100).toFixed(1) + '%';
  $('#railBar').style.width = (acc * 100).toFixed(1) + '%';
  $('#railUpdated').textContent = '数据 ' + String(META.generated || '').slice(0, 10);
}
function fillTicker() {
  var items = news().slice(0, 9).map(function (n) {
    return '<span class="tk-item"><em>' + esc(n.tag) + '</em><b>' + md(n.date) + '</b>' + esc(n.titleCn || n.title) + '</span>';
  }).join('');
  $('#ticker').innerHTML = items + items;
  $('#tickerMeta').textContent = news().length + ' FEEDS · ' + (META.generated || '').slice(0, 10);
}
function tickClock() {
  var d = new Date();
  $('#clock').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
}
var toastTimer = null;
function toast(msg) {
  var el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
}

/* ---------------- 事件 ---------------- */
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-view],[data-go],[data-team],[data-player],[data-match],[data-up],[data-news],[data-event],[data-cnnews],[data-isrc],[data-watch],[data-mapsel],[data-jump],' +
    '[data-mtab],[data-mfilter],[data-myear],[data-itag],[data-dbtab],[data-dbstatus],[data-dbregion],[data-dbscope],[data-dbyear],' +
    '[data-pick],[data-bo],[data-hero],#runSim,#dbMoreBtn,#matchMoreBtn,#searchTrigger,#searchClose,#refreshBtn,[data-si]');
  if (!el) return;
  var d = el.dataset || {};
  if (d.si != null && el.classList.contains('sr-row')) {
    pickSearch(parseInt(d.si, 10));
    return;
  }
  if (el.dataset.hero) {
    if (S.hero) { S.sim.a = S.hero.a; S.sim.b = S.hero.b; S.sim.bo = S.hero.bo; }
    go('predict');
    return;
  }
  if (d.view) { go(d.view); return; }
  if (d.go) { if (d.src) S.intelSrc = d.src; go(d.go, { tab: d.tab }); return; }
  if (d.region) {
    var k = d.region.charAt(0).toLowerCase() + d.region.slice(1);
    S.watch[k] = !S.watch[k];
    renderView();
    return;
  }
  if (d.team) { openTeam(d.team); return; }
  if (d.player) { openPlayer(d.player); return; }
  if (d.match) { openMatch(d.match); return; }
  if (d.up) { openMatch(d.up); return; }
  if (d.news) { openNews(d.news); return; }
  if (d.cnnews) { openCnNews(d.cnnews); return; }
  if (d.event) { openEvent(d.event); return; }
  if (d.mtab) { S.matchTab = d.mtab; S.matchPage = 1; matchesView(); return; }
  if (d.mfilter != null) { S.matchFilter = parseInt(d.mfilter, 10); S.matchPage = 1; matchesView(); return; }
  if (d.myear != null) { S.matchYear = d.myear; S.matchPage = 1; matchesView(); return; }
  if (el.id === 'matchMoreBtn') { S.matchPage++; matchesView(); return; }
  if (d.itag) { S.intelTag = d.itag; intelView(); return; }
  if (d.isrc) { S.intelSrc = d.isrc; S.intelTag = '全部'; intelView(); return; }
  if (d.mapsel) {
    if (window.ML) window.ML.exit();
    S.mapSlug = d.mapsel; maplabView(); return;
  }
  if (d.jump) {
    if (window.ML) window.ML.jump(parseFloat(d.x), parseFloat(d.y));
    return;
  }
  if (d.dbtab) { S.dbTab = d.dbtab; S.dbPage = 1; dbView(); return; }
  if (d.dbstatus != null) { S.dbStatus = d.dbstatus; S.dbPage = 1; dbView(); return; }
  if (d.dbregion != null) { S.dbRegion = d.dbregion; S.dbPage = 1; dbView(); return; }
  if (d.dbscope) { S.dbScope = d.dbscope; S.dbPage = 1; dbView(); return; }
  if (d.dbyear != null) { S.dbYear = d.dbyear; S.dbPage = 1; dbView(); return; }
  if (d.pick) {
    openSearch('team', function (name) {
      if (d.pick === 'a') S.sim.a = name; else S.sim.b = name;
      predictView();
    });
    return;
  }
  if (d.bo) { S.sim.bo = parseInt(d.bo, 10); predictView(); return; }
  if (el.id === 'runSim') {
    var box = $('.sim-result');
    if (box) { box.classList.remove('on'); void box.offsetWidth; box.classList.add('on'); }
    toast('推演完成 · 概率已更新');
    return;
  }
  if (el.id === 'dbMoreBtn') { S.dbPage++; refreshDbList(); return; }
  if (el.id === 'searchTrigger') { openSearch('global'); return; }
  if (el.id === 'searchClose') { closeSearch(); return; }
  if (el.id === 'refreshBtn') { refreshIntel(); return; }
});

document.addEventListener('input', function (e) {
  if (e.target.id === 'dbSearch') {
    S.dbQuery = e.target.value;
    S.dbPage = 1;
    refreshDbList();
  } else if (e.target.id === 'searchInput') {
    renderSearch(e.target.value);
  }
});

document.addEventListener('keydown', function (e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearch('global');
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#searchModal').hidden) closeSearch();
    else if ($('#drawer').classList.contains('on')) closeDrawer();
    return;
  }
  if (!$('#searchModal').hidden) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!searchItems.length) return;
      searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + searchItems.length) % searchItems.length;
      $$('#searchResults .sr-row').forEach(function (r, i) { r.classList.toggle('sel', i === searchSel); });
      var sel = $('#searchResults .sr-row.sel');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickSearch(searchSel);
    }
  }
});

window.addEventListener('hashchange', function () {
  var h = (location.hash || '').replace('#', '');
  if (VIEW_CN[h] && h !== S.view) {
    if (S.view === 'maplab' && window.ML) window.ML.exit();
    S.view = h;
    $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === h); });
    $('#crumb').textContent = VIEW_CN[h] + ' / ' + VIEW_EN[h];
    $('#view').scrollTop = 0;
    renderView();
  }
});
$('#scrim').addEventListener('click', closeDrawer);
$('#searchModal').addEventListener('click', function (e) {
  if (e.target === $('#searchModal')) closeSearch();
});
$$('#nav button').forEach(function (b) {
  b.addEventListener('click', function () { go(b.dataset.view); });
});

/* ---------------- 启动 ---------------- */
function boot() {
  fillTicker();
  tickClock();
  var h = (location.hash || '').replace('#', '');
  if (VIEW_CN[h]) S.view = h;
  try {
    var _q = new URLSearchParams(location.search);
    if (_q.get('dbtab')) S.dbTab = _q.get('dbtab');
    if (_q.get('mtab')) S.matchTab = _q.get('mtab');
    if (_q.get('myear')) S.matchYear = _q.get('myear');
  } catch (e) {}
  setInterval(tickClock, 1000);
  ensureYears(['2024', '2025', '2026']).then(function () {
    fillRail();
    $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === S.view); });
    $('#crumb').textContent = VIEW_CN[S.view] + ' / ' + VIEW_EN[S.view];
    renderView();
    try {
      var q = new URLSearchParams(location.search);
      if (q.get('open') === 'team') openTeam(q.get('name'));
      else if (q.get('open') === 'player') openPlayer(q.get('handle'));
      else if (q.get('open') === 'match') openMatch(q.get('id'));
      else if (q.get('open') === 'news') openNews(q.get('id'));
      else if (q.get('open') === 'event') openEvent(q.get('name'));
      else if (q.get('open') === 'search') openSearch('global');
    } catch (e) { window.__errs = window.__errs || []; window.__errs.push('boot:' + e + ' | ' + (e && e.stack)); }
    setTimeout(function () { ensureAllYears(); }, 700);
  }).catch(function (e) {
    window.__bootErr = String(e && (e.stack || e));
    $('#view').innerHTML = '<div class="empty">数据载入失败</div>';
  });
}
boot();

// 调试钩子（只读；不影响界面）
window.__VINTEL__ = {
  news: function () { return INTEL.news; },
  refresh: refreshIntel,
  search: openSearch,
  team: openTeam,
  player: openPlayer,
  match: openMatch
};

})();
