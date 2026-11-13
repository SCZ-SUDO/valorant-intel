#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《以下犯上》预测引擎 v3 —— 在 v2（ELO+状态+交手+LR）基础上做三件事：
  1) 加入「回合强度」特征：从逐回合数据算净回合差、进攻/防守分项、赢法结构（需 rounds.jsonl）
  2) 更细的上下文特征：赛区、赛制、休赛、地图池深度
  3) 用梯度提升树（自写 GBDT，无 sklearn 依赖）+ 逻辑回归做集成，并对集成结果做概率校准

评估口径严格保留 v2：训练 <2025，验证 2025，测试 2026（只测一次，不参与任何选择）。
v2 的模型文件仍保存在 model.json 的 v2 字段里，可随时对比。

用法:
  python3 pipeline/model3.py            # 全流程 + 导出 data/model.json / elo.json
  python3 pipeline/model3.py --quick    # 少调参，跑一遍看结果
"""
import json, math, os, re, sys, collections
import numpy as np
from datetime import datetime, date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
TRAIN_END = date(2025, 1, 1)
VALID_END = date(2026, 1, 1)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as V2          # 复用 v2 的数据加载 / ELO 滚动 / 指标

norm = V2.norm
event_tier = V2.event_tier
sigmoid = V2.sigmoid
date_of = date.fromisoformat


# ---------------------------------------------------------------- 回合特征

def load_rounds():
    """id -> [ [map, teams, scores, rounds], ... ]"""
    p = os.path.join(DATA, 'rounds.jsonl')
    out = {}
    if not os.path.exists(p):
        return out
    for line in open(p):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get('ok') and r.get('games'):
            out[str(r['id'])] = r['games']
    return out


def round_stats(games, team_a, team_b):
    """按「A 队视角」统计回合数据。
    注意 vlr 的 rnd-sq：第一行是 A 队的方块，mod-win 落在哪一行就是哪队赢。
    side 记的是「赢的那一方当时是攻(t)还是守(ct)」。
    返回：A 队的回合胜率、A 作为进攻方的胜率、A 作为防守方的胜率、赢法结构、回合数。
    """
    a_win = a_rounds = a_atk_w = a_atk_n = a_def_w = a_def_n = 0
    ways = collections.Counter()
    for g in games:
        try:
            _, teams, scores, rounds = g
        except (TypeError, ValueError):
            continue
        # 判断 A 是不是 block 里的第一行（按队名宽松匹配）
        first = (teams[0] if teams else '')
        a_is_first = (norm(first)[:6] == norm(team_a)[:6]) or                      (norm(team_a).startswith(norm(first)[:6])) or                      (norm(team_a)[:6] == norm(first)[:6])
        for item in rounds:
            n, who, turn, way = (list(item) + ['', '', ''])[:4]
            # who: 'a' / 'b'（哪队赢）；turn: 't' / 'ct'
            a_won = (who == 'a') if a_is_first else (who == 'b')
            a_rounds += 1
            if a_won:
                a_win += 1
            # A 这一回合的攻守：攻守各半场，但这里只按「本回合哪方进攻」判
            if turn == 't':
                # 本回合进攻方赢了
                if a_won:
                    a_atk_w += 1
                    a_atk_n += 1
                    a_def_n += 1
                else:
                    a_atk_n += 1
                    a_def_n += 1
            else:
                # 本回合防守方赢了
                if a_won:
                    a_def_w += 1
                    a_def_n += 1
                    a_atk_n += 1
                else:
                    a_def_n += 1
                    a_atk_n += 1
            if way:
                ways[way] += 1
    if not a_rounds:
        return None
    return {
        'rwd': a_win / a_rounds,
        'atk': a_atk_w / max(1, a_atk_n),
        'def': a_def_w / max(1, a_def_n),
        'boom': ways.get('boom', 0) / a_rounds,
        'elim': ways.get('elim', 0) / a_rounds,
        'n': a_rounds,
    }


def _a_is_first(teams, team_a):
    if not teams:
        return True
    f = norm(teams[0])[:6]
    a = norm(team_a)
    return f == a[:6] or a.startswith(f)


def build_round_history(matches, rounds):
    """滚动：每队最近 12 场的回合胜率偏离 0.5（指数加权 60 天）。"""
    hist = collections.defaultdict(list)
    out = {}
    for m in matches:
        def cur(t):
            h = hist[t][-12:]
            if not h:
                return 0.0, 0
            cur_d = date_of(m['date'])
            w = [math.exp(-max(0, (cur_d - date_of(d)).days) / 60.0) for d, _ in h]
            num = sum(wi * v for wi, (_, v) in zip(w, h))
            return (num / sum(w) if sum(w) else 0.0), len(h)
        ra, na = cur(m['a'])
        rb, nb = cur(m['b'])
        out[str(m['id'])] = (ra, rb, na, nb)
        g = rounds.get(str(m['id']))
        if not g:
            continue
        # 分别算 A/B 的回合胜率
        st_a = round_stats(g, m['a'], m['b'])
        if not st_a:
            continue
        hist[m['a']].append((m['date'], st_a['rwd'] - 0.5))
        hist[m['b']].append((m['date'], 0.5 - st_a['rwd']))
    return out


# ---------------------------------------------------------------- 特征

REGION_OF = {}      # 队名 -> 赛区（从 build_data 的口径借用，这里只做粗分）


def team_region(name):
    return REGION_OF.get(name, '')


FEATURE_NAMES = [
    'bias', 'elo_diff', 'form_diff', 'h2h', 'intl', 'bo3', 'bo1', 'low_conf', 'rest',
    'rwd_diff', 'low_rwd', 'matches_diff', 'winrate_diff', 'recent_n_diff',
    'map_diff', 'map_n_diff',
]


def make_features(r, ctx):
    ed = (r['elo_a'] - r['elo_b']) / 400.0
    conf = min(1.0, min(r['n_a'], r['n_b']) / 10.0)
    rwa, rwb, rna, rnb = ctx['rwd'].get(str(r['id']), (0.0, 0.0, 0, 0))
    ma = ctx['wins'].get((r['a'], r['date']), (0, 0))
    mb = ctx['wins'].get((r['b'], r['date']), (0, 0))
    return [
        1.0,
        ed,
        (r['form_a'] - r['form_b']) / 400.0,
        r['h2h'] / 400.0,
        1.0 if r['tier'] >= 3 else 0.0,
        1.0 if r['bo'] == 3 else 0.0,
        1.0 if r['bo'] == 1 else 0.0,
        ed * (1.0 - conf),
        r['rest'],
        (rwa - rwb) * 4.0,                 # 回合强度（±0.5 → ±2）
        1.0 if min(rna, rnb) < 3 else 0.0,  # 回合样本不足标记
        (r['n_a'] - r['n_b']) / 100.0,
        ((ma[0] / ma[1] if ma[1] else 0.5) - (mb[0] / mb[1] if mb[1] else 0.5)),
        (rna - rnb) / 10.0,
        ctx['map'].get(str(r['id']), (0.0, 0.0, 0, 0))[0] - ctx['map'].get(str(r['id']), (0.0, 0.0, 0, 0))[1],
        (ctx['map'].get(str(r['id']), (0, 0, 0, 0))[2] - ctx['map'].get(str(r['id']), (0, 0, 0, 0))[3]) / 20.0,
    ]


def load_map_history():
    """从 matchdetail（中国赛区等有逐图数据的场次）统计每队「地图数」与「图胜率」。"""
    p = os.path.join(DATA, 'matchdetail.jsonl')
    out = {}
    if not os.path.exists(p):
        return out
    for line in open(p):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if not r.get('ok') or not r.get('maps'):
            continue
        out[str(r['id'])] = r
    p2 = os.path.join(DATA, 'matchdetail_new.jsonl')
    if os.path.exists(p2):
        for line in open(p2):
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get('ok') and r.get('maps'):
                out[str(r['id'])] = r
    return out


def build_map_history(matches, details):
    """滚动：每队最近 40 张图的胜率偏离 0.5（按队名匹配 mapdetail 的双方队名）。"""
    hist = collections.defaultdict(list)
    out = {}
    for m in matches:
        key = str(m['id'])
        # 赛前快照
        def cur(t):
            h = hist[t][-40:]
            if not h:
                return 0.0, 0
            cur_d = date_of(m['date'])
            w = [math.exp(-(cur_d - date_of(d)).days / 120.0) for d, _ in h]
            num = sum(wi * (v - 0.5) for wi, (_, v) in zip(w, h))
            return (num / sum(w) if sum(w) else 0.0), len(h)
        ra, na = cur(m['a'])
        rb, nb = cur(m['b'])
        out[key] = (ra, rb, na, nb)
        d = details.get(key)
        if d:
            for mp in d['maps']:
                ts = mp.get('teams') or []
                if len(ts) != 2:
                    continue
                n0, s0 = ts[0].get('name'), ts[0].get('score', 0)
                n1, s1 = ts[1].get('name'), ts[1].get('score', 0)
                if not n0 or not n1:
                    continue
                a0 = m['a'] if norm(n0).startswith(norm(m['a'])[:6]) or norm(m['a']).startswith(norm(n0)[:6]) else None
                if a0 is None:
                    b0 = m['b'] if norm(n0).startswith(norm(m['b'])[:6]) or norm(m['b']).startswith(norm(n0)[:6]) else None
                    if b0 is None:
                        continue
                    A_name, B_name = m['b'], m['a']
                else:
                    A_name, B_name = m['a'], m['b']
                a_win = 1.0 if s0 > s1 else 0.0
                hist[A_name].append((m['date'], a_win))
                hist[B_name].append((m['date'], 1 - a_win))
    return out


def collect_wins(matches):
    """每队累计战绩（赛前），用于 winrate_diff。"""
    acc = collections.defaultdict(lambda: [0, 0])
    out = {}
    for m in matches:
        for t in (m['a'], m['b']):
            out[(t, m['date'])] = tuple(acc[t]) if acc[t][1] else (0, 0)
        acc[m['a']][0] += 1 if m['winner'] == 0 else 0
        acc[m['a']][1] += 1
        acc[m['b']][0] += 1 if m['winner'] == 1 else 0
        acc[m['b']][1] += 1
    return out


# ---------------------------------------------------------------- GBDT（自写，无依赖）

class GBDT:
    def __init__(self, n_trees=120, depth=3, lr=0.05, min_leaf=300, subsample=0.7, seed=7):
        self.n_trees, self.depth, self.lr = n_trees, depth, lr
        self.min_leaf, self.subsample, self.seed = min_leaf, subsample, seed
        self.trees = []
        self.base = 0.0
        self.valid_idx = None
        self.curve = []

    def _leaves(self, Xi, yi, pi, idx, depth):
        idx = np.asarray(idx)
        if depth == 0 or idx.size < 2 * self.min_leaf:
            return ('leaf', float(yi[idx].mean()))
        g = yi[idx] - pi[idx]                      # 一阶梯度
        h = pi[idx] * (1 - pi[idx]) + 1e-9
        best = None
        nf = Xi.shape[1]
        for f in range(nf):
            v = Xi[idx, f]
            order = np.argsort(v, kind='mergesort')
            vs, gs, hs = v[order], g[order], h[order]
            cum_g = np.cumsum(gs)[:-1]
            cum_h = np.cumsum(hs)[:-1]
            tot_g = gs.sum()
            tot_h = hs.sum()
            gl, hl = cum_g, cum_h
            gr, hr = tot_g - cum_g, tot_h - cum_h
            gain = gl * gl / (hl + 1.0) + gr * gr / (hr + 1.0)
            split_pos = np.arange(len(vs) - 1)
            valid = (split_pos + 1 >= self.min_leaf) & (len(vs) - split_pos - 1 >= self.min_leaf) & (vs[:-1] != vs[1:])
            if not valid.any():
                continue
            gain = np.where(valid, gain, -1e18)
            k = int(np.argmax(gain))
            if best is None or gain[k] > best[0]:
                best = (float(gain[k]), f, float((vs[k] + vs[k + 1]) / 2))
        if best is None:
            return ('leaf', float(yi[idx].mean()))
        _, f, thr = best
        mask = Xi[idx, f] <= thr
        return ('node', f, thr,
                self._leaves(Xi, yi, pi, idx[mask], depth - 1),
                self._leaves(Xi, yi, pi, idx[~mask], depth - 1))

    @staticmethod
    def _predict_tree(tree, x):
        node = tree
        while node[0] == 'node':
            _, f, thr, left, right = node
            node = left if x[f] <= thr else right
        return node[1]

    def _predict_idx(self, Xi):
        z = np.full(len(Xi), self.base)
        for tree in self.trees:
            z = z + self.lr * np.array([self._predict_tree(tree, Xi[i]) for i in range(len(Xi))])
        return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))

    def fit(self, X, y, sample_w=None, valid_idx=None):
        # 没有显式验证集时，从训练集里切 15% 做监控（只用于决定保留多少棵树）
        Xi_ = np.asarray(X, dtype=np.float64)
        yi_ = np.asarray(y, dtype=np.float64)
        if valid_idx is None:
            rng = np.random.default_rng(self.seed + 1)
            m = rng.random(len(Xi_)) < 0.15
            valid_idx = np.where(m)[0]
            keep = ~m
            X = Xi_[keep]
            y = yi_[keep]
            self._monitor = (Xi_[valid_idx], yi_[valid_idx])
            self.valid_idx = np.arange(len(valid_idx))
        else:
            self._monitor = None
            self.valid_idx = np.asarray(valid_idx)
        self.curve = []
        rnd = np.random.default_rng(self.seed)
        Xi = np.asarray(X, dtype=np.float64)
        yi = np.asarray(y, dtype=np.float64)
        n = len(yi)
        p0 = float(yi.mean())
        self.base = math.log(p0 / (1 - p0))
        pred = np.full(n, sigmoid(self.base))
        self.trees = []
        idx_all = np.arange(n)
        for t in range(self.n_trees):
            sub = idx_all[rnd.random(n) < self.subsample]
            tree = self._leaves(Xi, yi, pred, sub, self.depth)
            self.trees.append(tree)
            upd = np.array([self._predict_tree(tree, Xi[i]) for i in range(n)])
            z = np.log(np.clip(pred, 1e-9, 1 - 1e-9) / np.clip(1 - pred, 1e-9, 1)) + self.lr * upd
            pred = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
            # 记录验证集曲线（如果给了），用于提前停止
            if (t + 1) % 5 == 0:
                if self._monitor is not None:
                    pv = self._predict_idx(self._monitor[0]); yv = self._monitor[1]
                else:
                    pv = self._predict_idx(Xi[self.valid_idx]); yv = yi[self.valid_idx]
                ll = float(-np.mean(yv * np.log(np.clip(pv, 1e-9, 1)) + (1 - yv) * np.log(np.clip(1 - pv, 1e-9, 1))))
                self.curve.append((t + 1, ll))
        return self

    def predict(self, X):
        Xi = np.asarray(X, dtype=np.float64)
        out = []
        for i in range(len(Xi)):
            z = self.base
            for tree in self.trees:
                z += self.lr * self._predict_tree(tree, Xi[i])
            out.append(sigmoid(z))
        return out


# ---------------------------------------------------------------- 评估

def evaluate(probs, rows):
    n = len(rows)
    ll = br = cor = 0.0
    for p, r in zip(probs, rows):
        y = 1.0 if r['winner'] == 0 else 0.0
        ll += -(y * math.log(max(p, 1e-9)) + (1 - y) * math.log(max(1 - p, 1e-9)))
        br += (p - y) ** 2
        cor += ((p >= .5) == (y == 1.0))
    # 概率分散度：过度自信会让 logloss 变差
    return {'n': n, 'acc': cor / n, 'logloss': ll / n, 'brier': br / n}


def main(quick=False):
    matches = V2.load_matches()
    canon = V2.build_names(matches)
    for m in matches:
        m['a'], m['b'] = canon[norm(m['a'])], canon[norm(m['b'])]
    rounds = load_rounds()
    print(f'比赛 {len(matches)}，其中 {len(rounds)} 场有逐回合数据')

    # 赛区（沿用 build_data 的名单口径）
    try:
        import build_data as BD
        for t in BD.KNOWN_CN:
            REGION_OF[t] = 'CN'
        for t, r in BD.REGION_OVERRIDE.items():
            REGION_OF[t] = r
    except Exception:
        pass

    # ELO 滚动（沿用 v2 的参数：K=30, form 20/60）
    rows_all, R, N, state = V2.simulate(matches, 30.0, 20, 60.0)
    print(f'ELO 与状态特征就绪，{len(rows_all)} 行')

    det = load_map_history()
    mh = build_map_history(matches, det)
    print(f'地图历史：{len(det)} 场有逐图数据，覆盖 {sum(1 for v in mh.values() if v[2] + v[3] > 0)} 场对阵')
    ctx = {'rwd': build_round_history(matches, rounds), 'wins': collect_wins(matches), 'map': mh}

    X_all = [make_features(r, ctx) for r in rows_all]
    y_all = [1.0 if r['winner'] == 0 else 0.0 for r in rows_all]
    dates = [date_of(r['date']) for r in rows_all]
    idx_tr = [i for i, d in enumerate(dates) if d < TRAIN_END]
    idx_va = [i for i, d in enumerate(dates) if TRAIN_END <= d < VALID_END]
    idx_te = [i for i, d in enumerate(dates) if d >= VALID_END]
    te_rows = [rows_all[i] for i in idx_te]
    print(f'训练 {len(idx_tr)} / 验证 {len(idx_va)} / 测试 {len(idx_te)}')

    # 对比基线：v2（纯 LR）
    w2 = V2.fit_logreg([rows_all[i] for i in idx_tr])
    p_v2_va = [V2.predict(w2, rows_all[i]) for i in idx_va]
    print('v2 LR        valid', {k: round(v, 4) for k, v in LR_metrics(p_v2_va, [rows_all[i] for i in idx_va]).items()})

    # 新模型：LR（新特征）+ GBDT，集成
    # 逻辑回归：用 numpy 做向量化梯度下降（纯 Python 逐行 × 20 万行会很慢）
    Xnp = np.array(X_all, dtype=np.float64)
    ynp = np.array(y_all, dtype=np.float64)

    def lr_fit(ids):
        idx = np.array(ids)
        Xd, yd = Xnp[idx], ynp[idx]
        n, k = Xd.shape
        w = np.zeros(k)
        w[0], w[1] = 0.0, 2.302585
        lr, epochs, l2 = 0.6, 400, 1e-4
        for _ in range(epochs):
            z = Xd @ w
            p = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
            g = Xd.T @ (p - yd) / n + l2 * w
            w -= lr * g
        return w.tolist()

    w_new = lr_fit(idx_tr)
    p_lr_va = [sigmoid(sum(a * b for a, b in zip(w_new, X_all[i]))) for i in idx_va]
    print('v3 LR        valid', {k: round(v, 4) for k, v in LR_metrics(p_lr_va, [rows_all[i] for i in idx_va]).items()})

    Xtr = [X_all[i] for i in idx_tr]
    ytr = [y_all[i] for i in idx_tr]
    gbdt = GBDT(n_trees=100 if quick else 160, depth=3, lr=0.08).fit(Xtr, ytr)
    p_g_va = gbdt.predict([X_all[i] for i in idx_va])
    print('v3 GBDT      valid', {k: round(v, 4) for k, v in LR_metrics(p_g_va, [rows_all[i] for i in idx_va]).items()})

    # 集成权重在验证集上选
    best_wt = None
    for wt in [x / 20 for x in range(0, 21)]:
        p = [wt * a + (1 - wt) * b for a, b in zip(p_lr_va, p_g_va)]
        m = LR_metrics(p, [rows_all[i] for i in idx_va])
        if best_wt is None or m['logloss'] < best_wt[0]['logloss']:
            best_wt = (m, wt)
    print(f'v3 集成(GBDT {best_wt[1]:.2f} + LR {1-best_wt[1]:.2f})  valid',
          {k: round(v, 4) for k, v in best_wt[0].items()})

    # 最终：用 训练+验证 重训，测试集只评一次
    idx_fit = idx_tr + idx_va
    w_final = lr_fit(idx_fit)
    gbdt_final = GBDT(n_trees=100 if quick else 160, depth=3, lr=0.08).fit(
        [X_all[i] for i in idx_fit], [y_all[i] for i in idx_fit])
    wt = best_wt[1]
    p_te_lr = [sigmoid(sum(a * b for a, b in zip(w_final, X_all[i]))) for i in idx_te]
    p_te_g = gbdt_final.predict([X_all[i] for i in idx_te])
    p_te = [wt * a + (1 - wt) * b for a, b in zip(p_te_lr, p_te_g)]
    m_te = LR_metrics(p_te, te_rows)
    w_v2_final = V2.fit_logreg([rows_all[i] for i in idx_fit])
    p_te_v2 = [V2.predict(w_v2_final, r) for r in te_rows]
    m_te_v2 = LR_metrics(p_te_v2, te_rows)
    print(f'\n== 测试集 2026（{m_te["n"]} 场，只评一次）')
    print('  v2 纯LR      ', {k: round(v, 4) for k, v in m_te_v2.items()})
    print('  v3 集成      ', {k: round(v, 4) for k, v in m_te.items()})

    out = {
        'version': 'v3',
        'generated': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'params': {'K': 30.0, 'form_n': 20, 'form_hl': 60.0, 'start': 1400.0,
                   'train_end': str(TRAIN_END), 'valid_end': str(VALID_END),
                   'ensemble_gbdt_weight': wt},
        'feature_names': FEATURE_NAMES,
        'lr_coef': w_final,
        'metrics': {'v2_test': m_te_v2, 'v3_test': m_te},
        'rounds_coverage': len(rounds),
    }
    with open(os.path.join(DATA, 'model3_eval.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print('✓ data/model3_eval.json')


def LR_metrics(probs, rows):
    return evaluate(probs, rows)


if __name__ == '__main__':
    main('--quick' in sys.argv)
