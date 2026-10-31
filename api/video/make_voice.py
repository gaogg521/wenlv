#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
男声旁白合成（edge-tts · 云健 zh-CN-YunjianNeural）
—— 音色取舍：云健（低沉、有力量）用于宣传片；云扬是新闻播报腔，念"你不用换链"会像播天气。
—— 每条都测实际时长：超窗口就 atempo 微提，避免撞到下一幕（这是配音与画面错位的第一大原因）。
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import wave

import edge_tts
import numpy as np

SR = 48000
TOTAL = 53.0
VOICE = 'zh-CN-YunjianNeural'
RATE = '+12%'     # V4：15 句装进 53 秒，语速再提
PITCH = '-2Hz'    # 保留低沉力量感

FFMPEG = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'))

# (起, 止, 文本)  —— 止 = 这句最迟必须说完的时刻，留 0.3s 呼吸
# V4 · 15 幕 · 53 秒 · 与 stage-v.html 场景轴对齐；台词大量取自宣传网站定稿文案
LINES = [
    (0.4, 3.3, '每一次旅行，都值得写上链。'),
    (3.5, 6.7, '好评会刷，销量会刷，哈希不会。'),
    (6.9, 9.9, '八大主题，总有一款是你。'),
    (10.1, 13.1, '一个身份，走遍所有旅程。'),
    (13.3, 16.3, '下单瞬间，哈希指纹生成。'),
    (16.5, 19.5, '千笔订单，一个根概括全部。'),
    (19.7, 22.7, '借贷恒等才封账，根根相连。'),
    (22.9, 26.9, '一键锚定：链数根、蚂蚁链、腾讯BaaS。'),
    (27.2, 30.0, '一条证明，自证在链。'),
    (30.2, 33.2, '本地验签，数据主权还给游客。'),
    (33.4, 36.5, '一单旅行，让整个链条都被善待。'),
    (36.7, 40.1, '五项分账，守恒恒等，账实一致。'),
    (40.3, 43.3, '徽章藏品权益，一键上链。'),
    (43.5, 46.9, '去破案、去赴宴，去认识新朋友。'),
    (47.1, 52.6, '我们全力构建一个文旅的新生态。世界，就是我的游乐场。'),
]

os.makedirs('audio', exist_ok=True)


def probe_duration(path):
    """用 ffmpeg 读时长（ffmpeg-static 不带 ffprobe）"""
    r = subprocess.run([FFMPEG, '-hide_banner', '-i', path], capture_output=True, text=True, encoding='utf-8', errors='ignore')
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+\.\d+)', r.stderr)
    if not m:
        raise RuntimeError('读不到时长: ' + path)
    h, mi, se = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(se)


def to_wav(src, dst, tempo=1.0):
    af = []
    if abs(tempo - 1.0) > 0.005:
        af.append(f'atempo={tempo:.4f}')
    af.append('highpass=f=95')            # 去低频轰鸣（男声容易积在 80Hz 以下）
    af.append('acompressor=threshold=-18dB:ratio=2.6:attack=8:release=180')
    af.append('loudnorm=I=-17:TP=-2:LRA=9')
    cmd = [FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', '-i', src]
    if af:
        cmd += ['-af', ','.join(af)]
    cmd += ['-ar', str(SR), '-ac', '1', '-c:a', 'pcm_s16le', dst]
    subprocess.run(cmd, check=True)


async def gen_one(i, text):
    mp3 = f'audio/line{i:02d}.mp3'
    for attempt in range(3):
        try:
            c = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
            await c.save(mp3)
            return mp3
        except Exception as e:
            if attempt == 2:
                raise
            await asyncio.sleep(1.5)


async def main():
    report = []
    for i, (start, end, text) in enumerate(LINES):
        mp3 = await gen_one(i, text)
        raw = probe_duration(mp3)
        window = end - start
        tempo = 1.0
        # 超窗口才提语速；上限 1.12（再快就听出"赶"了，宁可改文案）
        if raw > window:
            tempo = min(1.12, raw / (window - 0.12))
        wav = f'audio/line{i:02d}.wav'
        to_wav(mp3, wav, tempo)
        real = probe_duration(wav)
        report.append({
            'i': i, 'start': start, 'window': round(window, 2),
            'raw': round(raw, 2), 'tempo': round(tempo, 3), 'final': round(real, 2),
            'fit': real <= window + 0.05, 'text': text,
        })
        flag = '✓' if real <= window + 0.05 else '✗ 超出'
        print(f'  {i:02d} {start:5.1f}s 窗 {window:4.1f}s  原始 {raw:4.2f}s ×{tempo:.3f} → {real:4.2f}s {flag}')

    # ── 按绝对时间铺到 90 秒轨上（不用 ffmpeg 滤镜拼接，避免累积误差）──
    n = int(TOTAL * SR)
    track = np.zeros(n, dtype=np.float32)
    for r in report:
        with wave.open(f"audio/line{r['i']:02d}.wav", 'rb') as w:
            frames = w.readframes(w.getnframes())
        seg = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        s = int(r['start'] * SR)
        e = min(n, s + len(seg))
        if e > s:
            track[s:e] += seg[:e - s]

    peak = float(np.abs(track).max())
    if peak > 0.98:
        track *= 0.98 / peak
    pcm = np.clip(track * 32767, -32768, 32767).astype(np.int16)
    with wave.open('audio/voice.wav', 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())

    with open('audio/voice-report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    bad = [r for r in report if not r['fit']]
    print(f'\n✓ audio/voice.wav  峰值 {20*np.log10(peak+1e-9):.1f} dBFS')
    print(f'  {len(report)} 句，超窗 {len(bad)} 句' + ('（已用 atempo 压到合适）' if bad else ''))
    if bad:
        for r in bad:
            print(f"    #{r['i']} 超 {r['final']-r['window']:+.2f}s：{r['text'][:20]}…")


asyncio.run(main())
