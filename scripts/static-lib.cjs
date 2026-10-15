'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const departmentFile = (file, lang) => file.replace(/(?:-en)?\.html$/, (lang === 'en' ? '-en' : '') + '.html');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');

function readSite(file) {
  // Parse JSON assignment without executing downloaded JavaScript.
  const text = fs.readFileSync(file, 'utf8').trim();
  const match = /^window\.MCSA_DATA\s*=\s*([\s\S]*);$/.exec(text);
  if (!match) throw Error('Expected a JSON window.MCSA_DATA assignment');
  return JSON.parse(match[1]);
}

function prepareData(raw, template, {allowPending = false} = {}) {
  const data = structuredClone(raw);
  if (JSON.stringify(Object.keys(data).sort()) !== JSON.stringify(Object.keys(template).sort())) {
    throw Error('Unsupported public content schema; do not import a private backup.');
  }
  // Reject private exports rather than silently publishing an unknown object.
  const privateKeys = new Set(['_translationId','translations','draft','draft_source','candidate',
    'candidate_source','protected','reviewed_by','reviewed_at','token','credentials','password_hash','secret']);
  const missing = [];
  function scan(node, location = 'data') {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (privateKeys.has(key)) throw Error(`Private field is not exportable: ${location}.${key}`);
      scan(value, `${location}.${key}`);
    }
    if (typeof node.zh === 'string' && node.zh.trim() && !node.en?.trim()) missing.push(location);
  }
  data.posts = data.posts.filter(post => post.published === true);
  scan(data);
  if (!allowPending && missing.length) throw Error(`English is missing in ${missing.length} fields: ${missing.join(', ')}`);
  for (const collection of ['posts','departments']) {
    const ids = new Set();
    for (const item of data[collection]) {
      if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id)) throw Error(`Invalid or duplicate ${collection} ID`);
      ids.add(item.id);
    }
  }
  for (const dept of data.departments) {
    if (dept.url?.startsWith('https://') && !dept.recruitmentUrl) dept.recruitmentUrl = dept.url;
    dept.url = `department-${dept.id}.html`;
  }
  return {data, missing};
}

function filesAt(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    if (entry.isSymbolicLink()) throw Error(`Symlink is not exportable: ${entry.name}`);
    const name = prefix + entry.name;
    return entry.isDirectory() ? filesAt(path.join(directory, entry.name), name + '/') : [name];
  });
}

async function serve(directory) {
  const root = path.resolve(directory);
  const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css',
    '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.json':'application/json'};
  const server = http.createServer((req,res) => {
    try {
      const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw Error();
      res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
      fs.createReadStream(file).pipe(res);
    } catch {res.writeHead(404);res.end('Not found');}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`, close:() => new Promise(resolve => server.close(resolve))};
}

function verifyOriginals(root, source) {
  for (const name of ['secretariat','publicity']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, `content/departments/${name}-originals.json`)));
    for (const item of manifest.files) {
      const bytes = fs.readFileSync(path.join(root, item.file));
      if (bytes.length !== item.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
        throw Error(`Original image changed: ${item.file}`);
      }
    }
  }
}

function validateOutput(directory) {
  const errors=[];
  for(const name of filesAt(directory).filter(n=>n.endsWith('.html'))) {
    const html=fs.readFileSync(path.join(directory,name),'utf8');
    if(html.includes('data-page=')&&!html.includes('<main id="main"'))errors.push(`Missing rendered body: ${name}`);
    if(name.startsWith('department')&&/<script/i.test(html))errors.push(`Department article contains scripts: ${name}`);
    for(const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      const value=match[1].replaceAll('&amp;','&');
      if(/^https?:/.test(value)) {
        if(['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname))errors.push(`Local preview address in ${name}`);
        continue;
      }
      if(/^(mailto:|data:|#)/.test(value))continue;
      const file=decodeURIComponent(value.split(/[?#]/)[0]);
      const target=path.resolve(directory,file);
      if(!target.startsWith(path.resolve(directory)+path.sep)||!fs.existsSync(target))errors.push(`${name}: missing local target ${file}`);
    }
  }
  if(errors.length)throw Error(errors.join('\n'));
}

module.exports = {departmentFile,esc,json,readSite,prepareData,filesAt,serve,verifyOriginals,validateOutput};
