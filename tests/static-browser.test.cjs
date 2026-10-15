const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
const {serve,readSite}=require('../scripts/static-lib.cjs');
const root=path.resolve(process.env.MCSA_EXPORT_DIR || path.join(__dirname,'../dist'));
const data=readSite(path.join(root,'data/site.js'));
const post=data.posts.find(p=>p.published);
let server,browser;
before(async()=>{server=await serve(root);browser=await chromium.launch({headless:true,executablePath:process.env.MCSA_BROWSER_EXECUTABLE||undefined});});
after(async()=>{await browser?.close();await server?.close();});

async function setup(options={}) {
  const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:390,height:844},...options});
  const errors=[];
  await context.route('**/*',route=>{
    if(!route.request().url().startsWith(server.url+'/')||route.request().url().includes('/api/')) {
      errors.push(route.request().url());return route.abort();
    }
    return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  return {context,page,errors};
}

test('English navigation, filters, article, department and refresh stay usable with CMS offline',async()=>{
  for(const width of [390,1440]) {
    const {context,page,errors}=await setup({viewport:{width,height:960}});
    try {
      await page.goto(server.url+'/index.html?lang=en');
      await page.locator('#language').waitFor();
      const department=data.departments[0];
      if(department) {
        await page.locator(`[data-department="${department.id}"]`).filter({visible:true}).first().click();
        await page.locator('#language').selectOption('zh');
        await page.locator('#language').selectOption('en');
        assert.equal(await page.locator('#department-detail h3').innerText(),department.name.en||department.name.zh);
        await page.locator('.department-link').click();
        assert.ok(new URL(page.url()).pathname.endsWith(`department-${department.id}-en.html`));
        await page.getByRole('link',{name:'Home',exact:true}).click();
        await page.waitForFunction(()=>window.MCSA?.lang==='en');
        assert.equal(new URL(page.url()).pathname,'/index.html');
        assert.equal(await page.locator('#language').inputValue(),'en');
      }
      for(const name of ['latest-events','campus-info','past-review','presidents','discounts','sponsors','recruitment','contact','privacy','privacy-settings','feedback','accessibility','disclaimer']){
        await page.goto(`${server.url}/${name}.html?lang=en`);
        await page.locator('#language').waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'),'en');
        assert.ok((await page.locator('h1,h2').first().innerText()).trim(),name);
        const blank=await page.locator('button,a,select').evaluateAll(elements=>elements.filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.querySelector('img[alt],svg')).map(e=>e.outerHTML));
        assert.deepEqual(blank,[],name);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name} overflow ${width}`);
        if(name==='discounts' && data.merchants.length) {
          const region=data.merchants[0].region,category=data.merchants[0].category;
          await page.locator('#region-filter').selectOption(region);
          await page.locator('#category-filter').selectOption(category);
          await page.locator('#language').selectOption('zh');
          await page.locator('#language').selectOption('en');
          assert.equal(await page.locator('#region-filter').inputValue(),region);
          assert.equal(await page.locator('#category-filter').inputValue(),category);
          assert.ok(await page.locator('.merchants .post-card:visible').count());
        } else if(name==='discounts') {
          assert.equal(await page.locator('#filter-empty').isVisible(),true);
        }
      }
      await page.goto(`${server.url}/article.html?id=${post?.id||'no-published-article'}&lang=en`);
      if(post) assert.equal(await page.locator('h1').innerText(),(post.title.en||post.title.zh).trim());
      else assert.match(await page.locator('#main').innerText(),/This article is not available/);
      await page.locator('#language').selectOption('zh');
      await page.locator('#language').selectOption('en');
      await page.reload();
      assert.equal(new URL(page.url()).pathname,'/article.html');
      assert.equal(new URL(page.url()).searchParams.get('id'),post?.id||'no-published-article');
      assert.equal(await page.locator('#language').inputValue(),'en');
      if(post) assert.equal(await page.title(),(post.title.en||post.title.zh).replace(/\n/g,' ')+' | MCSA');
      if(width===390){await page.locator('.menu-button').click();assert.equal(await page.locator('.menu-button').getAttribute('aria-expanded'),'true');}
      if(process.env.MCSA_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.MCSA_SCREENSHOT_DIR,`provisional-english-${width}.png`),fullPage:true});
      assert.deepEqual(errors,[]);
    } finally {await context.close();}
  }
});

test('About navigation reaches the homepage section and retains the selected language',async()=>{
  for(const width of [390,1440]) {
    const {context,page,errors}=await setup({viewport:{width,height:960}});
    try {
      for(const lang of ['zh','en','hant']) {
        await page.goto(`${server.url}/latest-events.html?lang=${lang}`);
        await page.waitForFunction(language=>window.MCSA?.lang===language,lang);
        if(width===390)await page.locator('.menu-button').click();
        const name={zh:'关于我们',en:'About us',hant:'關於我們'}[lang];
        const link=page.locator('#navigation').getByRole('link',{name,exact:true});
        assert.equal(await link.getAttribute('href'),`index.html?lang=${lang}#about`);
        await link.click();
        await page.waitForURL(`${server.url}/index.html?lang=${lang}#about`);
        await page.waitForFunction(language=>window.MCSA?.lang===language,lang);
        assert.equal(await page.locator('#language').inputValue(),lang);
        assert.equal(await page.locator('#about').isVisible(),true);
      }
      assert.deepEqual(errors,[]);
    } finally {await context.close();}
  }
});

