from PIL import Image, ImageDraw, ImageFilter
import numpy as np
from pathlib import Path

SS = 2
S = 1024 * SS

def col(hexstr):
    h = hexstr.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def gradient(size, stops, p0, p1):
    # stops: list of (position, (r,g,b))
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    denom = dx * dx + dy * dy
    t = ((xs - p0[0]) * dx + (ys - p0[1]) * dy) / denom
    t = np.clip(t, 0, 1)
    positions = [p[0] for p in stops]
    channels = []
    for c in range(3):
        vals = [p[1][c] for p in stops]
        channels.append(np.interp(t, positions, vals))
    rgb = np.stack(channels, axis=-1).astype(np.uint8)
    alpha = np.full((size, size, 1), 255, dtype=np.uint8)
    return Image.fromarray(np.concatenate([rgb, alpha], axis=-1), 'RGBA')

bg = gradient(
    S,
    [(0.0, col('#FCF3E5')), (0.6, col('#F2E4D0')), (1.0, col('#EAD8BE'))],
    (120*SS, 80*SS),
    (900*SS, 960*SS),
)

# Rounded square mask
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([32*SS, 32*SS, 992*SS, 992*SS], radius=224*SS, fill=255)

canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
canvas.paste(bg, (0, 0), mask)

draw = ImageDraw.Draw(canvas)

# White hairline inset
draw.rounded_rectangle(
    [49*SS, 49*SS, 975*SS, 975*SS], radius=208*SS,
    outline=(255, 255, 255, 92), width=3*SS,
)

# Disc shadow
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.ellipse([162*SS, 192*SS, 862*SS, 892*SS], fill=(106, 44, 24, 58))
shadow = shadow.filter(ImageFilter.GaussianBlur(26*SS))
canvas = Image.alpha_composite(canvas, Image.composite(shadow, Image.new('RGBA', (S, S), (0,0,0,0)), mask))

# Orange disc
disc = gradient(
    S,
    [(0.0, col('#FF9A5F')), (0.46, col('#FF7140')), (1.0, col('#DE4525'))],
    (260*SS, 180*SS),
    (800*SS, 880*SS),
)
disc_mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(disc_mask).ellipse([162*SS, 172*SS, 862*SS, 872*SS], fill=255)
canvas.paste(disc, (0, 0), disc_mask)

# Soft highlight inside the disc
highlight = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(highlight).ellipse([196*SS, 184*SS, 828*SS, 816*SS], fill=(255,255,255,14))
canvas = Image.alpha_composite(canvas, Image.composite(highlight, Image.new('RGBA', (S, S), (0,0,0,0)), disc_mask))

draw = ImageDraw.Draw(canvas)
ink = (42, 27, 19, 255)
cream = (255, 245, 232, 255)

# Open loop ring: gap on the upper-right
bbox = [227*SS, 227*SS, 797*SS, 797*SS]
draw.arc(bbox, start=35, end=324, fill=ink, width=82*SS)
import math
for angle in (35,):
    a = math.radians(angle)
    cx = 512*SS + 285*SS*math.cos(a)
    cy = 512*SS + 285*SS*math.sin(a)
    draw.ellipse([cx-41*SS, cy-41*SS, cx+41*SS, cy+41*SS], fill=ink)

# Arrowhead continuing the loop clockwise into the gap
a = math.radians(324)
cx = 512*SS + 285*SS*math.cos(a)
cy = 512*SS + 285*SS*math.sin(a)
tx, ty = -math.sin(a), math.cos(a)
nx, ny = -math.cos(a), -math.sin(a)
base_x, base_y = cx - tx*18*SS, cy - ty*18*SS
tip_x, tip_y = cx + tx*112*SS, cy + ty*112*SS
half = 84*SS
draw.polygon([
    (tip_x, tip_y),
    (base_x + nx*half, base_y + ny*half),
    (base_x - nx*half, base_y - ny*half),
], fill=ink)

# Play triangle with a softly rounded outline
triangle = [(448*SS, 405*SS), (674*SS, 522*SS), (448*SS, 639*SS)]
draw.polygon(triangle, fill=cream)

# Clip everything to the app tile
clipped = Image.new('RGBA', (S, S), (0, 0, 0, 0))
clipped.paste(canvas, (0, 0), mask)
icon = clipped.resize((1024, 1024), Image.LANCZOS)
icon.save(Path(__file__).resolve().parent / 'source.png')
print('saved', icon.size)
