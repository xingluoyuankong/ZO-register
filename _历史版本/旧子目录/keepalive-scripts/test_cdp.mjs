/**
 * 测试方案：直接获取 token 并注入到 cf-turnstile-response input
 * Turnstile explicit 模式下，可能需要手动触发
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'cdp_test');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());

// 零补丁：完全不注入任何JS
const { chromium } = await import('playwright');

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  locale: 'zh-CN',
});

// ★ 完全不注入补丁
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

// 启用必要的 CDP 域
await cdp.send('DOM.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');

// 步骤1：获取 magic link
log('获取 magic link...');
try {
  await page.goto('https://www.zo.computer/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch (e) {}
await sleep(3000);

await page.evaluate(() => {
  for (const btn of document.querySelectorAll('button, a')) {
    if (/email/i.test(btn.textContent || '') && btn.offsetParent) { btn.click(); return; }
  }
});
await sleep(2000);

await page.evaluate((email) => {
  const inp = document.querySelector('input[type=email]') || document.querySelector('input');
  if (inp) {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(inp, email);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, EMAIL);
await sleep(500);

await page.evaluate(() => {
  for (const btn of document.querySelectorAll('button')) {
    if (/continue/i.test(btn.textContent || '')) { btn.click(); return; }
  }
});
await sleep(3000);

const sendTime = new Date(Date.now() - 3000);

let magicLink = null;
let rt = REFRESH_TOKEN;
for (let i = 0; i < 30; i++) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: rt,
    scope: 'https://graph.microsoft.com/.default offline_access'
  });
  try {
    const tr = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
    });
    const td = await tr.json();
    if (td.error) { await sleep(3000); continue; }
    rt = td.refresh_token || rt;
    const mr = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
      headers: { Authorization: 'Bearer ' + td.access_token }
    });
    const md = await mr.json();
    for (const msg of (md.value || [])) {
      if (new Date(msg.receivedDateTime) < sendTime) continue;
      const c = (msg.subject || '') + ' ' + (msg.body?.content || '');
      if (!/zo/i.test(c)) continue;
      const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
      for (let l of links) {
        l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
        if (/token=|verify|login/i.test(l)) { magicLink = l; break; }
      }
      if (magicLink) break;
    }
  } catch (e) {}
  if (magicLink) break;
  process.stdout.write('.');
  await sleep(3000);
}

if (!magicLink) { log('未收到link'); process.exit(1); }
log(`✅ link`);

if (rt !== REFRESH_TOKEN) {
  writeFileSync(EMAIL_FILE, [EMAIL, PASSWORD, CLIENT_ID, rt].join('----'), 'utf-8');
}

// ★★★ 核心测试 ★★★
log('\n=== 打开 magic link，使用CDP全面探查 ===');
try {
  await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {}
await sleep(8000); // 等待 Turnstile 加载

await page.screenshot({ path: join(LOG_DIR, '01_page.png') });

// 1. CDP 获取完整 DOM 树（含 Shadow DOM）
log('CDP DOM.getDocument (depth=-1)...');
const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });

// 递归查找所有 iframe 和带有 turnstile/cf 属性的元素
function deepFind(node, path, depth) {
  const results = [];
  if (depth > 50) return results;
  if (!node) return results;

  const tag = (node.localName || node.nodeName || '').toLowerCase();
  const currentPath = path ? `${path}>${tag || '#' + node.nodeType}` : 'root';

  // 记录 turnstile/cf 相关
  if (tag === 'iframe' || tag === 'input' || tag === 'div') {
    let isCf = false;
    if (node.attributes) {
      const attrs = Array.isArray(node.attributes) ? node.attributes : [];
      const attrStr = attrs.join(' ');
      if (/turnstile|cf-chl|sitekey|challenge|cf-/i.test(attrStr)) {
        isCf = true;
      }
    }
    if (tag === 'iframe') {
      let src = '';
      if (node.attributes) {
        const attrs = Array.isArray(node.attributes) ? node.attributes : [];
        const srcIdx = attrs.findIndex(a => a === 'src');
        if (srcIdx >= 0) src = attrs[srcIdx + 1] || '';
      }
      results.push({ tag, path: currentPath, src: src.substring(0, 100), nodeId: node.nodeId, contentDocId: node.contentDocument?.nodeId });
    }
  }

  // 遍历 children
  if (node.children) {
    for (const child of node.children) {
      results.push(...deepFind(child, currentPath, depth + 1));
    }
  }

  // 遍历 Shadow DOM
  if (node.shadowRoots) {
    for (const sr of node.shadowRoots) {
      results.push(...deepFind(sr, currentPath + '::shadow', depth + 1));
    }
  }

  // 遍历 contentDocument (iframe)
  if (node.contentDocument) {
    results.push(...deepFind(node.contentDocument, currentPath + '::doc', depth + 1));
  }

  return results;
}

const iframes = deepFind(root, '', 0);
log(`CDP 发现 ${iframes.length} 个 iframe:`);
iframes.slice(0, 20).forEach(f => log(`  path=${f.path} src="${f.src}"`));

// 2. 检查 JS 执行上下文
log('\n=== JS 上下文分析 ===');
const jsInfo = await page.evaluate(() => {
  const info = {};

  // turnstile 对象
  info.turnstile = {
    exists: typeof turnstile !== 'undefined',
    render: typeof turnstile?.render,
    reset: typeof turnstile?.reset,
    getResponse: typeof turnstile?.getResponse,
    remove: typeof turnstile?.remove,
  };

  // 尝试获取 response
  if (info.turnstile.exists) {
    try { info.turnstile.token = turnstile.getResponse(); } catch(e) { info.turnstile.token = null; }
  }

  // cf-chl-widget 元素
  const cfInputs = document.querySelectorAll('[id*="cf-chl-widget"]');
  info.cfInputs = [];
  cfInputs.forEach(inp => {
    info.cfInputs.push({
      id: inp.id,
      name: inp.name,
      value: inp.value?.substring(0, 50) || '',
      rect: inp.getBoundingClientRect().toJSON(),
      parentTag: inp.parentElement?.tagName || '',
      parentId: inp.parentElement?.id || '',
      parentClass: (inp.parentElement?.className || '').toString().substring(0, 100),
      parentShadow: !!inp.parentElement?.shadowRoot,
      parentHTML: inp.parentElement?.innerHTML?.substring(0, 500),
    });
  });

  // 检查 parent 的 shadow DOM
  info.parentShadowChildren = [];
  for (const inp of cfInputs) {
    const parent = document.querySelector('#' + inp.id)?.parentElement;
    if (parent?.shadowRoot) {
      const children = [...parent.shadowRoot.querySelectorAll('*')].map(c => ({
        tag: c.tagName,
        id: c.id || '',
        src: c.src || '',
        rect: c.getBoundingClientRect().toJSON(),
      }));
      info.parentShadowChildren.push({ parentId: parent.id, children });
    }
  }

  // 所有 id 带 turnstile 的元素
  info.turnstileElements = [];
  document.querySelectorAll('[id*=turnstile i], [class*=turnstile i]').forEach(el => {
    info.turnstileElements.push({
      tag: el.tagName, id: el.id || '', class: (el.className || '').toString(),
      rect: el.getBoundingClientRect().toJSON(),
      hasShadow: !!el.shadowRoot,
    });
  });

  // window.__cf 相关
  info.__cf = {
    __cfRL: typeof window.__cfRL !== 'undefined',
    __cfBeacon: typeof window.__cfBeacon !== 'undefined',
    _cf_chl_opt: typeof window._cf_chl_opt !== 'undefined',
  };

  return info;
});

log(`turnstile API: ${JSON.stringify(jsInfo.turnstile)}`);
log(`cf inputs: ${jsInfo.cfInputs.length}`);
jsInfo.cfInputs.forEach(inp => {
  log(`  ${inp.id}: value="${inp.value}" rect=(${Math.round(inp.rect.x)},${Math.round(inp.rect.y)}) ${Math.round(inp.rect.width)}x${Math.round(inp.rect.height)}`);
  log(`    parent: ${inp.parentTag}#${inp.parentId} shadow=${inp.parentShadow}`);
  log(`    parentHTML: ${inp.parentHTML?.substring(0,200)}`);
});
log(`parentShadowChildren: ${JSON.stringify(jsInfo.parentShadowChildren).substring(0, 500)}`);
log(`turnstile elements: ${JSON.stringify(jsInfo.turnstileElements)}`);
log(`__cf: ${JSON.stringify(jsInfo.__cf)}`);

// 3. 尝试手动调用 turnstile.render()
log('\n=== 尝试手动 render ===');

// 查找合适的容器
const renderTry = await page.evaluate(() => {
  const results = [];
  
  // 方法1：找到 cf-chl-widget 的父元素作为容器
  const cfInput = document.querySelector('[id*="cf-chl-widget"]');
  if (cfInput && cfInput.parentElement) {
    const container = cfInput.parentElement;
    // 确保容器有ID
    let cid = container.id;
    if (!cid) {
      cid = 'turnstile-container-' + Date.now();
      container.id = cid;
    }
    
    try {
      const widgetId = turnstile.render('#' + cid, {
        sitekey: '0x4AAAAAAAEbA2am4T2iA28y',
        callback: function(token) { console.log('TS callback:', token); },
        'error-callback': function(e) { console.log('TS error:', e); },
        'timeout-callback': function() { console.log('TS timeout'); },
      });
      results.push({ method: 'parentContainer', containerId: cid, widgetId });
    } catch (e) {
      results.push({ method: 'parentContainer', error: e.message });
    }
  }
  
  return results;
});
log(`render 尝试: ${JSON.stringify(renderTry)}`);

await sleep(5000);
await page.screenshot({ path: join(LOG_DIR, '02_after_render.png') });

// 再次检查 iframes
const finalIframes = await page.evaluate(() => {
  const iframes = [];
  document.querySelectorAll('iframe').forEach(f => {
    const rect = f.getBoundingClientRect();
    iframes.push({
      src: (f.src || '').substring(0, 150),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      visible: rect.width > 0 && rect.height > 0,
    });
  });
  return iframes;
});
log(`最终 iframes: ${finalIframes.length}`);
finalIframes.forEach(f => log(`  ${f.visible?'👁':'🙈'} [${f.rect.w}x${f.rect.h}] @(${f.rect.x},${f.rect.y}) src="${f.src}"`));

// 检查 token
const token = await page.evaluate(() => {
  try { return turnstile.getResponse(); } catch(e) { return null; }
});
log(`turnstile token: ${token ? 'YES (' + token.substring(0, 30) + '...)' : 'NO'}`);

log('\n保持浏览器...');
await sleep(30000);
await browser.close();
log('完成');
