#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐回合抓取（vlr.gg 单场页 · vlr-rounds 块）

每张图拿到：
  回合序号 / 比分 / 哪队赢 / 胜利方当时是攻(=t)还是守(=ct) / 赢法(elim|boom|defuse|time)
由这些可以拆出「进攻评分」「防守评分」「赢法结构」，是 ELO 完全看不到的信息。

用法:
  python3 pipeline/crawl_rounds.py --list queue.jsonl   # 按清单抓
  python3 pipeline/crawl_rounds.py --limit 50
输出 append 到 data/rounds.jsonl（重跑自动跳过已抓过的 id）
"""
import argparse, gzip, json, os, re, sys, time, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(DATA, 'rounds.jsonl')
RATE = 1.0

_last = [0.0]


def fetch(url, rate=RATE):
    wait = rate - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Encoding": "gzip", "Accept-Language": "en-US,en;q=0.9"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                _last[0] = time.time()
                return raw.decode("utf-8", "replace")
        except Exception as e:            # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


RE_MAPNAME = re.compile(r'<div class="map-name">\s*<span[^>]*>\s*([^<]+?)\s*</span>')
RE_TEAM = re.compile(r'<div class="team-name">\s*([^<]+?)\s*</div>')
RE_SCORE = re.compile(r'<div class="score[^"]*"[^>]*>\s*(\d+)\s*</div>')
RE_WAY = re.compile(r'/round/(\w+)\.webp')
RE_SQ = re.compile(r'<div class="rnd-sq([^"]*)">(.*?)</div>', re.S)


def _blocks(html, tag='vlr-rounds-row-col', minlen=6):
    """从 <div class="...tag..."> 起，按 div 嵌套深度切出各块。"""
    out = []
    pat = '<div class="' + tag
    pos = 0
    while True:
        i = html.find(pat, pos)
        if i < 0:
            break
        depth = 0
        j = i
        while j < len(html):
            if html.startswith('<div', j):
                depth += 1
                j += 4
            elif html.startswith('</div>', j):
                depth -= 1
                j += 6
                if depth == 0:
                    break
            else:
                j += 1
        block = html[i:j]
        if len(block) >= minlen:
            out.append(block)
        pos = j
    return out


def parse_games(html):
    """按数据块划分地图：优先用 ?game=<id> 导航项确定每图的 stats 块。"""
    games = []
    # 每张地图一个 stats 容器：找到所有 map-name 的位置，块 = 从该位置往前最近的 vm-stats-game 起
    starts = [m.start() for m in re.finditer(r'<div class="vm-stats-game[^"]*" data-game-id=', html)]
    if not starts:
        return games
    starts.append(len(html))
    for a, b in zip(starts, starts[1:]):
        ch = html[a:b]
        mn = RE_MAPNAME.search(ch)
        if not mn:
            continue
        teams = RE_TEAM.findall(ch)[:2]
        scores = [x[0] for x in RE_SCORE.findall(ch)][:2]
        rounds = []
        for blk in _blocks(ch, 'vlr-rounds-row-col'):
            num = re.search(r'class="rnd-num">\s*(\d+)', blk)
            if not num:
                continue
            sqs = list(RE_SQ.finditer(blk))
            wins = []
            for k, sm in enumerate(sqs):
                cls, inner = sm.group(1), sm.group(2)
                if 'mod-win' in cls:
                    turn = 'ct' if 'mod-ct' in cls else ('t' if 'mod-t' in cls else '?')
                    way = RE_WAY.search(inner)
                    who = 'a' if k == 0 else 'b'      # 第一行 = A 队，第二行 = B 队
                    wins.append((who, turn, way.group(1) if way else ''))
            if len(wins) == 1:
                rounds.append([int(num.group(1)), wins[0][0], wins[0][1], wins[0][2]])
        if rounds:
            games.append([mn.group(1), teams, scores, rounds])
    return games


def load_done():
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            line = line.strip()
            if line:
                try:
                    done.add(json.loads(line)['id'])
                except Exception:
                    pass
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', default=os.path.join(DATA, 'detail_queue.jsonl'))
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--rate', type=float, default=RATE)
    args, _ = ap.parse_known_args()
    globals()['RATE'] = args.rate

    todo = []
    with open(args.list) as f:
        for line in f:
            line = line.strip()
            if line:
                todo.append(json.loads(line))
    done = load_done()
    queue = [r for r in todo if r['id'] not in done]
    if args.limit:
        queue = queue[:args.limit]
    print(f'清单 {len(todo)} | 已完成 {len(done)} | 本次 {len(queue)}', flush=True)
    ok = fail = 0
    t0 = time.time()
    with open(OUT, 'a') as out:
        for i, row in enumerate(queue, 1):
            rec = {'id': row['id'], 'ok': False}
            try:
                h = fetch(f"https://www.vlr.gg/{row['id']}/")
                games = parse_games(h)
                rec['ok'] = True
                rec['games'] = games
                ok += 1
            except Exception as e:        # noqa: BLE001
                rec['err'] = f'{type(e).__name__}: {e}'
                fail += 1
            out.write(json.dumps(rec, ensure_ascii=False) + '\n')
            if i % 20 == 0 or i == len(queue):
                out.flush()
                el = time.time() - t0
                print(f'  {i}/{len(queue)} ok={ok} fail={fail} {el/60:.1f}min 预计 '
                      f'{el/i*(len(queue)-i)/60:.1f}min', flush=True)
    print(f'完成：成功 {ok} 失败 {fail}')


if __name__ == '__main__':
    main()
