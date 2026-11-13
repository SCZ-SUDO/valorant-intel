#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓 vlr.gg 新闻列表（标题 / 摘要 / 日期 / 作者 / 国旗），输出 data/news.json。"""
import gzip, html as _html, json, os, re, sys, time, urllib.request
from datetime import datetime

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

_last = [0.0]
def fetch(url, rate=0.8):
    wait = rate - (time.time() - _last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Encoding": "gzip", "Accept-Language": "en-US,en;q=0.9"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip": raw = gzip.decompress(raw)
                _last[0] = time.time()
                return raw.decode("utf-8", "replace")
        except Exception as e:
            if attempt == 3: raise
            print(f"    ! retry {attempt+1}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))

def clean(s):
    return _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()

TAGS = [
    ("转会", ["sign", "signs", "signed", "depart", "parts ways", "part ways", "release",
              "free agent", "joins", "join", "roster", "bench", "acquire", "adds",
              "welcomes", "bids farewell", "retire", "coach", "trade"]),
    ("赛事", ["champions", "masters", "vct", "playoff", "grand final", "qualif", "stage",
              "league", "split", "ascension", "game changers", "cup", "invitational"]),
    ("版本", ["patch", "agent", "map pool", "meta", "update", "nerf", "buff", "skin"]),
]

def tag_of(text):
    t = text.lower()
    for tag, keys in TAGS:
        if any(k in t for k in keys): return tag
    return "动态"

def parse(html):
    out = []
    for m in re.finditer(r'<a class="wf-module-item[^"]*" href="/(\d+)/([a-z0-9\-]+)"(.*?)</a>', html, re.S):
        nid, slug, body = m.group(1), m.group(2), m.group(3)
        title = re.search(r'font-weight: 700; font-size: 15px; line-height: 1.3;">\s*(.*?)</div>', body, re.S)
        summ = re.search(r'font-size: 13px; padding: 5px 0; padding-bottom: 6px; line-height: 1.4;">\s*(.*?)</div>', body, re.S)
        meta = re.search(r'class="ge-text-light">(.*?)</div>', body, re.S)
        if not title: continue
        region = ""
        flag = re.search(r'class="flag mod-([a-z]{2,3})"', meta.group(1) if meta else "")
        if flag: region = flag.group(1)
        date = ""
        author = ""
        if meta:
            mm = re.search(r'([A-Z][a-z]+ \d{1,2}, \d{4})', clean(meta.group(1)))
            if mm:
                try: date = datetime.strptime(mm.group(1), "%B %d, %Y").strftime("%Y-%m-%d")
                except ValueError: date = ""
            au = re.search(r'by\s+(.+)$', clean(meta.group(1)))
            if au: author = au.group(1).strip()
        title_s = clean(title.group(1))
        summ_s = clean(summ.group(1)) if summ else ""
        out.append({
            "id": nid, "url": "https://www.vlr.gg/%s/%s" % (nid, slug),
            "title": title_s, "summary": summ_s, "date": date,
            "author": author, "region": region,
            "tag": tag_of(title_s + " " + summ_s),
        })
    return out

def main(pages=5):
    allrows, seen = [], set()
    for p in range(1, pages + 1):
        url = "https://www.vlr.gg/news" + (f"/?page={p}" if p > 1 else "")
        h = fetch(url)
        rows = parse(h)
        new = [r for r in rows if r["id"] not in seen]
        for r in new: seen.add(r["id"])
        allrows += new
        print(f"  page {p}: {len(rows)} rows ({len(new)} new)")
        if not rows: break
    allrows.sort(key=lambda r: (r["date"], int(r["id"])), reverse=True)
    with open(os.path.join(DATA, "news.json"), "w") as f:
        json.dump(allrows, f, ensure_ascii=False, indent=1)
    print(f"✓ {len(allrows)} 条新闻 -> data/news.json")

if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 5)
