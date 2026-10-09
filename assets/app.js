(() => {
  'use strict';
  const preferenceStore = window.MCSAPreferences.create();
  let preferences = preferenceStore.value;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => !preferences.motion || motionQuery.matches;
  let lang = preferences.language;
  if (document.body.dataset.page === 'admin') lang = 'zh';
  let preferenceDraft = null, preferenceStatus = '', homeReady = false;
  const previewMode = new URLSearchParams(location.search).has('preview');
  let promptResize = null, statusResize = null, closeIntro = null;
  let data = window.MCSA_DATA;
  let slide = 0,
    timer = null,
    paused = false;
  const page = document.body.dataset.page;
  let startX = 0;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]));
  const t = o => typeof o === 'string' ? o : (o?.[lang] || '');
  const ui = (zh, en, hant) => t(data.interfaceText?.[zh] || {
    zh,
    en,
    hant
  });

  function storageStatus(result) {
    if (!result.persistent) return result.session
      ? ui('浏览器无法长期保存；选择仅在当前标签页会话内有效。', 'Your browser cannot save permanently. Choices apply to this tab session only.', '瀏覽器無法長期保存；選擇僅在當前標籤頁工作階段內有效。')
      : ui('浏览器无法保存；选择仅在当前页面有效。', 'Your browser cannot save. Choices apply to this page only.', '瀏覽器無法保存；選擇僅在當前頁面有效。');
    if (preferences.remember) return ui('偏好已保存。', 'Preferences saved.', '偏好已保存。');
    return result.session
      ? ui('已记住不保存的决定；其他偏好仅在当前标签页会话内有效。', 'Your decision not to save is remembered. Other preferences apply to this tab session only.', '已記住不保存的決定；其他偏好僅在當前標籤頁工作階段內有效。')
      : ui('已记住不保存的决定；浏览器无法保存临时偏好，其他选择仅在当前页面有效。', 'Your decision not to save is remembered. Temporary preferences could not be saved and apply to this page only.', '已記住不保存的決定；瀏覽器無法保存臨時偏好，其他選擇僅在當前頁面有效。');
  }

  function notifyPreferences() {
    preferences = preferenceStore.value;
    window.dispatchEvent(new CustomEvent('mcsa-preferences-change', {
      detail: Object.freeze({ ...preferences, reducedMotion: reducedMotion() })
    }));
  }

  function showStorageStatus(message) {
    const live = document.querySelector('#local-preferences-status');
    if (!live) return;
    statusResize?.disconnect();
    live.innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="${ui('关闭提示', 'Dismiss notice', '關閉提示')}">×</button>`;
    const resize = () => document.documentElement.style.setProperty('--privacy-status-height', `${live.getBoundingClientRect().height}px`);
    statusResize = new ResizeObserver(resize);
    statusResize.observe(live);
    resize();
    live.querySelector('button').onclick = () => {
      statusResize?.disconnect();
      statusResize = null;
      live.replaceChildren();
      document.documentElement.style.removeProperty('--privacy-status-height');
      document.querySelector('.brand')?.focus({ preventScroll: true });
    };
  }

  function removePrivacyPrompt() {
    promptResize?.disconnect();
    promptResize = null;
    document.querySelector('#privacy-prompt')?.remove();
    document.documentElement.style.removeProperty('--privacy-prompt-height');
    document.body.classList.remove('has-privacy-prompt');
  }

  function privacyPrompt() {
    removePrivacyPrompt();
    if (page !== 'home' || !homeReady || previewMode || preferences.choice || document.querySelector('.opening')) return;
    const card = document.createElement('section');
    card.id = 'privacy-prompt';
    card.className = 'privacy-prompt';
    card.setAttribute('aria-labelledby', 'privacy-prompt-title');
    card.innerHTML = `<div class="privacy-prompt-copy"><h2 id="privacy-prompt-title">${ui('您的隐私与本机偏好', 'Your privacy and local preferences', '您的隱私與本機偏好')}</h2>
      <p>${ui('允许保存后，我们会在这个浏览器记住语言、开场动画和动态效果选择。不保存时，仅长期记住这个决定，其他选择在当前标签页会话内有效。', 'Allow saving to remember your language, intro and motion choices in this browser. If you decline, only that decision is remembered permanently; other choices apply to this tab session.', '允許保存後，我們會在這個瀏覽器記住語言、開場動畫和動態效果選擇。不保存時，僅長期記住這個決定，其他選擇在當前標籤頁工作階段內有效。')}</p></div>
      <div class="privacy-prompt-actions"><button type="button" class="button primary" data-privacy-choice="allowed">${ui('允许保存', 'Allow saving', '允許保存')}</button>
      <button type="button" class="button" data-privacy-choice="denied">${ui('不保存', 'Do not save', '不保存')}</button>
      ${a('privacy-settings.html', ui('自定义设置', 'Customize settings', '自訂設置'), 'text-link')}</div>`;
    document.body.append(card);
    document.body.classList.add('has-privacy-prompt');
    const resize = () => document.documentElement.style.setProperty('--privacy-prompt-height', `${card.getBoundingClientRect().height}px`);
    promptResize = new ResizeObserver(resize);
    promptResize.observe(card);
    resize();
    card.querySelectorAll('[data-privacy-choice]').forEach(button => button.onclick = () => {
      const result = preferenceStore.save({ ...preferences, remember: button.dataset.privacyChoice === 'allowed' }, lang);
      notifyPreferences();
      const status = storageStatus(result);
      removePrivacyPrompt();
      showStorageStatus(status);
      document.querySelector('.brand')?.focus({ preventScroll: true });
    });
  }

  function safe(v) {
    if (typeof v !== 'string' || /[\u0000-\u0020\\]/.test(v)) return '';
    if (/^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v);
        return u.username || u.password ? '' : v
      } catch {
        return ''
      }
    }
    return /^(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:html|png|jpe?g|webp|gif)(?:[?#][a-zA-Z0-9_=&%-]+)?|#[a-zA-Z0-9_-]+)$/.test(v) && !v.includes('..') ? v : ''
  }

  function image(src, alt, crop, extra = '') {
    src = safe(src);
    if (!src) return '';
    if (crop) {
      const [x, y, w, h, iw] = crop;
      return `<div class="sprite ${extra}" style="aspect-ratio:${w}/${h}"><img src="${esc(src)}" alt="${esc(alt)}" style="width:${iw/w*100}%;max-width:none;left:${-x/w*100}%;top:${-y/h*100}%" loading="lazy"></div>`
    }
    return `<img class="${extra}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`
  }
  const route = k => k === 'home' ? 'index.html' : k === 'about' ? 'index.html#about' : k + '.html';
  const label = k => k === 'home' ? ui('首页', 'Home', '首頁') : t(data.pages[k]?.title);
  const a = (url, text, cls = '') => `<a class="${cls}" href="${esc(safe(url)||'#')}" ${/^https?:/.test(url)?'target="_blank" rel="noopener noreferrer"':''}>${text}</a>`;

  function navLabel(k) {
    return lang === 'en' ? ({
      about: 'About us',
      'latest-events': 'Events',
      'campus-info': 'Campus info',
      'past-review': 'Highlights',
      presidents: 'Presidium',
      discounts: 'Discounts',
      sponsors: 'Sponsors'
    } [k] || label(k)) : label(k)
  }

  // The navigation and homepage heading open the department directory.
  const departmentDirectoryRoute = () => lang === 'en' ? 'departments-en.html' : 'departments.html';

  function nav() {
    const primaryLinks = ['about', 'latest-events', 'campus-info', 'past-review']
      .map(key => a(route(key), esc(navLabel(key)), page === key ? 'active' : ''))
      .join('');
    const secondaryLinks = ['presidents', 'discounts', 'sponsors']
      .map(key => a(route(key), esc(navLabel(key)), page === key ? 'active' : ''))
      .join('');
    const languageOptions = [
        ['zh', '简体中文'],
        ['en', 'English'],
        ['hant', '繁體中文']
      ]
      .map(([value, name]) => `<option value="${value}" ${value === lang ? 'selected' : ''}>${name}</option>`).join('');
    const brand = image(data.settings.logo, 'MCSA') + `
      <span>
        <b>Monash Chinese Students Association</b>
        <small>${ui('蒙纳士中国学生会', 'Monash Chinese Students Association', '蒙納士中國學生會')}</small>
      </span>`;

    return `
      <div class="site-header">
        <div class="header-inner">
          ${a('index.html', brand, 'brand')}
          <button class="menu-button" aria-expanded="false" aria-controls="navigation">
            ${ui('菜单', 'Menu', '菜單')}
          </button>
          <nav id="navigation" aria-label="${ui('主导航', 'Main navigation', '主導航')}">
            ${primaryLinks}
            ${a(departmentDirectoryRoute(), ui('部门招新', 'Recruitment', '部門招新'), page === 'recruitment' || page.startsWith('department-') ? 'active' : '')}
            ${secondaryLinks}
          </nav>
          <label class="language-control">
            <span class="language-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
                <path d="M2 5h12M7 2h1m4 3c-1.5 4-4 7-8 9M5 8l6 6m1 8 5-11 5 11m-8-4h6"/>
              </svg>
            </span>
            <select id="language" aria-label="${ui('切换语言', 'Change language', '切換語言')}">
              ${languageOptions}
            </select>
          </label>
        </div>
      </div>`;
  }

  function paragraphs(list) {
    return (list || []).map(x => `<p>${esc(t(x)).replace(/\n/g,'<br>')}</p>`).join('')
  }

  function heading(title, sub = '') {
    return `<div class="section-heading"><h2>${esc(title)}</h2>${sub?`<div>${sub}</div>`:''}</div>`
  }

  function visiblePosts(key) {
    return data.posts.filter(post => post.page === key && post.published)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || data.posts.indexOf(b) - data.posts.indexOf(a));
  }

  function postCard(post) {
    const link = post.url || `article.html?id=${encodeURIComponent(post.id)}`;
    const body = `${image(post.image,t(post.title),post.crop,'post-image') || '<div class="post-placeholder" aria-hidden="true">MCSA</div>'}
  <div class="post-body">${post.date ? `<time>${esc(post.date)}</time>` : ''}<h3>${esc(t(post.title)) || ui('翻译处理中', 'Translation pending', '翻譯處理中')}</h3><p>${esc(t(post.text))}</p><span class="text-link">${ui('阅读详情', 'Read more', '閱讀詳情')} ↗</span></div>`;
    return a(link, body, 'post-card');
  }

  function postGrid(key, limit) {
    const posts = visiblePosts(key).slice(0, limit);
    return posts.length ? `<div class="post-grid ${limit===3?'home-posts':''}">${posts.map(postCard).join('')}</div>` : `<p class="empty-state">${ui('内容将陆续更新，敬请期待。', 'Updates will appear here soon.', '內容將陸續更新，敬請期待。')}</p>`;
  }

  function departments() {
    return window.MCSAHome.departments(viewContext());
  }

  function carousel() {
    return window.MCSAHome.carousel(viewContext());
  }

  function contacts() {
    return window.MCSAHome.contacts(viewContext());
  }

  function linkedHeading(title, url, description = '') {
    return `<div class="section-heading"><h2>${a(url,esc(title)+' <span class="heading-arrow">↗</span>')}</h2><div>${description}</div></div>`;
  }

  function viewContext() {
    return {
      data,
      t,
      ui,
      esc,
      image,
      a,
      heading,
      linkedHeading,
      paragraphs,
      postGridOptional
    };
  }

  function home() {
    const sections = {
      hero: () => window.MCSAHome.hero(viewContext()),
      about: () => `<section class="section" id="about">${heading(label('about'))}<div class="prose">${paragraphs(data.pages.about.paragraphs)}</div>${postGridOptional('about')}</section>`,
      events: () => `<section class="section" id="events">${linkedHeading(label('latest-events'),'latest-events.html')}${postGrid('latest-events',3)}</section>`,
      presidents: carousel,
      departments: () => `<section class="section" id="departments">${linkedHeading(ui('部门介绍','Departments','部門介紹'),departmentDirectoryRoute(),paragraphs([data.settings.departmentHint]))}${departments()}</section>`
    };
    return data.homeSections.filter(section => section.visible)
      .map(section => sections[section.id]?.() || '').join('') + postGridOptional('home');
  }

  function postGridOptional(key) {
    return visiblePosts(key).length ? postGrid(key) : '';
  }

  function recruitment() {
    return `<section class="section" id="departments">${heading(label('recruitment'),paragraphs(data.pages.recruitment.paragraphs))}${departments()}</section>${postGridOptional('recruitment')}`;
  }

  function eventCarousel() {
    const posts = visiblePosts('latest-events').slice(0, 3);
    if (!posts.length) return '';
    return `<section class="event-carousel" aria-label="${ui('最新三个活动', 'Three latest events', '最新三個活動')}"><div class="event-strip">${posts.map(post=>`<div class="event-slide">${postCard(post)}</div>`).join('')}</div><div class="strip-controls"><button data-scroll="-1" aria-label="${ui('上一个活动', 'Previous event', '上一個活動')}">‹</button><button data-pause>${ui('暂停', 'Pause', '暫停')}</button><button data-scroll="1" aria-label="${ui('下一个活动', 'Next event', '下一個活動')}">›</button></div></section>`;
  }

  function archives() {
    const terms = [{
      name: ui('现任主席团', 'Current presidium', '現任主席團'),
      members: data.team
    }, ...(data.terms || []).slice().sort((a, b) => Number(b.year) - Number(a.year)).map(term => ({
      ...term,
      name: t(term.name)
    }))];
    return terms.map(term => `<section class="term"><h2>${esc(term.name)}</h2><div class="member-strip" tabindex="0">${term.members.map(member=>{
 const body=`${image(member.image,t(member.name))}<h3>${esc(t(member.name))}</h3><p>${esc(t(member.role))}</p>`;
 return member.url?a(member.url,body,'member-card'):`<article class="member-card">${body}</article>`;
 }).join('')}</div><div class="strip-controls"><button data-term-pause>${ui('暂停', 'Pause', '暫停')}</button><button data-member="-1" aria-label="${ui('上一位', 'Previous member', '上一位')}">‹</button><button data-member="1" aria-label="${ui('下一位', 'Next member', '下一位')}">›</button></div></section>`).join('');
  }

  function merchantGrid() {
    return `<div class="filters"><label>${ui('地区', 'Area', '地區')}<select id="region-filter"><option value="">${ui('全部地区', 'All areas', '全部地區')}</option>${data.regions.map(x=>`<option value="${esc(x.id)}">${esc(t(x.name))}</option>`).join('')}</select></label><label>${ui('种类', 'Category', '種類')}<select id="category-filter"><option value="">${ui('全部种类', 'All categories', '全部種類')}</option>${data.categories.map(x=>`<option value="${esc(x.id)}">${esc(t(x.name))}</option>`).join('')}</select></label></div><div class="post-grid merchants">${data.merchants.map(m=>`<article class="post-card" data-region="${esc(m.region)}" data-category="${esc(m.category)}">${m.url?a(m.url,`${image(m.image,t(m.name),null,'post-image')}<div class="post-body"><h3>${esc(t(m.name))}</h3><p>${esc(t(m.text))}</p></div>`):`${image(m.image,t(m.name),null,'post-image')}<div class="post-body"><h3>${esc(t(m.name))}</h3><p>${esc(t(m.text))}</p></div>`}</article>`).join('')}</div><p id="filter-empty" class="empty-state" ${data.merchants.length?'hidden':''}>${ui('暂无符合条件的商家。', 'No matching partners yet.', '暫無符合條件的商家。')}</p>`;
  }

  function sponsorGrid() {
    return `<div class="post-grid sponsors">${data.sponsors.map(sponsor=>{
 const body=`${image(sponsor.image,t(sponsor.name))}<h3>${esc(t(sponsor.name))}</h3>`;
 return sponsor.url?a(sponsor.url,body,'sponsor-card'):`<article class="sponsor-card">${body}</article>`;
 }).join('')}</div>`;
  }

  function content() {
    if (page === 'home') return home();
    if (page === 'admin') return '<div id="admin-root"></div>';
    if (page === 'recruitment') return recruitment();
    if (page === 'article') {
      const post = data.posts.find(p => p.id === new URLSearchParams(location.search).get('id') && p.published);
      return post ? `<header class="page-heading"><h1>${esc(t(post.title))}</h1></header><article class="article-detail">${image(post.image,t(post.title),post.crop)}<div class="prose">${paragraphs([post.text])}</div>${post.url?a(post.url,ui('阅读原文', 'Read original', '閱讀原文'),'button'):''}</article>` : `<p class="empty-state">${ui('这篇内容暂未发布。', 'This article is not available.', '這篇內容暫未發佈。')}</p>`;
    }
    const pageInfo = data.pages[page];
    if (['disclaimer', 'privacy', 'accessibility', 'feedback', 'privacy-settings'].includes(page)) return policyPage(pageInfo);
    let result = `<header class="page-heading"><span class="eyebrow">MCSA</span><h1>${esc(label(page))}</h1><div class="prose">${paragraphs(pageInfo?.paragraphs)}</div></header>`;
    if (page === 'latest-events') result += eventCarousel() + heading(ui('所有活动', 'All events', '所有活動'));
    if (page === 'presidents') result += archives();
    else if (page === 'discounts') result += merchantGrid();
    else if (page === 'sponsors') result += sponsorGrid();
    if (page !== 'contact') result += postGridOptional(page);
    return result;
  }

  function policyPage(pageInfo) {
    let result = `<header class="page-heading"><span class="eyebrow">MCSA</span><h1>${esc(t(pageInfo.title))}</h1></header><article class="policy-copy">`;
    result += pageInfo.paragraphs.map((text, index) => index % 2 === 0 ? `<h2>${esc(t(text))}</h2>` : `<p>${esc(t(text))}</p>`).join('') + '</article>';
    if (page === 'feedback') result += `<a class="button primary feedback-action" href="mailto:${esc(data.settings.email)}?subject=${encodeURIComponent(ui('网站反馈','Website feedback','網站反饋'))}">${ui('发送网站反馈','Send website feedback','發送網站反饋')} ↗</a>`;
    if (page === 'privacy-settings') {
      const selected = preferenceDraft || preferences;
      result += `<form class="privacy-options" id="preferences-form" aria-labelledby="local-preferences-title">
        <h2 id="local-preferences-title">${ui('本机偏好', 'Local preferences', '本機偏好')}</h2>
        <label><input id="remember-preferences" type="checkbox" ${selected.remember?'checked':''}><span>${ui('允许保存本机偏好','Remember preferences on this device','允許保存本機偏好')}<small>${ui('关闭后，仅长期记住不保存的决定；其他偏好在当前标签页会话内有效。', 'When off, only your decision not to save is remembered permanently. Other preferences apply to this tab session.', '關閉後，僅長期記住不保存的決定；其他偏好在當前標籤頁工作階段內有效。')}</small></span></label>
        <label><input id="show-intro" type="checkbox" ${selected.intro?'checked':''}><span>${ui('显示开场动画','Show opening animation','顯示開場動畫')}<small>${ui('进入首页时播放，每个标签页会话内最多一次；系统减少动态效果设置优先。', 'Play on entering the homepage, at most once per tab session. Your system’s reduced-motion setting takes priority.', '進入首頁時播放，每個標籤頁工作階段內最多一次；系統減少動態效果設置優先。')}</small></span></label>
        <label><input id="allow-motion" type="checkbox" ${selected.motion?'checked':''}><span>${ui('允许自动动态效果', 'Allow automatic motion', '允許自動動態效果')}<small>${ui('控制自动轮播、滚动及熊猫动画；关闭后仍可手动浏览。', 'Control automatic carousels, scrolling and mascot animation. Manual browsing remains available when off.', '控制自動輪播、滾動及熊貓動畫；關閉後仍可手動瀏覽。')}</small></span></label>
        <div class="preferences-actions"><button class="button primary" type="submit">${ui('保存偏好','Save preferences','保存偏好')}</button>
        <button class="button" type="button" id="clear-preferences">${ui('清除本机偏好','Clear local preferences','清除本機偏好')}</button></div>
        <p id="preferences-status" role="status">${esc(preferenceStatus)}</p></form>`;
    }
    return result + postGridOptional(page);
  }

  function render() {
    statusResize?.disconnect();
    statusResize = null;
    document.documentElement.style.removeProperty('--privacy-status-height');
    window.MCSAHome.cleanup();
    window.MCSAHome.applyLayout(data.layout);
    clearInterval(timer);
    document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]').forEach(el => el.href = safe(data.settings.logo) || 'images/logo.png');
    document.documentElement.lang = {
      zh: 'zh-CN',
      en: 'en',
      hant: 'zh-Hant'
    } [lang];
    document.title = (page === 'admin' ? ui('内容管理', 'Content management', '內容管理') : page.startsWith('department-') ? t(data.departments.find(d => 'department-' + d.id === page).name) : label(page)).replace(/\n/g, ' ') + ' | MCSA';
    const footerLinks = data.footerLinks.some(link => link.id === 'privacy-settings') ? data.footerLinks
      : [...data.footerLinks, { url: 'privacy-settings.html', name: ui('您的隐私设置', 'Privacy settings', '您的隱私設置') }];
    document.querySelector('#app').innerHTML = nav() + `<main id="main" class="container">${content()}</main>${page==='admin'?'':`<div class="container">${contacts()}</div>`}<footer class="footer"><div class="container"><nav class="footer-links">${footerLinks.map(link=>a(link.url,esc(t(link.name)))).join('')}</nav><p>${esc(t(data.settings.footer))}</p></div></footer><p id="local-preferences-status" class="local-preferences-status" role="status"></p><button id="back-top" class="round" aria-label="${ui('返回顶部', 'Back to top', '返回頂部')}" title="${ui('返回顶部', 'Back to top', '返回頂部')}">↑</button>`;
    bind();
    bindCollections();
    window.MCSAHome.bindDepartments(viewContext(), reducedMotion());
    document.querySelector('.skip').textContent = ui('跳到正文', 'Skip to content', '跳到正文');
    window.dispatchEvent(new CustomEvent('mcsa-render'));
    privacyPrompt();
  }

  function updateSlide() {
    const track = document.querySelector('.carousel-track');
    if (!track) return;
    slide = (slide + data.team.length) % data.team.length;
    track.style.transform = `translateX(-${slide*100}%)`;
    document.querySelectorAll('.president-slide').forEach((s, i) => {
      s.setAttribute('aria-hidden', String(i !== slide));
      s.inert = i !== slide
    });
    document.querySelectorAll('[data-slide]').forEach((s, i) => s.setAttribute('aria-current', String(i === slide)))
  }

  function carouselVisible() {
    const bounds = document.querySelector('.carousel')?.getBoundingClientRect();
    return bounds && bounds.top < innerHeight && bounds.bottom > 0;
  }

  function restart() {
    clearInterval(timer);
    if (!paused && !reducedMotion()) timer = setInterval(() => {
      if (!document.hidden && !document.querySelector('.opening') && !document.querySelector('.carousel')?.matches(':hover, :focus-within') && carouselVisible()) {
        slide++;
        updateSlide()
      }
    }, data.layout.carouselSeconds * 1000)
  }

  function bind() {
    document.querySelector('#language').onchange = e => {
      if (page === 'admin' && window.CMS?.dirty && !confirm(ui('切换语言会丢弃未保存修改，继续吗？', 'Discard unsaved edits to change language?', '切換語言會丟棄未保存修改，繼續嗎？'))) {
        e.target.value = lang;
        return
      }
      lang = e.target.value;
      const result = preferenceStore.setLanguage(lang);
      notifyPreferences();
      preferenceStatus = '';
      render();
      if ((!result.session && !preferences.remember) || (preferences.remember && !result.persistent)) showStorageStatus(storageStatus(result));
    };
    document.querySelector('.menu-button').onclick = e => {
      const n = document.querySelector('#navigation');
      n.classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', n.classList.contains('open'))
    };
    document.querySelector('#back-top').onclick = () => scrollTo({
      top: 0,
      behavior: reducedMotion() ? 'auto' : 'smooth'
    });
    document.querySelectorAll('.carousel .prev,.carousel .next').forEach(b => b.onclick = () => {
      slide += b.classList.contains('next') ? 1 : -1;
      updateSlide();
      restart()
    });
    document.querySelectorAll('[data-slide]').forEach(b => b.onclick = () => {
      slide = Number(b.dataset.slide);
      updateSlide();
      restart()
    });
    const box = document.querySelector('.carousel-window');
    if (box) {
      box.onkeydown = e => {
        if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          slide += e.key === 'ArrowRight' ? 1 : -1;
          updateSlide();
          restart()
        }
      };
      box.addEventListener('touchstart', e => startX = e.changedTouches[0].clientX, {
        passive: true
      });
      box.addEventListener('touchend', e => {
        const delta = e.changedTouches[0].clientX - startX;
        if (Math.abs(delta) > 45) {
          slide += delta < 0 ? 1 : -1;
          updateSlide();
          restart()
        }
      }, {
        passive: true
      });
      document.querySelector('.pause').onclick = e => {
        paused = !paused;
        e.currentTarget.textContent = paused ? ui('播放', 'Play', '播放') : ui('暂停', 'Pause', '暫停');
        e.currentTarget.setAttribute('aria-pressed', paused);
        restart()
      };
      updateSlide();
      restart()
    }
  }

  function bindCollections() {
    document.querySelectorAll('.filters select').forEach(select => select.onchange = () => {
      const region = document.querySelector('#region-filter').value;
      const category = document.querySelector('#category-filter').value;
      let count = 0;
      document.querySelectorAll('.merchants .post-card').forEach(card => {
        card.hidden = !!((region && card.dataset.region !== region) || (category && card.dataset.category !== category));
        if (!card.hidden) count++;
      });
      document.querySelector('#filter-empty').hidden = count > 0;
    });
    document.querySelectorAll('[data-member]').forEach(button => button.onclick = () => {
      const strip = button.closest('.term').querySelector('.member-strip');
      strip.scrollBy({
        left: Number(button.dataset.member) * (strip.firstElementChild?.offsetWidth + 20 || 200),
        behavior: reducedMotion() ? 'auto' : 'smooth'
      });
    });
    (window.termTimers || []).forEach(clearInterval);
    window.termTimers = [];
    document.querySelectorAll('.term').forEach(term => {
      const members = term.querySelector('.member-strip');
      const pause = term.querySelector('[data-term-pause]');
      let stopped = reducedMotion();
      const update = () => {
        pause.textContent = stopped ? ui('播放', 'Play', '播放') : ui('暂停', 'Pause', '暫停');
        pause.setAttribute('aria-pressed', String(stopped));
      };
      update();
      pause.onclick = () => {
        stopped = !stopped;
        update();
      };
      window.termTimers.push(setInterval(() => {
        if (stopped || reducedMotion() || document.hidden || document.querySelector('.opening') || term.matches(':hover,:focus-within')) return;
        const card = members.firstElementChild;
        if (!card) return;
        if (members.scrollWidth <= members.clientWidth + 2) {
          members.append(card);
        } else {
          const end = members.scrollLeft + members.clientWidth >= members.scrollWidth - 5;
          members.scrollTo({
            left: end ? 0 : members.scrollLeft + card.offsetWidth + 20,
            behavior: reducedMotion() ? 'auto' : 'smooth'
          });
        }
      }, 6500));
    });
    clearInterval(window.eventTimer);
    const strip = document.querySelector('.event-strip');
    if (strip) {
      let position = 0,
        stopped = reducedMotion();
      const move = direction => {
        position = (position + direction + strip.children.length) % strip.children.length;
        strip.scrollTo({
          left: position * strip.clientWidth,
          behavior: reducedMotion() ? 'auto' : 'smooth'
        });
      };
      document.querySelectorAll('[data-scroll]').forEach(button => button.onclick = () => move(Number(button.dataset.scroll)));
      const pause = document.querySelector('[data-pause]');
      const update = () => {
        pause.textContent = stopped ? ui('播放', 'Play', '播放') : ui('暂停', 'Pause', '暫停');
        pause.setAttribute('aria-pressed', String(stopped));
      };
      update();
      pause.onclick = () => {
        stopped = !stopped;
        update();
      };
      window.eventTimer = setInterval(() => {
        if (!stopped && !reducedMotion() && !document.hidden && !document.querySelector('.opening') && !strip.parentElement.matches(':hover,:focus-within')) move(1);
      }, data.layout.carouselSeconds * 1000);
    }
    const form = document.querySelector('#preferences-form');
    const readDraft = () => ({
      remember: document.querySelector('#remember-preferences').checked,
      intro: document.querySelector('#show-intro').checked,
      motion: document.querySelector('#allow-motion').checked
    });
    if (form) {
      form.querySelectorAll('input').forEach(input => input.onchange = () => {
        preferenceDraft = readDraft();
        preferenceStatus = '';
        document.querySelector('#preferences-status').textContent = '';
      });
      form.onsubmit = event => {
        event.preventDefault();
        const result = preferenceStore.save(readDraft(), lang);
        preferenceDraft = null;
        notifyPreferences();
        preferenceStatus = storageStatus(result);
        document.querySelector('#preferences-status').textContent = preferenceStatus;
      };
    }
    const clear = document.querySelector('#clear-preferences');
    if (clear) clear.onclick = () => {
      const cleared = preferenceStore.clear();
      preferenceDraft = null;
      notifyPreferences();
      lang = preferences.language;
      preferenceStatus = cleared
        ? ui('已清除本机记录并恢复默认；下次进入首页会重新提示。', 'Local records cleared and defaults restored. You will be prompted next time you enter the homepage.', '已清除本機記錄並恢復預設；下次進入首頁會重新提示。')
        : ui('已恢复当前页面默认设置，但浏览器无法完整清除保存记录。', 'Defaults restored on this page, but your browser could not clear all saved records.', '已恢復當前頁面預設設置，但瀏覽器無法完整清除保存記錄。');
      render();
      document.querySelector('#clear-preferences')?.focus({ preventScroll: true });
    };
  }

  function intro() {
    if (previewMode || page !== 'home' || !preferences.intro || reducedMotion() || preferenceStore.introSeen) return Promise.resolve();
    const src = safe(data.settings.opening);
    if (!src) return Promise.resolve();
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'opening';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', ui('MCSA 开场动画', 'MCSA opening animation', 'MCSA 開場動畫'));
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `<img alt="MCSA" src="${esc(src)}"><button>${ui('跳过动画', 'Skip intro', '跳過動畫')} →</button>`;
      document.body.append(overlay);
      document.querySelector('#app').inert = true;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      let ended = false, playbackTimer = null;
      const timeout = setTimeout(close, 30000);

      function close() {
        if (ended) return;
        ended = true;
        clearTimeout(playbackTimer);
        clearTimeout(timeout);
        closeIntro = null;
        overlay.remove();
        document.querySelector('#app').inert = false;
        document.body.style.overflow = previousOverflow;
        preferenceStore.markIntroSeen();
        document.querySelector('.brand')?.focus({ preventScroll: true });
        resolve();
      }
      closeIntro = close;
      overlay.querySelector('button').onclick = close;
      overlay.querySelector('button').focus();
      overlay.onkeydown = e => {
        if (e.key === 'Escape') close();
        if (e.key === 'Tab') {
          e.preventDefault();
          overlay.querySelector('button').focus()
        }
      };
      const img = overlay.querySelector('img');
      const loaded = () => {
        if (!ended && playbackTimer === null) playbackTimer = setTimeout(close, data.settings.openingDuration || 5600);
      };
      img.onload = loaded;
      img.onerror = close;
      if (img.complete) img.naturalWidth ? loaded() : close();
    });
  }
  window.MCSA = {
    esc,
    t,
    ui,
    safe,
    image,
    get data() {
      return data
    },
    get lang() {
      return lang
    },
    get preferences() {
      return Object.freeze({ ...preferences, language: lang, reducedMotion: reducedMotion() });
    },
    render,
    setData(d) {
      data = d;
      render()
    }
  };
  render();
  intro().then(() => {
    homeReady = true;
    privacyPrompt();
  });
  document.addEventListener('click', e => document.querySelectorAll('.nav-dropdown[open]').forEach(d => {
    if (!d.contains(e.target)) d.open = false
  }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.nav-dropdown[open]').forEach(d => d.open = false)
  });
  if (page !== 'admin' && !new URLSearchParams(location.search).has('preview') && window.MCSA_CONFIG.apiBase) {
    fetch(window.MCSA_CONFIG.apiBase + '/site', {
      signal: AbortSignal.timeout(6000)
    }).then(r => {
      if (!r.ok) throw Error();
      return r.json()
    }).then(r => {
      data = r.data;
      render();
      if (document.querySelector('.opening')) document.querySelector('#app').inert = true;
      const hash = location.hash.slice(1);
      if (hash) document.getElementById(hash)?.scrollIntoView()
    }).catch(() => {});
  } else if (location.hash) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 50);
})();
