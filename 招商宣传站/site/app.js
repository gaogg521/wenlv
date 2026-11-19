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
  playButton.addEventListener('click', () => { paused = !paused; focusHeld = false; updatePlayback(); });
  hero.addEventListener('focusin', () => { focusHeld = true; updatePlayback(); });
  hero.addEventListener('focusout', () => setTimeout(() => { focusHeld = hero.contains(document.activeElement); updatePlayback(); }, 0));
  document.addEventListener('visibilitychange', updatePlayback);
  motionPreference.addEventListener('change', () => { paused = motionPreference.matches; updatePlayback(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { heroVisible = entries[0].isIntersecting; updatePlayback(); }, {threshold:0.15}).observe(hero);
  updatePlayback();


  const themes = {
    mystery: ['剧本探秘', '在真实的古镇里，\n成为故事的主角。', '把石桥、街巷与在地文化变成线索，在探索与协作中认识一座城。', ['从场景进入故事，而不是只路过景点', '把解谜、交流与文化观察放进同一段旅程', '留下笔记、照片与属于自己的旅行记忆'], 'assets/hero-wuzhen.webp'],
    women: ['她的旅行', '把时间留给自己，\n也留给合拍的她们。', '把文化漫游、在地生活与轻松交流放在一起，找到适合自己的旅行节奏。', ['以兴趣与节奏选择体验', '给交流、观察与休息留出空间', '让创作记录自己的表达'], 'assets/canal.webp'],
    friends: ['好友社交', '一起做点有趣的事，\n比刻意找话题更自然。', '从共同的玩法开始认识彼此，把协作、交流与目的地探索放进同一个周末。', ['按主题找到相近的兴趣', '活动安排和参与条件提前看清', '把共同经历变成值得分享的作品'], 'assets/hero-wuzhen.webp'],
    wellness: ['身心疗愈', '不用赶路，\n先把节奏交还给自己。', '从湖边慢行到安静观察，让旅行留有空白，以适合自己的方式放松。', ['查看强度、时长与适用人群', '为休息和在地生活留出时间', '不把慢旅行变成另一份打卡清单'], 'assets/photo-33970873.webp'],
    sport: ['运动户外', '因为热爱而同行，\n在参与中认识彼此。', '让运动成为探索目的地的方式，按实际开放的产品选择适合自己的活动。', ['先确认活动强度与安全要求', '按天气、体力和开放信息安排', '把合作与体验放在结果之前'], 'assets/great-wall.webp'],
    family: ['亲子自然', '孩子多一个发现，\n全家多一段共同记忆。', '把自然观察、文化学习与亲子互动放在同一段旅程，让陪伴有具体的内容。', ['查看年龄、陪同与活动条件', '以观察、交流和体验为线索', '用照片和笔记留下亲子发现'], 'assets/canal.webp'],
    culture: ['文化研学', '走进一段历史，\n读懂眼前的生活。', '让建筑、街巷与地方故事相互连接，不只看见形式，也了解它们与人的关系。', ['从可观察的场景进入文化', '用问题、任务和记录加深理解', '以开放与尊重的方式认识在地生活'], 'assets/photo-31314824.webp'],
    explore: ['远方探索', '走向更大的世界，\n也看见新的自己。', '目的地不只是一个名字。从自己的兴趣出发，了解下一段值得认真体验的旅程。', ['先看内容，再确认实际产品', '核对预约、交通与出行须知', '把经历沉淀为作品与旅行履历'], 'assets/great-wall.webp']
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
    town: {title:'留半天给水乡，看小舟把日子划慢。', place:'上海 · 朱家角 / 旅行灵感示例', image:'assets/canal.webp', alt:'朱家角河道与水岸建筑', description:'江南的风景，不只有一座桥。把老街、小巷和河边的日常放在同一段漫步里，给出发一个轻松的理由。', points:['把桥、老街与水岸串成一段步行清单。','选择感兴趣的在地体验，提前查看预约说明。','用照片、视频或攻略图，留下自己的观察。']},
    friends: {title:'和喜欢的人，去喜欢的地方。', place:'好友出游 / 户外灵感示例', image:'assets/hero-wuzhen.webp', alt:'晴天的水乡旅行场景', description:'找一个晴朗的日子，和朋友走进户外。聊天、看风景、拍下一张合照，让周末多一点轻松和活力。', points:['按体力与天气选择适合自己的路线。','轻装出发，备好饮水与防晒。','图片为户外旅行氛围示意，具体活动与目的地请在小程序查看。']},
    lake: {title:'湖风刚刚好，今天不赶下一站。', place:'云南 · 丽江 / 旅行灵感示例', image:'assets/photo-33970873.webp', alt:'晴天的丽江山湖', description:'不急着填满行程，先给湖边留一点时间。远处的山、近处的水，都可以成为笔记里的一个片段。', points:['选一段适合自己的湖岸漫步，留出休息时间。','查看天气与现场开放信息，按实际条件安排出行。','把路线与喜欢的风景做成攻略图，分享给同路的人。']},
    wall: {title:'沿着山脊，把视野再放远一点。', place:'北京 · 长城 / 旅行灵感示例', image:'assets/great-wall.webp', alt:'群山之间的长城', description:'起伏的山脊，蜿蜒的城墙。目的地值得被看见，也值得用适合自己的节奏慢慢了解。', points:['出发前确认开放区域、预约与交通安排。','按体力选择路线，做好防晒、防风与补水。','用文字、照片和视频，记录属于自己的旅程。']}
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
