/**
 * 极简测试：完全不注入补丁，看 Turnstile widget 能否正常渲染
 * 目标：确认补丁是否导致 widget 不渲染
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'bare_test');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());

// ========== 零补丁方案：只做最基本的 webdriver 隐藏 ==========
const MINIMAL_PATCH = `
// 只隐藏 webdriver，其他什么都不碰
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
`;

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

// ★ 只注入最小补丁
await context.addInitScript({ content: MINIMAL_PATCH });

const page = await context.newPage();

// 第一步：用已有的 magic link（上面运行已经收到了）
// 先发一个新的 magic link
log('发送 magic link...');
try {
  await page.goto('https://www.zo.computer/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch (e) {}
await sleep(3000);

// 点击 Email 按钮
await page.evaluate(() => {
  for (const btn of document.querySelectorAll('button, a')) {
    if (/email/i.test(btn.textContent || '') && btn.offsetParent) { btn.click(); return; }
  }
});
await sleep(2000);

// 填邮箱
await page.evaluate((email) => {
  const inp = document.querySelector('input[type=email]') || document.querySelector('input');
  if (inp) {
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(inp, email);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, EMAIL);
await sleep(500);

// 点 Continue
await page.evaluate(() => {
  for (const btn of document.querySelectorAll('button')) {
    if (/continue/i.test(btn.textContent || '')) { btn.click(); return; }
  }
});
await sleep(3000);

const sendTime = new Date(Date.now() - 3000);
log(`发送时间: ${sendTime.toISOString()}`);

// 轮询
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
log(`✅ link: ${magicLink.substring(0,80)}`);

if (rt !== REFRESH_TOKEN) {
  writeFileSync(EMAIL_FILE, [EMAIL, PASSWORD, CLIENT_ID, rt].join('----'), 'utf-8');
}

// ★★★ 关键测试：打开 magic link，观察 Turnstile 是否渲染
log('\n★★★ 打开 magic link，不注入任何额外补丁 ★★★');

try {
  await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {}
await sleep(2000);
await page.screenshot({ path: join(LOG_DIR, '01_initial.png') });

// 等待 Turnstile 加载
log('等待 5 秒...');
await sleep(5000);
await page.screenshot({ path: join(LOG_DIR, '02_after5s.png') });

log('等待 10 秒...');
await sleep(5000);
await page.screenshot({ path: join(LOG_DIR, '03_after10s.png') });

// ★ 深度 DOM 分析
const dom = await page.evaluate(() => {
  const r = {
    url: location.href,
    bodyHTML: document.body?.innerHTML?.substring(0, 8000),
    bodyText: document.body?.innerText?.substring(0, 500),
    iframes: [],
    cfElements: [],
    turnstileObjects: [],
    scripts: [],
    windowProps: {},
  };

  // 所有 iframe
  document.querySelectorAll('iframe').forEach(f => {
    const rect = f.getBoundingClientRect();
    r.iframes.push({
      src: (f.src || '').substring(0, 200),
      id: f.id, name: f.name,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      visible: rect.width > 0 && rect.height > 0,
      style: getComputedStyle(f).display,
    });
  });

  // cf-* 相关
  document.querySelectorAll('[id*=cf-], [class*=cf-], [id*=challenge], [class*=challenge], [id*=turnstile], [class*=turnstile], [id*=ch], [class*=ch]').forEach(el => {
    const rect = el.getBoundingClientRect();
    r.cfElements.push({
      tag: el.tagName,
      id: el.id || '',
      className: (el.className || '').toString().substring(0, 100),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      visible: rect.width > 0 && rect.height > 0,
      hasShadow: !!el.shadowRoot,
      innerHTML: el.innerHTML?.substring(0, 200),
    });
  });

  // window.turnstile
  if (typeof turnstile !== 'undefined') {
    r.turnstileObjects.push({
      loaded: !!turnstile,
      render: typeof turnstile.render,
      reset: typeof turnstile.reset,
      getResponse: typeof turnstile.getResponse,
      remove: typeof turnstile.remove,
    });
  }

  // 脚本
  document.querySelectorAll('script[src]').forEach(s => {
    if (s.src.includes('cloudflare') || s.src.includes('turnstile')) {
      r.scripts.push(s.src);
    }
  });

  // window 检测属性
  r.windowProps = {
    webdriver: navigator.webdriver,
    hasChrome: !!window.chrome,
    hasPlugins: navigator.plugins?.length || 0,
    hasLanguages: navigator.languages?.join(',') || '',
  };

  return r;
});

log(`\n=== DOM 分析 ===`);
log(`URL: ${dom.url.substring(0, 100)}`);
log(`Body: ${dom.bodyText.substring(0, 300)}`);
log(`\nIframes: ${dom.iframes.length}`);
dom.iframes.forEach(f => log(`  ${f.visible?'👁':'🙈'} [${f.rect.w}x${f.rect.h}] @(${f.rect.x},${f.rect.y}) src="${f.src.substring(0,100)}"`));
log(`\nCF Elements: ${dom.cfElements.length}`);
dom.cfElements.forEach(e => log(`  ${e.tag}#${e.id} [${e.rect.w}x${e.rect.h}] @(${e.rect.x},${e.rect.y}) visible=${e.visible} shadow=${e.hasShadow} html="${e.innerHTML.substring(0,100)}"`));
log(`\nTurnstile API: ${JSON.stringify(dom.turnstileObjects)}`);
log(`\nScripts:`);
dom.scripts.forEach(s => log(`  ${s}`));
log(`\nWindow props: ${JSON.stringify(dom.windowProps)}`);

// 保存完整 HTML
writeFileSync(join(LOG_DIR, 'body.html'), dom.bodyHTML, 'utf-8');

// 尝试用 turnstile.render() 手动渲染
log('\n=== 尝试手动调用 turnstile.render() ===');
const renderResult = await page.evaluate(() => {
  try {
    if (typeof turnstile === 'undefined') return { error: 'turnstile not defined' };
    
    // 找一个容器
    const container = document.querySelector('#cf-chl-widget-\\*_response')?.parentElement
                  || document.querySelector('[id*="cf-chl-widget"]')?.parentElement
                  || document.getElementById('turnstile-container');
    
    if (!container) return { error: 'no container' };
    
    // 尝试 render
    const widgetId = turnstile.render('#' + container.id, {
      sitekey: '0x4AAAAAAAEbA2am4T2iA28y', // 从页面提取
      callback: function(token) { console.log('Turnstile callback:', token); },
      'error-callback': function(err) { console.log('Turnstile error:', err); },
    });
    
    return { success: true, widgetId, containerId: container.id };
  } catch (e) {
    return { error: e.message };
  }
});

log(`render 结果: ${JSON.stringify(renderResult)}`);

await page.screenshot({ path: join(LOG_DIR, '04_after_test.png') });

// 再等一会
await sleep(5000);
await page.screenshot({ path: join(LOG_DIR, '05_final.png') });

const finalDom = await page.evaluate(() => {
  const r = { iframes: [] };
  document.querySelectorAll('iframe').forEach(f => {
    const rect = f.getBoundingClientRect();
    r.iframes.push({
      src: (f.src || '').substring(0, 200),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      visible: rect.width > 0 && rect.height > 0,
    });
  });
  return r;
});
log(`\n最终 iframes: ${finalDom.iframes.length}`);
finalDom.iframes.forEach(f => log(`  ${f.visible?'👁':'🙈'} [${f.rect.w}x${f.rect.h}] @(${f.rect.x},${f.rect.y})`));

log('\n保持浏览器30秒...');
await sleep(30000);
await browser.close();
log('完成');
