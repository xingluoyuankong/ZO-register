/**
 * ZO 套娃自保活 v2 — 读AI回复 + 逐步验证 + 完整部署
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'matryoshka2');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];

// ZO内部保活脚本
const KEEPALIVE_JS = `// ZO内部自保活 — xvfb+puppeteer循环
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r = (a,b) => Math.floor(a+Math.random()*(b-a+1));
const rf = (a,b) => a+Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

async function cycle() {
  let browser;
  try {
    browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
    const ctx = await browser.newContext({viewport:{width:1280,height:720}});
    const page = await ctx.newPage();
    await page.goto('https://www.zo.computer',{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(r(3000,8000));
    for(let i=0;i<r(3,7);i++){await page.mouse.move(rf(100,1100),rf(100,650));await sleep(r(100,400));}
    await page.mouse.wheel(0,r(100,400));await sleep(r(1000,3000));
    await ctx.close();
    console.log(new Date().toISOString(),'[OK]');
  } catch(e) {
    console.error(e.message);
  } finally {
    if(browser) try{await browser.close()}catch(e){}
  }
}
console.log('[KeepAlive] started');
cycle();
setInterval(cycle, r(5*60000, 12*60000));
`;

// ========== 基础函数 ==========
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
  for (const m of (d.value || [])) { if (new Date(m.receivedDateTime) < after) continue; const c = (m.subject || '') + ' ' + (m.body?.content || ''); if (!/zo/i.test(c)) continue; const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || []; for (let l of links) { l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&'); if (/token=|verify|login/i.test(l)) return l; } }
  return null;
}
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName || '').toLowerCase(); if (t === 'iframe' && n.attributes) { const a = Array.isArray(n.attributes) ? n.attributes : []; const i = a.findIndex(x => x === 'src'); const s = i >= 0 ? (a[i + 1] || '') : ''; if (s.includes('challenges.cloudflare') || s.includes('turnstile')) { r = { nodeId: n.nodeId, src: s }; return; } } if (n.shadowRoots) for (const sr of n.shadowRoots) dfs(sr, d + 1); if (n.children) for (const c of n.children) dfs(c, d + 1); if (n.contentDocument) dfs(n.contentDocument, d + 1); })(root, 0);
  if (!r) return null;
  try { const bm = await cdp.send('DOM.getBoxModel', { nodeId: r.nodeId }); if (bm?.model?.content) { const c = bm.model.content; r.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] }; } } catch (e) {}
  return r;
}

// ========== 登录 ==========
async function login(page, cdp) {
  log('登录ZO...');
  try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) {}
  await sleep(3000);
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent || '') && btn.offsetParent) { btn.click(); return; } } });
  await sleep(2000);
  await page.evaluate(e => { const inp = document.querySelector('input[type=email]') || document.querySelector('input'); if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, e); inp.dispatchEvent(new Event('input', { bubbles: true })); } }, acc.email);
  await sleep(500);
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button')) { if (/continue/i.test(btn.textContent || '')) { btn.click(); return; } } });
  await sleep(3000);

  const st = new Date(Date.now() - 5000);
  let link = null, rt = acc.refreshToken;
  for (let i = 0; i < 45; i++) { try { const { at, rt: nr } = await getMsToken(acc.clientId, rt); rt = nr; link = await findLink(at, st); } catch (e) {} if (link) break; await sleep(3000); }
  if (!link) { log('❌ 无link'); return false; }
  try { await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
  await sleep(12000);
  for (let a = 0; a < 10; a++) {
    const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
    if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { log('✅ 已登录'); return true; }
    const widget = await findWidget(cdp);
    if (widget?.box && widget.box.w > 0 && a < 3) { const { x, y, h: bh } = widget.box; try { await page.mouse.move(x + 28, y + bh / 2, { steps: 8 }); await sleep(100); await page.mouse.down(); await sleep(50); await page.mouse.up(); } catch (e) {} }
    await sleep(3000);
  }
  return false;
}

// ========== ★ 核心：发送命令并读取AI回复 ==========
async function askZO(page, cmd, timeout = 90) {
  log(`  发送: ${cmd.substring(0, 80)}...`);

  // 先等ZO AI空闲（没有"thinking"状态）
  for (let w = 0; w < 10; w++) {
    const thinking = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /thinking|running|executing|processing|generating/i.test(text);
    }).catch(() => false);
    if (!thinking) break;
    log(`  AI忙碌中，等待(${w+1})...`);
    await sleep(10000);
  }

  // 记录发送前的body
  const before = await page.evaluate(() => document.body?.innerText || '');

  // 找输入框
  const inputSel = await page.evaluate(() => {
    for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="text"]:not([type="hidden"])']) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent) { el.focus(); el.click(); return sel; }
    }
    return null;
  });
  if (!inputSel) { log('  ❌ 无输入框'); return null; }

  // 输入
  for (const ch of cmd) { await page.keyboard.type(ch); await sleep(15); }
  await sleep(500);
  await page.keyboard.press('Enter');

  // ★ 等待AI回复完成（监控body文字变化）
  log('  等待回复...');
  let lastText = before;
  let replyFound = false;
  for (let i = 0; i < timeout; i++) {
    await sleep(2000);
    try {
      const text = await page.evaluate(() => document.body?.innerText || '');
      // 找到新增的回复内容
      if (text.length > lastText.length + 10) {
        const diff = text.substring(lastText.length);
        // 过滤掉cmd本身（可能在body中显示）
        const cleanDiff = diff.replace(new RegExp(cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
        if (cleanDiff.length > 5 && !/thinking|running|executing/i.test(cleanDiff)) {
          log(`  AI回复: "${cleanDiff.substring(0, 200)}"`);
          replyFound = true;
          // 继续等待确保回复完整
          await sleep(5000);
          break;
        }
      }
      lastText = text;
    } catch (e) {}
  }

  if (!replyFound) {
    log('  ⚠ 未检测到明确回复，可能命令仍在执行');
    // 抓当前body
    const final = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
    log(`  当前状态: "${final.substring(0,100)}"`);
  }

  await sleep(5000);
  return replyFound;
}

// ========== 部署 ==========
async function deploy(page) {
  log('\n=== 部署ZO内部套娃 ===');

  // Step 1: 安装xvfb
  log('Step 1: 安装xvfb...');
  await askZO(page, 'Install xvfb: sudo apt update && sudo apt install -y xvfb', 120);

  // Step 2: 安装chromium
  log('Step 2: 安装chromium...');
  await askZO(page, 'Install chromium-browser: sudo apt install -y chromium-browser', 120);

  // Step 3: 安装node/npm
  log('Step 3: 安装nodejs...');
  await askZO(page, 'Install nodejs: sudo apt install -y nodejs npm', 120);

  // Step 4: 安装playwright
  log('Step 4: 安装playwright...');
  await askZO(page, 'Install playwright globally: npm install -g playwright && npx playwright install chromium', 180);

  // Step 5: 创建保活脚本（用cat heredoc避免base64问题）
  log('Step 5: 创建保活脚本...');
  // 分片写入（避免单条命令太长）
  const lines = KEEPALIVE_JS.split('\n');
  await askZO(page, `Write keepalive script: cat > /home/user/keepalive.js << 'ENDOFSCRIPT' ${lines.slice(0, 15).join('\n')} ENDOFSCRIPT`, 60);

  for (let i = 15; i < lines.length; i += 15) {
    const chunk = lines.slice(i, i + 15).join('\n');
    await askZO(page, `Append to script: cat >> /home/user/keepalive.js << 'ENDOFSCRIPT' ${chunk} ENDOFSCRIPT`, 60);
  }

  // Step 6: 启动保活
  log('Step 6: 启动保活...');
  await askZO(page, 'Start keepalive: cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "PID=$!"', 60);

  // ===== 验证 =====
  log('\n=== 验证部署 ===');
  await sleep(10000);

  log('验证1: xvfb...');
  await askZO(page, 'which xvfb-run && echo INSTALLED || echo MISSING');

  log('验证2: keepalive进程...');
  await askZO(page, 'ps aux | grep -v grep | grep keepalive || echo NOT_RUNNING');

  log('验证3: 保活日志...');
  await askZO(page, 'cat /tmp/keepalive.log 2>/dev/null || echo NO_LOG');

  log('\n✅ 部署流程完成！');
}

// ========== 主 ==========
async function main() {
  log('ZO套娃v2 — 读AI回复+逐步验证');

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-matryoshka2'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  if (!await login(page, cdp)) { log('❌ 登录失败'); await context.close(); return; }

  log('等待ZO启动(60s)...');
  await sleep(60000);

  await deploy(page);

  log('\n保持30s...');
  await sleep(30000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
