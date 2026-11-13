#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vlr.gg 单场详情页抓取器 —— 只抓「中国赛区」那一批（见 tools/filter_cn.py）。

每场拿到的东西：
  · 逐张地图：地图名、时长、双方比分、双方进攻/防守方回合数、是否被 PICK
  · 逐名选手（每张地图 + 全场合计）：
      Rating 2.0 / ACS / K / D / A / K-D / KAST / ADR / HS% / FK / FD / FK-FD
      每项都带「全场 / 进攻方 / 防守方」三套数值
  · 选手所用特工

输入：data/cn_matches.jsonl（tools/filter_cn.py 生成）
产出：data/matchdetail.jsonl（追加写；重跑会自动跳过已抓过的 id）

用法：
  python3 tools/crawl_vlr_matchdetail.py               # 抓全部未抓的
  python3 tools/crawl_vlr_matchdetail.py --limit 5     # 只抓 5 场（试跑）
  python3 tools/crawl_vlr_matchdetail.py --retry-failed
"""
import argparse
import gzip
import html as _html
import json
import os
import re
import sys
import time
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
RATE = 0.7                      # 两次请求之间的最小间隔（秒）

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
LIST = os.path.join(DATA, "detail_queue.jsonl")
OUT = os.path.join(DATA, "matchdetail_new.jsonl")

METRICS = ["rating2", "acs", "kills", "deaths", "assists", "kd-diff",
           "kast", "adr", "hsp", "fb", "fd", "fk-diff"]

_last = [0.0]


# ----------------------------------------------------------------- 网络
def fetch(url):
    wait = RATE - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Encoding": "gzip",
        "Accept-Language": "en-US,en;q=0.9",
    })
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                _last[0] = time.time()
                return raw.decode("utf-8", "replace")
        except Exception as e:                      # noqa: BLE001
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise last_err


# ----------------------------------------------------------------- 解析
def strip(s):
    return _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()


def num(s):
    """'1.65' -> 1.65 ; '67%' -> 67.0 ; '-1' -> -1 ; '' / '–' -> None"""
    s = (s or "").strip().replace("%", "").replace("+", "")
    if s in ("", "-", "–", "—", "N/A"):
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() and "." not in s else f
    except ValueError:
        return None


RE_SIDE = re.compile(r'<span class="side mod-(both|t|ct)[^"]*">\s*([^<]*?)\s*</span>')
RE_HSIDE = re.compile(r'<span class="mod-(t|ct)">\s*([^<]*?)\s*</span>')
RE_GAME = re.compile(r'<div class="vm-stats-game[^"]*" data-game-id="([^"]+)">')
RE_NAV = re.compile(
    r'class="vm-stats-gamesnav-item[^"]*"[^>]*data-game-id="([^"]+)"[^>]*>(.*?)</a>', re.S)
RE_ROW = re.compile(r'<div class="ovw-row">')
RE_TEAM = re.compile(r'<div class="team(?: mod-right)?">(.*?)(?=<div class="team(?: mod-right)?">|$)',
                     re.S)


def parse_nav(h):
    """地图导航条 -> [(gid, 'Lotus'), ...]，顺序即比赛内的地图顺序"""
    out = []
    for m in RE_NAV.finditer(h):
        gid, body = m.group(1), m.group(2)
        if gid == "all":
            continue
        name = re.sub(r"^\d+\s*", "", strip(body)).strip()
        out.append((gid, name))
    return out


def parse_header(seg):
    """地图头 -> (map名, 时长, pickMod, [team1, team2])"""
    hd = seg[:seg.find('<div class="vlr-rounds"')] if '<div class="vlr-rounds"' in seg else seg[:8000]
    teams = []
    for tm in RE_TEAM.finditer(hd):
        body = tm.group(1)
        nm = re.search(r'class="team-name">\s*(.*?)\s*</div>', body, re.S)
        sc = re.search(r'class="score([^"]*)"[^>]*>\s*([^<]*?)\s*<', body)
        if not nm or not sc:
            continue
        sides = {k: num(v) for k, v in RE_HSIDE.findall(body)}
        teams.append({
            "name": strip(nm.group(1)),
            "score": num(sc.group(2)),
            "win": "mod-win" in sc.group(1),
            "t": sides.get("t"),
            "ct": sides.get("ct"),
        })
    # 地图名：map 区块里的粗体文本，去掉 PICK 与时长
    mp = re.search(r'<div class="map">(.*?)<div class="map-duration', hd, re.S)
    mapname = ""
    if mp:
        blk = re.sub(r'<span class="picked.*?</span>', "", mp.group(1), flags=re.S)
        mapname = strip(blk)
    dur = re.search(r'class="map-duration[^"]*"[^>]*>(.*?)</div>', hd, re.S)
    pick = re.search(r'class="picked mod-(\d+)', hd)
    return mapname, strip(dur.group(1)) if dur else "", (int(pick.group(1)) if pick else None), teams


def parse_row(row):
    """一行 = 一名选手"""
    nm = re.search(r'class="ovw-player-name[^"]*">(.*?)</div>', row, re.S)
    tag = re.search(r'class="ovw-player-tag[^"]*">(.*?)</div>', row, re.S)
    ctry = re.search(r'class="flag mod-([a-z0-9]{2,3})"', row)
    agents = re.findall(r'<img[^>]*agents/([a-z0-9\-_]+)\.png', row)
    if not nm:
        return None

    met = {}
    for piece in row.split('<div class="ovw-cell')[1:]:
        attrs, _, rest = piece.partition(">")
        cell = rest.split("</div>", 1)[0]
        if "mod-kda" in attrs:
            groups = cell.split('<span class="num-space">/</span>')
            keys = ["kills", "deaths", "assists"]
            for i, g in enumerate(groups[:3]):
                sides = {k: num(v) for k, v in RE_SIDE.findall(g)}
                met[keys[i]] = [sides.get("both"), sides.get("t"), sides.get("ct")]
        else:
            col = re.search(r'data-col="([^"]+)"', attrs)
            if not col:
                continue
            sides = {k: num(v) for k, v in RE_SIDE.findall(cell)}
            met[col.group(1)] = [sides.get("both"), sides.get("t"), sides.get("ct")]

    return {
        "n": strip(nm.group(1)),
        "t": strip(tag.group(1)) if tag else "",
        "c": ctry.group(1) if ctry else "",
        "ag": agents,
        "m": {k: met.get(k) for k in METRICS if k in met},
    }


def all_null(rows):
    """整块选手数据全是空值。"""
    for p in rows:
        for vals in (p.get("m") or {}).values():
            if any(v is not None for v in vals):
                return False
    return True


def is_phantom(mapname, teams, rows):
    """未开打的「幻影地图」判定。

    只有 名字是 TBD/空 **且** 双方比分都是 0/空 **且** 选手数据全空 才算幻影。
    注意不能只看"数据全空"就丢：
      实测有 15 张真打过、有比分、但 vlr.gg 没录选手数据的地图（如 148964 的 Pearl 13-7），
      那些必须留下 —— 比分本身是有价值的信息。
    """
    name = (mapname or "").strip()
    if name.upper() not in ("TBD", ""):
        return False
    has_score = any((t or {}).get("score") for t in (teams or []))
    return not has_score and all_null(rows)


def has_stats(rows):
    for p in rows or []:
        for vals in (p.get("m") or {}).values():
            if any(v is not None for v in vals):
                return True
    return False


def parse_match(h):
    """整页 -> {maps:[...], all:{...}}"""
    blocks = [(m.group(1), m.start()) for m in RE_GAME.finditer(h)]
    nav = parse_nav(h)                       # [(gid, 地图名)]
    navorder = [g for g, _ in nav]
    navname = dict(nav)
    maps, allblk = [], None
    for i, (gid, pos) in enumerate(blocks):
        end = blocks[i + 1][1] if i + 1 < len(blocks) else len(h)
        seg = h[pos:end]
        rows = []
        for r in RE_ROW.split(seg)[1:]:
            p = parse_row(r)
            if p:
                rows.append(p)
        if not rows:
            continue
        if gid == "all":
            allblk = {"gid": gid, "players": rows}
            continue
        mapname, dur, pick, teams = parse_header(seg)
        if not mapname:
            mapname = navname.get(gid, "")
        # 丢掉未开打的幻影地图（TBD + 0:0 + 无数据）
        if is_phantom(mapname, teams, rows):
            continue
        n = navorder.index(gid) + 1 if gid in navorder else len(maps) + 1
        maps.append({"gid": gid, "n": n, "map": mapname, "dur": dur,
                     "pick": pick, "teams": teams, "players": rows})
    maps.sort(key=lambda x: x["n"])
    for i, mp in enumerate(maps, 1):
        mp["n"] = i
    # 整场都没有选手数据？标出来，让下游别拿它去生成赛评
    any_stats = has_stats((allblk or {}).get("players"))
    if not any_stats:
        any_stats = any(has_stats(mp["players"]) for mp in maps)
    return {"maps": maps, "all": allblk, "noStats": not any_stats}


# ----------------------------------------------------------------- 主流程
def load_done(path):
    done = set()
    if not os.path.exists(path):
        return done
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                d = json.loads(line)
                if d.get("ok"):
                    done.add(d["id"])
            except Exception:                       # noqa: BLE001
                pass
    return done


def main():
    global RATE
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--rate", type=float, default=RATE)
    ap.add_argument("--retry-failed", action="store_true")
    args = ap.parse_args()
    RATE = args.rate

    todo = []
    with open(LIST, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                todo.append(json.loads(line))

    done = load_done(OUT)
    if args.retry_failed and os.path.exists(OUT):
        os.replace(OUT, OUT + ".bak")
        done = set()
        print("已把旧文件备份为 matchdetail.jsonl.bak，重抓全部。")

    queue = [r for r in todo if r["id"] not in done
             and r.get("played") and r.get("hasPlayerStats")]
    if args.limit:
        queue = queue[:args.limit]

    print(f"清单 {len(todo)} 场 | 已完成 {len(done)} | 本次待抓 {len(queue)}", flush=True)
    if not queue:
        print("没有待抓的场次。")
        return

    t0 = time.time()
    ok = fail = nostat = 0
    with open(OUT, "a", encoding="utf-8") as out:
        for i, row in enumerate(queue, 1):
            mid = row["id"]
            rec = {"id": mid, "date": row["date"], "event": row["event"],
                   "series": row["series"], "cnTeam": row["cnTeam"],
                   "cnEvent": row["cnEvent"], "ok": False}
            try:
                h = fetch(f"https://www.vlr.gg/{mid}/")
                p = parse_match(h)
                if not p["maps"] and not p["all"]:
                    rec["ok"] = True
                    rec["noStats"] = True
                    nostat += 1
                else:
                    rec.update(p)
                    rec["ok"] = True
                    ok += 1
            except Exception as e:                  # noqa: BLE001
                rec["err"] = f"{type(e).__name__}: {e}"
                fail += 1

            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            if i % 20 == 0 or i == len(queue):
                out.flush()
                el = time.time() - t0
                eta = el / i * (len(queue) - i)
                print(f"  {i}/{len(queue)}  成功{ok} 无数据{nostat} 失败{fail}  "
                      f"{el/60:.1f}min  预计还需 {eta/60:.1f}min", flush=True)

    el = time.time() - t0
    print(f"\n完成：抓 {len(queue)} 场，成功 {ok}（其中无选手数据 {nostat}），失败 {fail}，"
          f"耗时 {el/60:.1f} 分钟")
    print(f"-> {OUT}  {os.path.getsize(OUT)/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
