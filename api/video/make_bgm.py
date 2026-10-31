#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
科技感配乐 v2（纯 numpy 合成，无采样依赖、零版权风险）
BPM 132 · A 小调 · 结构跟着 53 秒分镜走：
  0.0-4.6   引子：pad + 心跳鼓 + 滤波爬升（开场钩子）
  4.6-19.1  律动A：四踩底鼓 + 反拍贝斯 + 16分琶音 + 军鼓反拍
  19.1-23.9 造势：噪声 riser + 军鼓滚奏加速（对准"日终封存"收尾）
  23.9      落点重锤（对准"多链锚定"进场）
  23.9-47.1 律动B：全编制 + 和弦 stab + 更宽立体声
  47.1-53.0 尾奏：和声垫 + 琶音余韵收束（对准 slogan）
人声在混音阶段做 sidechain ducking，这里先把音乐自身的"泵感"做出来。
"""
import wave

import numpy as np

SR = 48000
TOTAL = 53.0
BPM = 132.0
BEAT = 60.0 / BPM          # 0.4545s
BAR = BEAT * 4             # 1.8182s
N = int(TOTAL * SR)

rng = np.random.default_rng(20261027)   # 固定种子：可复现


def t_axis(n):
    return np.arange(n) / SR


def env_ad(n, a, d):
    """attack-decay 包络"""
    t = t_axis(n)
    at = np.clip(t / max(a, 1e-4), 0, 1)
    de = np.exp(-t / d)
    return at * de


def kick(hit_t, out_l, out_r, gain=1.0):
    """底鼓：正弦 150→45Hz 扫频 + 起振 click"""
    n = int(0.30 * SR)
    s0 = int(hit_t * SR)
    if s0 + n > N:
        n = N - s0
    if n <= 0:
        return
    t = t_axis(n)
    f = 45 + 105 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 16)
    click = rng.standard_normal(n) * np.exp(-t * 260) * 0.5
    sig = (body + click) * gain
    out_l[s0:s0 + n] += sig
    out_r[s0:s0 + n] += sig


def hat(hit_t, out_l, out_r, gain=1.0, open_=False):
    n = int((0.14 if open_ else 0.045) * SR)
    s0 = int(hit_t * SR)
    if s0 + n > N:
        n = N - s0
    if n <= 0:
        return
    t = t_axis(n)
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0.0)          # 高通近似
    sig = noise * np.exp(-t * (14 if open_ else 70)) * gain * 0.5
    # 轻微立体声展开
    out_l[s0:s0 + n] += sig * 1.1
    out_r[s0:s0 + n] += sig * 0.9


def snare(hit_t, out_l, out_r, gain=1.0):
    """V4：电子 clap/zap 替代军鼓 —— 三连噪声微爆 + 高频 zap 下扫，科技感更强"""
    s0 = int(hit_t * SR)
    # 1) 三连 flam：0 / 12ms / 25ms 三记短噪声，模拟电子拍手
    for k, off in enumerate((0.0, 0.012, 0.025)):
        n = int(0.09 * SR)
        st = s0 + int(off * SR)
        if st + n > N or st < 0:
            continue
        t = t_axis(n)
        noise = np.diff(rng.standard_normal(n), prepend=0.0)   # 高通近似，薄而脆
        g = gain * 0.5 * (1.0 if k == 2 else 0.55)
        sig = noise * np.exp(-t * 90) * g
        out_l[st:st + n] += sig * 1.05
        out_r[st:st + n] += sig * 0.95
    # 2) zap：1200→320Hz 正弦下扫 70ms，金属科技味
    n = int(0.07 * SR)
    if s0 + n <= N:
        t = t_axis(n)
        f = 320 + 880 * np.exp(-t * 55)
        ph = 2 * np.pi * np.cumsum(f) / SR
        sig = np.sin(ph) * np.exp(-t * 60) * gain * 0.22
        out_l[s0:s0 + n] += sig
        out_r[s0:s0 + n] += sig


def saw_note(freq, dur, out_l, out_r, hit_t, gain=1.0, harm=10, pan=0.5, cutoff=1.0):
    """锯齿波加性和声 + 低通滚降"""
    n = int(dur * SR)
    s0 = int(hit_t * SR)
    if s0 >= N:
        return
    n = min(n, N - s0)
    t = t_axis(n)
    sig = np.zeros(n)
    for k in range(1, harm + 1):
        sig += np.sin(2 * np.pi * freq * k * t + k * 0.7) / k
    sig *= env_ad(n, 0.008, dur * 0.45)
    l = sig * gain * (1 - pan) * 2
    r = sig * gain * pan * 2
    out_l[s0:s0 + n] += l * cutoff
    out_r[s0:s0 + n] += r * cutoff


# ── 和声：Am F C G（每和弦一小节，循环）──
CHORDS = [
    [220.00, 261.63, 329.63],   # A3 C4 E4
    [174.61, 220.00, 261.63],   # F3 A3 C4
    [130.81, 164.81, 196.00],   # C3 E3 G3
    [196.00, 246.94, 293.66],   # G3 B3 D4
]
ROOTS = [110.00, 87.31, 65.41, 98.00]  # A2 F2 C2 G2

L = np.zeros(N, dtype=np.float32)
R = np.zeros(N, dtype=np.float32)
D = np.zeros(N, dtype=np.float32)     # 鼓组单独轨，最后做总线

n_bars = int(np.ceil(TOTAL / BAR))
for bar in range(n_bars):
    bt = bar * BAR
    if bt >= TOTAL:
        break
    chord = CHORDS[bar % 4]
    root = ROOTS[bar % 4]

    # ── 段落判定 ──
    intro = bt < 4.6
    build = 19.1 <= bt < 23.9
    groove_b = bt >= 23.9
    outro = bt >= 47.1

    # 引子/尾奏：和声垫
    if intro or outro:
        dur = min(BAR * 1.02, TOTAL - bt)
        for vi, f in enumerate(chord):
            det = 1 + (vi - 1) * 0.0012
            saw_note(f * det, dur, L, R, bt, gain=0.028, harm=6,
                     pan=0.35 + 0.3 * (vi / 2), cutoff=0.55)
            saw_note(f * (2 - det), dur, L, R, bt, gain=0.014, harm=4,
                     pan=0.65 - 0.3 * (vi / 2), cutoff=0.4)

    # 律动段：四踩底鼓 + 反拍贝斯 + 16分琶音
    if not intro and not outro:
        for b in range(4):
            kick(bt + b * BEAT, D, D, gain=0.7 if build else 1.0)
        # 反拍贝斯（8 分反拍）
        for e in range(8):
            if e % 2 == 1:
                saw_note(root / 2, 0.16, L, R, bt + e * BEAT / 2,
                         gain=0.10 if build else 0.16, harm=5, cutoff=0.8)
        # 军鼓 2/4 反拍（造势小节换成滚奏）
        if not build:
            snare(bt + BEAT, D, D, gain=0.9)
            snare(bt + BEAT * 3, D, D, gain=0.9)
        else:
            # 滚奏：8 分 → 16 分 → 32 分，渐强
            prog = (bt - 19.1) / 4.8
            step, g = (BEAT / 2, 0.5) if prog < 0.4 else ((BEAT / 4, 0.62) if prog < 0.75 else (BEAT / 8, 0.78))
            k = 0
            ht = bt
            while ht < bt + BAR and ht < 23.85:
                snare(ht, D, D, gain=g * (0.5 + min(1.0, 0.5 * k * step * 4)))
                ht += step
                k += 1
        # 16 分琶音（和弦音循环，律动B 高八度）
        arp_gain = 0.05 if intro else (0.085 if not build else 0.11)
        arp_oct = 2.0 if groove_b else 1.0
        for s16 in range(16):
            note = chord[(s16 * 7) % 3] * arp_oct * (2 if (s16 % 8) >= 4 else 1)
            pan = 0.3 + 0.4 * ((s16 % 4) / 3)
            saw_note(note, 0.11, L, R, bt + s16 * BEAT / 4,
                     gain=arp_gain, harm=7, pan=pan, cutoff=0.9)
        # 律动B：和弦 stab（每小节 1.5 拍处）
        if groove_b:
            for f in chord:
                saw_note(f * 2, 0.20, L, R, bt + BEAT * 1.5,
                         gain=0.055, harm=8, pan=0.5, cutoff=1.0)
        # 镲：闭镲 8 分 + 律动B 反拍开镲
        if not build:
            for e in range(8):
                hat(bt + e * BEAT / 2, L, R, gain=0.5 if e % 2 else 0.3,
                    open_=(e == 7 and groove_b))


def impact(hit_t):
    """落点重锤：sub + 泛音 + 噪声爆"""
    n = int(1.8 * SR)
    s0 = int(hit_t * SR)
    n = min(n, N - s0)
    t = t_axis(n)
    sub = np.sin(2 * np.pi * 58 * t) * np.exp(-t * 3.2)
    boom = np.sin(2 * np.pi * 116 * t) * np.exp(-t * 5)
    noise = rng.standard_normal(n) * np.exp(-t * 6) * 0.35
    sig = (sub * 0.9 + boom * 0.4 + noise) * 0.85
    L[s0:s0 + n] += sig * 0.9
    R[s0:s0 + n] += sig * 1.0


impact(23.9)      # 多链锚定进场
impact(47.4)      # slogan 定音

# ── Riser：噪声扫频 19.1→23.9 ──
n = int(4.8 * SR)
s0 = int(19.1 * SR)
t = t_axis(n)
noise = np.diff(rng.standard_normal(n), prepend=0.0)
sweep = noise * (t / t[-1]) ** 2 * 0.45
shimmer = np.sin(2 * np.pi * (200 + 900 * t ** 1.6) * t) * (t / t[-1]) ** 2.4 * 0.10
L[s0:s0 + n] += (sweep * 0.9 + shimmer) * 0.8
R[s0:s0 + n] += (sweep * 1.1 + shimmer) * 0.8

# ── 侧链泵感：底鼓触发，非鼓元素下陷 ──
duck = np.ones(N, dtype=np.float32)
kt = 0.0
while kt < TOTAL:
    s0 = int(kt * SR)
    n = min(int(0.36 * SR), N - s0)
    if n > 0:
        duck[s0:s0 + n] *= (1 - 0.38 * np.exp(-t_axis(n) * 14))
    kt += BEAT
L *= duck
R *= duck

# ── 总线：Haas 立体声展开 + 软削波 + 归一化 ──
mix_l = L + D * 0.95
mix_r = R + D
side = np.zeros(N, dtype=np.float32)
side[1:] = (mix_l[1:] - mix_r[:-1]) * 0.18
mix_l += side
mix_r -= side
mix_l = np.tanh(mix_l * 1.25)
mix_r = np.tanh(mix_r * 1.25)
peak = max(np.abs(mix_l).max(), np.abs(mix_r).max())
mix_l *= 0.88 / peak
mix_r *= 0.88 / peak

fade_in = int(0.25 * SR)
fade_out = int(1.6 * SR)
mix_l[:fade_in] *= np.linspace(0, 1, fade_in)
mix_r[:fade_in] *= np.linspace(0, 1, fade_in)
mix_l[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5
mix_r[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5

pcm = np.stack([mix_l, mix_r], axis=1)
pcm = np.clip(pcm * 32767, -32768, 32767).astype(np.int16)
with wave.open('audio/bgm.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'✓ audio/bgm.wav  BPM {BPM:.0f} · {TOTAL:.0f}s · 立体声 · 峰值 {20*np.log10(peak+1e-9):.1f} dBFS')
