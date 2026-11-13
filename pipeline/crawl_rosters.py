#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 vlr.gg 世界排名页取战队 ID，再逐队抓当前阵容。"""
import gzip, html as _html, json, os, re, sys, time, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

_last = [0.0]
def fetch(url, rate=0.3):
    wait = rate - (time.time() - _last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip": raw = gzip.decompress(raw)
                _last[0] = time.time()
                return raw.decode("utf-8", "replace")
        except Exception as e:
            if attempt == 2: raise
            time.sleep(2 * (attempt + 1))

def clean(s):
    return _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()

def norm(x):
    return re.sub(r"[^a-z0-9]", "", (x or "").lower())

def main():
    elo = json.load(open(os.path.join(DATA, "elo.json")))
    targets = {}
    for x in elo[:90]:
        targets[norm(x["team"])] = x["team"]
    for nm in ("EDward Gaming", "Bilibili Gaming", "FunPlus Phoenix", "Nova Esports",
               "Xi Lai Gaming", "Trace Esports", "JD Gaming", "Wolves Esports",
               "All Gamers", "TYLOO", "Titan Esports Club", "KeepBest Gaming",
               "Rare Atom", "Any Questions Gaming", "Dragon Ranger Gaming",
               "World Sports Invictus", "Unsettled Resentment", "A Team"):
        targets[norm(nm)] = nm
    h = fetch("https://www.vlr.gg/rankings/")
    teams = {}
    for m in re.finditer(r'<a href="/team/(\d+)/([^"]+)"[^>]*>\s*<img[^>]*alt="([^"]+)"', h):
        teams[m.group(1)] = {"id": m.group(1), "slug": m.group(2), "name": clean(m.group(3))}
    picked = {tid: t for tid, t in teams.items() if norm(t["name"]) in targets}
    out = {}
    try:
        seed = json.load(open(os.path.join(DATA, "rosters.json")))
        out.update(seed)
        picked = {tid: t for tid, t in picked.items() if t["name"] not in seed}
    except Exception:
        pass
    print(f"ranking teams: {len(teams)} / matched {len(picked)} (已有 {len(out)})", flush=True)
    for i, (tid, t) in enumerate(picked.items()):
        try:
            page = fetch(f"https://www.vlr.gg/team/{tid}/{t['slug']}")
            roster = []
            pm = re.search(r'<div class="wf-module-label"[^>]*>\s*players\s*</div>(.*?)(?=<div class="wf-module-label"|$)', page, re.S)
            block = pm.group(1) if pm else page
            for rm in re.finditer(r'<div class="team-roster-item">\s*<a href="/player/(\d+)/[^"]*"[^>]*>(.*?)</a>\s*</div>', block, re.S):
                blob = rm.group(2)
                alias = re.search(r'team-roster-item-name-alias">\s*(.*?)</div>', blob, re.S)
                real = re.search(r'team-roster-item-name-real">\s*(.*?)</div>', blob, re.S)
                fl = re.search(r'class="flag mod-([a-z]{2,3})"', blob)
                if alias:
                    roster.append({"handle": clean(re.sub(r'<[^>]+>', '', alias.group(1))),
                                   "real": clean(real.group(1)) if real else "",
                                   "flag": fl.group(1) if fl else "",
                                   "pid": rm.group(1)})
            out[t["name"]] = {"vlrId": tid, "slug": t["slug"], "roster": roster}
            print(f"  [{i+1}/{len(picked)}] {t['name']}: {len(roster)}", flush=True)
            if (i + 1) % 3 == 0:
                with open(os.path.join(DATA, "rosters.json"), "w") as f:
                    json.dump(out, f, ensure_ascii=False, indent=1)
        except Exception as e:
            print(f"  ! {t['name']}: {e}", file=sys.stderr)
    with open(os.path.join(DATA, "rosters.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"✓ {len(out)} 支战队阵容 -> data/rosters.json")

if __name__ == "__main__":
    main()
