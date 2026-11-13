#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把抓来的原始数据压成前端直接可用的紧凑 JS。

产出（web/assets/data/）：
  meta.js       统计、模型系数、地图/特工译名、详情索引
  core.js       选手 / 战队
  roster.js     战队阵容（来自中国赛区逐场数据 + 选手档案）
  matches-YYYY.js  按年切分的比赛
  records.js    选手生涯记录（懒加载）
  details.js    CN 赛事逐场地图/选手数据（懒加载）
  intel.js      待赛赛程 + 新闻
"""
import json, os, re, collections
from datetime import datetime, date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "web", "assets", "data")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- 译名 / 标签

TEAM_TAGS = {
    "EDward Gaming": "EDG", "FunPlus Phoenix": "FPX", "Bilibili Gaming": "BLG",
    "Nova Esports": "NOVA", "Xi Lai Gaming": "XLG", "Trace Esports": "TE",
    "JD Gaming": "JDG", "Wolves Esports": "WOL", "All Gamers": "AG",
    "TYLOO": "TYL", "Titan Esports Club": "TEC", "KeepBest Gaming": "KBG",
    "Rare Atom": "RA", "Any Questions Gaming": "AQ", "World Sports Invictus": "WSIG",
    "Unsettled Resentment": "UR", "Dragon Ranger Gaming": "DRG",
    "Paper Rex": "PRX", "Sentinels": "SEN", "Gen.G": "GEN", "T1": "T1",
    "Team Liquid": "TL", "FNATIC": "FNC", "G2 Esports": "G2", "NRG": "NRG",
    "Cloud9": "C9", "100 Thieves": "100T", "Team Heretics": "TH",
    "Team Vitality": "VIT", "FUT Esports": "FUT", "KRÜ Esports": "KRU",
    "LOUD": "LOUD", "MIBR": "MIBR", "FURIA": "FUR", "Evil Geniuses": "EG",
    "Global Esports": "GE", "BBL Esports": "BBL", "GIANTX": "GX",
    "Natus Vincere": "NAVI", "Movistar Riders": "MR", "Karmine Corp": "KC",
    "Aurora Gaming": "AUR", "Talon Esports": "TLN", "BOOM Esports": "BOOM",
    "DetonatioN FocusMe": "DFM", "ZETA DIVISION": "ZETA", "REJECT": "RC",
    "GE": "GE", "Nongshim RedForce": "NS", "DRX": "DRX", "KIWOOM DRX": "DRX",
    "LEVIATÁN": "LEV", "Leviatán": "LEV", "Gambit Esports": "GMB", "OpTic Gaming": "OG",
    "The Guard": "TG", "Vision Strikers": "VS", "Team Secret": "TS",
    "Xi Lai Gaming": "XLG", "Titan Esports Club": "TEC", "KeepBest Gaming": "KBG",
    "Enterprise Esports": "ENT", "BBL PACIFIC": "BBLP", "Gentle Mates GC": "GMGC",
    "Weibo Gaming": "WBG", "JD Gaming": "JDG", "Wolves Esports": "WOL", "All Gamers": "AG",
    "Trace Esports": "TE", "Nova Esports": "NOVA", "TYLOO": "TYL", "Xi Lai Gaming": "XLG",
    "Bilibili Gaming": "BLG", "EDward Gaming": "EDG", "FunPlus Phoenix": "FPX",
    "Dragon Ranger Gaming": "DRG", "KeepBest Gaming": "KBG", "Rare Atom": "RA",
    "Any Questions Gaming": "AQ", "Titan Esports Club": "TEC", "Team A": "TA",
    "KRÜ BLAZE": "KRB", "Shopify Rebellion Gold": "SRG", "Eintracht Frankfurt Team Vision": "EFTV",
}

TEAM_ZH = {
    "EDward Gaming": "EDG", "FunPlus Phoenix": "FPX", "Bilibili Gaming": "BLG",
    "Nova Esports": "NOVA", "Xi Lai Gaming": "XLG", "Trace Esports": "TE",
    "JD Gaming": "JDG", "Wolves Esports": "WOL", "All Gamers": "AG",
    "TYLOO": "TYL", "Titan Esports Club": "TEC", "KeepBest Gaming": "KBG",
    "Rare Atom": "RA", "Any Questions Gaming": "AQ", "Dragon Ranger Gaming": "DRG",
    "Unsettled Resentment": "UR", "World Sports Invictus": "WSIG",
}

MAP_ZH = {
    "Bind": "源工重镇", "Haven": "隐世修所", "Split": "裂变峡谷", "Ascent": "亚海悬城",
    "Icebox": "森寒冬港", "Breeze": "微风岛屿", "Fracture": "霓虹町", "Pearl": "深海明珠",
    "Lotus": "莲华古城", "Sunset": "日落之城", "Abyss": "幽邃地窟",
}

AGENT_ZH = {
    "jett": "捷风", "phoenix": "不死鸟", "raze": "雷兹", "reyna": "蕾娜",
    "yoru": "夜露", "neon": "霓虹", "iso": "壹决", "sage": "贤者",
    "sova": "苏法", "breach": "铁臂", "skye": "斯凯", "kayo": "KAY/O",
    "fade": "黑梦", "gekko": "盖可", "chamber": "尚勃勒", "cypher": "零",
    "killjoy": "奇乐", "omen": "欧门", "brimstone": "布史东", "astra": "星礈",
    "viper": "薇蝮", "harbor": "海神", "deadlock": "铁锁", "clove": "幻棱",
    "vyse": "薇丝", "tejo": "泰乔", "waylay": "维蕾", "veto": "维托",
}

COUNTRY_ISO = {
    "United States": "us", "Brazil": "br", "Turkey": "tr", "South Korea": "kr",
    "Germany": "de", "China": "cn", "Japan": "jp", "Spain": "es", "France": "fr",
    "United Kingdom": "gb", "Australia": "au", "India": "in", "Saudi Arabia": "sa",
    "Mexico": "mx", "Thailand": "th", "Argentina": "ar", "Philippines": "ph",
    "Singapore": "sg", "Indonesia": "id", "Italy": "it", "Norway": "no",
    "Poland": "pl", "Portugal": "pt", "Vietnam": "vn", "Canada": "ca",
    "Sweden": "se", "Belgium": "be", "Russia": "ru", "United Arab Emirates": "ae",
    "Chile": "cl", "Czech Republic": "cz", "Hungary": "hu", "Austria": "at",
    "Taiwan": "tw", "Ukraine": "ua", "Egypt": "eg", "Switzerland": "ch",
    "Colombia": "co", "Tunisia": "tn", "Hong Kong": "hk", "Netherlands": "nl",
    "Denmark": "dk", "Costa Rica": "cr", "Finland": "fi", "Malaysia": "my",
    "Mongolia": "mn", "Morocco": "ma", "Greece": "gr", "Peru": "pe",
    "Kuwait": "kw", "Slovenia": "si", "Bangladesh": "bd", "Paraguay": "py",
    "Israel": "il", "New Zealand": "nz", "South Africa": "za", "Pakistan": "pk",
    "Jordan": "jo", "Qatar": "qa", "Oman": "om", "Bahrain": "bh", "Iraq": "iq",
    "Lebanon": "lb", "Serbia": "rs", "Croatia": "hr", "Romania": "ro",
    "Bulgaria": "bg", "Lithuania": "lt", "Latvia": "lv", "Estonia": "ee",
    "Kazakhstan": "kz", "Uzbekistan": "uz", "Belarus": "by", "Georgia": "ge",
    "Armenia": "am", "Azerbaijan": "az", "Bolivia": "bo", "Ecuador": "ec",
    "Uruguay": "uy", "Venezuela": "ve", "Guatemala": "gt", "Dominican Republic": "do",
    "Puerto Rico": "pr", "Nigeria": "ng", "Kenya": "ke", "Algeria": "dz",
}

REGION_OVERRIDE = {"LEVIATÁN": "Americas", "Leviatán": "Americas",
                   "G2 Esports": "Americas", "Team Liquid": "Americas",
                   "100 Thieves": "Americas", "Cloud9": "Americas", "Sentinels": "Americas",
                   "NRG": "Americas", "ENVY": "Americas", "MIBR": "Americas", "LOUD": "Americas",
                   "KRÜ Esports": "Americas", "FURIA": "Americas", "Evil Geniuses": "Americas",
                   "Gamers Club Esports": "Americas", "9z Globant": "Americas"}

# 唯一分类口径：CN / EMEA / Americas / Pacific（其余归入 Pacific，与 VCT 国际赛区命名一致）
REGION_BUCKET = {
    "cn": "CN", "china": "CN", "chinese": "CN",
    "eu": "EMEA", "europe": "EMEA", "emea": "EMEA", "cis": "EMEA", "me": "EMEA",
    "middle east": "EMEA", "mena": "EMEA", "turkey": "EMEA",
    "na": "Americas", "br": "Americas", "las": "Americas", "lan": "Americas",
    "latin america south": "Americas", "brazil": "Americas", "north america": "Americas",
    "oce": "Pacific", "oceania": "Pacific",
    "kr": "Pacific", "jp": "Pacific", "sea": "Pacific", "ap": "Pacific", "apac": "Pacific",
    "asia": "Pacific", "asia-pacific": "Pacific", "east asia": "Pacific",
    "southeast asia": "Pacific", "south asia": "Pacific", "japan": "Pacific",
    "south korea": "Pacific", "thailand": "Pacific", "india": "Pacific",
}
REGION_ORDER = ["CN", "EMEA", "Americas", "Pacific"]

# VCT CN 生态里的中国战队（比赛里常以全名出现，Liquipedia 赛区字段可能为空或写 China）
KNOWN_CN = {
    "EDward Gaming", "FunPlus Phoenix", "Bilibili Gaming", "Nova Esports", "Xi Lai Gaming",
    "Trace Esports", "JD Gaming", "Wolves Esports", "All Gamers", "TYLOO",
    "Titan Esports Club", "KeepBest Gaming", "Rare Atom", "Any Questions Gaming",
    "Dragon Ranger Gaming", "World Sports Invictus", "Unsettled Resentment", "Weibo Gaming",
    "Attacking Soul Esports", "Shenzhen NTER", "Number One Player", "KONE eSports Club",
    "Tales of Eastern", "Monarch Effect", "A Team", "Night Wings Gaming", "ShanXi Gaming Girls",
    "Bilibili Gaming Academy", "EDward Gaming Academy", "Clutch Gaming", "Lizhi Esports",
    "Qing Jiu Club", "Crazy Pigeons", "Kanga Esports",
}

TIER_NAME = {0: "其他", 1: "挑战者", 2: "VCT", 3: "国际大赛"}

def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def tag_of(name):
    if name in TEAM_TAGS:
        return TEAM_TAGS[name]
    words = re.findall(r"[A-Za-z0-9]+", name)
    if not words:
        return name[:4].upper()
    if len(words) == 1:
        return words[0][:4].upper()
    return "".join(w[0] for w in words)[:4].upper()

def parse_date(r):
    iso = r.get("isoDate") or ""
    if iso:
        return iso
    d = re.sub(r"\s*(Today|Yesterday|Tomorrow)\s*$", "", r.get("date", "")).strip()
    for fmt in ("%a, %B %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(d, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""

def tier_of(ev):
    e = (ev or "").lower()
    if "game changers" in e: return 1
    if "challengers" in e or "ascension" in e or "qualifier" in e or "open" in e: return 1
    if ("champions" in e and "tour" not in e) or "masters" in e or "world cup" in e: return 3
    if "vct" in e or "valorant champions tour" in e or "first strike" in e: return 2
    return 0

# ---------------------------------------------------------------- 读数据

def load_matches():
    rows = []
    for fn in ("matches.jsonl", "matches_recent.jsonl"):
        p = os.path.join(DATA, fn)
        if not os.path.exists(p): continue
        for line in open(p):
            line = line.strip()
            if not line: continue
            r = json.loads(line)
            if r.get("status") and r["status"] != "Completed": continue
            ts = r["teams"]
            if len(ts) != 2: continue
            try:
                a, b = int(ts[0]["score"]), int(ts[1]["score"])
            except (TypeError, ValueError):
                continue
            if a == b: continue
            iso = parse_date(r)
            if not iso: continue
            rows.append({
                "id": r["id"], "date": iso, "event": r.get("event", ""),
                "series": r.get("series", ""), "a": ts[0]["name"], "b": ts[1]["name"],
                "sa": a, "sb": b, "winner": 0 if a > b else 1,
                "tier": tier_of(r.get("event", "")),
                "flagA": ts[0].get("country", ""), "flagB": ts[1].get("country", ""),
            })
    ded = {}
    for r in rows: ded[r["id"]] = r
    return sorted(ded.values(), key=lambda r: (r["date"], r["id"]))

def main():
    matches = load_matches()
    print(f"matches {len(matches)}")

    # 归一化队名
    exact = set()
    for line in open(os.path.join(DATA, "teams.jsonl")):
        exact.add(json.loads(line)["name"])
    groups = collections.defaultdict(collections.Counter)
    for m in matches:
        groups[norm(m["a"])][m["a"]] += 1
        groups[norm(m["b"])][m["b"]] += 1
    canon = {}
    for k, c in groups.items():
        names = [n for n, _ in c.most_common()]
        canon[k] = next((n for n in names if n in exact), names[0])
    for m in matches:
        m["a"], m["b"] = canon[norm(m["a"])], canon[norm(m["b"])]

    # 战队基础信息
    team_meta = {}
    team_meta_n = {}
    for line in open(os.path.join(DATA, "teams.jsonl")):
        t = json.loads(line)
        team_meta[t["name"]] = t
        team_meta_n[norm(t["name"])] = t
    for m in matches:
        for side in ("a", "b"):
            nm = m[side]
            d = team_meta.setdefault(nm, {"name": nm, "countryCn": "", "region": "",
                                          "created": "", "disbanded": ""})
            if not d.get("countryCn"):
                d["countryCn"] = ""
    # 国旗码：出现最多的
    flags = collections.defaultdict(collections.Counter)
    for m in matches:
        flags[m["a"]][m["flagA"]] += 1
        flags[m["b"]][m["flagB"]] += 1

    # Elo
    elo = {x["team"]: x for x in json.load(open(os.path.join(DATA, "elo.json")))}
    model = json.load(open(os.path.join(DATA, "model.json")))

    # 战队聚合 + 当前状态（form 由模型导出？这里用最近 10 场胜率替代展示，预测由前端按公式算）
    agg = collections.defaultdict(lambda: {"n": 0, "w": 0, "l": 0, "first": "9999", "last": "",
                                           "years": collections.defaultdict(lambda: [0, 0, 0])})
    for m in matches:
        for side, won in ((m["a"], m["winner"] == 0), (m["b"], m["winner"] == 1)):
            a = agg[side]
            a["n"] += 1
            a["w" if won else "l"] += 1
            a["first"] = min(a["first"], m["date"])
            a["last"] = max(a["last"], m["date"])
            y = m["date"][:4]
            a["years"][y][0] += 1
            a["years"][y][1 if won else 2] += 1

    # 阵容：优先 vlr.gg 当前阵容，其次中国赛区逐场反推
    rel = json.load(open(os.path.join(DATA, "relations.json")))
    roster = {}
    roster_src = {}
    rosters_raw = {}
    rp = os.path.join(DATA, "rosters.json")
    if os.path.exists(rp) and os.path.getsize(rp) > 4:
        try: rosters_raw = json.load(open(rp))
        except Exception: rosters_raw = {}
    _rn = {norm(k): v for k, v in rosters_raw.items()}
    # 选手档案里的当前队
    players_raw = [json.loads(l) for l in open(os.path.join(DATA, "players.jsonl"))]
    player_team = {}
    for p in players_raw:
        if p.get("team"):
            player_team[p["id"]] = p["team"]

    # 选手生涯记录
    pr_src = open(os.path.join(DATA, "player-records.js")).read()
    pr = json.loads(pr_src[pr_src.find("{"):pr_src.rfind("}") + 1])
    pr_ci = {}
    for k, v in pr["p"].items():
        pr_ci.setdefault(k.lower(), v)

    # 选手数组
    # 先建 vlr 当前阵容 -> 反查选手当前队
    _cur_team, _vct, _cur_pid, _vct_pid = {}, set(), {}, set()
    for tname in agg:
        v = _rn.get(norm(tname))
        if not v or not v.get("roster"): continue
        entries = []
        for rp_ in v["roster"]:
            h = rp_.get("handle", "")
            if not h: continue
            rec = pr["p"].get(h) or pr_ci.get(h.lower()) or {}
            pid = str(rp_.get("pid", ""))
            if rec and pid and rec.get("v") and str(rec["v"]) != pid:
                rec = {}
            entries.append([h, rec.get("n", 0), rp_.get("real", ""), rp_.get("flag", "")])
            _cur_team[h] = tname
            if pid:
                _cur_pid[pid] = tname
                _vct_pid.add(pid)
            _vct.add(h.lower())
        if entries:
            roster[tname] = {"s": "vlr", "p": entries}
    for tname, t in rel.get("teams", {}).items():
        if tname in roster: continue
        roster[tname] = {"s": "cn", "p": [[p["handle"], p["matches"], p.get("first", ""), p.get("last", "")]
                                          for p in t.get("players", [])]}

    players = []
    for p in players_raw:
        h = p["id"]
        if p.get("vlrId") and str(p["vlrId"]) in _cur_pid:
            p["team"] = _cur_pid[str(p["vlrId"])]
            _vct.add(h.lower())
        elif h in _cur_team:
            p["team"] = _cur_team[h]
        rec = pr["p"].get(h, {})
        if rec and p.get("vlrId") and rec.get("v") and str(rec["v"]) != str(p["vlrId"]):
            rec = {}
        team = player_team.get(h, "")
        if not team and rec.get("tm"):
            tm = sorted(rec["tm"], key=lambda x: (x[3], x[1]), reverse=True)
            team = tm[0][0]
        st = p.get("status", "")
        st_cn = {"Active": "现役", "Retired": "退役", "Inactive": "不活跃",
                 "Passed Away": "已故", "Banned": "禁赛", "Streamer": "主播"}.get(st, st or "未知")
        n, w = rec.get("n", 0), rec.get("w", 0)
        wr = round(w / n * 100, 1) if n else 0
        players.append([h, p.get("realName", ""), p.get("countryCn", ""), st_cn,
                        p.get("yearsActive", ""), p.get("birthDate", ""), p.get("retiredDate", ""),
                        p.get("vlrId", ""), team, p.get("aliases", ""), n, wr,
                        1 if (str(p.get("vlrId", "")) in _vct_pid or
                              (not p.get("vlrId") and h.lower() in _vct)) else 0])
    # 同名去重：保留 VCT 现役优先、生涯场次更多的那一条（旧版 3,820 也是这个口径）
    _best = {}
    for _p in players:
        _k = _p[0].lower()
        _old = _best.get(_k)
        if _old is None or (_p[12], _p[10]) > (_old[12], _old[10]):
            _best[_k] = _p
    players = list(_best.values())
    players.sort(key=lambda x: (-x[12], -x[10], x[0].lower()))

    # 战队数组
    teams = []
    for nm, a in agg.items():
        meta = team_meta.get(nm) or team_meta_n.get(norm(nm), {})
        reg = ("CN" if nm in KNOWN_CN else
               REGION_OVERRIDE.get(nm) or
               REGION_BUCKET.get((meta.get("region") or "").strip().lower(), "Pacific"))
        if not meta.get("region") and flags.get(nm) and nm not in REGION_OVERRIDE and nm not in KNOWN_CN:
            fc = flags[nm].most_common(1)[0][0]
            reg = REGION_BUCKET.get({"cn": "cn", "kr": "kr", "jp": "jp", "br": "br", "na": "na",
                                     "eu": "eu", "ap": "ap", "las": "las", "lan": "lan",
                                     "oce": "oce", "me": "me"}.get(fc, ""), "Pacific")
        e = elo.get(nm, {})
        flag = COUNTRY_ISO.get(meta.get("country", ""), "")
        if not flag and flags.get(nm):
            flag = flags[nm].most_common(1)[0][0]
        teams.append([nm, TEAM_ZH.get(nm, ""), tag_of(nm), meta.get("countryCn", ""), flag,
                      reg, round(e.get("elo", 0)), a["n"], a["w"], a["l"],
                      a["first"], a["last"], e.get("n", a["n"]),
                      re.sub(r"<[^>]+>", " ", meta.get("created", "")).strip(),
                      meta.get("disbanded", ""), e.get("form", 0), e.get("last", "")])
    teams.sort(key=lambda x: (-x[6], -x[7]))

    # 比赛按年
    by_year = collections.defaultdict(list)
    for m in matches:
        by_year[m["date"][:4]].append([int(m["id"]), m["date"], m["event"], m["series"],
                                       m["a"], m["b"], m["sa"], m["sb"], m["winner"], m["tier"]])

    # 详情
    detail_ids = []
    details = {}
    for fn in ("matchdetail.jsonl", "matchdetail_new.jsonl"):
      fp = os.path.join(DATA, fn)
      if not os.path.exists(fp): continue
      for line in open(fp):
        r = json.loads(line)
        if not r.get("ok") or not r.get("maps"): continue
        maps = []
        for mp in r["maps"]:
            ts = mp.get("teams", [])
            if len(ts) != 2: continue
            maps.append([mp.get("map", ""), ts[0].get("score", 0), ts[1].get("score", 0)])
        pl = []
        for p in (r.get("all", {}) or {}).get("players", []):
            m = p.get("m", {})
            def g(k):
                v = m.get(k)
                return v[0] if isinstance(v, list) and v else (v if v is not None else "")
            pl.append([p.get("n", ""), p.get("t", ""), p.get("c", ""),
                       [x for x in (p.get("ag") or [])][:3],
                       g("rating2"), g("acs"), g("kills"), g("deaths"), g("assists"),
                       g("kast"), g("adr"), g("hsp"), g("fb"), g("fd")])
        if not pl: continue
        details[r["id"]] = [maps, pl]
        detail_ids.append(int(r["id"]))
    detail_ids = sorted(set(detail_ids))
    _dset = set(str(x) for x in detail_ids)
    _ddates = sorted(m["date"] for m in matches if str(m["id"]) in _dset)

    # 待赛
    upcoming = json.load(open(os.path.join(DATA, "upcoming.json")))
    for u in upcoming:
        for t in u["teams"]:
            t["name"] = canon.get(norm(t["name"]), t["name"])
    # CN 本土资讯
    cn_intel = []
    cp = os.path.join(DATA, "cn_intel.json")
    if os.path.exists(cp):
        cn_intel = json.load(open(cp))
        for x in cn_intel:
            x["team"] = ""
            txt = (x.get("title", "") + " " + x.get("summary", ""))
            for known in ("EDward Gaming", "Bilibili Gaming", "FunPlus Phoenix", "TYLOO",
                          "Xi Lai Gaming", "Nova Esports", "JD Gaming", "Trace Esports",
                          "All Gamers", "Dragon Ranger Gaming", "Wolves Esports",
                          "Titan Esports Club", "Weibo Gaming", "Rare Atom", "Any Questions Gaming"):
                if norm(known.split()[0]) and known.split()[0].lower() in txt.lower() and not x["team"]:
                    x["team"] = known
        cn_intel = [x for x in cn_intel if len(x.get("summary", "")) >= 30]
    # 新闻
    news = json.load(open(os.path.join(DATA, "news.json")))
    news_zh = {}
    p = os.path.join(DATA, "news_zh.json")
    if os.path.exists(p):
        news_zh = json.load(open(p))
    for n in news:
        z = news_zh.get(n["id"], {})
        n["titleCn"] = z.get("title", "")
        n["summaryCn"] = z.get("summary", "")

    # ---------------- 写文件
    def dump(name, var, obj, pretty=False):
        path = os.path.join(OUT, name)
        with open(path, "w") as f:
            f.write("window.%s=%s;\n" % (var, json.dumps(obj, ensure_ascii=False,
                                                         separators=None if pretty else (",", ":"))))
        print(f"  {name:18s} {os.path.getsize(path)/1024:8.1f} KB")

    meta = {
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "counts": {"players": len(players), "teams": len(teams), "matches": len(matches),
                   "events": len({m["event"] for m in matches}), "news": len(news),
                   "upcoming": len(upcoming), "details": len(details)},
        "range": [matches[0]["date"], matches[-1]["date"]],
        "seasons": sorted(by_year.keys()),
        "yearCounts": {y: len(rows) for y, rows in sorted(by_year.items())},
        "regionCounts": dict(collections.Counter(t[5] for t in teams if t[7] >= 10)),
        "regions": REGION_ORDER,
        "vctCN": {
            "partners": ["All Gamers", "Bilibili Gaming", "EDward Gaming", "JD Gaming",
                         "Trace Esports", "TYLOO", "Weibo Gaming", "Xi Lai Gaming"],
            "ascended": ["Dragon Ranger Gaming", "Nova Esports"],
            "partnersCn": ["All Gamers", "Bilibili Gaming", "EDward Gaming", "JD Gaming",
                           "Trace Esports", "TYLOO", "Weibo Gaming", "Xi Lai Gaming"],
        },
        "model": model,
        "maps": MAP_ZH,
        "agents": AGENT_ZH,
        "tierNames": {str(k): v for k, v in TIER_NAME.items()},
        "detailIds": detail_ids,
        "detailRange": [_ddates[0], _ddates[-1]] if _ddates else [],
        "teamTags": TEAM_TAGS,
        "events": sorted([[e, sum(1 for m in matches if m["event"] == e)]
                          for e in {m["event"] for m in matches}], key=lambda x: -x[1]),
        "playerFlags": {c: COUNTRY_ISO.get(e, "") for e, c in
                        [(x.get("country", ""), x.get("countryCn", "")) for x in players_raw] if c},
    }
    dump("meta.js", "VD_META", meta, pretty=True)
    dump("core.js", "VD_CORE", {"players": players, "teams": teams})
    dump("roster.js", "VD_ROSTER", roster)
    print(f"  当前阵容 {sum(1 for v in roster.values() if v.get('s')=='vlr')} 队 / 历史反推 {sum(1 for v in roster.values() if v.get('s')=='cn')} 队")
    # 选手记录单独文件（懒加载）
    with open(os.path.join(OUT, "records.js"), "w") as f:
        f.write("window.VD_PR=" + json.dumps(pr, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"  records.js         {os.path.getsize(os.path.join(OUT,'records.js'))/1024:8.1f} KB")
    with open(os.path.join(OUT, "details.js"), "w") as f:
        f.write("window.VD_DETAIL=" + json.dumps(details, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"  details.js         {os.path.getsize(os.path.join(OUT,'details.js'))/1024:8.1f} KB")
    for y, rows in sorted(by_year.items()):
        path = os.path.join(OUT, f"matches-{y}.js")
        with open(path, "w") as f:
            f.write("(window.VD_MATCHES=window.VD_MATCHES||{}).y%s=%s;\n"
                    % (y, json.dumps(rows, ensure_ascii=False, separators=(",", ":"))))
        print(f"  matches-{y}.js      {os.path.getsize(path)/1024:8.1f} KB")
    dump("intel.js", "VD_INTEL", {"upcoming": upcoming, "news": news, "cn": cn_intel})

    print(f"✓ 完成：{len(players)} 选手 / {len(teams)} 战队 / {len(matches)} 比赛 / {len(details)} 场详情")

if __name__ == "__main__":
    main()
