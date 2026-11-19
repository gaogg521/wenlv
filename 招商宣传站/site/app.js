(() => {
  'use strict';

  // Travel photography crossfades, with a user-controlled and motion-aware timer.
  const hero = document.querySelector('.hero');
  const heroPhotos = [...document.querySelectorAll('.hero-photo')];
  const heroDots = [...document.querySelectorAll('[data-hero-slide]')];
  const playButton = document.querySelector('.hero-play');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const captions = ['云南 · 丽江 / 山湖晴光', '北京 · 古建 / 看见文化', '好友同行 / 户外旅行灵感', '北京 · 长城 / 去看更大的世界'];
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
    friends: {title:'和喜欢的人，去喜欢的地方。', place:'好友出游 / 户外灵感示例', image:'assets/photo-7348780.webp', alt:'晴天下结伴徒步的年轻旅行者', description:'找一个晴朗的日子，和朋友走进户外。聊天、看风景、拍下一张合照，让周末多一点轻松和活力。', points:['按体力与天气选择适合自己的路线。','轻装出发，备好饮水与防晒。','图片为户外旅行氛围示意，具体活动与目的地请在小程序查看。']},
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
