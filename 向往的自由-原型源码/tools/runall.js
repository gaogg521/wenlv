/**
 * 一键全量验收：串行跑完全部 CDP 走查，避开端口互抢，末尾汇总
 * 用法：node tools/runall.js            全跑
 *       node tools/runall.js quick      只跑核心三套（deepscan / crosstrace / ovprobe）
 *       node tools/runall.js deep       追加 deadlink / overflow
 */
const { spawn } = require('child_process');
const pathx = require('path');
const fs = require('fs');

const ROOT = pathx.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 找一个空闲的调试端口（从 base 起连续探测，最多 30 次） */
async function freePort(base){
  const net = require('net');
  for(let p = base; p < base + 30; p++){
    const busy = await new Promise(res => {
      const srv = net.createServer();
      srv.once('error', () => res(true));
      srv.once('listening', () => srv.close(() => res(false)));
      srv.listen(p, '127.0.0.1');
    });
    if(!busy) return p;
  }
  return base;
}

const GROUPS = {
  quick: [
    ['deepscan.js', '二级下钻扫描'],
    ['crosstrace.js', '跨端一致性'],
    ['ovprobe.js', '成本控制闭环'],
  ],
  deep: [
    ['deadlink.js', '死链扫描'],
    ['overflow.js', '布局与图标'],
    ['endtrace.js', '端跳转回归'],
  ],
  full: [
    ['ovprobe.js', '成本控制闭环'],
    ['crosstrace.js', '跨端一致性'],
    ['deepscan.js', '二级下钻扫描'],
    ['deadlink.js', '死链扫描'],
    ['overflow.js', '布局与图标'],
    ['endtrace.js', '端跳转回归'],
    ['enginetrace.js', '引擎可玩链路'],
    ['paytrace.js', '支付链路'],
    ['missiontrace.js', '任务状态机'],
    ['sbcheck.js', '状态栏'],
    ['playtrace.js', '剧本流程'],
    ['accept2.js', '全量点击'],
    ['tabshot.js', 'tab 一致性截图'],
    ['fitprobe.js', '演示模式与闭环跳转'],
    ['rangeprobe.js', '经营口径与派生视图'],
    ['consisprobe.js', '演示自洽性'],
    ['uxprobe.js', '交互手感'],
    ['touchprobe.js', '可点性与反馈'],
    ['backprobe.js', '返回键与返回栏'],
    ['v114smoke.js', '三端重构冒烟'],
  ],
};

const mode = (process.argv[2] || 'full').toLowerCase();
const list = GROUPS[mode];
if(!list){
  console.error('未知模式：' + mode + '，可选 quick / deep / full');
  process.exit(1);
}

(async () => {
  const results = [];
  const portBase = 9410;
  for(let i = 0; i < list.length; i++){
    const [file, name] = list[i];
    const port = await freePort(portBase + i * 3);
    process.stdout.write('\n──────── [' + (i+1) + '/' + list.length + '] ' + name + ' (' + file + ') ────────\n');
    const t0 = Date.now();
    const code = await new Promise(res => {
      const p = spawn(process.execPath, [pathx.join(__dirname, file)], {
        cwd: ROOT, stdio: ['ignore','pipe','pipe'], env: Object.assign({}, process.env, { PORT: String(port) }),
      });
      let out = '';
      p.stdout.on('data', d => { const s = d.toString(); out += s; process.stdout.write(s); });
      p.stderr.on('data', d => process.stderr.write(d.toString()));
      p.on('close', c => res({ code:c, out:out }));
    });
    const out = code.out || '';
    /* 抓该脚本的结论行 */
    const sum = out.split(/\r?\n/).filter(l => /PASS \d+ \/ FAIL|无响应\/报错|无响应死链|JSON errors|broken/.test(l));
    const verdict = sum.length ? sum[sum.length-1].trim() : (code.code === 0 ? 'OK' : 'EXIT ' + code.code);
    const pass = /(FAIL 0|PASS \d+ \/ FAIL 0)/.test(out) || code.code === 0;
    results.push({ name:name, file:file, verdict:verdict, ok:pass, ms:Date.now() - t0 });
    await sleep(600);   /* 等 Chrome 彻底退出再起下一个 */
  }

  process.stdout.write('\n\n════════════════ 全量验收汇总 ════════════════\n');
  results.forEach(r => {
    process.stdout.write((r.ok ? '  ✔ ' : '  ✘ ') + r.name.padEnd(14) + ' ' + String(Math.round(r.ms/1000)).padStart(3) + 's  ' + r.verdict + '\n');
  });
  const bad = results.filter(r => !r.ok);
  process.stdout.write('────────────────────────────────────────\n');
  process.stdout.write(bad.length ? ('不通过 ' + bad.length + ' 套：' + bad.map(r=>r.name).join('、') + '\n')
                                  : ('全部 ' + results.length + ' 套通过\n'));
  process.exit(bad.length ? 1 : 0);
})();