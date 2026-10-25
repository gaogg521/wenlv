# -*- coding: utf-8 -*-
import io
c = io.open('admin/app.css', encoding='utf-8').read()

# 用新场景版替换旧登录样式段（从 /* ===== 登录 */ 到 /* ===== 框架 */ 前）
start = c.find('/* ===== 登录 ===== */')
end = c.find('/* ===== 框架 ===== */')
assert start > 0 and end > start

new_login_css = '''/* ===== 登录：全屏动态文旅场景 + 玻璃拟态 ===== */
.login-stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden;
  background: radial-gradient(120% 90% at 20% 0%, #0f4d47 0%, #0a2e33 45%, #06181f 100%); }
.scene { position: absolute; inset: 0; }
.scene .stars i { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: #9ff2e4; opacity: .7; animation: twinkle 3.2s ease-in-out infinite; }
.scene .stars i:nth-child(1){left:8%;top:12%}.scene .stars i:nth-child(2){left:22%;top:26%;animation-delay:.5s}
.scene .stars i:nth-child(3){left:35%;top:8%;animation-delay:1.1s}.scene .stars i:nth-child(4){left:52%;top:18%;animation-delay:.2s}
.scene .stars i:nth-child(5){left:68%;top:9%;animation-delay:1.6s}.scene .stars i:nth-child(6){left:80%;top:24%;animation-delay:.8s}
.scene .stars i:nth-child(7){left:91%;top:14%;animation-delay:1.3s}.scene .stars i:nth-child(8){left:15%;top:38%;animation-delay:2s}
.scene .stars i:nth-child(9){left:60%;top:34%;animation-delay:.9s}.scene .stars i:nth-child(10){left:74%;top:40%;animation-delay:1.9s}
.scene .stars i:nth-child(11){left:44%;top:44%;animation-delay:2.4s}.scene .stars i:nth-child(12){left:87%;top:36%;animation-delay:.4s}
@keyframes twinkle { 0%,100% { opacity: .15; transform: scale(1);} 50% { opacity: .8; transform: scale(1.4);} }
.glow { position: absolute; border-radius: 50%; filter: blur(70px); opacity: .5; }
.glow.g1 { width: 420px; height: 420px; background: #10b981; left: -120px; top: -140px; animation: drift 14s ease-in-out infinite alternate; }
.glow.g2 { width: 380px; height: 380px; background: #0ea5e9; right: -100px; bottom: -60px; animation: drift 18s ease-in-out infinite alternate-reverse; }
@keyframes drift { from { transform: translate(0,0);} to { transform: translate(60px, 40px);} }
.hills { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: 46%; }
.pagoda { position: absolute; bottom: 24%; left: 9%; width: 88px; opacity: .55; animation: sway 7s ease-in-out infinite; transform-origin: bottom center; }
@keyframes sway { 0%,100% { transform: rotate(-1deg);} 50% { transform: rotate(1.2deg);} }
.bird { position: absolute; color: #bfeee6; opacity: .55; font-size: 13px; letter-spacing: 2px; animation: fly linear infinite; }
.bird.b1 { top: 20%; left: -60px; animation-duration: 26s; }
.bird.b2 { top: 28%; left: -160px; animation-duration: 34s; animation-delay: 6s; font-size: 10px; }
.bird.b3 { top: 15%; left: -260px; animation-duration: 42s; animation-delay: 14s; font-size: 11px; }
@keyframes fly { from { transform: translateX(0) translateY(0);} 25% { transform: translateX(35vw) translateY(-22px);} 50% { transform: translateX(70vw) translateY(8px);} 75% { transform: translateX(105vw) translateY(-14px);} to { transform: translateX(130vw) translateY(0);} }
.balloon { position: absolute; right: 14%; top: 18%; animation: floaty 9s ease-in-out infinite; }
.balloon .bb { width: 34px; height: 42px; border-radius: 50% 50% 46% 46%; background: linear-gradient(160deg, #f5a623, #e87722); box-shadow: inset -6px -8px 0 rgba(0,0,0,.12); }
.balloon .bl { width: 2px; height: 46px; background: linear-gradient(#e8c9a0, transparent); margin: 0 auto; }
@keyframes floaty { 0%,100% { transform: translateY(0) rotate(-2deg);} 50% { transform: translateY(-26px) rotate(2deg);} }
.river { position: absolute; left: 0; right: 0; bottom: 0; height: 5%; background: linear-gradient(90deg, transparent, #123c44 20%, #164b52 50%, #123c44 80%, transparent); opacity: .8; }

.login-panel { position: relative; z-index: 2; margin-right: 7vw; max-width: 460px; color: #eafaf6; }
.brand-line { font-size: 34px; font-weight: 800; letter-spacing: 2px; }
.brand-line b { font-weight: 400; opacity: .8; font-size: 20px; }
.logo-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #34d399; margin-right: 12px; box-shadow: 0 0 14px #34d399; }
.brand-sub { margin: 10px 0 34px; opacity: .8; font-size: 14px; letter-spacing: 1px; }
.brand-points { list-style: none; }
.brand-points li { padding: 11px 0 11px 28px; position: relative; font-size: 13.5px; border-bottom: 1px solid rgba(255,255,255,.12); }
.brand-points li::before { content: "✓"; position: absolute; left: 0; top: 11px; width: 19px; height: 19px; border-radius: 50%; background: rgba(52,211,153,.2); display: flex; align-items: center; justify-content: center; font-size: 11px; color: #34d399; }
.brand-foot { margin-top: 40px; font-size: 12.5px; opacity: .55; }

.glass-wrap { position: relative; z-index: 2; width: 400px; }
.glass-card { padding: 40px 42px 32px; border-radius: 20px; background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.18);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: 0 24px 70px rgba(0,0,0,.45); color: #f2fbf9; }
.glass-card h2 { color: #fff; }
.glass-card label { display: block; font-size: 13px; font-weight: 600; color: #cfeee6; margin: 18px 0 6px; }
.glass-card input { width: 100%; padding: 12px 14px; border: 1.5px solid rgba(255,255,255,.22); border-radius: 10px; outline: none; background: rgba(0,0,0,.22); color: #fff; transition: .15s; }
.glass-card input::placeholder { color: rgba(255,255,255,.4); }
.glass-card input:focus { border-color: #2fbfae; box-shadow: 0 0 0 3px rgba(47,191,174,.25); }
.glass-card .btn.primary { background: linear-gradient(135deg, #10b981, #0f766e); border: none; }
.glass-card .btn.primary:hover { filter: brightness(1.1); }
.glass-card .btn.ghost { background: rgba(255,255,255,.08); color: #dff5f0; border: 1.5px solid rgba(255,255,255,.3); }
.lerr { color: #fda4af; font-size: 12.5px; min-height: 20px; margin-top: 10px; }
.code-input { text-align: center; font-size: 26px !important; letter-spacing: 14px; font-weight: 700; }
.linklike { background: none; color: #9fd8ce; font-size: 13px; margin-top: 14px; width: 100%; }
.linklike:hover { color: #fff; }
.quick-accounts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 16px; }
.qa { font-size: 12px; padding: 4px 12px; border-radius: 999px; background: rgba(47,191,174,.15); color: #a9ece2; border: 1px solid rgba(47,191,174,.4); }
.qa:hover { background: #10b981; color: #fff; }
.glass-card .hint, .glass-card .muted { color: #9fd8ce; }

'''
c = c[:start] + new_login_css + c[end:]

