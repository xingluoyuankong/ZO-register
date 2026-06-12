/**
 * Turnstile 破解最终版
 * 
 * 基于 10+ 轮实跑测试的最终方案：
 * 1. CDP穿透Shadow DOM获取widget坐标
 * 2. 真人行为模拟（鼠标移动+滚动+延迟）
 * 3. 精准点击widget左侧checkbox位置(28px offset)
 * 4. 持续轮询turnstile.getResponse()观察token
 * 5. 过期自动刷新
 * 
 * 核心认知：Turnstile是Managed隐形验证型，点击只是辅助
 * token生成取决于Cloudflare后台的浏览器指纹检测
 * 如果token始终不生成，需要从浏览器环境层面解决
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'final');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => a + Math.random() * (b - a);

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());
log(`使用: ${EMAIL}`);

// ========== 轻量指纹补丁（只保留最关键的）==========
const PATCH = `
(function() {
  if (window.__TSFINAL__) return;
  window.__TSFINAL__ = true;
  
  // webdriver - 最关键
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  try {
    var d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
    if (d) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
  } catch(e) {}
  
  // outerWidth/Height - 真实浏览器有边框差异
  Object.defineProperty(window, 'outerWidth', { 
    get: function() { return window.innerWidth + 16 + Math.floor(Math.random()*2); }
  });
  Object.defineProperty(window, 'outerHeight', { 
    get: function() { return window.innerHeight + 80 + Math.floor(Math.random()*5); }
  });
  
  // plugins
  Object.defineProperty(navigator, 'plugins', {
    get: function() {
      return Object.setPrototypeOf([
        { name:'Chrome PDF Plugin', filename:'internal-pdf-viewer', length:1, item:function(){return null}, namedItem:function(){return null} },
        { name:'Chrome PDF Viewer', filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai', length:1, item:function(){return null}, namedItem:function(){return null} },
        { name:'Native Client', filename:'internal-nacl-plugin', length:1, item:function(){return null}, namedItem:function(){return null} }
      ], PluginArray.prototype);
    }
  });
  
  // languages
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN','zh','en-US','en'] });
})();
`;

// ========== 获取 magic link ==========
async function sendMagicLink(page) {
  try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch(e) {}
  await sleep(3000);
  
  // 点 Email 按钮
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button, a')) {
      if (/email/i.test(btn.textContent || '') && btn.offsetParent) { btn.click(); return; }
    }
  });
  await sleep(2000);
  
  // 填邮箱
  await page.evaluate(email => {
    const inp = document.querySelector('input[type="email"]') || document.querySelector('input');
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
  
  return new Date(Date.now() - 5000);
}

// ========== 轮询 magic link ==========
async function pollMagicLink(sendTime) {
  let rt = REFRESH_TOKEN;
  for (let i = 0; i < 40; i++) {
    try {
      const body = new URLSearchParams({
        client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: rt,
        scope: 'https://graph.microsoft.com/.default offline_access'
      });
      const tr = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
      });
      const td = await tr.json();
      if (td.error) { await sleep(3000); continue; }
      rt = td.refresh_token || rt;
      
      const mr = await fetch(
        'https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc',
        { headers: { Authorization: 'Bearer ' + td.access_token } }
      );
      const md = await mr.json();
      for (const msg of (md.value || [])) {
        if (new Date(msg.receivedDateTime) < sendTime) continue;
        const c = (msg.subject || '') + ' ' + (msg.body?.content || '');
        if (!/zo/i.test(c)) continue;
        const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
        for (let l of links) {
          l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
          if (/token=|verify|login/i.test(l)) return { link: l, newRt: rt };
        }
      }
    } catch (e) {}
    await sleep(3000);
    process.stdout.write('.');
  }
  return null;
}

// ========== CDP 穿透 Shadow DOM 找 Turnstile widget ==========
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let result = null;
  
  function dfs(node, depth) {
    if (result || depth > 100 || !node) return;
    const t = (node.localName || '').toLowerCase();
    
    if (t === 'iframe' && node.attributes) {
      const attrs = Array.isArray(node.attributes) ? node.attributes : [];
      const si = attrs.findIndex(a => a === 'src');
      const src = si >= 0 ? (attrs[si + 1] || '') : '';
      if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
        result = { nodeId: node.nodeId, src };
        return;
      }
    }
    if (node.shadowRoots) for (const sr of node.shadowRoots) dfs(sr, depth + 1);
    if (node.children) for (const c of node.children) dfs(c, depth + 1);
    if (node.contentDocument) dfs(node.contentDocument, depth + 1);
  }
  dfs(root, 0);
  if (!result) return null;
  
  try {
    const bm = await cdp.send('DOM.getBoxModel', { nodeId: result.nodeId });
    if (bm?.model?.content) {
      const c = bm.model.content;
      result.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] };
    }
  } catch (e) {}
  return result;
}

// ========== 真人行为 + 点击 ==========
async function humanClick(page, widget) {
  if (!widget?.box) return false;
  const { x, y, w, h } = widget.box;
  const clickX = x + 28;  // checkbox在widget左侧28px
  const clickY = y + h / 2; // 垂直居中
  
  log(`  点击 (${Math.round(clickX)}, ${Math.round(clickY)}) [widget: ${Math.round(w)}x${Math.round(h)}]`);
  
  // 模拟真人移动
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(rand(200, 900), rand(100, 700), { steps: Math.floor(rand(4, 8)) });
    await sleep(rand(200, 500));
  }
  await page.mouse.wheel(0, rand(50, 150));
  await sleep(rand(400, 800));
  
  // 移向目标
  const sx = clickX + rand(80, 200) * (Math.random() > 0.5 ? 1 : -1);
  const sy = clickY + rand(30, 80) * (Math.random() > 0.5 ? 1 : -1);
  const steps = Math.floor(rand(6, 10));
  for (let s = 1; s <= steps; s++) {
    const p = s / steps;
    await page.mouse.move(
      sx + (clickX - sx) * p + Math.sin(p * Math.PI * 1.5) * rand(-8, 8),
      sy + (clickY - sy) * p + Math.cos(p * Math.PI) * rand(-6, 6)
    );
    await sleep(rand(20, 50));
  }
  await sleep(rand(100, 300));
  await page.mouse.move(clickX, clickY);
  await sleep(rand(60, 150));
  await page.mouse.down();
  await sleep(rand(40, 80));
  await page.mouse.up();
  log(`  ✅ 已点击`);
  
  return true;
}

// ========== 主循环 ==========
async function main() {
  const { chromium } = await import('playwright');
  
  // 启动浏览器
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  await context.addInitScript({ content: PATCH });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  
  // 发送magic link
  log('发送 magic link...');
  const sendTime = await sendMagicLink(page);
  log(`等待收件...`);
  const result = await pollMagicLink(sendTime);
  if (!result) { log('❌ 未收到link'); await browser.close(); return; }
  log(`\n✅ link`);
  
  if (result.newRt !== REFRESH_TOKEN) {
    writeFileSync(EMAIL_FILE, [EMAIL, PASSWORD, CLIENT_ID, result.newRt].join('----'), 'utf-8');
  }
  
  // 打开link，等Turnstile
  log('打开 link，等 Turnstile 加载...');
  try { await page.goto(result.link, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
  await sleep(12000);
  await page.screenshot({ path: join(LOG_DIR, 'loaded.png') });
  
  // 主循环
  let solved = false, attempt = 0, clicked = false;
  
  while (!solved && attempt < 30) {
    attempt++;
    log(`\n--- 尝试 ${attempt} ---`);
    
    const url = page.url();
    const hostname = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();
    if (hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer') {
      log('🎉 已登录子域名！'); solved = true; break;
    }
    
    // 检查token
    const token = await page.evaluate(() => {
      try { const r = turnstile.getResponse(); return (r && r.length > 10) ? r : null; }
      catch (e) { return null; }
    });
    if (token) {
      log(`✅ TOKEN: ${token.substring(0, 30)}...`);
      // 尝试继续
      await sleep(5000);
      const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
      if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { solved = true; break; }
    }
    
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
    
    // 检查是否已通过
    if (/choose your handle|set up your profile|welcome|dashboard/i.test(text)) {
      log('🎉 进入注册流程！'); solved = true; break;
    }
    
    // 检查过期
    if (/invalid|expired/i.test(text) && !/redirecting/i.test(text)) {
      log('⚠ Link expired, 重新导航...');
      try { await page.goto(result.link, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
      await sleep(12000);
      clicked = false;
      continue;
    }
    
    // 找widget并点击
    const widget = await findWidget(cdp);
    
    if (widget?.box && widget.box.w > 0) {
      log(`Widget: (${Math.round(widget.box.x)},${Math.round(widget.box.y)}) ${Math.round(widget.box.w)}x${Math.round(widget.box.h)}`);
      
      if (!clicked || attempt % 5 === 0) {
        await humanClick(page, widget);
        clicked = true;
      }
      
      // 观察token
      for (let w = 0; w < 10; w++) {
        await sleep(2000);
        const t = await page.evaluate(() => { try { return turnstile.getResponse(); } catch (e) { return null; } });
        if (t && t.length > 10) { log('✅ TOKEN!'); solved = true; break; }
        const ch = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
        if (ch.endsWith('.zo.computer') && ch !== 'www.zo.computer') { log('🎉 跳转!'); solved = true; break; }
        if (w % 3 === 0) log(`  ${w * 2}s: token=${t ? 'YES' : 'NO'}`);
      }
      if (solved) break;
    } else {
      log(`Widget不可见, token=${token ? 'YES' : 'NO'}`);
    }
    
    await sleep(2000);
  }
  
  if (solved) log('\n🎉 破解成功！');
  else log('\n❌ 30次尝试后仍未通过');
  
  log(`最终: ${page.url().substring(0, 100)}`);
  await page.screenshot({ path: join(LOG_DIR, 'FINAL.png') });
  
  // 保持浏览器打开
  log('浏览器保持60秒...');
  await sleep(60000);
  await browser.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
