# -*- coding: utf-8 -*-
"""官方定稿 Logo（图片/2.png）落地：拆图标、出头像、入项目资产"""
from PIL import Image, ImageDraw, ImageOps
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = r"C:\Users\allenzhao\Desktop\文旅项目\wanderlust\图片\2.png"
MINI_A = r"C:\Users\allenzhao\Desktop\文旅项目\wanderlust\mini-a\assets"

im = Image.open(SRC).convert("RGBA")
W, H = im.size
# 合成到白底再找非白内容 bbox（兼容透明/白底两种情况）
flat = Image.new("RGBA", im.size, (255, 255, 255, 255))
flat.alpha_composite(im)
rgb = flat.convert("RGB")

# 图标在左侧：先取左 45% 区域的非白 bbox
left = rgb.crop((0, 0, int(W * 0.45), H))
bbox = ImageOps.invert(left.convert("L")).getbbox()
print("左侧图标 bbox:", bbox)
icon = left.crop(bbox)
iw, ih = icon.size
print("图标尺寸:", icon.size)

# --- 头像 512（full-bleed：向内收 9% 去掉圆角白角，微信圆形裁剪无白边） ---
inset = int(min(iw, ih) * 0.09)
core = icon.crop((inset, inset, iw - inset, ih - inset))
# 补成正方形（以短边为准居中）
side = min(core.size)
cx, cy = core.width // 2, core.height // 2
core_sq = core.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))
avatar = core_sq.resize((512, 512), Image.LANCZOS)
avatar.save(os.path.join(MINI_A, "logo-avatar-512.png"))
avatar.resize((144, 144), Image.LANCZOS).save(os.path.join(MINI_A, "logo-avatar-144.png"))

# --- 圆形裁剪预览 ---
mask = Image.new("L", (2048, 2048), 0)
ImageDraw.Draw(mask).ellipse([0, 0, 2048, 2048], fill=255)
big = avatar.resize((2048, 2048), Image.LANCZOS)
circ = Image.new("RGBA", (2048, 2048), (0, 0, 0, 0))
circ.paste(big, (0, 0), mask)
circ.resize((512, 512), Image.LANCZOS).save(os.path.join(BASE, "官方定稿-头像圆形裁剪预览-512.png"))

# --- 资产入项目 ---
rgb.save(os.path.join(MINI_A, "logo-lockup.png"))
icon.save(os.path.join(MINI_A, "logo-icon.png"))
rgb.save(os.path.join(BASE, "官方定稿-横版组合-2180x795.png"))
print("已写入 mini-a/assets/: logo-avatar-512.png / logo-avatar-144.png / logo-lockup.png / logo-icon.png")
