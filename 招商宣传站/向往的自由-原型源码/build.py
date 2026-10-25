# -*- coding: utf-8 -*-
"""
「向往的自由」业务系统 demo —— 构建脚本（自适应路径版）

用法：
    python build.py

会把 src/ 下的 13 个组件拼装成一个单文件 HTML，输出到本目录，
文件名：向往的自由-业务系统demo-高保真版.html

依赖：仅需 Python 3。若系统有 Node.js，会额外做 JS 语法校验（没有则自动跳过）。
"""
import os
import re
import sys
import shutil
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(ROOT, '向往的自由-业务系统demo-高保真版.html')

# 拼装顺序固定，改动顺序会导致样式/脚本错位
ORDER = [
    'p1.html',    # DOCTYPE / head 开头 / meta
    'p2.html',    # 基础样式（第一段 <style>）
    'p2b.html',   # 组件样式（最后一段 <style>，以 </style></head> 结束）
    'p3.html',    # SVG symbol 图标库 + body 骨架
    'p4.html',    # 数据 DB / 四端定义 ENDS / 全局状态 S / 工具函数
    'p4b.html',   # 程序化场景插画引擎 sceneSVG（13 类场景）
    'p4c.html',   # 图表 / 徽章 / 头像 / 门票 SVG 生成器
    'p4d.html',   # 扩展数据 DB.x / 打卡逻辑
    'p5.html',    # 路由（push/pop）+ 登录流 + 右侧联动面板
    'p6.html',    # 游客端 + 游客端子页面
    'p7.html',    # 合伙人端 + 商户端
    'p8.html',    # 平台运营端 + 生态架构 / 境外准入 / 示范闭环
]

INJECT_INTO = 'p2b.html'   # 增强样式注入目标
INJECT_FILE = 'p2c.html'   # 被注入的增强样式（v2/v3/v4 累积）


def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def find_node():
    """尽量找到 node 可执行文件，找不到返回 None（语法校验降级）。"""
    cand = []
    env = os.environ.get('NODE_BIN')
    if env:
        cand.append(env)
    cand.append(shutil.which('node'))
    if sys.platform.startswith('win'):
        cand += [
            r'C:\Program Files\nodejs\node.exe',
            r'C:\Program Files (x86)\nodejs\node.exe',
        ]
    else:
        cand += ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node']
    for c in cand:
        if c and os.path.exists(c):
            return c
    return None


def main():
    if not os.path.isdir(SRC):
        print('!! 找不到 src 目录：' + SRC)
        return 1

    missing = [f for f in ORDER if not os.path.exists(os.path.join(SRC, f))]
    if missing:
        print('!! 缺少组件：' + ', '.join(missing))
        return 1

    # 把增强样式注入到 p2b 的最后一个 </style> 之前
    p2b = read(INJECT_INTO)
    p2c = read(INJECT_FILE) if os.path.exists(os.path.join(SRC, INJECT_FILE)) else ''
    if p2c:
        idx = p2b.rfind('</style>')
        if idx < 0:
            print('!! p2b.html 里找不到 </style>，注入失败')
            return 1
        p2b = p2b[:idx] + '\n' + p2c + '\n' + p2b[idx:]

    parts = []
    for name in ORDER:
        parts.append(p2b if name == INJECT_INTO else read(name))

    html = '\n'.join(parts)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)

    print('已生成：' + OUT)
    print('字符数 %s · 约 %.0f KB' % (f'{len(html):,}', len(html.encode('utf-8')) / 1024))

    # 标签配对检查
    bad = False
    for tag in ('style', 'script', 'head', 'body'):
        o = len(re.findall(r'<' + tag + r'[ >]', html))
        c = len(re.findall(r'</' + tag + r'>', html))
        if o != c:
            print('!! <%s> 不配对：开 %d 闭 %d' % (tag, o, c))
            bad = True

    # JS 语法检查（可选）
    node = find_node()
    if not node:
        print('（未找到 Node.js，跳过 JS 语法校验）')
        return 0 if not bad else 1

    scripts = re.findall(r'<script>(.*?)</script>', html, re.S)
    tmp = os.path.join(ROOT, '_syntax_check.js')
    errs = 0
    for i, s in enumerate(scripts):
        with open(tmp, 'w', encoding='utf-8') as fh:
            fh.write(s)
        r = subprocess.run([node, '--check', tmp], capture_output=True, text=True)
        if r.returncode != 0:
            errs += 1
            print('--- 第 %d 段脚本语法错误 ---' % i)
            print(r.stderr[:1200])
    try:
        os.remove(tmp)
    except OSError:
        pass

    if errs:
        print('!! JS 语法错误 %d 处' % errs)
        return 1
    print('JS 语法校验通过（%d 段）' % len(scripts))
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
