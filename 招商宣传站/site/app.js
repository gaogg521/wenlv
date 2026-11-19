(() => {
  'use strict';

  // Travel photography crossfades, with a user-controlled and motion-aware timer.
  const hero = document.querySelector('.hero');
  const heroPhotos = [...document.querySelectorAll('.hero-photo')];
  const heroDots = [...document.querySelectorAll('[data-hero-slide]')];
  const playButton = document.querySelector('.hero-play');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const captions = ['浙江 · 乌镇 / 走进水乡生活', '北京 · 古建 / 看见文化', '上海 · 朱家角 / 在水岸读懂日常', '北京 · 长城 / 让旅程成为经历'];
  let heroIndex = 0;
  let paused = motionPreference.matches;
  let heroVisible = true;
  let heroTimer;
  let focusHeld = false;
  function showSlide(index) {
    heroIndex = (index + heroPhotos.length) % heroPhotos.length;
    heroPhotos.forEach((photo, i) => photo.classList.toggle('is-active', i === heroIndex));
    heroDots.forEach((dot, i) => { dot.classList.toggle('active', i === heroIndex); dot.setAttribute('aria-current', String(i === heroIndex)); });
    document.querySelector('#hero-caption').textContent = captions[heroIndex];
    document.querySelector('.hero-counter').textContent = String(heroIndex + 1).padStart(2, '0') + ' / 04';
  }
  function updatePlayback() {
    clearInterval(heroTimer);
    playButton.textContent = paused ? '播放' : '暂停';
    playButton.setAttribute('aria-label', paused ? '播放轮播' : '暂停轮播');
    playButton.setAttribute('aria-pressed', String(paused));
    hero.classList.toggle('rotation-paused', paused || !heroVisible || document.hidden || focusHeld);
    if (!paused && heroVisible && !document.hidden && !focusHeld) heroTimer = setInterval(() => showSlide(heroIndex + 1), 6500);
  }
  heroDots.forEach((dot, index) => dot.addEventListener('click', () => { showSlide(index); paused = true; updatePlayback(); }));
  document.querySelector('[data-hero-prev]').addEventListener('click', () => { showSlide(heroIndex - 1); paused = true; updatePlayback(); });
  document.querySelector('[data-hero-next]').addEventListener('click', () => { showSlide(heroIndex + 1); paused = true; updatePlayback(); });
  playButton.addEventListener('click', () => { paused = !paused; focusHeld = false; updatePlayback(); });
  hero.addEventListener('focusin', () => { focusHeld = true; updatePlayback(); });
  hero.addEventListener('focusout', () => setTimeout(() => { focusHeld = hero.contains(document.activeElement); updatePlayback(); }, 0));
  document.addEventListener('visibilitychange', updatePlayback);
  motionPreference.addEventListener('change', () => { paused = motionPreference.matches; updatePlayback(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { heroVisible = entries[0].isIntersecting; updatePlayback(); }, {threshold:0.15}).observe(hero);
  updatePlayback();


  const themes = {
    mystery: ['剧本探秘', '在真实的古镇里，\n成为故事的主角。', '把石桥、街巷与在地文化变成线索，在探索与协作中认识一座城。', ['从场景进入故事，而不是只路过景点', '把解谜、交流与文化观察放进同一段旅程', '留下笔记、照片与属于自己的旅行记忆'], 'assets/scene-theme-mystery-14553043.webp'],
    women: ['她的旅行', '把时间留给自己，\n也留给合拍的她们。', '把文化漫游、在地生活与轻松交流放在一起，找到适合自己的旅行节奏。', ['以兴趣与节奏选择体验', '给交流、观察与休息留出空间', '让创作记录自己的表达'], 'assets/scene-theme-women-34486996.webp'],
    friends: ['好友社交', '一起做点有趣的事，\n比刻意找话题更自然。', '从共同的玩法开始认识彼此，把协作、交流与目的地探索放进同一个周末。', ['按主题找到相近的兴趣', '活动安排和参与条件提前看清', '把共同经历变成值得分享的作品'], 'assets/scene-theme-friends-28770560.webp'],
    wellness: ['身心疗愈', '不用赶路，\n先把节奏交还给自己。', '从湖边慢行到安静观察，让旅行留有空白，以适合自己的方式放松。', ['查看强度、时长与适用人群', '为休息和在地生活留出时间', '不把慢旅行变成另一份打卡清单'], 'assets/scene-theme-wellness-36849810.webp'],
    sport: ['运动户外', '因为热爱而同行，\n在参与中认识彼此。', '让运动成为探索目的地的方式，按实际开放的产品选择适合自己的活动。', ['先确认活动强度与安全要求', '按天气、体力和开放信息安排', '把合作与体验放在结果之前'], 'assets/scene-theme-sport-6513728.webp'],
    family: ['亲子自然', '孩子多一个发现，\n全家多一段共同记忆。', '把自然观察、文化学习与亲子互动放在同一段旅程，让陪伴有具体的内容。', ['查看年龄、陪同与活动条件', '以观察、交流和体验为线索', '用照片和笔记留下亲子发现'], 'assets/scene-theme-family-31829081.webp'],
    culture: ['文化研学', '走进一段历史，\n读懂眼前的生活。', '让建筑、街巷与地方故事相互连接，不只看见形式，也了解它们与人的关系。', ['从可观察的场景进入文化', '用问题、任务和记录加深理解', '以开放与尊重的方式认识在地生活'], 'assets/scene-theme-culture-40530663.webp'],
    explore: ['远方探索', '走向更大的世界，\n也看见新的自己。', '目的地不只是一个名字。从自己的兴趣出发，了解下一段值得认真体验的旅程。', ['先看内容，再确认实际产品', '核对预约、交通与出行须知', '把经历沉淀为作品与旅行履历'], 'assets/scene-theme-explore-36535763.webp']
  };
  function fillList(selector, items) { document.querySelector(selector).replaceChildren(...items.map(text => { const item = document.createElement('li'); item.textContent = text; return item; })); }
  function markChoice(selector, selected) { document.querySelectorAll(selector).forEach(button => { button.classList.toggle('active', button === selected); button.setAttribute('aria-pressed', String(button === selected)); }); }
  document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => {
    const [name, title, copy, points, image] = themes[button.dataset.theme];
    markChoice('[data-theme]', button);
    document.querySelector('#theme-tag').textContent = name + ' · 主题灵感';
    document.querySelector('#theme-title').textContent = title;
    document.querySelector('#theme-copy').textContent = copy;
    fillList('#theme-points', points);
    const photo = document.querySelector('#theme-photo'); photo.src = image; photo.alt = name + '旅行氛围示意';
  }));
  const rewards = {
    earn: ['每一份奖励，都有对应的参与。', '符合规则的消费、约稿或创作任务，可按相应规则获得旅豆。符合条件的笔记可获旅豆，先看标准、审核与上限，再开始创作。', ['来源和变动记录可查', '奖励须满足活动与审核规则', '具体比例、数量与资格在小程序明示']],
    use: ['从账户里的记录，走向下一次消费。', '旅豆在适用订单中按规则抵扣，实际可用数量由账户余额、产品条件和单笔上限共同决定。先看试算，再确认支付。', ['不是所有产品、场景都默认适用', '注意有效期、可用余额与抵扣上限', '退款与取消按订单规则处理相应权益']],
    sustain: ['权益有预算，生态才走得长。', '发放以业务规则和预算为基础，使用、过期与退款变动留有账本记录。让奖励与真实参与相对应，让商户清楚成本与结算。', ['预算批次与总量控制约束发放', '发放、抵扣与变动记录相互对应', '权益不承诺升值或投资收益']]
  };
  document.querySelectorAll('[data-reward]').forEach(button => button.addEventListener('click', () => { const [title, copy, points] = rewards[button.dataset.reward]; markChoice('[data-reward]', button); document.querySelector('#reward-title').textContent = title; document.querySelector('#reward-copy').textContent = copy; fillList('#reward-points', points); }));
  const credentials = {
    pass: ['TRAVEL PASS / 出行凭证', '一次出发，有迹可循。', [['对应关系', '关联订单与适用人次'], ['使用状态', '待核销 / 已核销等'], ['有效范围', '按行程和使用规则校验']], '现场核销时，系统检查凭证、适用条件和状态，减少重复使用或口头确认。出行权益的有效期与留存的旅行记录分开看。'],
    identity: ['TRAVEL ID / 旅行履历', '每一份参与，都能留下记忆。', [['个人成长', '会员等级与成长记录'], ['旅程收获', '城市、旅程与荣誉徽章'], ['访问范围', '按授权与角色查看']], '把散落在订单和活动中的参与，整理为可查看的成长与旅行履历。记录让自己回望，也为适用的服务与协作提供依据，不承诺通行所有平台。'],
    proof: ['VERIFIABLE RECORD / 可信证明', '不只展示一张图，也能核对依据。', [['签发来源', '核对由谁签发'], ['内容完整性', '检查签名是否匹配'], ['当前有效性', '检查有效期与撤销状态']], '可信凭证的价值是核验来源、完整性与当前有效状态；关键业务记录可关联存证核验。技术用于减少“只凭截图或口头承诺”的信息差，不替代服务质量和售后责任。']
  };
  document.querySelectorAll('[data-credential]').forEach(button => button.addEventListener('click', () => { const [kind, title, fields, copy] = credentials[button.dataset.credential]; markChoice('[data-credential]', button); document.querySelector('#credential-kind').textContent = kind; document.querySelector('#credential-title').textContent = title; document.querySelector('#credential-copy').textContent = copy; const rows = fields.map(([label, value]) => { const row = document.createElement('div'); const name = document.createElement('span'); const detail = document.createElement('b'); name.textContent = label; detail.textContent = value; row.append(name, detail); return row; }); document.querySelector('#credential-fields').replaceChildren(...rows); }));


  const ecosystemRoles = {
    traveler: ['FOR TRAVELERS', '因为喜欢而出发，\n带着收获再回来。', '从真实内容中发现兴趣，选择合适的主题体验。把旅行作品、旅豆权益与个人履历留下，成为下一次出发的理由。', ['主题体验', '清楚的权益规则', '属于自己的旅行记录']],
    creator: ['FOR CREATORS', '让值得分享的内容，\n连接真实的旅行。', '在广场展示作品，参与约稿与内容共创，让目的地被更多人看见。创作奖励与推广计酬分别按任务规则、资格和有效交易办理。', ['作品展示与互动', '约稿与创作任务', '规则清楚的贡献记录']],
    merchant: ['FOR LOCAL BUSINESS', '认真接待每一位来客，\n让经营有据可循。', '用商品、预约与在地体验承接旅行需求。游客实付、权益补贴与结算分列，订单履约、库存和差异处理有清晰的入口。', ['供给与预约管理', '订单核销与留痕', '清晰对账和结算']],
    partner: ['FOR CITY PARTNERS', '连接一座城的资源，\n让协作持续发生。', '连接本地供给、内容与渠道，围绕真实服务和有效交易协作。在授权范围内查看归因与经营记录，按合作方案明确分工与结算。', ['在地资源协作', '渠道与内容连接', '按规则归因和对账']]
  };
  document.querySelectorAll('[data-eco-role]').forEach(button => button.addEventListener('click', () => {
    const role = button.dataset.ecoRole;
    const [label, title, copy, benefits] = ecosystemRoles[role];
    document.querySelectorAll('[data-eco-role]').forEach(node => { const selected = node === button; node.classList.toggle('active', selected); node.setAttribute('aria-pressed', String(selected)); });
    document.querySelector('.ecosystem-map').dataset.activeRole = role;
    document.querySelectorAll('[data-edge]').forEach(edge => edge.classList.toggle('is-active', edge.dataset.edge === role));
    document.querySelector('#eco-detail-label').textContent = label;
    document.querySelector('#eco-detail-title').textContent = title;
    document.querySelector('#eco-detail-copy').textContent = copy;
    document.querySelector('#eco-detail-benefits').replaceChildren(...benefits.map(text => { const span = document.createElement('span'); span.textContent = text; return span; }));
  }));

  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#main-nav');
  const setMenu = (open) => { nav.classList.toggle('open', open); menuButton.setAttribute('aria-expanded', String(open)); menuButton.setAttribute('aria-label', open ? '关闭导航' : '打开导航'); };
  menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
  nav.querySelectorAll('a,button').forEach(el => el.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenu(false); });
  const dialogs = [...document.querySelectorAll('dialog')];
  let returnFocus = null;
  function openDialog(dialog, trigger) {
    returnFocus = trigger || document.activeElement;
    dialogs.forEach(d => { if (d.open) d.close(); });
    dialog.showModal(); document.body.classList.add('modal-open');
    dialog.scrollTop = 0;
  }
  dialogs.forEach(dialog => {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('close', () => { if (!dialogs.some(d => d.open)) { document.body.classList.remove('modal-open'); if (returnFocus && returnFocus.isConnected) returnFocus.focus({preventScroll:true}); } });
  });
  document.querySelectorAll('[data-experience]').forEach(button => button.addEventListener('click', () => openDialog(document.querySelector('#experience-dialog'), button)));
  const stories = {
  "heritage": {
    "title": "沿着建筑，读懂一段时光。",
    "place": "山西 · 古建 / 旅行灵感示例",
    "image": "assets/scene-destination-town-34494754.webp",
    "alt": "晴空下的山西传统古建筑",
    "description": "从屋檐、雕饰与院落的细节开始，认识地方文化在建筑中的表达。",
    "points": [
      "提前核对天气、开放信息与出行安排。",
      "选择与体力和兴趣相适应的游览方式。",
      "用自己的观察完成笔记，记录真实感受。"
    ]
  },
  "lake": {
    "title": "湖风刚刚好，今天不赶下一站。",
    "place": "云南 · 丽江 / 旅行灵感示例",
    "image": "assets/photo-33970873.webp",
    "alt": "晴天的丽江山湖",
    "description": "给湖边留一点时间。远处的山、近处的水，都可以成为笔记里的一个片段。",
    "points": [
      "提前核对天气、开放信息与出行安排。",
      "选择与体力和兴趣相适应的游览方式。",
      "用自己的观察完成笔记，记录真实感受。"
    ]
  },
  "guilin": {
    "title": "群山之间，给目光留一点远方。",
    "place": "广西 · 桂林 / 旅行灵感示例",
    "image": "assets/scene-story-guilin-36204297.webp",
    "alt": "桂林连绵的喀斯特群山",
    "description": "山峰层层铺向远方，每一段光影都有不同的形状。用自己的节奏观察山水。",
    "points": [
      "提前核对天气、开放信息与出行安排。",
      "选择与体力和兴趣相适应的游览方式。",
      "用自己的观察完成笔记，记录真实感受。"
    ]
  },
  "westlake": {
    "title": "沿湖走一段，把日常慢下来。",
    "place": "浙江 · 杭州 / 旅行灵感示例",
    "image": "assets/scene-story-westlake-37254292.webp",
    "alt": "西湖绿树与拱桥倒映在水面",
    "description": "绿树、湖水与拱桥，把一段轻松的城市漫步连接起来。不必赶着填满每一个行程格子。",
    "points": [
      "提前核对天气、开放信息与出行安排。",
      "选择与体力和兴趣相适应的游览方式。",
      "用自己的观察完成笔记，记录真实感受。"
    ]
  },
  "huangshan": {
    "title": "看松风与山脊，听一段自然的故事。",
    "place": "安徽 · 黄山 / 旅行灵感示例",
    "image": "assets/scene-story-huangshan-33921415.webp",
    "alt": "晴天下黄山的山峰与青松",
    "description": "在山峰、青松与天空之间，看见自然的层次，也为下一次旅行留下新的灵感。",
    "points": [
      "提前核对天气、开放信息与出行安排。",
      "选择与体力和兴趣相适应的游览方式。",
      "用自己的观察完成笔记，记录真实感受。"
    ]
  }
};
  document.querySelectorAll('[data-story]').forEach(button => button.addEventListener('click', () => {
    const story = stories[button.dataset.story];
    document.querySelector('#story-title').textContent = story.title;
    document.querySelector('#story-place').textContent = story.place;
    document.querySelector('#story-description').textContent = story.description;
    const image = document.querySelector('#story-photo'); image.src = story.image; image.alt = story.alt;
    const points = document.querySelector('#story-points'); points.replaceChildren(...story.points.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    openDialog(document.querySelector('#story-dialog'), button);
  }));
  document.querySelector('[data-screen]').addEventListener('click', event => openDialog(document.querySelector('#screen-dialog'), event.currentTarget));
  const tabs = [...document.querySelectorAll('[data-tab]')];
  function selectTab(tab) { tabs.forEach(button => { const selected = button === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; document.getElementById(button.getAttribute('aria-controls')).hidden = !selected; }); }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectTab(tabs[next]); tabs[next].focus(); }
    });
  });
  let toastTimer;
  function toast(text) { const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3500); }
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); toast('联系电话已复制'); }
    catch { toast('请长按或选择电话号码复制：' + button.dataset.copy); }
  }));
})();
/* Progressive entry effects: no hiding content, and reduced motion stays static. */
(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add('editorial-enter');
      observer.unobserve(entry.target);
    }
  }, {threshold: .08});
  document.querySelectorAll('.section-head,.why-columns article,.theme-feature,.destination,.story-card,.creation-bar,.product-tabs,.reward-explain,.trust-card,.ecosystem-heading,.ecosystem-detail,.partner-grid article,.faq-layout,.contact-layout').forEach(el => observer.observe(el));
})();
