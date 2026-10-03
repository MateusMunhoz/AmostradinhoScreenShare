# Fundo do tema Di'Luna (styles-diluna.css): um pedaço grande da Lua cheia na esquerda (~20% da largura) e o espaço
# no resto, em branco, ciano, azul e roxo, com algumas faíscas de luz no céu. Mesma geometria do Sol do Du'Sol
# (gerar-sol.py): a borda fica a 20,5% da largura, para o CSS saber onde ela está.
# Gera assets/temas/diluna-lua.webp (2560x1440). Uso: python assets/temas/gerar-lua.py  (precisa de numpy e opencv-python)
import numpy as np, cv2, sys, os
rng = np.random.default_rng(11)
W, H = 2560, 1440
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'diluna-lua.webp')

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
r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / R
inside = r < 1
img = np.zeros((H, W, 3), np.float32)  # BGR, 0..1

# ---------- Espaço: azul-noite, véus roxo e azul, estrelas ----------
img[...] = (0.022, 0.010, 0.008)
neb = np.clip(fbm([500, 220, 90], [1, .6, .3]), -2, 2)
for (px, py, sx, sy, col, k) in ((0.70, 0.30, 0.45, 0.40, (0.55, 0.12, 0.35), 0.06), (0.88, 0.78, 0.35, 0.35, (0.60, 0.30, 0.10), 0.05),
                                  (0.45, 0.85, 0.40, 0.25, (0.45, 0.25, 0.20), 0.035)):
    g = np.exp(-((xx - px * W) ** 2 / (sx * W) ** 2 + (yy - py * H) ** 2 / (sy * H) ** 2)) * (1 + 0.5 * neb)
    for c in range(3): img[..., c] += g * k * col[c] / max(col)
stars = np.zeros((H, W), np.float32)
n = 3000
for x, y, m in zip(rng.uniform(0, W, n), rng.uniform(0, H, n), rng.power(0.25, n)):
    stars[int(y), int(x)] += 0.15 + 0.85 * m ** 3
stars = cv2.GaussianBlur(stars, (0, 0), 0.7) * 4.0 + cv2.GaussianBlur(stars, (0, 0), 3.0) * 0.9
tint = rng.uniform(0, 1, (H, W)).astype(np.float32)
img[..., 0] += stars * 1.0
img[..., 1] += stars * (0.88 + 0.1 * tint)
img[..., 2] += stars * (0.80 + 0.15 * (1 - tint))
# Faíscas: estrelas de quatro pontas, em ciano, branco e lilás, espalhadas pelo céu
spark = np.zeros((H, W, 3), np.float32)
for _ in range(26):
    x, y = int(rng.uniform(0.30 * W, W - 20)), int(rng.uniform(20, H - 20))
    L = int(rng.uniform(8, 34)); a = rng.uniform(0.35, 1.0)
    col = [(1.0, 0.95, 0.55), (1.0, 1.0, 1.0), (1.0, 0.55, 0.75)][rng.integers(0, 3)]  # BGR: ciano, branco, lilás
    layer = np.zeros((H, W), np.float32)
    cv2.line(layer, (x - L, y), (x + L, y), a, 1, cv2.LINE_AA)
    cv2.line(layer, (x, y - L), (x, y + L), a, 1, cv2.LINE_AA)
    cv2.circle(layer, (x, y), 2, a * 1.4, -1, cv2.LINE_AA)
    layer = cv2.GaussianBlur(layer, (0, 0), 0.8) + cv2.GaussianBlur(layer, (0, 0), 5) * 0.8
    for c in range(3): spark[..., c] += layer * col[c]
img += spark
img[inside] *= 0