test('rendered general pages and English department articles are readable without JavaScript',async()=>{
  const {context,page,errors}=await setup({javaScriptEnabled:false});
  try{
    const pages=['index','discounts',...data.departments.map(d=>`department-${d.id}-en`)];
    if(post) pages.push(`article-${post.id}`);
    for(const name of pages){
      await page.goto(`${server.url}/${name}.html`);
      assert.equal(await page.locator('html').getAttribute('lang'),name.startsWith('department-')?'en':'zh-CN');
      assert.ok((await page.locator('#main').innerText()).trim().length>0);
      const broken=await page.locator('img').evaluateAll(images=>images.filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src));
      assert.deepEqual(broken,[],name);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name);
    }
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('missing content and CMS button overrides have visible English fallbacks',async()=>{
  const {context,page,errors}=await setup();
  try{
    const copy=structuredClone(data);
    copy.posts.push({id:'missing-translation-fixture',page:'latest-events',published:true,date:'2026-01-01',image:'',url:'',crop:null,
      title:{zh:'等待翻译的活动',en:'',hant:'等待翻譯的活動',_translationStatus:'pending'},text:{zh:'',en:'',hant:''}});
    copy.interfaceText['全部地区']={zh:'全部地区',en:'',hant:'全部地區'};
    await context.route('**/data/site.js',route=>route.fulfill({contentType:'text/javascript',body:'window.MCSA_DATA='+JSON.stringify(copy)}));
    await page.goto(server.url+'/latest-events.html?lang=en');
    assert.match(await page.locator('#main').innerText(),/Translation pending/);
    await page.goto(server.url+'/discounts.html?lang=en');
    assert.equal(await page.locator('#region-filter option').first().innerText(),'All areas');
    await page.goto(server.url+'/article.html?id=removed-post&lang=en');
    assert.match(await page.locator('#main').innerText(),/This article is not available/);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

test('legacy addresses retain explicit language and section',async()=>{
  const {context,page}=await setup();
  try{
    await page.goto(server.url+'/about.html?lang=en');
    await page.waitForURL(/\/index\.html\?lang=en#about$/);
    assert.equal(await page.locator('#language').inputValue(),'en');
    await page.goto(server.url+'/apply.html?lang=en');
    await page.waitForURL(/\/recruitment\.html\?lang=en$/);
    assert.equal(await page.locator('#language').inputValue(),'en');
    await page.goto(server.url+'/about.html');
    await page.waitForURL(/\/index\.html\?lang=en#about$/);
    assert.equal(await page.locator('#language').inputValue(),'en');
  }finally{await context.close();}
});

test('English links work without granting persistent storage; clearing restores defaults',async()=>{
  const {context,page}=await setup();
  try{
    await page.goto(server.url+'/index.html?lang=en');
    assert.equal(await page.evaluate(()=>localStorage.getItem('mcsa-language')),null);
    await page.goto(server.url+'/privacy-settings.html?lang=en');
    await page.locator('#clear-preferences').click();
    assert.equal(await page.locator('#language').inputValue(),'zh');
    await page.reload();
    assert.equal(await page.locator('#language').inputValue(),'zh');
    await page.locator('#language').selectOption('en');
    await page.locator('#remember-preferences').check();
    await page.locator('#preferences-form button[type=submit]').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('mcsa-language')),'en');
    await page.goto(server.url+'/index.html');
    assert.equal(await page.locator('#language').inputValue(),'en');
  }finally{await context.close();}
});

test('general pages keep one filename across languages, links and refresh',async()=>{
  const {context,page,errors}=await setup({viewport:{width:1440,height:960}});
  try{
    await page.goto(server.url+'/latest-events.html?lang=en#main');
    for(const lang of ['hant','zh','en']) {
      await page.locator('#language').selectOption(lang);
      assert.equal(new URL(page.url()).pathname,'/latest-events.html');
      assert.equal(new URL(page.url()).hash,'#main');
      await page.reload();
      assert.equal(await page.locator('#language').inputValue(),lang);
      const links=await page.locator('a[href]').evaluateAll(items=>items.map(item=>item.href));
      for(const href of links) {
        const url=new URL(href);
        if(url.origin!==server.url||!url.pathname.endsWith('.html')||url.pathname.startsWith('/department'))continue;
        assert.doesNotMatch(url.pathname,/(?:-en|-hant)\.html$/);
        assert.equal(url.searchParams.get('lang'),lang,href);
      }
    }
    await page.locator('#navigation a[href*="discounts.html"]').click();
    assert.equal(new URL(page.url()).pathname,'/discounts.html');
    assert.equal(await page.locator('#language').inputValue(),'en');
    if(post) {
      await page.goto(`${server.url}/article-${post.id}.html?lang=en`);
      await page.locator('#language').selectOption('hant');
      await page.reload();
      assert.equal(new URL(page.url()).pathname,`/article-${post.id}.html`);
      assert.equal(await page.locator('#language').inputValue(),'hant');
      assert.equal(await page.locator('h1').innerText(),(post.title.hant||'').trim());
    }
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
