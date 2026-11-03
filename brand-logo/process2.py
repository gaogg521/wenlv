# -*- coding: utf-8 -*-
"""第二轮创意 Logo 后处理：C/D/E 图形标 + F 书法字标 + 应用图标"""
from PIL import Image, ImageDraw, ImageFont, ImageOps
import os

BASE = os.path.dirname(os.path.abspath(__file__))
NAVY = (36, 59, 85)
DARKBG = (21, 34, 48)
ORANGE = (232, 119, 34)

SRC = {
    "C": os.path.join(BASE, "Flat_vector_logo_mark__an_abst_2026-11-03T12-35-01.png"),
    "D": os.path.join(BASE, "Flat_vector_logo_mark_on_pure__2026-11-03T12-35-18.png"),
    "E": os.path.join(BASE, "Flat_vector_logo_mark_on_pure__2026-11-03T12-35-31.png"),
    "F": os.path.join(BASE, "Chinese_logotype_wordmark__exa_2026-11-03T12-35-54.png"),
}
NAMES = {"C": "摩天轮徽章", "D": "滑梯纸飞机", "E": "轨道地图钉", "F": "书法字标"}

# ---------- 1) C 去水印（右下角，填充附近深蓝背景） ----------
c = Image.open(SRC["C"]).convert("RGB")
samples = [c.getpixel(p) for p in [(650, 980), (720, 1000), (500, 995), (930, 900)]]
avg = tuple(sum(s[i] for s in samples) // len(samples) for i in range(3))
ImageDraw.Draw(c).rectangle([830, 930, 1024, 1024], fill=avg)
c.save(os.path.join(BASE, "logo-C-摩天轮徽章-1024.png"))

# ---------- 2) F 字标：背景提纯为纯白 + 裁紧 + 配口号 ----------
f = Image.open(SRC["F"]).convert("RGB")
px = f.load()
for y in range(f.height):
    for x in range(f.width):
        r, g, b = px[x, y]
        if r > 228 and g > 228 and b > 228:
            px[x, y] = (255, 255, 255)
# 裁到内容紧贴
bbox = ImageOps.invert(f.convert("L")).getbbox()
pad = 40
f_tight = f.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                  min(f.width, bbox[2] + pad), min(f.height, bbox[3] + pad)))
f_tight.save(os.path.join(BASE, "logo-F-书法字标-纯白.png"))
# 透明版
f_alpha = f_tight.convert("RGBA")
d2 = f_alpha.load()
for y in range(f_alpha.height):
    for x in range(f_alpha.width):
        r, g, b, a = d2[x, y]
        if r > 240 and g > 240 and b > 240:
            d2[x, y] = (255, 255, 255, 0)
f_alpha.save(os.path.join(BASE, "logo-F-书法字标-透明.png"))
# 加口号版（白底横幅）
slogan_f = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 52)
s = "世界就是我的游乐场 · 主题游 · 预约制"
W = f_tight.width + 160
H = f_tight.height + 200
banner = Image.new("RGB", (W, H), (255, 255, 255))
banner.paste(f_tight, (80, 60))
dd = ImageDraw.Draw(banner)
sb = dd.textbbox((0, 0), s, font=slogan_f)
sw = sb[2] - sb[0]
dd.text(((W - sw) // 2, H - 130), s, font=slogan_f, fill=NAVY)
ly = H - 150
dd.rectangle([(W - 240) // 2, ly, (W - 240) // 2 + 240, ly + 6], fill=ORANGE)
banner.save(os.path.join(BASE, "logo-F-字标横幅-配口号.png"))

# ---------- 3) C/D/E 尺寸族 + 圆形预览 ----------
def make_sizes(src, prefix):
    im = Image.open(src).convert("RGB")
    for size, name in [(512, "小程序头像-512"), (256, "头像-256"), (144, "头像-144")]:
        im.resize((size, size), Image.LANCZOS).save(os.path.join(BASE, f"{prefix}-{name}.png"))
    big = im.resize((2048, 2048), Image.LANCZOS)
    mask = Image.new("L", (2048, 2048), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 2048, 2048], fill=255)
    out = Image.new("RGBA", (2048, 2048), (0, 0, 0, 0))
    out.paste(big, (0, 0), mask)
    out.resize((512, 512), Image.LANCZOS).save(os.path.join(BASE, f"{prefix}-圆形裁剪预览-512.png"))

make_sizes(os.path.join(BASE, "logo-C-摩天轮徽章-1024.png"), "logo-C")
make_sizes(SRC["D"], "logo-D")
make_sizes(SRC["E"], "logo-E")
Image.open(SRC["D"]).convert("RGB").save(os.path.join(BASE, "logo-D-滑梯纸飞机-1024.png"))
Image.open(SRC["E"]).convert("RGB").save(os.path.join(BASE, "logo-E-轨道地图钉-1024.png"))

# ---------- 4) 应用图标（圆角方 22% + 深色底变体） ----------
def app_icon(src, out_name, bg=None):
    im = Image.open(src).convert("RGB")
    if bg:
        base = Image.new("RGB", (1024, 1024), bg)
        icon = im.resize((760, 760), Image.LANCZOS)
        base.paste(icon, (132, 132), _white_alpha(icon))
        im = base
    im = im.resize((1024, 1024), Image.LANCZOS) if im.size != (1024, 1024) else im
    mask = Image.new("L", (4096, 4096), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 4096, 4096], radius=900, fill=255)
    mask = mask.resize((1024, 1024), Image.LANCZOS)
    out = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    out.paste(im.resize((1024, 1024), Image.LANCZOS), (0, 0), mask)
    out.save(os.path.join(BASE, out_name))

def _white_alpha(im):
    m = Image.new("L", im.size, 255)
    mm = m.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = im.getpixel((x, y))
            if r > 240 and g > 240 and b > 240:
                mm[x, y] = 0
    return m

app_icon(os.path.join(BASE, "logo-C-摩天轮徽章-1024.png"), "app图标-C-圆角方-512.png")
app_icon(SRC["E"], "app图标-E-深蓝底圆角方-512.png", bg=DARKBG)
app_icon(SRC["D"], "app图标-D-白底圆角方-512.png", bg=(255, 255, 255))

for f in sorted(os.listdir(BASE)):
    if f.startswith(("logo-", "app")):
        print(" -", f)
