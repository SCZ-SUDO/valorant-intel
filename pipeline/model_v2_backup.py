#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《以下犯上》预测引擎 —— Elo + 近期状态 + 交手记录，时间切分回测。

设计要点
--------
1. Elo 按比赛时间顺序滚动，预测时只使用「赛前」评分，杜绝未来数据泄漏。
2. K 值按赛事级别分层：Champions/Masters > VCT 联赛 > Challengers > 其他。
3. 近期状态 = 最近 N 场「实际结果 − 赛前期望」的加权均值（Elo 分），
   交手记录 = 近 3 年双方交手的加权胜率差（Elo 分）。
4. 概率模型用逻辑回归在训练集上拟合，而不是手拍权重；
   2026 年整年作为完全留出的测试集，只测一次。
5. 输出：data/model.json（参数 + 回测指标）、data/elo.json（当前评分）、
   data/predictions.json（待赛预测）。

用法：
  python3 pipeline/model.py            # 回测 + 导出
  python3 pipeline/model.py --quick    # 跳过网格搜索，用默认参数
"""
import json, math, os, re, sys, collections
from datetime import datetime, date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
TRAIN_END = date(2025, 1, 1)       # 训练：< 2025
VALID_END = date(2026, 1, 1)       # 验证：2025
                                   # 测试：>= 2026-01-01（只测一次）

# ---------------------------------------------------------------- 数据

def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def event_tier(ev):
    e = (ev or "").lower()
    if "game changers" in e:
        return 1
    if "challengers" in e or "ascension" in e or "qualifier" in e or "open" in e:
        return 1
    if ("champions" in e and "tour" not in e) or "masters" in e or "world cup" in e:
        return 3
    if "vct" in e or "valorant champions tour" in e or "first strike" in e:
        return 2
    return 0

TIER_K = {0: 0.6, 1: 1.0, 2: 1.45, 3: 1.9}

def load_matches():
    rows = []
    for fn in ("matches.jsonl", "matches_recent.jsonl"):
        p = os.path.join(DATA, fn)
        if not os.path.exists(p):
            continue
        for line in open(p):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get("status") and r["status"] != "Completed":
                continue
            ts = r["teams"]
            if len(ts) != 2:
                continue
            try:
                a, b = int(ts[0]["score"]), int(ts[1]["score"])
            except (ValueError, TypeError):
                continue
            if a == b:
                continue
            iso = r.get("isoDate") or ""
            if not iso:
                d = re.sub(r"\s*(Today|Yesterday|Tomorrow)\s*$", "", r.get("date", "")).strip()
                for fmt in ("%a, %B %d, %Y", "%B %d, %Y", "%Y-%m-%d"):
                    try:
                        iso = datetime.strptime(d, fmt).strftime("%Y-%m-%d")
                        break
                    except ValueError:
                        continue
            if not iso:
                continue
            rows.append({
                "id": r["id"], "date": iso, "event": r.get("event", ""),
                "series": r.get("series", ""), "a": ts[0]["name"], "b": ts[1]["name"],
                "sa": a, "sb": b, "winner": 0 if a > b else 1,
                "tier": event_tier(r.get("event", "")),
            })
    # 去重
    ded = {}
    for r in rows:
        ded[r["id"]] = r
    rows = sorted(ded.values(), key=lambda r: (r["date"], r["id"]))
    return rows

def build_names(matches):
    """归一化队伍名：key -> 显示名（优先 Liquipedia 全名）。"""
    exact = set()
    p = os.path.join(DATA, "teams.jsonl")
    if os.path.exists(p):
        for line in open(p):
            exact.add(json.loads(line)["name"])
    groups = collections.defaultdict(collections.Counter)
    for m in matches:
        groups[norm(m["a"])][m["a"]] += 1
        groups[norm(m["b"])][m["b"]] += 1
    canon = {}
    for k, c in groups.items():
        if not k:
            canon[k] = "unknown"
            continue
        names = [n for n, _ in c.most_common()]
        pick = next((n for n in names if n in exact), names[0])
        canon[k] = pick
    return canon

# ---------------------------------------------------------------- Elo

def sigmoid(x):
    if x > 30: return 1.0
    if x < -30: return 0.0
    return 1.0 / (1.0 + math.exp(-x))

def calc_form(hist, cur_date, n, halflife):
    """hist: deque[(date, actual, expected)]"""
    if not hist:
        return 0.0
    cur = date.fromisoformat(cur_date)
    tot = wsum = 0.0
    for d, act, exp in list(hist)[-n:]:
        age = (cur - date.fromisoformat(d)).days
        if age > 400:
            continue
        w = math.exp(-age / halflife)
        tot += w * (act - exp)
        wsum += w
    if wsum == 0:
        return 0.0
    return max(-120.0, min(120.0, tot / wsum * 400.0))

def calc_h2h(h2h, cur_date, a_is_first):
    """h2h: list[(date, winner_side)]，返回 A 视角的 Elo 分调整。"""
    if not h2h:
        return 0.0, 0
    cur = date.fromisoformat(cur_date)
    tot = wsum = 0.0
    cnt = 0
    for d, wside in h2h:
        age = (cur - date.fromisoformat(d)).days
        if age > 365 * 3:
            continue
        w = math.exp(-age / 365.0)
        a_win = 1.0 if ((wside == 0) == a_is_first) else 0.0
        tot += w * (a_win * 2 - 1)
        wsum += w
        cnt += 1
    if wsum == 0:
        return 0.0, 0
    return max(-40.0, min(40.0, tot / wsum * 40.0)), cnt

def simulate(matches, K=24.0, form_n=10, form_hl=90.0, start=1400.0, regress=1.0):
    """按时间滚动 Elo，返回每场赛前特征。regress = 跨赛季保留的评分偏差比例。"""
    R, N = {}, {}
    form = collections.defaultdict(lambda: collections.deque(maxlen=40))
    h2h = collections.defaultdict(list)
    last = {}
    rows = []
    season = None
    for m in matches:
        a, b = m["a"], m["b"]
        yr = m["date"][:4]
        if season is not None and yr != season and regress < 1.0:
            for t in R:
                R[t] = start + (R[t] - start) * regress
        season = yr
        ra, rb = R.get(a, start), R.get(b, start)
        na, nb = N.get(a, 0), N.get(b, 0)
        da = (date.fromisoformat(m["date"]) - date.fromisoformat(last[a])).days if a in last else 365
        db = (date.fromisoformat(m["date"]) - date.fromisoformat(last[b])).days if b in last else 365
        ka = 1.0 + max(0, 10 - na) / 10.0 * 0.6
        kb = 1.0 + max(0, 10 - nb) / 10.0 * 0.6
        ea = 1.0 / (1.0 + 10.0 ** (-(ra - rb) / 400.0))
        fa = calc_form(form[a], m["date"], form_n, form_hl)
        fb = calc_form(form[b], m["date"], form_n, form_hl)
        key = tuple(sorted((norm(a), norm(b))))
        h, hc = calc_h2h(h2h[key], m["date"], norm(a) == key[0])
        rows.append({
            "id": m["id"], "date": m["date"], "tier": m["tier"],
            "a": a, "b": b, "sa": m["sa"], "sb": m["sb"], "winner": m["winner"],
            "elo_a": ra, "elo_b": rb, "n_a": na, "n_b": nb,
            "form_a": fa, "form_b": fb, "h2h": h, "h2h_n": hc,
            "exp_a": ea, "bo": max(m["sa"], m["sb"]),
            "rest": (math.log1p(min(da, 365)) - math.log1p(min(db, 365))) / 4.0,
        })
        diff = abs(m["sa"] - m["sb"])
        k = K * TIER_K[m["tier"]] * (1.0 + 0.35 * (min(diff, 3) - 1))
        saw = 1.0 if m["winner"] == 0 else 0.0
        R[a] = ra + ka * k * (saw - ea)
        R[b] = rb + kb * k * ((1 - saw) - (1 - ea))
        N[a], N[b] = na + 1, nb + 1
        form[a].append((m["date"], saw, ea))
        form[b].append((m["date"], 1 - saw, 1 - ea))
        h2h[key].append((m["date"], m["winner"] if norm(a) == key[0] else 1 - m["winner"]))
        last[a] = last[b] = m["date"]
    state = {"form": {t: calc_form(q, matches[-1]["date"], form_n, form_hl) for t, q in form.items()},
             "last": last}
    return rows, R, N, state

# ---------------------------------------------------------------- 逻辑回归

def features(r):
    ed = (r["elo_a"] - r["elo_b"]) / 400.0
    conf = min(1.0, min(r["n_a"], r["n_b"]) / 10.0)
    return [1.0, ed, (r["form_a"] - r["form_b"]) / 400.0, r["h2h"] / 400.0,
            1.0 if r["tier"] >= 3 else 0.0,
            1.0 if r["bo"] == 3 else 0.0,
            1.0 if r["bo"] == 1 else 0.0,
            ed * (1.0 - conf),
            r["rest"]]

def fit_logreg(rows, epochs=400, lr=0.35, l2=1e-4, sample_hl=730.0):
    w = [0.0, 2.302585, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]   # Elo 差 -> log(10) 即标准 Elo 公式
    if not rows:
        return w
    ref = date.fromisoformat(max(r["date"] for r in rows))
    data = []
    for r in rows:
        age = (ref - date.fromisoformat(r["date"])).days
        sw = math.exp(-age / sample_hl)
        x = features(r)
        y = 1.0 if r["winner"] == 0 else 0.0
        data.append((x, y, sw))
    n = sum(sw for _, _, sw in data)
    for ep in range(epochs):
        g = [0.0] * len(w)
        for x, y, sw in data:
            z = sum(wi * xi for wi, xi in zip(w, x))
            p = sigmoid(z)
            d = (p - y) * sw
            for i in range(len(w)):
                g[i] += d * x[i]
        for i in range(len(w)):
            w[i] -= lr * (g[i] / n + l2 * w[i])
    return w

def predict(w, r):
    return sigmoid(sum(wi * xi for wi, xi in zip(w, features(r))))

def metrics(rows, w):
    n = ll = br = correct = 0
    bins = [[] for _ in range(10)]
    for r in rows:
        p = predict(w, r)
        y = 1.0 if r["winner"] == 0 else 0.0
        n += 1
        ll += -(y * math.log(max(p, 1e-9)) + (1 - y) * math.log(max(1 - p, 1e-9)))
        br += (p - y) ** 2
        if (p >= 0.5) == (y == 1.0):
            correct += 1
        bins[min(9, int(p * 10))].append((p, y))
    cal = []
    for i, b in enumerate(bins):
        if b:
            cal.append({"bin": i, "n": len(b), "pred": sum(p for p, _ in b) / len(b),
                        "hit": sum(y for _, y in b) / len(b)})
    return {"n": n, "acc": correct / n if n else 0, "logloss": ll / n if n else 0,
            "brier": br / n if n else 0, "calibration": cal}

# ---------------------------------------------------------------- 主流程

def series_prob(p, bo):
    """由单图胜率推系列赛胜率（独立图假设）。"""
    if bo == 5:
        q = 1 - p
        return p ** 3 * (1 + 3 * q + 6 * q * q)
    q = 1 - p
    return p * p * (3 - 2 * p)

def score_dist(p, bo):
    q = 1 - p
    if bo == 5:
        return [(3, 0, p**3), (3, 1, 3 * p**3 * q), (3, 2, 6 * p**3 * q * q)]
    return [(2, 0, p * p), (2, 1, 2 * p * p * q)]

def main(quick=False, final=False):
    matches = load_matches()
    canon = build_names(matches)
    for m in matches:
        m["a"], m["b"] = canon[norm(m["a"])], canon[norm(m["b"])]
    print(f"比赛 {len(matches)} 场，队伍 {len({m['a'] for m in matches} | {m['b'] for m in matches})} 支")
    print(f"时间 {matches[0]['date']} → {matches[-1]['date']}")

    train = [m for m in matches if date.fromisoformat(m["date"]) < TRAIN_END]
    valid = [m for m in matches if TRAIN_END <= date.fromisoformat(m["date"]) < VALID_END]
    test = [m for m in matches if date.fromisoformat(m["date"]) >= VALID_END]
    print(f"训练 {len(train)} / 验证 {len(valid)} / 测试 {len(test)}")

    grid = [(30.0, 20, 60.0, 1.0)] if quick else [
        (K, fn, fh, rg) for K in (24.0, 30.0) for fn in (10, 20)
        for fh in (60.0,) for rg in (1.0, 0.75, 0.6)
    ]
    if final:
        mp = json.load(open(os.path.join(DATA, "model.json")))["params"]
        grid = [(mp["K"], mp["form_n"], mp["form_hl"], mp.get("regress", 1.0))]
    best = None
    for K, fn, fh, rg in grid:
        rows_all, _, _, _ = simulate(matches, K, fn, fh, regress=rg)
        rows_tr = [r for r in rows_all if date.fromisoformat(r["date"]) < TRAIN_END]
        rows_va = [r for r in rows_all if TRAIN_END <= date.fromisoformat(r["date"]) < VALID_END]
        w = fit_logreg(rows_tr)
        mv = metrics(rows_va, w)
        if best is None or mv["logloss"] < best[0]["logloss"]:
            best = (mv, (K, fn, fh, rg), w, rows_all)
        print(f"  K={K:4.0f} form={fn:2d}/{fh:3.0f} regress={rg:.2f}  valid logloss {mv['logloss']:.4f} acc {mv['acc']:.3f}")

    mv, (K, fn, fh, rg), w, rows_all = best
    rows_tr = [r for r in rows_all if date.fromisoformat(r["date"]) < TRAIN_END]
    rows_va = [r for r in rows_all if TRAIN_END <= date.fromisoformat(r["date"]) < VALID_END]
    rows_te = [r for r in rows_all if date.fromisoformat(r["date"]) >= VALID_END]
    # 最终系数：训练+验证一起拟合，测试集完全不参与
    w_final = fit_logreg(rows_tr + rows_va)
    m_test = metrics(rows_te, w_final)
    m_train = metrics(rows_tr, w_final)
    m_valid = metrics(rows_va, w_final)
    print(f"\n✓ 选定 K={K} form={fn}/{fh}")
    print(f"  系数 {['%.3f' % x for x in w_final]}")
    print(f"  train  acc {m_train['acc']:.3f} logloss {m_train['logloss']:.4f}")
    print(f"  valid  acc {m_valid['acc']:.3f} logloss {m_valid['logloss']:.4f}")
    print(f"  TEST26 acc {m_test['acc']:.3f} logloss {m_test['logloss']:.4f} brier {m_test['brier']:.4f} n={m_test['n']}")

    # 基线：纯 Elo（不比系数）
    base_correct = 0
    base_ll = 0
    for r in rows_te:
        p = r["exp_a"]
        y = 1.0 if r["winner"] == 0 else 0.0
        base_correct += (p >= 0.5) == (y == 1.0)
        base_ll += -(y * math.log(max(p, 1e-9)) + (1 - y) * math.log(max(1 - p, 1e-9)))
    base = {"acc": base_correct / len(rows_te), "logloss": base_ll / len(rows_te)}
    print(f"  基线纯Elo acc {base['acc']:.3f} logloss {base['logloss']:.4f}")

    # 当前评分（用全量数据）
    _, R, N, state = simulate(matches, K, fn, fh, regress=rg)
    elo = sorted(({"team": t, "elo": round(v), "n": N[t],
                   "form": round(state["form"].get(t, 0), 1),
                   "last": state["last"].get(t, "")} for t, v in R.items()),
                 key=lambda x: -x["elo"])

    # 按赛事级别看 2026 表现
    by_tier = {}
    for tier in (1, 2, 3):
        sub = [r for r in rows_te if r["tier"] == tier]
        if len(sub) >= 50:
            by_tier[str(tier)] = metrics(sub, w_final)

    # 比分分布：按预测胜率分箱，统计「A 胜时」的实际比分
    score_model = {}
    for bo in (1, 2, 3):
        sub = [r for r in rows_all if r["bo"] == bo and r["winner"] == 0]
        if len(sub) < 30: continue
        bins = []
        for lo, hi in ((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 1.01)):
            ss = [r for r in sub if lo <= predict(w_final, r) < hi]
            if not ss: continue
            c = collections.Counter("%d-%d" % (r["sa"], r["sb"]) for r in ss)
            tot = sum(c.values())
            bins.append({"lo": lo, "hi": hi, "n": tot,
                         "dist": {k: round(v / tot, 3) for k, v in c.most_common(3)}})
        score_model[str(bo)] = bins

    recent = []
    for r in rows_all[-160:]:
        recent.append({"id": int(r["id"]), "p": round(predict(w_final, r), 4),
                       "w": r["winner"]})

    model = {
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "params": {"K": K, "form_n": fn, "form_hl": fh, "start": 1400.0, "regress": rg,
                   "train_end": str(TRAIN_END), "valid_end": str(VALID_END)},
        "coef": w_final,
        "metrics": {"train": m_train, "valid": m_valid, "test": m_test,
                    "baseline_elo": base, "by_tier": by_tier},
        "scoreModel": score_model,
        "recent": recent,
        "counts": {"matches": len(matches), "teams": len(R),
                   "train": len(rows_tr), "valid": len(rows_va), "test": len(rows_te)},
        "tier_names": {"0": "其他", "1": "挑战者/次级", "2": "VCT 联赛", "3": "国际大赛"},
    }
    with open(os.path.join(DATA, "model.json"), "w") as f:
        json.dump(model, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, "elo.json"), "w") as f:
        json.dump(elo, f, ensure_ascii=False, indent=0)
    print(f"✓ model.json / elo.json（{len(elo)} 队）")

    return model, R, N, rows_all, w_final, (K, fn, fh)

if __name__ == "__main__":
    main("--quick" in sys.argv, "--final" in sys.argv)
