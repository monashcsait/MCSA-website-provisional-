#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('playwright');
const {departmentFile,esc,json,readSite,prepareData,filesAt,serve,verifyOriginals,validateOutput} = require('./static-lib.cjs');
const root = path.resolve(__dirname, '..');

async function build({snapshot, out = path.join(root,'dist'), allowPending = false, apply = false} = {}) {
  out = path.resolve(out);
  // Fresh staging directories prevent withdrawn articles surviving an export.
  if (fs.existsSync(out)) throw Error('Output already exists. Use a new --out directory for this export.');
  if (out === root || root.startsWith(out + path.sep)) throw Error('Output must not contain the source checkout.');
  if (out.startsWith(root+path.sep) && ['assets','images','media','data','content','templates','scripts','tests'].includes(path.relative(root,out).split(path.sep)[0])) {
    throw Error('Output must not be inside a source directory.');
  }
  const baseline = readSite(path.join(root,'data/site.js'));
  let raw = baseline, revision = null, mediaRoot = root;
  if (snapshot) {
    const bundle = JSON.parse(fs.readFileSync(snapshot,'utf8'));
    if (bundle.format !== 'mcsa-public-v1' || Object.keys(bundle).some(k => !['format','revision','data'].includes(k))) {
      throw Error('Use content.json from “导出临时站公开内容”, not a content backup or admin response.');
    }
    raw = bundle.data; revision = bundle.revision; mediaRoot = path.dirname(path.resolve(snapshot));
  }
  const {data,missing} = prepareData(raw,baseline,{allowPending});
  // A new department must have full article templates before it can be exported.
  for (const dept of data.departments) for (const suffix of ['', '-en']) {
    if (!fs.existsSync(path.join(root,`templates/departments/department-${dept.id}${suffix}.html`))) {
      throw Error(`Missing full department article: ${dept.id}${suffix}`);
    }
  }
  fs.mkdirSync(out,{recursive:true});
  for (const folder of ['assets','images']) fs.cpSync(path.join(root,folder),path.join(out,folder),{recursive:true});
  fs.mkdirSync(path.join(out,'data'));
  fs.writeFileSync(path.join(out,'data/site.js'),'window.MCSA_DATA = '+json(data)+';\n');
  fs.writeFileSync(path.join(out,'assets/config.js'),'window.MCSA_CONFIG={apiBase:""};\n');
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
  for (const folder of ['pages','departments']) {
    for (const name of fs.readdirSync(path.join(root,'templates',folder))) {
      const department = /^department-(.+?)(?:-en)?\.html$/.exec(name);
      if (department && !data.departments.some(d=>d.id===department[1])) continue;
      fs.copyFileSync(path.join(root,'templates',folder,name),path.join(out,name));
    }
  }
  for (const lang of ['zh','en']) {
    const file=path.join(out,departmentFile('departments.html',lang));
    const cards=data.departments.map(dept=>`<a class="static-department-card" href="${departmentFile(dept.url,lang)}"><h2>${esc(dept.name[lang]||dept.name.zh)}</h2><p>${esc((dept.keywords?.[lang]||dept.intro?.[lang]||dept.intro?.zh||'').replace(/[|｜]/g,' · '))}</p><span>${lang==='en'?'Explore department':'查看部门'} →</span></a>`).join('');
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/(<div class="static-directory">)[\s\S]*?(<\/div><\/main>)/,()=>`<div class="static-directory">${cards}</div></main>`));
  }
  const template = fs.readFileSync(path.join(root,'templates/pages/article.html'),'utf8');
  for (const post of data.posts) fs.writeFileSync(path.join(out,`article-${post.id}.html`),
    template.replace('data-page="article"',`data-page="article" data-article-id="${esc(post.id)}"`));
  const media = new Set();
  function collect(value) {
    if (typeof value === 'string' && /^media\/[a-zA-Z0-9_.-]+$/.test(value)) media.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  collect(data);
  const dataMedia=new Set(media);
  for (const name of fs.readdirSync(out).filter(n=>n.startsWith('department'))) {
    for (const match of fs.readFileSync(path.join(out,name),'utf8').matchAll(/(?:src|href)="(media\/[^"]+)"/g)) media.add(match[1]);
  }
  fs.mkdirSync(path.join(out,'media'));
  for (const name of media) {
    const preferred = path.join(mediaRoot,name), original = path.join(root,name);
    const source = snapshot && dataMedia.has(name) ? preferred : fs.existsSync(preferred) ? preferred : original;
    if (!fs.existsSync(source)) throw Error(`Missing image: ${name}`);
    fs.copyFileSync(source,path.join(out,name));
  }
  verifyOriginals(out,root);
  const server = await serve(out);
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.MCSA_BROWSER_EXECUTABLE || undefined});
    const context = await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}});
    // Rendering cannot contact the CMS, external sites or Azure.
    await context.route('**/*', route => {
      const request = route.request();
      if (!request.url().startsWith(server.url + '/') || request.url().includes('/api/')) {
        errors.push(`Unexpected network request: ${request.url()}`); return route.abort();
      }
      // Images are verified on disk; avoid waiting for GIF decoding during export.
      if (request.resourceType() === 'image') return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=','base64')});
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const dynamic = fs.readdirSync(out).filter(name => name.endsWith('.html') && !name.startsWith('department') && !['about.html','apply.html'].includes(name));
    for (const file of dynamic) {
      const shell = fs.readFileSync(path.join(out,file),'utf8');
      // General pages share one URL and switch languages using the bundled data.
      // Render the default language so the exported HTML also has a readable body.
      await page.goto(`${server.url}/${file}?lang=zh&preview=1`,{waitUntil:'load'});
      await page.waitForFunction(() => !!window.MCSA && !!document.querySelector('#main'));
      const result = await page.evaluate(() => {
        // Serialize the content, not transient dialogs, animation or persisted choices.
        const app = document.querySelector('#app').cloneNode(true);
        app.removeAttribute('inert');
        app.querySelectorAll('[inert]').forEach(el => el.removeAttribute('inert'));
        app.querySelectorAll('.president-slide').forEach(el=>el.removeAttribute('aria-hidden'));
        return {html:app.innerHTML,title:document.title,lang:document.documentElement.lang,style:document.documentElement.getAttribute('style')||''};
      });
      const nojs = `<noscript><style>#navigation{display:flex;position:static;flex-wrap:wrap}.menu-button,.language-control,.carousel-controls,.strip-controls,.department-list-controls,.filters{display:none}.header-inner{flex-wrap:wrap}.event-strip{overflow:auto}.president-slide{visibility:visible!important}.carousel-track{transform:none!important;overflow:auto}.department-track{transform:none!important}.department-copy[aria-hidden]{display:none}</style><p>启用 JavaScript 可切换语言并使用筛选、轮播与本机偏好设置。 <span lang="en">Enable JavaScript to switch languages and use filters, carousels and local preferences.</span></p></noscript>`;
      const html = shell.replace(/<html lang="[^"]+"/,`<html lang="${result.lang}" style="${esc(result.style)}"`)
        .replace(/<title>[\s\S]*?<\/title>/,`<title>${esc(result.title)}</title>`)
        .replace(/<div id="app">[\s\S]*?<\/div>/,()=>`<div id="app">${result.html.split(server.url+'/').join('')}</div>`)
        .replace(/<noscript>[\s\S]*?<\/noscript>/,nojs)
        .replace(/<body /,'<body data-static-export="true" ')
        .replace(/(<a class="skip" href="#main">)[\s\S]*?(<\/a>)/,'$1跳到正文$2');
      fs.writeFileSync(path.join(out,file),html);
      console.log(`Rendered ${file}`);
    }
    await context.close();
  } finally {await browser?.close(); await server.close();}
  if (errors.length) throw Error(errors.join('\n'));
  // Old entry points preserve query strings and hashes, with a no-JS fallback.
  fs.writeFileSync(path.join(out,'assets/redirect.js'),`(() => {const u=new URL(document.body.dataset.redirect,location.href);const query=new URLSearchParams(location.search);const lang=query.get('lang')||window.MCSAPreferences.create().value.language;u.searchParams.set('lang',lang);query.forEach((v,k)=>u.searchParams.set(k,v));if(location.hash)u.hash=location.hash;location.replace(u.href);})();\n`);
  for (const [old,target] of [['about','index'],['apply','recruitment']]) {
    const destination = target+'.html'+(old==='about'?'#about':'');
    fs.writeFileSync(path.join(out,old+'.html'),`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>MCSA</title><noscript><meta http-equiv="refresh" content="0;url=${esc(destination)}"></noscript><script src="assets/preferences.js" defer></script><script src="assets/redirect.js" defer></script></head><body data-redirect="${esc(destination)}"><a href="${esc(destination)}">继续 / Continue</a></body></html>`);
  }
  // A former admin URL must not expose a broken or misleading CMS UI.
  fs.writeFileSync(path.join(out,'admin.html'),'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>内容管理 | MCSA</title><link rel="stylesheet" href="assets/style.css"></head><body><main class="container"><h1>内容管理</h1><p>本站为静态展示站。请使用正式后台编辑、校对并导出内容。</p><p>This is a static website. Edit, review and export content through the main administration site.</p><a href="index.html">返回首页 / Home</a></main></body></html>');
  // Stable text bytes keep the manifest valid across Windows and Unix checkouts.
  for(const name of filesAt(out).filter(n=>/\.(html|js|css|json|svg)$/.test(n))) {
    const file=path.join(out,name);
    let text=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
    if(name.endsWith('.html'))text=text.replace(/[ \t]+$/gm,'');
    fs.writeFileSync(file,text);
  }
  validateOutput(out);
  const exported = filesAt(out);
  const checksums = Object.fromEntries(exported.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(out,name))).digest('hex')]));
  const manifest={format:'mcsa-static-export-v1',revision,posts:data.posts.map(p=>p.id),missingEnglish:missing,files:checksums};
  fs.writeFileSync(path.join(out,'export-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  if (apply) {
    // Remove only previously generated files, and stop if someone edited one by hand.
    const previousFile=path.join(root,'export-manifest.json');
    const previous=fs.existsSync(previousFile)?JSON.parse(fs.readFileSync(previousFile)).files:{};
    const withdrawn=[];
    for(const [name,hash] of Object.entries(previous)) {
      const target=path.resolve(root,name);
      if(!target.startsWith(root+path.sep)) throw Error('Unsafe previous manifest path');
      if(!(name in checksums) && fs.existsSync(target)) {
        if(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==hash) throw Error(`Withdrawn file was edited locally: ${name}`);
        withdrawn.push(target);
      } else if (fs.existsSync(target)) {
        const current=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
        if(current!==hash && current!==checksums[name]) throw Error(`Generated file was edited locally; move the edit into its template first: ${name}`);
      }
    }
    for(const target of withdrawn) fs.unlinkSync(target);
    for(const name of [...exported,'export-manifest.json']) {
      fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});
      fs.copyFileSync(path.join(out,name),path.join(root,name));
    }
  }
  return {out,pages:exported.filter(n=>n.endsWith('.html')).length,manifest};
}

if(require.main===module) {
  const argv=process.argv.slice(2), options={};
  for(let i=0;i<argv.length;i++) {
    const flag=argv[i];
    if(flag==='--snapshot'||flag==='--out') {if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error(`Missing ${flag} value`);options[flag.slice(2)]=argv[++i];}
    else if(flag==='--allow-pending') options.allowPending=true;
    else if(flag==='--apply') options.apply=true;
    else throw Error(`Unknown option: ${flag}`);
  }
  build(options).then(result=>console.log(`Exported ${result.pages} pages to ${result.out}`)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={build};
