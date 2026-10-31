// 合成：JPEG 序列 → H.264 MP4（含极轻氛围音轨）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRAMES = path.join(__dirname, 'frames')
const FPS = Number(process.env.FPS || 30)
const ffmpeg = (await import('ffmpeg-static')).default

const out = process.argv[2] || path.join(__dirname, '向往的自由-全链路90秒.mp4')
const withAudio = process.argv[3] !== '--silent'

const n = fs.readdirSync(FRAMES).filter((f) => f.endsWith('.jpg')).length
if (!n) { console.error('✗ frames/ 为空，先跑 node video/render.mjs'); process.exit(1) }
console.log(`▶ 合成 ${n} 帧 @${FPS}fps = ${(n / FPS).toFixed(1)} 秒`)

/* 氛围音：极低的合成底噪 + 每 4 秒一次轻微脉冲。
   目的是让画面不死寂，而不是当 BGM —— 音量压得很低（-26dB 左右）。 */
function buildAudio(file) {
  const dur = n / FPS + 0.4
  const filter = [
    // 55Hz 基频 + 82.5Hz 五度 + 极轻的高频嘶声
    `aevalsrc='0.06*sin(2*PI*55*t)+0.03*sin(2*PI*82.5*t)+0.012*sin(2*PI*220*t)*(0.5+0.5*sin(2*PI*0.25*t))':s=48000:d=${dur}`,
    'lowpass=f=380',
    'afade=t=in:st=0:d=2.5',
    `afade=t=out:st=${(dur - 3).toFixed(2)}:d=3`,
    'volume=0.55',
  ].join(',')
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', filter, '-c:a', 'aac', '-b:a', '96k', file], { stdio: 'pipe' })
}

const args = [
  '-y',
  '-framerate', String(FPS),
  '-i', path.join(FRAMES, 'f%05d.jpg'),
]
let audioFile = null
if (withAudio) {
  audioFile = path.join(__dirname, '_ambience.m4a')
  buildAudio(audioFile)
  args.push('-i', audioFile, '-shortest')
}
args.push(
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
  '-x264-params', 'keyint=60:min-keyint=30',
  '-movflags', '+faststart',
  '-r', String(FPS),
  out,
)
execFileSync(ffmpeg, args, { stdio: 'inherit' })
if (audioFile) fs.rmSync(audioFile, { force: true })

const size = fs.statSync(out).size
console.log(`✓ ${out}`)
console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB · ${n} 帧 · ${(n / FPS).toFixed(1)}s · ${withAudio ? '含氛围音轨' : '无音轨'}`)
