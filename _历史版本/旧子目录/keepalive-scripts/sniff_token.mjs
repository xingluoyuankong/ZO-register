/**
 * 抓取ZO ACCESS_TOKEN + 分析ZO桌面页面结构
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'sniff');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'sniff.log'), m + '\n'); };

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];

async function getMsToken(cid, rt) {
  const b = new URLSearchParams({ client_id: cid, grant_type: 'refresh_token', refresh_token: rt, scope: 'https://graph.microsoft.com/.default offline_access' });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const d = await r.json();
  if (d.error) throw new Error(d.error_description);
  return { at: d.access_token, rt: d.refresh_token || rt };
}

async function findLink(at, after) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', { headers: { Authorization: 'Bearer ' + at } });
  const d = await r.json();
  for (const m of (d.value || [])) {
    if (new Date(m.receivedDateTime) < after) continue;
    const c = (m.subject || '') + ' ' + (m.body?.content || '');
    if (!/zo/i.test(c)) continue;
    const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    for (let l of links) { l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&'); if (/token=|verify|login/i.test(l)) return l; }
  }
  return null;
}

async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName || '').toLowerCase(); if (t === 'iframe' && n.attributes) { const a = Array.isArray(n.attributes) ? n.attributes : []; const i = a.findIndex(x => x === 'src'); const s = i >= 0 ? (a[i + 1] || '') : ''; if (s.includes('challenges.cloudflare') || s.includes('turnstile')) { r = { nodeId: n.nodeId, src: s }; return; } } if (n.shadowRoots) for (const sr of n.shadowRoots) dfs(sr, d + 1); if (n.children) for (const c of n.children) dfs(c, d + 1); })(root, 0);
  if (!r) return null;
  try { const bm = await cdp.send('DOM.getBoxModel', { nodeId: r.nodeId }); if (bm?.model?.content) { const c = bm.model.content; r.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] }; } } catch (e) {}
  return r;
}

async function main() {
  log('抓取 ZO Access Token');

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-sniff'),
    {
      headless: false,
      executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
    }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 登录流程
  log('登录...');
  try { await page.goto(acc.zoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
  await sleep(5000);

  const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
  if (host !== acc.handle + '.zo.computer') {
    log('需要登录...');
    try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) {}
    await sleep(3000);
    await page.evaluate(() => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent||'')&&btn.offsetParent){btn.click();return;} } });
    await sleep(2000);
    await page.evaluate(e => { const inp=document.querySelector('input[type=email]')||document.querySelector('input'); if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,e);inp.dispatchEvent(new Event('input',{bubbles:true}));} }, acc.email);
    await sleep(500);
    await page.evaluate(() => { for(const btn of document.querySelectorAll('button')){if(/continue/i.test(btn.textContent||'')){btn.click();return;}} });
    await sleep(3000);

    const st=new Date(Date.now()-5000); let link=null, rt=acc.refreshToken;
    for(let i=0;i<45;i++){try{const {at,rt:nr}=await getMsToken(acc.clientId,rt);rt=nr;link=await findLink(at,st);}catch(e){} if(link)break;await sleep(3000);}
    if(!link){log('❌');await context.close();return;}

    try{await page.goto(link,{waitUntil:'domcontentloaded',timeout:60000});}catch(e){}
    await sleep(12000);

    for(let a=0;a<8;a++){
      const h=(()=>{try{return new URL(page.url()).hostname}catch(e){return''}})();
      if(h===acc.handle+'.zo.computer'){log('✅ 登录成功');break;}
      const widget=await findWidget(cdp);
      if(widget?.box&&a<3){const {x,y,w,wh}=widget.box;await page.mouse.move(x+28,y+wh/2,{steps:8});await sleep(100);await page.mouse.down();await sleep(50);await page.mouse.up();await sleep(3000);}
      await sleep(2000);
    }
  }

  // ★ 等待ZO桌面充分加载
  log('\n等待ZO桌面加载 (20秒)...');
  await sleep(20000);
  await page.screenshot({ path: join(LOG_DIR, 'desktop.png') });

  // ★ 抓取cookies
  const cookies = await context.cookies();
  log(`\n=== Cookies (${cookies.length}) ===`);
  cookies.forEach(c => {
    if (c.name.toLowerCase().includes('token') || c.name.toLowerCase().includes('auth') || c.name.toLowerCase().includes('session') || c.name.toLowerCase().includes('access')) {
      log(`  ★ ${c.name}=${c.value.substring(0, 50)}... domain=${c.domain}`);
    }
  });

  // ★ 抓取localStorage
  const ls = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('token') || key.includes('auth') || key.includes('session') || key.includes('access') || key.includes('zo_'))) {
        items[key] = localStorage.getItem(key).substring(0, 80);
      }
    }
    return items;
  });
  log(`\n=== localStorage tokens ===`);
  Object.entries(ls).forEach(([k, v]) => log(`  ★ ${k}=${v}...`));

  // ★ 抓取网络请求中的Authorization header
  log('\n=== 拦截网络请求中的Auth ===');
  await cdp.send('Network.enable');
  let capturedToken = null;

  cdp.on('Network.requestWillBeSent', params => {
    const headers = params.request.headers;
    if (headers.Authorization || headers.authorization) {
      const auth = headers.Authorization || headers.authorization;
      if (auth.includes('zo_sk_') || auth.includes('Bearer')) {
        capturedToken = auth;
        log(`  截获Auth: ${auth.substring(0, 60)}...`);
      }
    }
  });

  // 触发一些请求 (刷新或导航)
  try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
  await sleep(10000);

  // ★ 分析页面结构
  log('\n=== 页面结构分析 ===');
  const structure = await page.evaluate(() => {
    const info = {
      url: location.href,
      title: document.title,
      bodyHTML: document.body?.innerHTML?.substring(0, 3000),
      bodyText: document.body?.innerText?.substring(0, 500),
    };

    // 所有iframe
    info.iframes = [...document.querySelectorAll('iframe')].map(f => {
      const r = f.getBoundingClientRect();
      return { src: (f.src||'').substring(0, 80), visible: r.width > 0, rect: { w: Math.round(r.width), h: Math.round(r.height) } };
    });

    // 所有输入元素
    info.inputs = [];
    ['textarea', '[contenteditable="true"]', '[role="textbox"]', '.ProseMirror', 'input[type="text"]:not([type="hidden"])', 'input:not([type="hidden"])'].forEach(sel => {
      try {
        [...document.querySelectorAll(sel)].forEach(el => {
          if (el.offsetParent) {
            const r = el.getBoundingClientRect();
            info.inputs.push({
              selector: sel,
              tag: el.tagName,
              placeholder: el.placeholder || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            });
          }
        });
      } catch(e) {}
    });

    // 按钮
    info.buttons = [...document.querySelectorAll('button, [role="button"]')]
      .filter(b => b.offsetParent && (b.textContent||'').trim().length > 0 && (b.textContent||'').trim().length < 40)
      .map(b => (b.textContent||'').trim());

    return info;
  });

  log(`URL: ${structure.url}`);
  log(`Title: ${structure.title}`);
  log(`Body: ${structure.bodyText.substring(0, 200)}`);
  log(`Iframes: ${structure.iframes.length}`);
  structure.iframes.forEach(f => log(`  ${f.visible?'👁':'🙈'} [${f.rect.w}x${f.rect.h}] ${f.src}`));
  log(`Inputs: ${structure.inputs.length}`);
  structure.inputs.forEach(inp => log(`  [${inp.selector}] ${inp.tag} ${inp.rect.w}x${inp.rect.h} @(${inp.rect.x},${inp.rect.y}) ph="${inp.placeholder}" aria="${inp.ariaLabel}"`));
  log(`Buttons (${structure.buttons.length}): ${structure.buttons.slice(0, 20).join(', ')}`);

  // ★ 保存HTML
  writeFileSync(join(LOG_DIR, 'body.html'), structure.bodyHTML, 'utf-8', () => {});

  // ★ 尝试通过API测试
  if (capturedToken) {
    const token = capturedToken.replace('Bearer ', '').replace('bearer ', '');
    log(`\n=== 测试ZO API ===`);
    log(`Token: ${token.substring(0, 30)}...`);

    try {
      const resp = await fetch('https://api.zo.computer/v1/models', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await resp.json();
      log(`API状态: ${resp.status}`);
      log(`Models: ${JSON.stringify(data).substring(0, 300)}`);
    } catch (e) {
      log(`API错误: ${e.message}`);
    }
  }

  log('\n浏览器保持60秒，可手动检查...');
  await sleep(60000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
