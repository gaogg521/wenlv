# -*- coding: utf-8 -*-
"""品牌 Logo 后处理：去水印、尺寸族、圆形预览、网站横版字标"""
from PIL import Image, ImageDraw, ImageFont, ImageOps
import os

BASE = os.path.dirname(os.path.abspath(__file__))
NAVY = (36, 59, 85)
ORANGE = (232, 119, 34)

A = os.path.join(BASE, "Minimalist_flat_vector_app_log_2026-11-03T12-26-38.png")
B = os.path.join(BASE, "Minimalist_line_art_logo_icon__2026-11-03T12-26-54.png")

# ---------- 1) A 版去水印（右下角填充为附近背景色） ----------
a = Image.open(A).convert("RGB")
# 采样水印左侧同一水平线上的干净背景色，取多点平均
samples = [a.getpixel((x, y)) for x, y in [(700, 985), (750, 1000), (500, 990), (600, 1010), (930, 900)]]
avg = tuple(sum(c[i] for c in samples) // len(samples) for i in range(3))
d = ImageDraw.Draw(a)
d.rectangle([840, 935, 1024, 1024], fill=avg)  # 覆盖右下角水印区
a.save(os.path.join(BASE, "logo-A-徽章版-1024.png"))

# ---------- 2) 尺寸族 ----------
def make_sizes(src, prefix):
    im = Image.open(src).convert("RGB")
    for size, name in [(512, "小程序头像-512"), (256, "头像-256"), (144, "头像-144")]:
        im.resize((size, size), Image.LANCZOS).save(
            os.path.join(BASE, f"{prefix}-{name}.png"))
    # 圆形裁剪预览（4x 超采样抗锯齿）
    big = im.resize((2048, 2048), Image.LANCZOS)
    mask = Image.new("L", (2048, 2048), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 2048, 2048], fill=255)
    out = Image.new("RGBA", (2048, 2048), (0, 0, 0, 0))
    out.paste(big, (0, 0), mask)
    out.resize((512, 512), Image.LANCZOS).save(
        os.path.join(BASE, f"{prefix}-圆形裁剪预览-512.png"))

make_sizes(os.path.join(BASE, "logo-A-徽章版-1024.png"), "logo-A")
make_sizes(B, "logo-B")
Image.open(B).convert("RGB").save(os.path.join(BASE, "logo-B-线条版-1024.png"))

# ---------- 3) 网站横版字标（B 图标 + 中文文字） ----------
def font(path, size):
    return ImageFont.truetype(path, size, index=0)

title_f = font(r"C:\Windows\Fonts\msyhbd.ttc", 128)
slogan_f = font(r"C:\Windows\Fonts\msyh.ttc", 46)

W, H = 1800, 600
canvas = Image.new("RGB", (W, H), (255, 255, 255))
icon = Image.open(B).convert("RGB").resize((520, 520), Image.LANCZOS)
canvas.paste(icon, (40, 40))

t = "向往的自由"
s = "世界就是我的游乐场 · 主题游 · 预约制"
tw = canvas.convert("RGB")
dt = ImageDraw.Draw(tw)
tb = dt.textbbox((0, 0), t, font=title_f)
sb = dt.textbbox((0, 0), s, font=slogan_f)
tx = 620
ty = (H - (tb[3] - tb[1]) - 46 - 26) // 2 - 10
dt.text((tx, ty), t, font=title_f, fill=NAVY)
dt.text((tx + 4, ty + (tb[3] - tb[1]) + 46), s, font=slogan_f, fill=ORANGE)
# 标题下一条橙色短横线，呼应品牌色
line_y = ty + (tb[3] - tb[1]) + 18
dt.rectangle([tx + 2, line_y, tx + 190, line_y + 8], fill=ORANGE)
tw.save(os.path.join(BASE, "logo-横版字标-网站用.png"))

# 深色底横版（网站深色 hero 用）
dark = Image.new("RGB", (W, H), (21, 34, 48))
di = Image.open(B).convert("RGB")
# 白底图标放到深色底：把接近白色的像素转成深色底色
px = di.load()
for y in range(di.height):
    for x in range(di.width):
        r, g, b = px[x, y]
        if r > 235 and g > 235 and b > 235:
            px[x, y] = (21, 34, 48)
dark.paste(di.resize((520, 520), Image.LANCZOS), (40, 40))
dd = ImageDraw.Draw(dark)
dd.text((tx, ty), t, font=title_f, fill=(255, 255, 255))
dd.text((tx + 4, ty + (tb[3] - tb[1]) + 46), s, font=slogan_f, fill=ORANGE)
dd.rectangle([tx + 2, line_y, tx + 190, line_y + 8], fill=ORANGE)
dark.save(os.path.join(BASE, "logo-横版字标-深色底.png"))

print("完成，输出文件：")
for f in sorted(os.listdir(BASE)):
    print(" -", f)
