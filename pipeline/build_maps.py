#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 valorant-api.com 的地图数据 + 俯视图转成可跑的跑图数据。

关键：图片上的像素坐标与地图世界坐标不是简单线性对应（官方 displayIcon 与
xMultiplier/xScalarToAdd 用的不是同一套画布）。所以这里不猜偏移，而是：
  在「地图实心区域」里搜索一个平移量 (dx,dy)，让官方点位坐标命中实心区的比例最大。
  搜索步长 2px，范围 ±45% 画布。命中率 ≥ 90% 才算通过（断言，不通过就报错）。

输出 data/maps/maps.json（含每个地图的实心网格、点位、标定后的画布参数）
"""
import json, os, sys
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data/maps/valorant-api-maps.json')
IMG = os.path.join(ROOT, 'web/assets/img/maps')
OUT = os.path.join(ROOT, 'data/maps/maps.json')

ZH = {'Ascent':'亚海悬城','Split':'裂变峡谷','Fracture':'霓虹町','Bind':'源工重镇','Breeze':'微风岛屿',
      'Abyss':'幽邃地窟','Lotus':'莲华古城','Sunset':'日落之城','Pearl':'深海明珠','Summit':'巅峰',
      'Icebox':'森寒冬港','Corrode':'锈蚀','Haven':'隐世修所'}
PLACE = {'Ascent':'意大利·威尼斯','Split':'日本·东京','Fracture':'美国新墨西哥','Bind':'摩洛哥·拉巴特',
         'Breeze':'百慕大三角','Abyss':'大西洋深海','Lotus':'印度·喜马拉雅','Sunset':'美国·洛杉矶',
         'Pearl':'葡萄牙·里斯本','Summit':'中国·青藏高原','Icebox':'俄罗斯·摩尔曼斯克',
         'Corrode':'法国·巴黎','Haven':'不丹·帕罗'}
CELL_WORLD = 120.0     # 网格边长（世界单位），约等于角色可站立的一格


def load_mask(slug):
    im = Image.open(os.path.join(IMG, f'{slug}-display.png')); im.load(); im = im.convert('RGBA')
    a = np.array(im)
    H, W = a.shape[:2]
    alpha = a[:, :, 3]
    lum = a[:, :, :3].mean(axis=2)
    r, g, b = a[:, :, 0].astype(int), a[:, :, 1].astype(int), a[:, :, 2].astype(int)
    teal = (g > 120) & (g - r > 60) & (g - b > 20)      # 传送门连线
    olive = (r > 140) & (r < 200) & (g > 150) & (b < 150) & (abs(r - g) < 40)  # 站点高亮
    solid = (alpha > 20) & (lum < 240) & ~teal & ~olive
    return solid, W, H


def hit_ratio(pts, solid, W, H):
    hit = 0
    for (u, v) in pts:
        x, y = int(round(u)), int(round(v))
        if 0 <= x < W and 0 <= y < H and solid[y, x]:
            hit += 1
    return hit / max(1, len(pts))


def calibrate(m, solid, W, H):
    """在平移量上搜索，最大化「点位命中实心区」的比例。"""
    pts0 = [((c['location']['x'] * m['xMultiplier'] + m['xScalarToAdd']) * W,
             1 - (c['location']['y'] * m['yMultiplier'] + m['yScalarToAdd']) * H) for c in m['callouts']]
    best = (0, 0, 0)
    rng = range(-int(H * 0.45), int(H * 0.45) + 1, 2)
    for dy in rng:
        for dx in rng:
            pts = [(u + dx, v + dy) for (u, v) in pts0]
            r = hit_ratio(pts, solid, W, H)
            if r > best[0]:
                best = (r, dx, dy)
    r, dx, dy = best
    # 以 X 为基准，求两轴缩放：用点位命中区间估计
    return r, dx, dy


def main():
    raw = json.load(open(RAW))
    out = {'_meta': {'source': 'valorant-api.com/v1/maps', 'cellWorld': CELL_WORLD,
                     'canvas': 'calibrated：px = (x*xMultiplier+xScalarToAdd)*W + dx'},
           'maps': {}}
    fails = []
    for m in raw['data']:
        name = m['displayName']
        slug = name.lower().replace(' ', '-')
        disp = f'assets/img/maps/{slug}-display.png'
        if not os.path.exists(os.path.join(ROOT, 'web', disp)):
            print(f'  跳过（无图）{name}'); continue
        solid, W, H = load_mask(slug)
        r, dx, dy = calibrate(m, solid, W, H)
        # 标定后再做一次精细搜索（步长 1，范围 ±4）
        bestr, bdx, bdy = r, dx, dy
        for ddy in range(dy - 4, dy + 5):
            for ddx in range(dx - 4, dx + 5):
                pts = [((c['location']['x'] * m['xMultiplier'] + m['xScalarToAdd']) * W + ddx,
                        1 - (c['location']['y'] * m['yMultiplier'] + m['yScalarToAdd']) * H + ddy) for c in m['callouts']]
                rr = hit_ratio(pts, solid, W, H)
                if rr > bestr:
                    bestr, bdx, bdy = rr, ddx, ddy
        print(f"  {name:<9} 命中 {bestr*100:5.1f}%  偏移 dx={bdx} dy={bdy}", flush=True)
        if bestr < 0.9:
            fails.append((name, bestr, bdx, bdy))

        def w2p(x, y):
            return ((x * m['xMultiplier'] + m['xScalarToAdd']) * W + bdx,
                    1 - (y * m['yMultiplier'] + m['yScalarToAdd']) * H + bdy)

        pts = []
        for c in m['callouts']:
            px, py = w2p(c['location']['x'], c['location']['y'])
            pts.append({'n': c['regionName'], 's': c['superRegionName'],
                        'u': round(px / W, 4), 'v': round(py / H, 4),
                        'x': c['location']['x'], 'y': c['location']['y'], 'z': c['location']['z'],
                        'o': not (0 <= px <= W and 0 <= py <= H)})

        # 世界包围盒：用「实心像素」反推，并叠加点位外扩
        ys, xs = np.where(solid)
        wxs, wys = [], []
        for c in m['callouts']:
            wxs.append(c['location']['x']); wys.append(c['location']['y'])
        def p2w(px, py):
            return (((px - bdx) / W) - m['xScalarToAdd']) / m['xMultiplier'], \
                   ((1 - (py - bdy) / H) - m['yScalarToAdd']) / m['yMultiplier']
        x0, y0 = p2w(xs.min(), ys.max())   # 图像左下
        x1, y1 = p2w(xs.max(), ys.min())   # 图像右上
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        pad = 400
        x0, x1, y0, y1 = x0 - pad, x1 + pad, y0 - pad, y1 + pad
        gw = max(24, int(round((x1 - x0) / CELL_WORLD)))
        gh = max(24, int(round((y1 - y0) / CELL_WORLD)))
        grid = []
        for rr in range(gh):
            row = []
            for cc in range(gw):
                wx = x0 + (cc + .5) / gw * (x1 - x0)
                wy = y0 + (rr + .5) / gh * (y1 - y0)
                px, py = w2p(wx, wy)
                blocked = False
                for ddy in (-2, 0, 2):
                    for ddx in (-2, 0, 2):
                        X, Y = int(px) + ddx, int(py) + ddy
                        if 0 <= X < W and 0 <= Y < H and solid[Y, X]:
                            blocked = True; break
                    if blocked: break
                row.append(1 if blocked else 0)
            grid.append(''.join(map(str, row)))
        out['maps'][slug] = {
            'slug': slug, 'name': name, 'zh': ZH.get(name, name), 'place': PLACE.get(name, ''),
            'sites': m.get('tacticalDescription') or '', 'img': disp, 'size': [W, H],
            'xMultiplier': m['xMultiplier'], 'yMultiplier': m['yMultiplier'],
            'xScalarToAdd': m['xScalarToAdd'], 'yScalarToAdd': m['yScalarToAdd'],
            'dx': bdx, 'dy': bdy, 'calib': round(bestr, 3),
            'world': [round(x0), round(y0), round(x1 - x0), round(y1 - y0)],
            'grid': grid, 'callouts': pts,
        }
    if fails:
        print('!! 标定未达标：', fails)
        sys.exit(1)
    json.dump(out, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f"✓ {len(out['maps'])} 张地图 -> data/maps/maps.json {os.path.getsize(OUT)//1024} KB")

if __name__ == '__main__':
    main()
