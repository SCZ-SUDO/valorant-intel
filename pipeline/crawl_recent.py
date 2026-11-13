#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增量抓取：2026-09-27 之后的赛果 + 当前待赛赛程。

- 赛果：vlr.gg /matches/results/?page=N，复用 9 月那版解析器，翻到 9/26 为止。
- 待赛：/matches 列表里的每场，再开单场页取 UTC 时间、Bo 制式、队标、veto。
输出：
  data/matches_recent.jsonl
  data/upcoming.json
"""
import gzip, html as _html, json, os, re, sys, time, urllib.request
from datetime import datetime, timezone

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
STOP_ISO = "2026-09-26"

_last = [0.0]
def fetch(url, rate=0.7):
    wait = rate - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Encoding": "gzip",
        "Accept-Language": "en-US,en;q=0.9"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                _last[0] = time.time()
                return raw.decode("utf-8", "replace")
        except Exception as e:
            if attempt == 3:
                raise
            print(f"    ! retry {attempt+1}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))

def clean(s):
    return _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()

RE_DATE = re.compile(r'class="wf-label mod-large"[^>]*>(.*?)</div>', re.S)
RE_ITEM = re.compile(r'<a href="/(\d+)/([a-z0-9\-]+)"\s+class="wf-module-item match-item[^"]*">(.*?)</a>', re.S)
RE_TEAM = re.compile(
    r'<div class="match-item-vs-team\s*(mod-winner)?">\s*'
    r'<div class="match-item-vs-team-name">(.*?)'
    r'<div class="match-item-vs-team-score[^"]*">\s*([^<\s]*)\s*</div>', re.S)

def parse_results(html):
    events = []
    for m in RE_DATE.finditer(html):
        events.append((m.start(), "date", clean(m.group(1))))
    for m in RE_ITEM.finditer(html):
        events.append((m.start(), "item", m))
    events.sort(key=lambda x: x[0])
    cur_date = ""
    out = []
    for _, kind, payload in events:
        if kind == "date":
            d = re.sub(r"\s*(Today|Yesterday|Tomorrow)\s*$", "", payload).strip()
            if re.search(r"\d{4}", d):
                cur_date = d
            continue
        m = payload
        mid, slug, body = m.group(1), m.group(2), m.group(3)
        teams = []
        for tm in RE_TEAM.finditer(body):
            winner, nameblk, score = tm.group(1), tm.group(2), tm.group(3)
            flag = re.search(r'class="flag mod-([a-z0-9]{2,3})"', nameblk)
            nm = clean(re.sub(r'<span class="flag[^"]*"></span>', "", nameblk))
            teams.append({"name": nm, "country": flag.group(1) if flag else "",
                          "score": score, "winner": bool(winner)})
        if len(teams) != 2:
            continue
        st = re.search(r'class="ml-status">([^<]*)</div>', body)
        du = re.search(r'class="ml-eta[^"]*">([^<]*)</div>', body)
        ev = re.search(r'class="match-item-event-series text-of">\s*([^<]*?)\s*</div>\s*([^<]*?)\s*</div>', body, re.S)
        tm = re.search(r'class="match-item-time">\s*([^<]*?)\s*</div>', body)
        iso = ""
        if cur_date:
            for fmt in ("%a, %B %d, %Y", "%B %d, %Y"):
                try:
                    iso = datetime.strptime(cur_date, fmt).strftime("%Y-%m-%d")
                    break
                except ValueError:
                    continue
        out.append({
            "id": mid, "slug": slug, "date": cur_date, "isoDate": iso,
            "time": clean(tm.group(1)) if tm else "",
            "status": clean(st.group(1)) if st else "",
            "duration": clean(du.group(1)) if du else "",
            "event": clean(ev.group(2)) if ev else "",
            "series": clean(ev.group(1)) if ev else "",
            "teams": teams,
        })
    return out

def crawl_results():
    allrows, seen = [], set()
    for page in range(1, 41):
        url = f"https://www.vlr.gg/matches/results/?page={page}"
        h = fetch(url)
        rows = parse_results(h)
        if not rows:
            print(f"  page {page}: empty, stop"); break
        new = [r for r in rows if r["id"] not in seen]
        for r in new: seen.add(r["id"])
        # 保留 9/27 起的（含 9/27 当天）
        keep = [r for r in new if r["isoDate"] >= STOP_ISO]
        allrows += keep
        oldest = min((r["isoDate"] for r in rows if r["isoDate"]), default="")
        print(f"  page {page}: {len(rows)} rows, keep {len(keep)}, oldest {oldest}")
        if oldest and oldest < STOP_ISO:
            break
    # 去重
    dedup = {}
    for r in allrows: dedup[r["id"]] = r
    rows = sorted(dedup.values(), key=lambda r: (r["isoDate"], r["id"]), reverse=True)
    with open(os.path.join(DATA, "matches_recent.jsonl"), "w") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"✓ {len(rows)} 场赛果 -> data/matches_recent.jsonl")
    return rows

def parse_match_page(mid, slug):
    url = f"https://www.vlr.gg/{mid}/{slug}"
    h = fetch(url)
    ts = re.search(r'data-utc-ts="([^"]+)"', h)
    ev = re.search(r'class="match-header-event">.*?<div style="font-weight: 700;">\s*([^<]+?)\s*</div>\s*<div class="match-header-event-series">\s*([^<]+?)\s*</div>', h, re.S)
    note = re.findall(r'<div class="match-header-vs-note">\s*([^<]+?)\s*</div>', h)
    bo = next((x for x in note if re.fullmatch(r"Bo\d", x.strip())), "")
    links = re.findall(r'class="match-header-link wf-link-hover mod-(\d)" href="/team/(\d+)/([^"]+)"', h)
    teams = []
    for side, tid, tslug in links:
        nm = re.search(r'class="match-header-link-name mod-%s">.*?<div class="wf-title-med[^"]*">\s*([^<]+?)\s*</div>' % side, h, re.S)
        logo = re.search(r'<img src="(//owcdn\.net/[^"]+)" alt="[^"]*team logo"', h[h.find('match-header-link mod-%s' % side):h.find('match-header-link mod-%s' % side)+2500] if 'match-header-link mod-%s' % side in h else "")
        if not nm: continue
        teams.append({"name": clean(nm.group(1)), "vlrId": tid, "slug": tslug,
                      "logo": ("https:" + logo.group(1)) if logo else ""})
    # 兜底：可能顺序与 mod 对应
    if len(teams) < 2:
        names = re.findall(r'<div class="wf-title-med[^"]*">\s*([^<]+?)\s*</div>', h)
        teams = [{"name": clean(n), "vlrId": "", "slug": "", "logo": ""} for n in names[:2]]
    status = "Upcoming"
    if re.search(r'match-header-vs-note">\s*final', h): status = "Completed"
    iso, hhmm = "", ""
    if ts:
        dt = datetime.strptime(ts.group(1), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        iso = dt.strftime("%Y-%m-%d")
        hhmm = dt.strftime("%H:%M")
    veto = re.search(r'<div class="match-header-note">\s*(.*?)\s*</div>', h, re.S)
    return {
        "id": mid, "slug": slug, "url": url, "isoDate": iso, "utc": ts.group(1) if ts else "",
        "timeUTC": hhmm, "status": status,
        "event": clean(ev.group(1)) if ev else "", "series": clean(ev.group(2)) if ev else "",
        "bo": bo, "teams": teams,
        "veto": clean(veto.group(1)) if veto else "",
    }

def crawl_upcoming():
    h = fetch("https://www.vlr.gg/matches")
    items = re.findall(r'<a href="/(\d+)/([a-z0-9\-]+)"\s+class="wf-module-item match-item', h)
    seen, out = set(), []
    for mid, slug in items:
        if mid in seen: continue
        seen.add(mid)
        try:
            m = parse_match_page(mid, slug)
            if m["status"] == "Upcoming":
                out.append(m)
                print(f"  ✓ {m['isoDate']} {m['timeUTC']}Z  {m['teams'][0]['name']} vs {m['teams'][1]['name']}")
        except Exception as e:
            print(f"  ! {mid}: {e}", file=sys.stderr)
    with open(os.path.join(DATA, "upcoming.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"✓ {len(out)} 场待赛 -> data/upcoming.json")
    return out

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "results"): crawl_results()
    if which in ("all", "upcoming"): crawl_upcoming()
