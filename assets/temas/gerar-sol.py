# Fundo do tema Du'Sol (styles-dusol.css): um pedaço grande do Sol na esquerda (~20% da largura) e o espaço no resto.
# Gera assets/temas/dusol-sol.webp (2560x1440). Uso: python assets/temas/gerar-sol.py  (precisa de numpy e opencv-python)
import numpy as np, cv2, sys
rng = np.random.default_rng(7)
W, H = 2560, 1440
import os
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dusol-sol.webp')

def noise(scale, w=W, h=H):
    sw, sh = max(2, int(w / scale)), max(2, int(h / scale))
    n = rng.standard_normal((sh, sw)).astype(np.float32)
    return cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC)

def fbm(scales, weights):
    acc = np.zeros((H, W), np.float32)
    for s, wgt in zip(scales, weights):
        acc += noise(s) * wgt
    return acc / sum(weights)

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
R = 0.78 * H
cx, cy = 0.205 * W - R, 0.52 * H
d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
r = d / R
inside = r < 1

img = np.zeros((H, W, 3), np.float32)  # BGR, 0..1

# ---------- Espaço: preto quente, um véu de poeira e estrelas ----------
dust = np.clip(fbm([420, 180, 70], [1, .6, .3]), -2, 2)
haze = (0.010 + 0.010 * dust) * np.exp(-((xx - 0.62 * W) ** 2 / (0.5 * W) ** 2 + (yy - 0.35 * H) ** 2 / (0.45 * H) ** 2))
img[..., 2] += haze * 1.0
img[..., 1] += haze * 0.55
img[..., 0] += haze * 0.35
img += 0.006  # nunca preto puro
n_stars = 2600
sx = rng.uniform(0, W, n_stars); sy = rng.uniform(0, H, n_stars)
mag = rng.power(0.25, n_stars)  # quase todas fracas
stars = np.zeros((H, W), np.float32)
for x, y, m in zip(sx, sy, mag):
    ix, iy = int(x), int(y)
    stars[iy, ix] += 0.15 + 0.85 * m ** 3
for _ in range(14):  # umas poucas grandes, com brilho em volta
    x, y = int(rng.uniform(0.3 * W, W - 5)), int(rng.uniform(5, H - 5))
    stars[y, x] += 1.6
stars = cv2.GaussianBlur(stars, (0, 0), 0.7) * 4.0 + cv2.GaussianBlur(stars, (0, 0), 3.0) * 0.9
tint = rng.uniform(0, 1, (H, W)).astype(np.float32)
img[..., 0] += stars * (0.85 + 0.15 * tint)
img[..., 1] += stars * 0.92
img[..., 2] += stars * (0.95 + 0.05 * (1 - tint))
img[inside] *= 0  # atrás do sol não tem estrela

# ---------- Coroa e brilho em volta do disco ----------
out_r = np.maximum(r - 1, 0)
glow_near = np.exp(-np.abs(r - 1) / 0.02)
glow_far = np.exp(-out_r / 0.16) * (~inside)
glow_wide = np.exp(-out_r / 0.5) * (~inside)
ray = 1 + 0.35 * np.clip(fbm([60, 25], [1, .5]), -2, 2)  # o brilho não é liso
for g, k, col in ((glow_near, 1.1, (0.20, 0.62, 1.0)), (glow_far * ray, 0.45, (0.06, 0.38, 1.0)), (glow_wide, 0.12, (0.02, 0.18, 0.75))):
    for c in range(3):
        img[..., c] += g * k * col[c]

# ---------- Protuberâncias: arcos de plasma presos à borda ----------
prom = np.zeros((H, W), np.float32)
for ang in rng.uniform(-0.75, 0.75, 9):
    size = rng.uniform(0.03, 0.09)
    px, py = cx + R * np.cos(ang), cy + R * np.sin(ang)
    if not (-50 <= px < W and -50 <= py < H + 50): continue
    a = size * R
    for k in range(5):  # vários fios finos, um pouco tortos, formando a pluma
        rx, ry = a * rng.uniform(0.5, 1.0), a * rng.uniform(0.3, 0.7)
        st, en = rng.uniform(-100, -60), rng.uniform(60, 100)
        cv2.ellipse(prom, (int(px + rng.normal(0, a * .1)), int(py + rng.normal(0, a * .1))), (int(rx), int(ry)), np.degrees(ang), st, en, rng.uniform(.25, .6), 2, cv2.LINE_AA)
prom_tex = np.clip(0.5 + 0.8 * fbm([14, 6], [1, .7]), 0, 1.5)
prom = cv2.GaussianBlur(prom, (0, 0), 5) * 2.2 * prom_tex * (~inside)
img[..., 2] += prom * 1.0
img[..., 1] += prom * 0.32
img[..., 0] += prom * 0.08

# ---------- Disco: granulação, escurecimento na borda, manchas e fáculas ----------
mu = np.sqrt(np.clip(1 - r ** 2, 0, 1))
limb = 0.30 + 0.70 * mu ** 0.55
gran = fbm([7, 3.5, 14], [1, .6, .5])
cells = 1 - np.abs(np.clip(fbm([9, 4.5], [1, .5]), -1.5, 1.5))  # bordas das células mais escuras
surf = 1 + 0.10 * gran + 0.08 * (cells - 0.5)
big = 1 + 0.06 * fbm([160, 80], [1, .6])  # manchas grandes de brilho
spots = np.ones((H, W), np.float32)
for ang, rr, s in ((-0.32, 0.72, 0.030), (-0.28, 0.69, 0.012), (0.18, 0.80, 0.022), (0.44, 0.62, 0.016), (-0.05, 0.55, 0.010)):
    sxp, syp = cx + rr * R * np.cos(ang), cy + rr * R * np.sin(ang)
    dd = np.sqrt((xx - sxp) ** 2 + (yy - syp) ** 2) / (s * R)
    spots *= 1 - 0.55 * np.exp(-(dd / 1.6) ** 2) - 0.35 * np.exp(-(dd / 0.6) ** 2)
fac = np.clip(fbm([30, 12], [1, .6]), 0, 2) * (1 - mu) * 0.25  # fáculas claras perto da borda
b = np.clip(limb * surf * big * spots + fac, 0, 1.3)
# Cor pelo brilho: vermelho-alaranjado escuro → laranja → amarelo → quase branco
stops = np.array([0.0, 0.35, 0.6, 0.85, 1.05, 1.3])
cols = np.array([[0.01, 0.04, 0.32], [0.02, 0.18, 0.80], [0.04, 0.38, 1.0], [0.10, 0.62, 1.0], [0.40, 0.86, 1.0], [0.75, 0.96, 1.0]])
disk = np.stack([np.interp(b, stops, cols[:, c]) for c in range(3)], -1)
edge = np.clip((1 - r) * R / 2.0, 0, 1)[..., None]  # borda suave (2 px)
img = img * (1 - edge * inside[..., None]) + disk * edge * inside[..., None]

# ---------- Saída ----------
img = np.clip(img, 0, 1)
img = (img ** (1 / 1.05) * 255).astype(np.uint8)
img = cv2.GaussianBlur(img, (0, 0), 0.4)
cv2.imwrite(out, img, [cv2.IMWRITE_WEBP_QUALITY, 80])
print(out, os.path.getsize(out) // 1024, 'KB')
