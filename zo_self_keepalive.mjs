/**
 * ZO 自保活 — 完整版
 * 
 * 流程：注册/登录 → 进入ZO云电脑 → AI对话保活
 * 策略：在ZO内部发送终端命令，让ZO AI在云电脑上实际执行 = 真正活跃
 * 
 * 间隔：8-15分钟随机发送一条AI消息
 * 消息类型：需要AI执行终端命令的任务
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'zoself');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const randF = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// 保活任务——让AI在ZO云电脑上执行实际操作
const KEEPALIVE_TASKS = [
  'Run "date" and "uptime" and tell me the results',
  'Run "ls -la /tmp" and show what files exist',
  'Run "free -h" and show memory usage',
  'Run "df -h" and show disk usage',
  'Run "ps aux | head -5" to show top processes',
  'Run "whoami" and "pwd"',
  'Create a file /tmp/keepalive_$(date +%s).txt with "ZO alive"',
  'Run "cat /proc/loadavg" and explain',
  'Check "uname -a" and tell me the kernel version',
  'Run "ls /etc" and count how many config files',
  'Run "env | head -10" to show environment',
  'Check if python3 is available: "which python3"',
  'Run "ip addr show" and summarize network',
  'Run "netstat -tlnp" if available, show listening ports',
  'Run "timedatectl" or "date -R" for system time',
];

function loadAccounts() {
  if (existsSync(ACCOUNTS_FILE)) {
    try { return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8')); } catch (e) {}
  }
  return [];
}

// Graph API
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

// CDP widget
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName || '').toLowerCase(); if (t === 'iframe' && n.attributes) { const a = Array.isArray(n.attributes) ? n.attributes : []; const i = a.findIndex(x => x === 'src'); const s = i >= 0 ? (a[i + 1] || '') : ''; if (s.includes('challenges.cloudflare') || s.includes('turnstile')) { r = { nodeId: n.nodeId, src: s }; return; } } if (n.shadowRoots) for (const sr of n.shadowRoots) dfs(sr, d + 1); if (n.children) for (const c of n.children) dfs(c, d + 1); if (n.contentDocument) dfs(n.contentDocument, d + 1); })(root, 0);
  if (!r) return null;
  try { const bm = await cdp.send('DOM.getBoxModel', { nodeId: r.nodeId }); if (bm?.model?.content) { const c = bm.model.content; r.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] }; } } catch (e) {}
  return r;
}

// ========== 登录流程 ==========
async function login(page, cdp, acc) {
  log('发送magic link...');
  try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) {}
  await sleep(3000);
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent||'') && btn.offsetParent) { btn.click(); return; } } });
  await sleep(2000);
  await page.evaluate(e => { const inp = document.querySelector('input[type=email]') || document.querySelector('input'); if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, e); inp.dispatchEvent(new Event('input', { bubbles: true })); } }, acc.email);
  await sleep(500);
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button')) { if (/continue/i.test(btn.textContent||'')) { btn.click(); return; } } });
  await sleep(3000);

  const st = new Date(Date.now() - 5000);
  let link = null, rt = acc.refreshToken;
  for (let i = 0; i < 45; i++) {
    try { const { at, rt: nr } = await getMsToken(acc.clientId, rt); rt = nr; link = await findLink(at, st); } catch (e) {}
    if (link) break;
    await sleep(3000); process.stdout.write('.');
  }
  if (!link) { log('\n❌ 无link'); return false; }
  log('\n✅ link');

  try { await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
  await sleep(12000);

  for (let a = 0; a < 10; a++) {
    const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
    if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { log('✅ 已登录'); return true; }

    const widget = await findWidget(cdp);
    if (widget?.box && widget.box.w > 0 && a < 3) {
      const { x, y, w, wh } = widget.box;
      await page.mouse.move(x + 28, y + wh / 2, { steps: 8 });
      await sleep(100); await page.mouse.down(); await sleep(50); await page.mouse.up();
      await sleep(3000);
    }
    await sleep(2000);
  }
  return false;
}

// ========== ★ ZO内部AI保活 ==========
async function sendKeepalive(page) {
  log('\n💬 [ZO内部保活]');

  // 等ZO加载
  await sleep(rand(5000, 10000));

  const info = await page.evaluate(() => {
    const inputs = [];
    ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="text"]:not([type="hidden"])'].forEach(sel => {
      try { [...document.querySelectorAll(sel)].forEach(el => { if (el.offsetParent) { const r = el.getBoundingClientRect(); inputs.push({ sel, tag: el.tagName, ph: el.placeholder || '', w: Math.round(r.width), h: Math.round(r.height) }); } }); } catch(e) {}
    });
    return { body: (document.body?.innerText || '').substring(0, 200), inputs };
  });

  log(`  body: "${info.body.substring(0, 80)}"`);
  log(`  inputs: ${info.inputs.length}`);

  if (info.inputs.length > 0) {
    const inp = info.inputs[0];
    const task = pick(KEEPALIVE_TASKS);
    log(`  ★ 发送: "${task}"`);

    // 点输入框
    await page.evaluate(s => { const el = document.querySelector(s); if (el) { el.focus(); el.click(); } }, inp.sel);
    await sleep(rand(300, 800));

    // 输入
    for (const ch of task) {
      await page.keyboard.type(ch);
      await sleep(rand(30, 120));
    }
    await sleep(rand(500, 1500));
    await page.keyboard.press('Enter');
    log('  ✅ 已发送');

    // 等AI处理
    await sleep(rand(20000, 40000));
    return true;
  } else {
    log('  ⚠ 无输入框，尝试浏览替代...');
    for (let i = 0; i < rand(4, 7); i++) {
      await page.mouse.move(randF(200, 1000), randF(100, 700), { steps: rand(4, 8) });
      await sleep(rand(300, 800));
    }
    await page.mouse.wheel(0, rand(100, 300));
    await sleep(rand(2000, 5000));

    // 随机点击
    const btns = await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], a')].filter(b => b.offsetParent && (b.textContent||'').trim() && (b.textContent||'').trim().length < 40).map(b => (b.textContent||'').trim()));
    if (btns.length > 0) {
      const t = pick(btns.slice(0, 10));
      log(`  点击: "${t}"`);
      await page.evaluate(tx => { for (const b of document.querySelectorAll('button, [role="button"], a')) { if (b.offsetParent && (b.textContent||'').trim() === tx) { b.click(); return; } } }, t);
      await sleep(rand(5000, 10000));
    }
    return false;
  }
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('ZO 云电脑自保活系统');
  log('在ZO内部通过AI对话执行终端命令保持活跃');
  log('='.repeat(60));

  const accounts = loadAccounts();
  if (!accounts.length) { log('❌ 无账号'); return; }
  const acc = accounts[0];
  log(`账号: ${acc.email} → ${acc.zoUrl}`);

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-self-keepalive'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 登录
  if (!await login(page, cdp, acc)) { log('❌ 登录失败'); await context.close(); return; }

  // 等待ZO桌面加载
  log('\n等待ZO云电脑启动(30s)...');
  await sleep(30000);

  // 立即保活一次
  log('\n首次保活...');
  await sendKeepalive(page);

  // 定时保活
  let count = 1;
  const interval = rand(8 * 60000, 15 * 60000);
  log(`\n🛡️ 定时保活: 每 ${Math.round(interval/60000)} 分钟`);

  setInterval(async () => {
    count++;
    log(`\n=== 保活 #${count} ===`);
    try {
      const url = page.url();
      if (!url.includes('.zo.computer')) {
        log('⚠ 需要重新登录');
        await login(page, cdp, acc);
      }
      await sendKeepalive(page);
    } catch (e) { log(`⚠ ${e.message}`); }
  }, interval);

  log('\n守护运行中...');
  process.stdin.resume();
}

process.on('SIGINT', () => { log('退出'); process.exit(0); });
main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
