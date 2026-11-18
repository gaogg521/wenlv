// P-01：经营测算独立页——从「经营概览」迁出，按模块授权（modules.mjs 'scenario'，V92 种子只授 ops；super 恒全部）。
// 滑块、公式、示范案例行为不变（渲染与计算复用 operating-scenario.js / scenic-formula.js）。
window.scenarioPage = async function () {
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>经营测算</h2><span class="muted">招商讲解工具 · 示例假设</span></div>
    <p class="muted" style="margin:-6px 0 4px">面向招商讲解的测算工具：全部为手填假设，与真实经营数据互不混淆；原来嵌在「经营概览」里的同款测算已迁移到本页。</p>
  </div>${operatingScenarioPanel()}`
  await mountOperatingScenario($('#app'))
}