# ---------- Halo: branco colado na borda, ciano e azul em volta, roxo bem largo ----------
out_r = np.maximum(r - 1, 0)
near = np.exp(-np.abs(r - 1) / 0.015)
mid = np.exp(-out_r / 0.10) * (~inside)
wide = np.exp(-out_r / 0.45) * (~inside)
veil = 1 + 0.3 * np.clip(fbm([80, 35], [1, .5]), -2, 2)
for g, k, col in ((near, 0.9, (1.0, 0.98, 0.9)), (mid * veil, 0.42, (1.0, 0.78, 0.35)), (wide, 0.16, (0.95, 0.35, 0.55))):
    for c in range(3): img[..., c] += g * k * col[c]

# ---------- Disco: mares escuros, crateras em relevo, luz vinda da direita (do lado do espaço) ----------
x0, x1 = 0, int(cx + R) + 4  # só a parte que aparece
sub = np.s_[:, x0:x1]
hx, hy = xx[sub], yy[sub]
height = 0.6 * fbm([90, 40, 16], [1, .6, .4])[sub] * 0.04
for _ in range(800):
    rc = float(np.clip(rng.pareto(2.2) * 5 + 3, 3, 95))
    ang = rng.uniform(-np.pi / 2, np.pi / 2); rr = np.sqrt(rng.uniform(0, 1)) * R
    ccx, ccy = cx + rr * np.cos(ang), cy + rr * np.sin(ang)
    if not (-rc <= ccx < x1 + rc and -rc <= ccy < H + rc): continue
    xa, xb = int(max(0, ccx - 1.6 * rc)), int(min(x1, ccx + 1.6 * rc)); ya, yb = int(max(0, ccy - 1.6 * rc)), int(min(H, ccy + 1.6 * rc))
    if xa >= xb or ya >= yb: continue
    d = np.sqrt((hx[ya:yb, xa:xb] - ccx) ** 2 + (hy[ya:yb, xa:xb] - ccy) ** 2) / rc
    bowl = np.where(d < 1, -(1 - d ** 2), 0) * 0.5
    rim = np.exp(-((d - 1) / 0.22) ** 2) * 0.25
    height[ya:yb, xa:xb] += (bowl + rim) * rc * 0.012
gy, gx = np.gradient(height)
shade = np.clip(1 + 6.0 * (gx * 0.8 - gy * 0.35), 0.55, 1.45)  # luz da direita e um pouco de cima
maria = cv2.GaussianBlur(np.clip(fbm([340, 170, 80], [1, .6, .3])[sub], -3, 3), (0, 0), 6)
mare = 1 / (1 + np.exp(-(maria - 0.25) * 5))
albedo = 0.82 + 0.025 * cv2.GaussianBlur(fbm([6, 3], [1, .6]), (0, 0), 1.2)[sub] + 0.05 * fbm([40, 18], [1, .6])[sub] - 0.32 * mare
rs = r[sub]; mu = np.sqrt(np.clip(1 - rs ** 2, 0, 1))
lum = np.clip(albedo * shade * (0.80 + 0.20 * mu ** 0.4), 0, 1.25)
moon = np.stack([lum * 1.00, lum * 0.95, lum * 0.88], -1)  # um branco frio
moon += np.stack([(1 - lum) * 0.10, (1 - lum) * 0.04, (1 - lum) * 0.06], -1)  # sombras puxando para o azul e o roxo
glow_in = ((1 - mu) ** 3)[..., None] * np.array([0.30, 0.22, 0.06], np.float32)  # a borda acesa por dentro, em ciano
moon += glow_in
edge = np.clip((1 - rs) * R / 2.0, 0, 1)[..., None] * inside[sub][..., None]
img[sub] = img[sub] * (1 - edge) + moon * edge

img = np.clip(img, 0, 1)
img = (img ** (1 / 1.05) * 255).astype(np.uint8)
img = cv2.GaussianBlur(img, (0, 0), 0.4)
cv2.imwrite(out, img, [cv2.IMWRITE_WEBP_QUALITY, 80])
print(out, os.path.getsize(out) // 1024, 'KB')
