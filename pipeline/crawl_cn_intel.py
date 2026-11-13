#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CN 本土资讯：
  1. vlr.gg 论坛 CN 转会/赛事汇总帖（VCTCN News 系列）—— 逐楼抓取，按「首楼之外的短讯」生成条目
  2. vlr.gg 新闻里提到 CN 战队/赛区的，自动打 CN 标签
输出：data/cn_intel.json
"""
import gzip, html as _html, json, os, re, sys, time, urllib.request
from datetime import datetime

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

# VCTCN News 系列帖（历年）
THREADS = [
    ("777405", "VCTCN News [2026 Offseason]"),
    ("638685", "VCTCN News [2026 Season]"),
    ("572859", "VCT CN Transfer News [2025 Offseason & 2026 Season]"),
    ("568671", "VCT CN News [2025 Offseason]"),
]

CN_ORG = ["EDG", "BLG", "FPX", "TYL", "TYLOO", "XLG", "TEC", "NOVA", "TE ", "JDG", "AG ", "DRG",
          "WOL", "WBG", "AQ", "KBG", "RA ", "UR ", "WSIG", "AT ", "KG", "LGD", "VCT CN", "VCTCN",
          "China", "CN "]

_last = [0.0]
def fetch(url, rate=1.0):
    wait = rate - (time.time() - _last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Encoding": "gzip", "Accept-Language": "en-US,en;q=0.9"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip": raw = gzip.decompress(raw)
                _last[0] = time.time()
                return raw.decode("utf-8", "replace")
        except Exception as e:
            if attempt == 2: raise
            time.sleep(2 * (attempt + 1))

def clean(s):
    return _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()

def tag_of(t):
    tl = t.lower()
    if re.search(r"sign|join|releas|depart|transfer|roster|bench|coach|leav|leave|left|lft|academ|contract|租借|加入|离队|签约|解约", tl):
        return "转会"
    if re.search(r"vct|champions|masters|ascension|threshold|kickoff|cup|final|playoff|week|赛|杯|决赛|晋级|排名", tl):
        return "赛事"
    if re.search(r"patch|agent|map|buff|nerf|update|版本|特工|地图", tl):
        return "版本"
    return "动态"

def thread_posts(tid):
    h = fetch(f"https://www.vlr.gg/thread/{tid}")
    title = re.search(r"<title>(.*?)</title>", h, re.S)
    title = clean(re.sub(r"\|\s*VLR\.gg", "", title.group(1))) if title else tid
    bodies = re.findall(r'<div class="post-body">(.*?)</div>\s*<div class="post-footer">', h, re.S)
    authors = re.findall(r'<a class="post-header-author[^"]*"[^>]*>(.*?)</a>', h, re.S)
    out = []
    for i, b in enumerate(bodies):
        txt = clean(b)
        if not txt or len(txt) < 8: continue
        # 跳过引言（"first" / "big if true" 这类只有几个词的回复）
        if len(txt.split()) < 4 and not re.search(r"VCT|China|EDG|BLG", txt):
            continue
        out.append({"i": i, "text": txt, "author": clean(authors[i]) if i < len(authors) else ""})
    return title, out

def main():
    items = []
    today = datetime.now().strftime("%Y-%m-%d")
    for tid, label in THREADS:
        try:
            title, posts = thread_posts(tid)
        except Exception as e:
            print(f"  ! {tid}: {e}", file=sys.stderr)
            continue
        print(f"  {label}: {len(posts)} 楼", flush=True)
        # 取信息量大的楼：长度 >= 40 字，含 CN 相关实体或数字
        picked = [p for p in posts if len(p["text"]) >= 40 and
                  (any(k.lower() in p["text"].lower() for k in CN_ORG) or re.search(r"\d{2}%|\d+-|Oct|Nov|Dec", p["text"]))]
        for p in picked:
            t = p["text"]
            head = t[:160]
            items.append({
                "id": f"{tid}-{p['i']}",
                "url": f"https://www.vlr.gg/thread/{tid}",
                "title": head[:110] + ("…" if len(t) > 110 else ""),
                "summary": t[:420] + ("…" if len(t) > 420 else ""),
                "full": t,
                "date": today,
                "author": p["author"] or title,
                "region": "CN",
                "tag": tag_of(t),
                "src": f"VLR 论坛 · {label}",
                "thread": tid,
                "titleCn": "", "summaryCn": "", "lang": "en",
            })
    # vlr 新闻里带 CN 的
    try:
        news = json.load(open(os.path.join(DATA, "news.json")))
        for n in news:
            blob = (n.get("title", "") + " " + n.get("summary", "")).lower()
            if any(k.lower() in blob for k in ["vct cn", "vctcn", "china", "edg", "blg", "fpx", "tyloo",
                                               "xlg", "nova esports", "dragon ranger", "all gamers",
                                               "trace esports", "keepbest", "xi lai", "jd gaming"]):
                items.append({
                    "id": "vlr-" + str(n["id"]), "url": n["url"], "title": n.get("titleCn") or n.get("title", ""),
                    "titleEn": n.get("title", ""), "summary": n.get("summaryCn") or n.get("summary", ""),
                    "summaryEn": n.get("summary", ""), "date": n.get("date", ""), "author": n.get("author", ""),
                    "region": "CN", "tag": n.get("tag", "动态"), "src": "VLR.gg 新闻",
                    "thread": "", "lang": "zh" if n.get("titleCn") else "en",
                })
    except Exception as e:
        print(f"  ! news merge: {e}", file=sys.stderr)
    seen, out = set(), []
    for it in items:
        if it["id"] in seen: continue
        seen.add(it["id"]); out.append(it)
    out.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
    with open(os.path.join(DATA, "cn_intel.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"✓ {len(out)} 条 CN 资讯 -> data/cn_intel.json")

if __name__ == "__main__":
    main()