# ===== SaaS 质感微调 =====
c = c.replace('body { font: 14px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink); background: var(--bg); }',
'''body { font: 14px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink);
  background: var(--bg) radial-gradient(60% 40% at 85% -5%, rgba(15,118,110,.07), transparent),
  radial-gradient(50% 35% at 0% 100%, rgba(37,99,235,.05), transparent); background-attachment: fixed; }''')
c = c.replace('.card { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px 22px; margin-bottom: 18px; }',
'''.card { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px 22px; margin-bottom: 18px;
  border: 1px solid rgba(255,255,255,.7); transition: box-shadow .18s, transform .18s; }
.card:hover { box-shadow: 0 6px 26px rgba(16,35,51,.09); }''')
c = c.replace('.topbar { height: 58px; background: #fff; border-bottom: 1px solid var(--line);',
'.topbar { height: 58px; background: rgba(255,255,255,.86); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line);')
c = c.replace('.kpi { background: #fff; border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px; display: flex; gap: 14px; align-items: center; }',
'''.kpi { background: #fff; border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px; display: flex; gap: 14px; align-items: center;
  border: 1px solid rgba(255,255,255,.8); transition: transform .16s, box-shadow .16s; }
.kpi:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(16,35,51,.1); }''')

io.open('admin/app.css', 'w', encoding='utf-8', newline='\n').write(c)
print('login scene + saas polish css done')
