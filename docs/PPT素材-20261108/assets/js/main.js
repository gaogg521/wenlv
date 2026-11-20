/* 向往的自由 · 宣传网站 交互脚本（无依赖，file:// 直开可用） */
(function () {
  'use strict';

  /* ===== 导航：滚动投影 + 移动端抽屉 ===== */
  var nav = document.querySelector('.nav');
  var burger = document.querySelector('.nav-burger');
  var drawer = document.querySelector('.nav-drawer');
  if (burger && drawer) {
    burger.addEventListener('click', function () {
      drawer.classList.toggle('open');
    });
    drawer.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') drawer.classList.remove('open');
    });
  }
  function onScroll() {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ===== 入场动效：分区间淡入（一次性播放） ===== */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  /* ===== 盖章动效：徽章进入视口时触发一次 ===== */
  var stamps = document.querySelectorAll('.stamp-target');
  if ('IntersectionObserver' in window && stamps.length) {
    var sio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('stamp-in');
          sio.unobserve(en.target);
        }
      });
    }, { threshold: 0.4 });
    stamps.forEach(function (el) { sio.observe(el); });
  } else {
    stamps.forEach(function (el) { el.classList.add('stamp-in'); });
  }

  /* ===== 数字滚动 count-up（800ms） ===== */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count') || '0');
    var dur = 800;
    var start = null;
    var suffix = el.getAttribute('data-suffix') || '';
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString('zh-CN') + (p === 1 ? suffix : '');
      if (p < 1) requestAnimationFrame(step);
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = target.toLocaleString('zh-CN') + suffix;
      return;
    }
    requestAnimationFrame(step);
  }
  var counters = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window && counters.length) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          countUp(en.target);
          cio.unobserve(en.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { cio.observe(el); });
  } else {
    counters.forEach(countUp);
  }

  /* ===== 导航高亮：当前分区同步（仅首页可见分区） ===== */
  var sections = document.querySelectorAll('section[id]');
  var navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');
  if (sections.length && navAnchors.length && 'IntersectionObserver' in window) {
    var nio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (document.body.getAttribute('data-current-page') !== 'home') return;
        var pg = en.target.closest('.page');
        if (pg && pg.hidden) return;
        if (en.isIntersecting) {
          navAnchors.forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id);
          });
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { nio.observe(s); });
  }

  /* ===== 合作意向表单（首页 + 招募页）：无后端，mailto 承接 ===== */
  document.querySelectorAll('form.lead-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var val = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value : ''; };
      var name = val('name'), role = val('role'), city = val('city'), desc = val('desc'), phone = val('phone');
      var subject = '【向往的自由】合作意向 - ' + (role || '未填写') + ' - ' + name;
      var body = '姓名：' + name + '\n身份：' + role + '\n城市：' + city + '\n联系电话：' + phone + '\n资源简述：\n' + desc;
      var tip = form.querySelector('.form-tip');
      window.location.href = 'mailto:hello@xiangwangziyou.example?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      if (tip) tip.textContent = '已唤起邮件客户端；如未打开，请复制信息发送至 hello@xiangwangziyou.example';
    });
  });

  /* ===== 四端实况：端切换 ===== */
  var endTabs = document.getElementById('endTabs');
  if (endTabs) {
    endTabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.end-tab');
      if (!btn) return;
      endTabs.querySelectorAll('.end-tab').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      var t = btn.getAttribute('data-t');
      endTabs.querySelectorAll('.end-pane').forEach(function (p) {
        p.classList.toggle('active', p.getAttribute('data-p') === t);
      });
    });
  }

  /* ===== 线路库页：主题筛选 ===== */
  var filterBar = document.getElementById('routeFilter');
  if (filterBar) {
    var cards = document.querySelectorAll('.route-card[data-cat]');
    filterBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      filterBar.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      var f = btn.getAttribute('data-filter');
      cards.forEach(function (c) {
        c.style.display = (f === 'all' || c.getAttribute('data-cat') === f) ? '' : 'none';
      });
    });
  }
})();
