// 竖版 45 秒合成：画面 + 男声旁白 + 科技感配乐（人声触发 ducking）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRAMES = path.join(__dirname, 'frames')
const AUD = path.join(__dirname, 'audio')
const FPS = 30
const ffmpeg = (await import('ffmpeg-static')).default

const out = path.join(__dirname, '向往的自由-全链路53秒-竖版-V4-20261027.mp4')
const mixFile = path.join(AUD, 'mix.m4a')

const n = fs.readdirSync(FRAMES).filter((f) => f.endsWith('.jpg')).length
if (!n) { console.error('✗ frames/ 为空'); process.exit(1) }
console.log(`▶ 合成 ${n} 帧 @${FPS}fps = ${(n / FPS).toFixed(1)} 秒`)

/* ── 混音 ──
   人声：高通去轰 + 轻压缩（宣传片旁白需要贴耳、稳定）
   配乐：整体压低，再用人声做 sidechain 触发 ducking ——
        解说一开口，音乐自动让路；一停，音乐抬回来。这是"听感专业"和"糊成一团"的分界。
   总线：loudnorm 到 -15 LUFS（网络视频通行值），真峰值 -1.2dB 防削。 */
if (!fs.existsSync(path.join(AUD, 'voice.wav'))) { console.error('✗ 缺 audio/voice.wav'); process.exit(1) }
if (!fs.existsSync(path.join(AUD, 'bgm.wav'))) { console.error('✗ 缺 audio/bgm.wav'); process.exit(1) }

// 人声预处理单独一步：acompressor 的参数若和后续 filter 串在同一条 filter_complex 里，
// ffmpeg 6.1 会把后面的输出标签当成"流选择器"报错（Stream specifier 'xxx' matches no streams）。
// 拆成两遍既绕开这个坑，也更容易单独调人声。
const voiceProc = path.join(AUD, 'voice_proc.wav')
execFileSync(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', path.join(AUD, 'voice.wav'),
  '-af', 'highpass=f=100,acompressor=threshold=-16dB:ratio=3:attack=6:release=170',
  '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', voiceProc,
], { stdio: 'inherit' })

execFileSync(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', voiceProc,
  '-i', path.join(AUD, 'bgm.wav'),
  '-filter_complex', [
    // 音乐让人声：宣传片第一原则是"听得清在说什么"，宁可音乐小一点
    '[1:a]volume=0.62[bgm]',
    '[bgm][0:a]sidechaincompress=threshold=0.05:ratio=10:attack=15:release=400[duck]',
    '[0:a][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-15:TP=-1.2:LRA=11[mixout]',
  ].join(';'),
  '-map', '[mixout]', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', mixFile,
], { stdio: 'inherit' })
console.log('  混音完成 →', path.basename(mixFile))

execFileSync(ffmpeg, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', path.join(FRAMES, 'f%05d.jpg'),
  '-i', mixFile,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
  '-x264-params', 'keyint=60:min-keyint=30',
  '-c:a', 'aac', '-b:a', '192k',
  '-shortest', '-movflags', '+faststart',
  '-r', String(FPS),
  out,
], { stdio: 'inherit' })

const st = fs.statSync(out)
console.log(`✓ ${out}`)
console.log(`  ${(st.size / 1024 / 1024).toFixed(1)} MB · ${n} 帧 · ${(n / FPS).toFixed(1)}s · 1080×1920`)
