const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {readSite,prepareData,verifyOriginals,filesAt}=require('../scripts/static-lib.cjs');
const root=path.resolve(__dirname,'..');
const data=readSite(path.join(root,'data/site.js'));
const output=path.resolve(process.env.MCSA_EXPORT_DIR || path.join(root,'dist'));

test('public data has complete English and stable department links',()=>{
  const result=prepareData(data,data);
  assert.equal(result.missing.length,0);
  for(const dept of result.data.departments)assert.equal(dept.url,`department-${dept.id}.html`);
  const copy=structuredClone(data);
  copy.departments.reverse();
  assert.deepEqual(prepareData(copy,data).data.departments.map(d=>d.id),copy.departments.map(d=>d.id));
});

test('private metadata is rejected and withdrawn content is excluded',()=>{
  const copy=structuredClone(data);
  copy.posts.push({...copy.posts[0],id:'private-test',published:false,text:{zh:'DO NOT PUBLISH',en:'PRIVATE DRAFT',hant:''}});
  const result=prepareData(copy,data);
  assert.doesNotMatch(JSON.stringify(result),/DO NOT PUBLISH|PRIVATE DRAFT/);
  copy.pages.home.title._translationId='private-id';
  assert.throws(()=>prepareData(copy,data),/Private field/);
  delete copy.pages.home.title._translationId;
  copy.pages.home.title.en='';
  assert.throws(()=>prepareData(copy,data),/English is missing/);
  assert.ok(prepareData(copy,data,{allowPending:true}).missing.length);
});

test('all department originals are unchanged',()=>verifyOriginals(output,root));

test('export contains rendered bodies, separate department languages only and local assets',()=>{
  const names=filesAt(output);
  const exportedData=readSite(path.join(output,'data/site.js'));
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'export-manifest.json')));
  assert.equal(manifest.missingEnglish.length,0);
  assert.deepEqual(manifest.posts,exportedData.posts.map(post=>post.id));
  assert.ok(exportedData.posts.every(post=>post.published===true));
  assert.equal(names.some(n=>n.startsWith('content/')||n.startsWith('templates/')||n.endsWith('.sqlite3')),false);
  assert.deepEqual(names.filter(n=>/(?:-en|-hant)\.html$/.test(n)&&!/^departments?(?:-[a-z-]+)?-en\.html$/.test(n)),[]);
  for(const name of names.filter(n=>n.endsWith('.html'))){
    const html=fs.readFileSync(path.join(output,name),'utf8');
    if(html.includes('data-page=')) {
      assert.match(html,/<main id="main"/i,name);
      assert.doesNotMatch(html,/<div id="app">\s*<\/div>/);
    }
    if(name.startsWith('department')) assert.doesNotMatch(html,/<script/i,name);
    for(const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)){
      const value=match[1].replaceAll('&amp;','&');
      if(/^(https?:|mailto:|data:|#)/.test(value))continue;
      const file=decodeURIComponent(value.split(/[?#]/)[0]);
      assert.ok(fs.existsSync(path.join(output,file)),`${name}: missing ${file}`);
    }
  }
  for(const post of exportedData.posts) {
    assert.ok(fs.existsSync(path.join(output,`article-${post.id}.html`)));
  }
  assert.doesNotMatch(fs.readFileSync(path.join(output,'assets/app.js'),'utf8'),/fetch\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(output,'data/site.js'),'utf8'),/_translationId|reviewed_by|draft_source/);
});
