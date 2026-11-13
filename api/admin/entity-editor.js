// 实体编辑器：读取服务端 schema（GET /admin/entity-schemas/:kind）渲染完整表单。
// 新增与编辑同一个界面；字段定义只在 api/src/domain/entity-schema.mjs 一处维护。
(() => {
  const E = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  let st = null // 当前编辑会话 { kind, id, schema, values, dirty, opts }

  /* ---------------- 字段渲染 ---------------- */
  const fid = (k, p = '') => 'ee_' + p + k
  function control(f, v, p = '') {
    const id = fid(f.k, p)
    const ph = f.ph ? ` placeholder="${E(f.ph)}"` : ''
    const max = f.max && ['text', 'textarea'].includes(f.type) ? ` maxlength="${f.max}"` : ''
    switch (f.type) {
      case 'text': case 'phone': case 'email': case 'url':
        return `<input id="${id}" type="${f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : 'text'}" value="${E(v)}"${ph}${max} data-count="${f.max || ''}">`
      case 'textarea':
        return `<textarea id="${id}" rows="3"${ph}${max} data-count="${f.max || ''}">${E(v)}</textarea>`
      case 'bp':
        return `<div class="ee-affix"><input id="${id}" type="number" value="${v ?? ''}" step="0.01"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${ph}><span>%</span></div>`
      case 'int': case 'number': case 'money':
        return `<div class="ee-affix">${f.type === 'money' ? '<span>¥</span>' : ''}<input id="${id}" type="number" value="${v ?? ''}" step="${f.type === 'int' ? 1 : f.type === 'money' ? '0.01' : 'any'}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${ph}>${f.unit && f.type !== 'money' ? `<span>${E(f.unit)}</span>` : ''}</div>`
      case 'select': case 'ref':
        if (f.type === 'ref' && f.multiple) return refMulti(f, v, id)
        return `<select id="${id}"><option value="">${f.required ? '请选择' : '— 不选 —'}</option>${(f.options || []).map(([o, t]) => `<option value="${E(o)}" ${String(v ?? '') === String(o) ? 'selected' : ''}>${E(t)}</option>`).join('')}</select>`
      case 'multi':
        return `<div class="ee-chips" id="${id}">${f.options.map(([o, t]) => `<label class="ee-chip"><input type="checkbox" value="${E(o)}" ${(v || []).includes(String(o)) ? 'checked' : ''}><span>${E(t)}</span></label>`).join('')}</div>`
      case 'switch':
        return `<label class="ee-switch"><input id="${id}" type="checkbox" ${Number(v) ? 'checked' : ''}><i></i><span>${Number(v) ? '是' : '否'}</span></label>`
      case 'date': return `<input id="${id}" type="date" value="${E(v)}">`
      case 'time': return `<input id="${id}" type="time" value="${E(v)}">`
      case 'datetime': return `<input id="${id}" type="datetime-local" value="${E(String(v || '').replace(' ', 'T'))}">`
      case 'color': return `<div class="ee-affix"><input type="color" value="${E(v || '#e87722')}" oninput="this.nextElementSibling.value=this.value;this.nextElementSibling.dispatchEvent(new Event('input',{bubbles:true}))"><input id="${id}" value="${E(v)}" placeholder="#RRGGBB" maxlength="7"></div>`
      case 'geo': return `<div class="ee-affix"><input id="${id}" value="${E(v)}" placeholder="31.115,121.052"><a class="ee-link" href="https://lbs.qq.com/getPoint/" target="_blank" rel="noopener">地图取点 ↗</a></div>`
      case 'tags': return tagsCtl(id, v || [], f)
      case 'lines': return `<textarea id="${id}" rows="4" placeholder="每行一条">${E((v || []).join('\n'))}</textarea>`
      case 'image': return imageCtl(id, v, f)
      case 'gallery': return galleryCtl(id, v || [], f)
      case 'video': return videoCtl(id, v, f)
      case 'rich': return richCtl(id, v || '')
      case 'repeat': return repeatCtl(id, v || [], f)
      default: return `<input id="${id}" value="${E(v)}">`
    }
  }
  function refMulti(f, v, id) {
    const sel = (v || []).map(String)
    return `<div class="ee-refm" id="${id}"><input class="ee-refm-q" placeholder="搜索…" oninput="eeRefFilter(this)">
      <div class="ee-refm-list">${(f.options || []).map(([o, t]) => `<label><input type="checkbox" value="${E(o)}" ${sel.includes(String(o)) ? 'checked' : ''}> ${E(t)}</label>`).join('') || '<span class="muted">暂无可选项</span>'}</div></div>`
  }
  window.eeRefFilter = (inp) => { const q = inp.value.trim(); inp.nextElementSibling.querySelectorAll('label').forEach((l) => { l.hidden = q && !l.textContent.includes(q) }) }

  function tagsCtl(id, arr, f) {
    return `<div class="ee-tags" id="${id}" data-max="${f.max || 20}">${arr.map((t) => tagChip(t)).join('')}<input placeholder="输入后回车" onkeydown="eeTagKey(event,this)"></div>`
  }
  const tagChip = (t) => `<span class="ee-tag" data-v="${E(t)}">${E(t)}<b onclick="this.parentNode.remove();eeDirty()">×</b></span>`
  window.eeTagKey = (e, inp) => {
    if (!['Enter', ',', '，'].includes(e.key)) { if (e.key === 'Backspace' && !inp.value) { inp.previousElementSibling?.remove(); eeDirty() } return }
    e.preventDefault()
    const v = inp.value.trim().replace(/[,，]$/, '')
    const box = inp.parentNode
    if (!v) return
    if (box.querySelectorAll('.ee-tag').length >= Number(box.dataset.max)) return toast('最多 ' + box.dataset.max + ' 个', true)
    if ([...box.querySelectorAll('.ee-tag')].some((x) => x.dataset.v === v)) { inp.value = ''; return }
    inp.insertAdjacentHTML('beforebegin', tagChip(v)); inp.value = ''; eeDirty()
  }

  function imageCtl(id, url, f) {
    return `<div class="ee-img" id="${id}" data-url="${E(url)}">${url ? `<img src="${E(url)}"><button type="button" class="ee-x" onclick="eeImgClear('${id}')">×</button>` : '<span>＋ 上传图片</span>'}
      <input type="file" accept="image/png,image/jpeg,image/webp" onchange="eeUpload(this,'${id}','single')"></div>`
  }
  function videoCtl(id, url, f) {
    return `<div class="ee-img" id="${id}" data-url="${E(url || '')}">${url ? `<video src="${E(url)}" controls style="max-width:100%;border-radius:8px"></video><button type="button" class="ee-x" onclick="eeVideoClear('${id}')">×</button>` : '<span>＋ 上传视频（MP4 ≤30MB）</span>'}
      <input type="file" accept="video/mp4" onchange="eeVideoUpload(this,'${id}')"></div>`
  }
  window.eeVideoClear = (id) => { const b = document.getElementById(id); b.dataset.url = ''; b.querySelector('video')?.remove(); b.querySelector('.ee-x')?.remove(); b.insertAdjacentHTML('afterbegin', '<span>＋ 上传视频（MP4 ≤30MB）</span>'); eeDirty() }
  window.eeVideoUpload = async (input, id) => {
    const file = (input.files || [])[0]; input.value = ''
    if (!file) return
    if (file.size > 30 * 1024 * 1024) return toast('视频超过 30MB', true)
    const box = document.getElementById(id)
    try {
      const url = await uploadFile(file)
      box.dataset.url = url
      box.querySelector('span')?.remove(); box.querySelector('video')?.remove(); box.querySelector('.ee-x')?.remove()
      box.insertAdjacentHTML('afterbegin', `<video src="${E(url)}" controls style="max-width:100%;border-radius:8px"></video><button type="button" class="ee-x" onclick="eeVideoClear('${id}')">×</button>`)
    } catch (e) { toast(e.message || '视频上传失败', true) }
  }
  window.eeImgClear = (id) => { const b = document.getElementById(id); b.dataset.url = ''; b.querySelector('img')?.remove(); b.querySelector('.ee-x')?.remove(); b.insertAdjacentHTML('afterbegin', '<span>＋ 上传图片</span>'); eeDirty() }
  function galleryCtl(id, arr, f) {
    return `<div class="ee-gallery" id="${id}" data-max="${f.max || 9}">${arr.map((u, i) => galItem(u, i)).join('')}
      <label class="ee-gadd" ${arr.length >= (f.max || 9) ? 'hidden' : ''}>＋<small>添加图片</small><input type="file" multiple accept="image/png,image/jpeg,image/webp" onchange="eeUpload(this,'${id}','gallery')"></label></div>`
  }
  const galItem = (u, i) => `<div class="ee-gitem" data-url="${E(u)}"><img src="${E(u)}">${i === 0 ? '<em>封面</em>' : ''}
    <div class="ee-gops"><button type="button" title="前移" onclick="eeGalMove(this,-1)">‹</button><button type="button" title="删除" onclick="eeGalDel(this)">×</button><button type="button" title="后移" onclick="eeGalMove(this,1)">›</button></div></div>`
  function galRefresh(box) {
    const urls = [...box.querySelectorAll('.ee-gitem')].map((x) => x.dataset.url)
    box.querySelectorAll('.ee-gitem').forEach((x) => x.remove())
    box.querySelector('.ee-gadd').insertAdjacentHTML('beforebegin', urls.map(galItem).join(''))
    box.querySelector('.ee-gadd').hidden = urls.length >= Number(box.dataset.max)
    eeDirty()
  }
  window.eeGalDel = (b) => { const box = b.closest('.ee-gallery'); b.closest('.ee-gitem').remove(); galRefresh(box) }
  window.eeGalMove = (b, d) => {
    const it = b.closest('.ee-gitem'), box = it.parentNode
    const sib = d < 0 ? it.previousElementSibling : it.nextElementSibling
    if (!sib || !sib.classList.contains('ee-gitem')) return
    d < 0 ? box.insertBefore(it, sib) : box.insertBefore(sib, it)
    galRefresh(box)
  }
  async function uploadFile(file) {
    if (file.size > 2 * 1024 * 1024) throw new Error(file.name + ' 超过 2MB')
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(file) })
    return (await api('POST', '/admin/uploads', { data, ext })).url
  }
  window.eeUpload = async (input, id, mode) => {
    const files = [...(input.files || [])]
    input.value = ''
    if (!files.length) return
    const box = document.getElementById(id)
    try {
      if (mode === 'single') {
        const url = await uploadFile(files[0])
        box.dataset.url = url
        box.querySelector('span')?.remove(); box.querySelector('img')?.remove(); box.querySelector('.ee-x')?.remove()
        box.insertAdjacentHTML('afterbegin', `<img src="${E(url)}"><button type="button" class="ee-x" onclick="eeImgClear('${id}')">×</button>`)
      } else {
        const room = Number(box.dataset.max) - box.querySelectorAll('.ee-gitem').length
        for (const f of files.slice(0, room)) {
          const url = await uploadFile(f)
          box.querySelector('.ee-gadd').insertAdjacentHTML('beforebegin', galItem(url, 1))
        }
        if (files.length > room) toast(`最多 ${box.dataset.max} 张，已忽略多余图片`, true)
        galRefresh(box)
      }
      eeDirty(); toast('图片已上传')
    } catch (e) { toast(e.message, true) }
  }

  /* 富文本：标题/列表/引用/对齐/颜色/链接/图片/分割线/撤销，带字数统计 */
  function richCtl(id, html) {
    const B = (cmd, val, label, title) => `<button type="button" title="${title}" onmousedown="eeRt(event,'${cmd}','${val}')">${label}</button>`
    return `<div class="ee-rich"><div class="ee-rt">
      ${B('undo', '', '↶', '撤销')}${B('redo', '', '↷', '重做')}<i></i>
      ${B('formatBlock', 'P', '正文', '正文')}${B('formatBlock', 'H2', 'H2', '大标题')}${B('formatBlock', 'H3', 'H3', '小标题')}<i></i>
      ${B('bold', '', '<b>B</b>', '加粗')}${B('italic', '', '<i>I</i>', '斜体')}${B('underline', '', '<u>U</u>', '下划线')}${B('strikeThrough', '', '<s>S</s>', '删除线')}
      ${B('foreColor', '#c64e28', '<span style="color:#c64e28">A</span>', '强调色')}${B('hiliteColor', '#fff1c2', '<span style="background:#fff1c2">高亮</span>', '高亮')}<i></i>
      ${B('insertUnorderedList', '', '• 列表', '无序列表')}${B('insertOrderedList', '', '1. 列表', '有序列表')}${B('formatBlock', 'BLOCKQUOTE', '❝ 引用', '引用')}<i></i>
      ${B('justifyLeft', '', '⇤', '左对齐')}${B('justifyCenter', '', '⇔', '居中')}<i></i>
      ${B('link', '', '链接', '插入链接')}<label class="ee-rt-img" title="插入图片">图片<input type="file" accept="image/png,image/jpeg,image/webp" onchange="eeRtImg(this,'${id}')"></label>${B('insertHorizontalRule', '', '— 分割线', '分割线')}${B('removeFormat', '', '清除格式', '清除格式')}
    </div><div id="${id}" class="ee-rt-body" contenteditable="true" oninput="eeRtCount(this)">${html}</div><div class="ee-rt-foot"><span>0</span> 字</div></div>`
  }
  window.eeRt = (e, cmd, val) => {
    e.preventDefault()
    if (cmd === 'link') { const u = prompt('链接地址（https:// 开头）'); if (!u) return; if (!/^https?:\/\//.test(u)) return toast('链接需以 http(s):// 开头', true); document.execCommand('createLink', false, u) }
    else document.execCommand(cmd, false, val || null)
    eeDirty()
  }
  window.eeRtImg = async (input, id) => {
    const f = input.files?.[0]; input.value = ''
    if (!f) return
    try { const url = await uploadFile(f); document.getElementById(id).focus(); document.execCommand('insertImage', false, url); eeDirty() } catch (e) { toast(e.message, true) }
  }
  window.eeRtCount = (el) => { el.closest('.ee-rich').querySelector('.ee-rt-foot span').textContent = el.innerText.replace(/\s/g, '').length; eeDirty() }

  /* 可重复子表 */
  function repeatCtl(id, rows, f) {
    return `<div class="ee-repeat" id="${id}" data-max="${f.max || 20}">
      <div class="ee-rows">${rows.map((r, i) => repeatRow(f, r, i)).join('')}</div>
      <button type="button" class="btn ghost sm" onclick="eeRowAdd('${f.k}')">＋ 添加一行</button>
      <span class="muted" style="margin-left:8px">最多 ${f.max || 20} 行</span></div>`
  }
  let rowSeq = 0
  function repeatRow(f, r, i) {
    const p = `r${++rowSeq}_`
    return `<div class="ee-row" data-p="${p}"><div class="ee-row-no">${i + 1}</div><div class="ee-row-grid">
      ${f.of.map((sf) => `<div class="ee-sub ${sf.type === 'textarea' ? 'wide' : ''}"><label>${E(sf.label)}${sf.required ? '<b>*</b>' : ''}</label>${control(sf, (r || {})[sf.k], p)}</div>`).join('')}</div>
      <div class="ee-row-ops"><button type="button" title="上移" onclick="eeRowMove(this,-1)">↑</button><button type="button" title="下移" onclick="eeRowMove(this,1)">↓</button><button type="button" title="删除" onclick="eeRowDel(this)">×</button></div></div>`
  }
  const renumber = (box) => box.querySelectorAll('.ee-row-no').forEach((n, i) => { n.textContent = i + 1 })
  window.eeRowAdd = (k) => {
    const f = fieldOf(k), box = document.getElementById(fid(k))
    if (box.querySelectorAll('.ee-row').length >= Number(box.dataset.max)) return toast('已达上限', true)
    box.querySelector('.ee-rows').insertAdjacentHTML('beforeend', repeatRow(f, {}, box.querySelectorAll('.ee-row').length)); eeDirty()
  }
  window.eeRowDel = (b) => { const box = b.closest('.ee-rows'); b.closest('.ee-row').remove(); renumber(box); eeDirty() }
  window.eeRowMove = (b, d) => {
    const row = b.closest('.ee-row'), sib = d < 0 ? row.previousElementSibling : row.nextElementSibling
    if (!sib) return
    d < 0 ? row.parentNode.insertBefore(row, sib) : row.parentNode.insertBefore(sib, row)
    renumber(row.parentNode); eeDirty()
  }

  /* ---------------- 取值 ---------------- */
  function read(f, p = '') {
    const el = document.getElementById(fid(f.k, p))
    if (!el) return undefined
    switch (f.type) {
      case 'switch': return el.checked ? 1 : 0
      case 'multi': return [...el.querySelectorAll('input:checked')].map((x) => x.value)
      case 'tags': return [...el.querySelectorAll('.ee-tag')].map((x) => x.dataset.v)
      case 'lines': return el.value.split('\n').map((s) => s.trim()).filter(Boolean)
      case 'image': return el.dataset.url || ''
      case 'gallery': return [...el.querySelectorAll('.ee-gitem')].map((x) => x.dataset.url)
      case 'rich': return el.innerHTML.trim() === '<br>' ? '' : el.innerHTML
      case 'ref': if (f.multiple) return [...el.querySelectorAll('input:checked')].map((x) => Number(x.value)); return el.value
      case 'repeat': return [...el.querySelectorAll('.ee-row')].map((row) => Object.fromEntries(f.of.map((sf) => [sf.k, read(sf, row.dataset.p)])))
      default: return el.value
    }
  }
  const fieldOf = (k) => st.schema.sections.flatMap((s) => s.fields).find((f) => f.k === k)
  const collect = () => Object.fromEntries(st.schema.sections.flatMap((s) => s.fields).map((f) => [f.k, read(f)]))

  window.eeDirty = () => { if (st && document.getElementById('eeRoot')) { st.dirty = true; applyShowIf(); progress() } }
  function applyShowIf() {
    for (const f of st.schema.sections.flatMap((s) => s.fields)) {
      if (!f.showIf) continue
      const cur = read(fieldOf(f.showIf[0]))
      const wrap = document.querySelector(`[data-field="${f.k}"]`)
      if (wrap) wrap.hidden = String(cur ?? '') !== f.showIf[1]
    }
  }
  const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length)
  function progress() {
    const vals = collect()
    const fs = st.schema.sections.flatMap((s) => s.fields).filter((f) => f.type !== 'switch')
    const pct = Math.round(fs.filter((f) => !empty(vals[f.k])).length / fs.length * 100)
    const ring = document.getElementById('eeRing')
    if (ring) { ring.style.setProperty('--p', pct); ring.querySelector('b').textContent = pct + '%' }
    st.schema.sections.forEach((s, i) => {
      const req = s.fields.filter((f) => f.required && !(f.showIf && document.querySelector(`[data-field="${f.k}"]`)?.hidden))
      const miss = req.filter((f) => empty(vals[f.k])).length
      const nav = document.querySelector(`.ee-nav a[data-i="${i}"] small`)
      if (nav) { nav.textContent = miss ? `缺 ${miss} 项必填` : `${s.fields.filter((f) => !empty(vals[f.k])).length}/${s.fields.length}`; nav.className = miss ? 'warn' : '' }
    })
  }

  /* ---------------- 主入口 ---------------- */
  window.entityEditor = async (kind, id, opts = {}) => {
    const action = `entity.${kind}.${id ? 'edit' : 'create'}`
    if (!adminCan(action)) return toast(adminWhy(action), true)
    if (st && st.dirty && !confirm('当前编辑尚未保存，确定放弃？')) return
    closeEditor(true)
    const root = document.createElement('div')
    root.id = 'eeRoot'
    root.innerHTML = `<div class="ee-overlay"></div><aside class="ee-drawer" role="dialog" aria-modal="true"><div class="ee-loading">${'<div class="sk sk-row"></div>'.repeat(6)}</div></aside>`
    document.body.appendChild(root)
    document.body.classList.add('dialog-open')
    try {
      const [schema, data] = await Promise.all([api('GET', '/admin/entity-schemas/' + kind), id ? api('GET', `/admin/entities/${kind}/${id}`) : Promise.resolve(null)])
      const values = data ? data.values : Object.fromEntries(schema.sections.flatMap((s) => s.fields).map((f) => [f.k, f.dflt ?? (opts.defaults || {})[f.k] ?? null]))
      Object.assign(values, id ? {} : (opts.defaults || {}))
      st = { kind, id, schema, values, dirty: false, opts, version: data && data.version != null ? Number(data.version) : undefined }
      render()
    } catch (e) { closeEditor(true); toast(e.message, true) }
  }
  function render() {
    const { schema, values, id } = st
    const title = id ? `编辑${schema.label}${values[schema.titleKey] ? ' · ' + E(String(values[schema.titleKey]).slice(0, 24)) : ''}` : `新建${schema.label}`
    const drawer = document.querySelector('#eeRoot .ee-drawer')
    drawer.innerHTML = `
      <header class="ee-head"><div class="ee-ring" id="eeRing" title="资料完整度"><b>0%</b></div>
        <div><h3>${title}</h3><p>${id ? 'ID ' + E(id) + ' · ' : ''}带 <b>*</b> 为必填；修改会写入审计日志</p></div>
        <button class="ee-close" onclick="eeClose()" aria-label="关闭">✕</button></header>
      <div class="ee-main">
        <nav class="ee-nav">${schema.sections.map((s, i) => `<a data-i="${i}" onclick="eeJump(${i})">${E(s.title)}<small></small></a>`).join('')}</nav>
        <div class="ee-body" id="eeBody">${schema.sections.map((s, i) => `
          <section class="ee-sec" id="eeSec${i}"><div class="ee-sec-h"><h4>${E(s.title)}</h4>${s.desc ? `<p>${E(s.desc)}</p>` : ''}</div>
            <div class="ee-grid">${s.fields.map((f) => `
              <div class="ee-field ${f.span === 2 || ['rich', 'gallery', 'repeat'].includes(f.type) ? 'span2' : ''}" data-field="${f.k}">
                <label for="${fid(f.k)}">${E(f.label)}${f.required ? '<b>*</b>' : ''}${f.isCol ? '' : ''}</label>
                ${control(f, values[f.k])}
                <div class="ee-help">${f.help ? E(f.help) : ''}<span class="ee-cnt"></span></div>
                <div class="ee-err" id="eeErr_${f.k}"></div>
              </div>`).join('')}</div></section>`).join('')}</div>
      </div>
      <footer class="ee-foot"><span class="muted" id="eeState">${id ? '已加载' : '新建'}</span><span style="flex:1"></span>
        <button class="btn ghost" onclick="eeClose()">取消</button>
        <button class="btn primary" id="eeSave" onclick="eeSave()">${id ? '保存修改' : '创建'}<small> Ctrl+S</small></button></footer>`
    drawer.querySelectorAll('.ee-rt-body').forEach((el) => { el.closest('.ee-rich').querySelector('.ee-rt-foot span').textContent = el.innerText.replace(/\s/g, '').length })
    drawer.addEventListener('input', (e) => { if (!e.target.closest('.ee-tags input,.ee-refm-q')) { counter(e.target); eeDirty() } })
    drawer.addEventListener('change', (e) => { if (e.target.closest('.ee-switch')) e.target.nextElementSibling.nextElementSibling.textContent = e.target.checked ? '是' : '否'; eeDirty() })
    drawer.querySelectorAll('[data-count]').forEach(counter)
    // 只读字段（如暗号/佣金页里的线路名称）：展示用，服务端也不会写入
    st.schema.sections.flatMap((x) => x.fields).filter((f) => f.readonly).forEach((f) => document.querySelectorAll(`[data-field="${f.k}"] input,[data-field="${f.k}"] select,[data-field="${f.k}"] textarea`).forEach((el) => { el.disabled = true }))
    document.querySelector('#eeRoot .ee-overlay').onclick = () => eeClose()
    const body = document.getElementById('eeBody')
    body.addEventListener('scroll', () => {
      if (!st) return
      let cur = 0
      st.schema.sections.forEach((_, i) => { if (document.getElementById('eeSec' + i).offsetTop - body.scrollTop < 120) cur = i })
      document.querySelectorAll('.ee-nav a').forEach((a) => a.classList.toggle('on', Number(a.dataset.i) === cur))
    })
    applyShowIf(); progress(); st.dirty = false
    document.querySelector('.ee-nav a')?.classList.add('on')
    drawer.querySelector('input,select,textarea,[contenteditable]')?.focus()
  }
  function counter(el) {
    if (!el?.dataset?.count) return
    const c = el.closest('.ee-field,.ee-sub')?.querySelector('.ee-cnt')
    if (c) c.textContent = `${el.value.length}/${el.dataset.count}`
  }
  window.eeJump = (i) => { const b = document.getElementById('eeBody'); b.scrollTo({ top: document.getElementById('eeSec' + i).offsetTop - 8, behavior: 'smooth' }) }

  window.eeSave = async () => {
    if (!st) return
    const action = `entity.${st.kind}.${st.id ? 'edit' : 'create'}`
    if (!adminCan(action)) return toast(adminWhy(action), true)
    document.querySelectorAll('.ee-err').forEach((x) => { x.textContent = '' })
    document.querySelectorAll('.ee-field.bad').forEach((x) => x.classList.remove('bad'))
    const btn = document.getElementById('eeSave')
    btn.disabled = true; document.getElementById('eeState').textContent = '保存中…'
    try {
      const values = collect()
      const r = st.id
        ? await api('PUT', `/admin/entities/${st.kind}/${st.id}`, { values, expectedVersion: st.version })
        : await api('POST', `/admin/entities/${st.kind}`, { values, parentId: st.opts.parentId })
      st.dirty = false
      if (r.version != null) st.version = Number(r.version) // 乐观锁版本随保存递增，继续编辑不误报冲突
      toast(st.id ? (r.changed.length ? `已保存 ${r.changed.length} 处修改` : '没有需要保存的修改') : `${st.schema.label}已创建`)
      const cb = st.opts.onSaved
      closeEditor(true)
      if (cb) cb(r.id); else if (typeof go === 'function') go(location.hash.slice(1) || 'dash', { history: false })
    } catch (e) {
      const errs = e.fieldErrors || {}
      let first = null
      for (const [k, msg] of Object.entries(errs)) {
        const box = document.getElementById('eeErr_' + k)
        if (box) { box.textContent = msg; box.closest('.ee-field').classList.add('bad'); first ||= box }
      }
      if (first) first.closest('.ee-field').scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.getElementById('eeState').textContent = Object.keys(errs).length ? `有 ${Object.keys(errs).length} 处需要修改` : '保存失败'
      toast(e.message, true)
    } finally { if (document.getElementById('eeSave')) btn.disabled = false }
  }
  function closeEditor(force) {
    document.getElementById('eeRoot')?.remove()
    document.body.classList.remove('dialog-open')
    st = null
  }
  window.eeClose = () => { if (st && st.dirty && !confirm('修改尚未保存，确定关闭？')) return; closeEditor(true) }
  // 无条件关闭（供工作台「返回工作台」的统一脏检查后调用；不走本编辑器自己的 confirm，避免双重确认）
  window.eeCloseHard = () => closeEditor(true)
  document.addEventListener('keydown', (e) => {
    if (!st) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); eeSave() }
    if (e.key === 'Escape') { e.stopPropagation(); eeClose() }
  }, true)
  window.addEventListener('beforeunload', (e) => { if (st && st.dirty) { e.preventDefault(); e.returnValue = '' } })

  /* 列表页小部件：完整度条 + 缩略图 */
  window.eeCompleteness = async (kind) => { try { return Object.fromEntries((await api('GET', '/admin/entities/' + kind)).map((r) => [String(r.id), r])) } catch { return {} } }
  window.eeBar = (info) => info ? `<div class="ee-bar" title="资料完整度 ${info.completeness}%"><i style="width:${info.completeness}%" class="${info.completeness < 40 ? 'low' : info.completeness < 75 ? 'mid' : ''}"></i></div><span class="td-sub">资料 ${info.completeness}%</span>` : ''
  window.eeThumb = (info) => info && info.cover ? `<img class="ee-thumb" src="${E(info.cover)}" alt="">` : '<span class="ee-thumb empty">无图</span>'
})()
