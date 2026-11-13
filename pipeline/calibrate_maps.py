#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 valorant-api 的点位世界坐标标定到俯视图像素上。

为什么不能直接用官方系数：实测官方 displayIcon 画布与 xMultiplier/xScalarToAdd
那套系数不匹配（直接套用命中率只有 5%~57%）。所以用「几何拟合」：
  未知量 = 每像素世界长度 s、画布原点 (x0,y0)、像素偏移 (dx,dy)
  px = (x - x0)/s + dx ,  py = (y0 - y)/s + dy
  目标 = 官方点位落在实心区域的比例最高
  做法 = 先用点位质心/实心区质心对齐估原点，再对 s ∈ {11..16} 做粗搜(±120px,8px步) → 精搜(±6px,1px步)
通过线：所有地图命中率 ≥ 70% 才写出 maps.json，否则非零退出（不悄悄放过）。
"""
import json, os, sys
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data/maps/valorant-api-maps.json')
IMG = os.path.join(ROOT, 'web/assets/img/maps')
OUT = os.path.join(ROOT, 'data/maps/maps.json')
THRESHOLD = 0.70
# 已知未达标地图：保留但打上 calibrated=False，前端不给点位、只给走图（不伪造标定）
UNKNOWN_OK = {"Split"}
CELL_WORLD = 120.0

ZH = {'Ascent':'亚海悬城','Split':'裂变峡谷','Fracture':'霓虹町','Bind':'源工重镇','Breeze':'微风岛屿',
      'Abyss':'幽邃地窟','Lotus':'莲华古城','Sunset':'日落之城','Pearl':'深海明珠','Summit':'天枢云阙',
      'Icebox':'森寒冬港','Corrode':'盐海矿镇','Haven':'隐世修所'}
PLACE = {'Ascent':'意大利·威尼斯','Split':'日本·东京','Fracture':'美国新墨西哥','Bind':'摩洛哥·拉巴特',
         'Breeze':'百慕大三角','Abyss':'大西洋深海','Lotus':'印度·喜马拉雅','Sunset':'美国·洛杉矶',
         'Pearl':'葡萄牙·里斯本','Summit':'中国·青藏高原','Icebox':'俄罗斯·摩尔曼斯克',
         'Corrode':'法国·阿尔萨斯','Haven':'不丹·帕罗'}
# 点位中文名（人工编译；没列的保留英文）
CALLOUT_ZH = {'Site':'包点','Spawn':'出生点','Main':'主路','Lobby':'大厅','Link':'连接','Long':'长道',
  'Short':'短道','Top':'上层','Bottom':'下层','Mid':'中路','Hall':'走廊','Door':'门','Doors':'门',
  'Window':'窗口','Tower':'塔楼','Rafters':'顶梁','Nest':'巢','Vent':'通风管','Cave':'洞穴','Cubby':'死角',
  'Tree':'树','Window':'窗口','Garden':'花园','Market':'集市','Courtyard':'庭院','Pizza':'披萨房','Wine':'红酒',
  'Catwalk':'天桥','Boat House':'船屋','Back':'后场','Screens':'屏风','Sewer':'下水道','Tunnel':'隧道',
  'Bench':'长椅','Arcade':'拱廊','Generator':'发电机','Canteen':'食堂','Hall':'走廊','Rope':'绳索',
  'Drop':'跳点','Dish':'雷达盘','Gate':'门闸','Bridge':'桥','Exit':'出口','Fountain':'喷泉','Elbow':'拐角',
  'Bath':'浴室','Lamps':'路灯','Pillars':'柱子','Upper':'上层','Waterfall':'瀑布','Mound':'土丘','Bend':'弯道',
  'Gravel':'碎石','Hut':'小屋','Root':'树根','Rubble':'瓦砾','Stairs':'楼梯','Mail':'邮报房','Garage':'车库',
  'Boba':'奶茶店','Tiles':'瓷砖','Alley':'小巷','Arches':'拱门','Wood Doors':'木门','Pillar':'石柱',
  'Pyramids':'金字塔','Shop':'商店','Ramp':'坡道','Wall':'围墙','Cannon':'大炮','Nest':'巢','Belt':'传送带',
  'Pipes':'管道','Screen':'屏风','Yellow':'黄区','Green':'绿区','Orange':'橙区','Blue':'蓝区','Boiler':'锅炉',
  'Pallet':'托盘','Fence':'围栏','Snowman':'雪人','Snow Pile':'雪堆','Kitchen':'厨房','Tube':'管道',
  'Crane':'吊机','Pocket':'口袋','Yard':'院子','Arch':'拱门','Records':'档案室','Secret':'密室',
  'Security':'安保','Danger':'危险区','Library':'图书馆','Nest':'巢','Flowers':'花坛','Dugout':'看台',
  'Restaurant':'餐厅','Art':'画廊','Plaza':'广场','Shops':'商铺','Club':'夜店','Connector':'连接处',
  'Water':'水池','Cafeteria':'自助餐厅','Heaven':'天堂','Hell':'地狱','Loading':'装卸区','Mid Doors':'中门',
  'Gym':'健身区','Trophy':'奖杯厅','Garden':'花园','Summit':'峰顶','Mound':'土丘','Sewer':'下水道',
  'Museum':'博物馆','Kitchen':'厨房','Lane':'小路','Walkway':'步道','Overpass':'天桥','Pizza Room':'披萨房'}

SOLID_ALPHA = 20
# 俯视图的灰度编码（实测）：白色空区 ~255、浅灰地面 ~118、通路/标记线 ~140+、站点高亮为橄榄色。
# 之前把"浅灰地面"当成实心区，导致点位几乎全被判为"落在墙里"——这里只把「亮于地面的线/标记」视为墙。
SOLID_LUM_MIN = 132
SOLID_LUM_MAX = 240


def load_mask(slug):
    im = Image.open(os.path.join(IMG, f'{slug}-display.png')); im.load()
    a = np.array(im.convert('RGBA')); H, W = a.shape[:2]
    alpha = a[:, :, 3]
    lum = a[:, :, :3].mean(axis=2)
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    teal = (g > 120) & (g - r > 60) & (g - b > 20)      # 传送门连线
    olive = (r > 140) & (r < 200) & (g > 150) & (b < 150) & (abs(r - g) < 40)   # 站点高亮
    wall = (alpha > SOLID_ALPHA) & (lum >= SOLID_LUM_MIN) & (lum < SOLID_LUM_MAX) & ~teal & ~olive
    walk = (alpha > SOLID_ALPHA) & (((lum >= 108) & (lum <= 126)) | olive)   # 地面浅灰 + 站点橄榄
    invalid = teal     # 传送门连线等装饰
    return wall, walk, invalid, W, H


def official_uv(m, x, y):
    """官方标定（实测：轴对调）。u 由世界 y 决定、v 由世界 x 决定。
    证据：Ascent 22 点字面义命中 9%，对调 77%；Bind 0%→92%；Fracture 0%→82%。"""
    if not m.get('xMultiplier'):
        return None
    u = y * m['xMultiplier'] + m['xScalarToAdd']
    v = x * m['yMultiplier'] + m['yScalarToAdd']
    return u, v


def score(walk, W, H, pts, s, dx, dy, x0, y0):
    n = 0
    for (x, y) in pts:
        px = int((x - x0) / s) + dx
        py = int((y0 - y) / s) + dy
        if 0 <= px < W and 0 <= py < H and walk[py, px]:
            n += 1
    return n


def calibrate(walk, W, H, pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    yp, xp = np.where(walk)
    best = None
    for s in (11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5, 16.0, 16.5, 17.0):
        x0 = sum(xs) / len(xs) - xp.mean() * s
        y0 = sum(ys) / len(ys) + yp.mean() * s
        b = (0, 0, 0)
        for ddx in range(-120, 121, 8):
            for ddy in range(-120, 121, 8):
                n = score(walk, W, H, pts, s, ddx, ddy, x0, y0)
                if n > b[0]: b = (n, ddx, ddy)
        for ddx in range(b[1] - 6, b[1] + 7):
            for ddy in range(b[2] - 6, b[2] + 7):
                n = score(walk, W, H, pts, s, ddx, ddy, x0, y0)
                if n > b[0]: b = (n, ddx, ddy)
        if best is None or b[0] > best[0]:
            best = (b[0], s, b[1], b[2], x0, y0)
    return best


def main():
    raw = json.load(open(RAW))
    out = {'_meta': {'source': 'valorant-api.com/v1/maps + spikeatlas 小地图',
                     'cellWorld': CELL_WORLD, 'threshold': THRESHOLD,
                     'formula': 'px = (x-x0)/s + dx ; py = (y0-y)/s + dy'},
           'maps': {}}
    fails = []
    for m in raw['data']:
        name = m['displayName']; slug = name.lower().replace(' ', '-')
        disp = f'assets/img/maps/{slug}-display.png'
        if not os.path.exists(os.path.join(ROOT, 'web', disp)):
            print(f'  跳过（无图）{name}'); continue
        solid, walk, invalid, W, H = load_mask(slug)
        pts = [(c['location']['x'], c['location']['y']) for c in m['callouts']]

        # 方案 A：官方标定公式（轴对调）——多数图直接够用
        f = official_uv(m, *pts[0]) if pts else None
        ratio_off, hits_off = 0.0, 0
        if f is not None:
            for (x, y) in pts:
                u, v = official_uv(m, x, y)
                px, py = u * W, v * H
                if 0 <= px < W and 0 <= py < H and walk[int(py), int(px)]:
                    hits_off += 1
            ratio_off = hits_off / len(pts)

        # 方案 B：几何拟合（仅当官方公式不够好时才跑；拟合很慢，能省则省）
        if ratio_off >= THRESHOLD:
            n, s, dx, dy, x0, y0 = hits_off, 1.0, 0, 0, 0.0, 0.0
            ratio = ratio_off
        else:
            n, s, dx, dy, x0, y0 = calibrate(walk, W, H, pts)
            ratio = n / len(pts)

        if ratio_off >= max(THRESHOLD, ratio):
            method = 'official'
            ratio = ratio_off
            s = 1.0 / abs(m['xMultiplier']) / W      # 世界单位 / 像素
            x0, y0 = 0.0, 0.0
            dx = None  # 官方公式不需要平移
            print(f'  {name:<9}{ZH.get(name,name):<5} 官方公式 命中 {ratio*100:5.1f}%  (u=y*xm+xa, v=x*ym+ya)', flush=True)
        else:
            method = 'fitted'
            dx = dx
            print(f'  {name:<9}{ZH.get(name,name):<5} 拟合 命中 {ratio*100:5.1f}%  (官方 {ratio_off*100:.0f}%) s={s:.1f}u/px dx={dx} dy={dy}', flush=True)
        if ratio < THRESHOLD and name not in UNKNOWN_OK:
            fails.append((name, round(ratio, 3)))
            continue
        calibrated = bool(ratio >= THRESHOLD)

        if method == 'official':
            def w2p(x, y):
                u, v = official_uv(m, x, y)
                return u * W, v * H
            def p2w(px, py):
                # 官方公式的逆：x 由 v 反推、y 由 u 反推
                y = (px / W - m['xScalarToAdd']) / m['xMultiplier']
                x = (py / H - m['yScalarToAdd']) / m['yMultiplier']
                return x, y
        else:
            def w2p(x, y):
                # px = (x - x0)/s + dx ;  py = (y0 - y)/s + dy
                return (x - x0) / s + dx, (y0 - y) / s + dy
            def p2w(px, py):
                return x0 + (px - dx) * s, y0 - (py - dy) * s

        callouts = []
        for c in m['callouts']:
            px, py = w2p(c['location']['x'], c['location']['y'])
            inb = 0 <= px < W and 0 <= py < H
            hit = bool(inb and walk[int(py), int(px)])
            callouts.append({'n': c['regionName'], 'zh': CALLOUT_ZH.get(c['regionName'], ''),
                             's': c['superRegionName'], 'u': round(px / W, 4), 'v': round(py / H, 4),
                             'x': c['location']['x'], 'y': c['location']['y'], 'z': c['location']['z'],
                             'o': bool(not inb), 'ok': bool(hit)})
        # 地图世界包围盒：由画布四角换算
        if method == 'official':
            xs_, ys_ = [], []
            for (px, py) in ((0, 0), (W, 0), (0, H), (W, H)):
                wx, wy = p2w(px, py); xs_.append(wx); ys_.append(wy)
            wx0, wx1 = min(xs_), max(xs_); wy0, wy1 = min(ys_), max(ys_)
        else:
            wx0, wy1 = (x0 - dx * s), (y0 + dy * s)          # 画布左上
            wx1, wy0 = wx0 + W * s, wy1 - H * s              # 画布右下
        gw = max(24, int(round(W * s / CELL_WORLD)))
        gh = max(24, int(round(H * s / CELL_WORLD)))
        walk_msk = walk & ~invalid
        raw_rows = []
        offsets = [(dx_, dy_) for dx_ in (-2, 0, 2) for dy_ in (-2, 0, 2)]
        # 注意：在 numpy 数组上做逐像素索引，某些 numpy 版本会慢到不可用，
        # 这里先转成 Python list-of-bytes，逐点查询很快
        walkb = walk_msk.astype(bool).tolist()
        for r in range(gh):
            cy = int((r + .5) / gh * H)
            row = []
            for cc in range(gw):
                cx = int((cc + .5) / gw * W)
                hits = 0
                for ddx, ddy in offsets:
                    X, Y = cx + ddx, cy + ddy
                    if 0 <= X < W and 0 <= Y < H and walkb[Y][X]: hits += 1
                row.append(0 if hits >= 3 else 1)
            raw_rows.append(row)
        # 可走 = 浅灰地面(≈118) 或 站点橄榄色；只保留最大连通块（其余碎块当墙）
        ok = np.array([[raw_rows[r][c] == 0 for c in range(gw)] for r in range(gh)], dtype=bool)
        keep = np.zeros_like(ok)
        todo = ok.copy()
        best_size = 0
        for _ in range(2000):
            if not todo.any():
                break
            gy, gx = np.argwhere(todo)[0]
            comp = np.zeros_like(ok); comp[gy, gx] = True
            while True:
                grown = comp.copy()
                grown[1:, :] |= comp[:-1, :]
                grown[:-1, :] |= comp[1:, :]
                grown[:, 1:] |= comp[:, :-1]
                grown[:, :-1] |= comp[:, 1:]
                grown &= ok
                if grown.sum() == comp.sum(): break
                comp = grown
            todo &= ~comp
            if comp.sum() > best_size:
                best_size, best_mask = comp.sum(), comp
        if best_size:
            keep = best_mask
        rows_out = [''.join('0' if keep[r, c] else '1' for c in range(gw)) for r in range(gh)]
        kept_pct = int(keep.sum()) / max(1, int(ok.sum())) * 100
        print(f'    最大连通块 {kept_pct:.1f}% 的可走格', flush=True)
        _c = [c for c in m['callouts'] if c['regionName'] == 'Lobby' and c['superRegionName'] == 'A']
        if _c:
            _px, _py = w2p(_c[0]['location']['x'], _c[0]['location']['y'])
            _cc = int(_px / W * gw); _rr = int(_py / H * gh)
            print(f'    抽查 Lobby A px=({_px:.0f},{_py:.0f}) cell=({_rr},{_cc}) raw={raw_rows[_rr][_cc] if 0<=_rr<gh and 0<=_cc<gw else "oob"} out={rows_out[_rr][_cc] if 0<=_rr<gh and 0<=_cc<gw else "oob"} keep={bool(keep[_rr,_cc]) if 0<=_rr<gh and 0<=_cc<gw else 'oob'}', flush=True)
        out['maps'][slug] = {
            'slug': slug, 'name': name, 'zh': ZH.get(name, name), 'place': PLACE.get(name, ''),
            'sites': m.get('tacticalDescription') or '', 'img': disp, 'size': [W, H],
            'method': method,
            's': s, 'dx': dx, 'dy': dy, 'x0': round(x0, 1), 'y0': round(y0, 1),
            'xMultiplier': m.get('xMultiplier'), 'yMultiplier': m.get('yMultiplier'),
            'xScalarToAdd': m.get('xScalarToAdd'), 'yScalarToAdd': m.get('yScalarToAdd'),
            'calib': round(ratio, 3), 'calibrated': calibrated, 'world': [round(wx0), round(wy0), round(W * s), round(H * s)],
            'grid': {'cell': CELL_WORLD, 'w': gw, 'h': gh, 'rows': rows_out, 'keepPct': round(kept_pct, 1)},
            'callouts': callouts,
        }
    if fails:
        print('!! 标定未通过：', fails)
        sys.exit(1)
    json.dump(out, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f"✓ {len(out['maps'])} 张地图 -> data/maps/maps.json  {os.path.getsize(OUT)//1024} KB")


if __name__ == '__main__':
    main()
