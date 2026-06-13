/**
 * ZO 云电脑内部自保活 — 在ZO VM内部通过AI对话保持活跃
 * 
 * 核心思路：
 * 1. 登录ZO → 进入云电脑桌面
 * 2. 在ZO内部找到AI聊天输入框
 * 3. 定期发送AI对话消息（ZO云电脑处理AI请求 = 活跃 = 不休眠）
 * 4. 发送的消息会让ZO AI执行任务，保持VM进程活跃
 * 
 * 保活消息策略：发送需要AI思考/操作的指令（非简单问答）
 *   - 代码编写请求
 *   - 终端命令执行
 *   - 文件操作
 *   - 系统信息查询
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'keepalive_overseas');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const randF = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ★ 保活消息 — 需要AI思考/操作的指令（非简单问答）
const KEEPALIVE_TASKS = [
  'Run "uptime" command and tell me the result',
  'List the current directory with "ls -la" and show me what files are there',
  'Show me the current system load with "top -bn1 | head -5"',
  'Check disk usage with "df -h" and summarize',
  'Show me the current date, time, and timezone',
  'Run "ps aux | head -10" to show running processes',
  'Create a file /tmp/keepalive_notes.txt with current timestamp',
  'Check if python3 is installed, if not tell me what to install',
  'Show me the contents of /etc/hostname',
  'Run "free -h" to show memory usage',
  'Check network connectivity with "ping -c 1 google.com"',
  'Show me the last 5 lines of /var/log/syslog if available',
  'Create a simple hello world script in /tmp/hello.sh',
  'List all cron jobs for the current user',
  'Show me the systemd services status with "systemctl list-units --type=service | head -10"',
  'Run "uname -a" to show kernel version',
  'Check what programming languages are installed (python, node, gcc etc)',
  'Show me the current user with "whoami" and home directory',
  'Run "cat /proc/cpuinfo | head -10" to show CPU info',
  'Create a directory /tmp/keepalive_data_$(date +%Y%m%d)',
];

// ========== 账号加载 ==========
function loadAccounts() {
  if (existsSync(ACCOUNTS_FILE)) {
    try { return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8')); } catch(e) {}
  }
  return [];
}

// ========== Graph API ==========
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

// ========== CDP找Turnstile widget ==========
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName || '').toLowerCase(); if (t === 'iframe' && n.attributes) { const a = Array.isArray(n.attributes) ? n.attributes : []; const i = a.findIndex(x => x === 'src'); const s = i >= 0 ? (a[i + 1] || '') : ''; if (s.includes('challenges.cloudflare') || s.includes('turnstile')) { r = { nodeId: n.nodeId, src: s }; return; } } if (n.shadowRoots) for (const sr of n.shadowRoots) dfs(sr, d + 1); if (n.children) for (const c of n.children) dfs(c, d + 1); })(root, 0);
  if (!r) return null;
  try { const bm = await cdp.send('DOM.getBoxModel', { nodeId: r.nodeId }); if (bm?.model?.content) { const c = bm.model.content; r.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] }; } } catch (e) {}
  return r;
}

// ========== 登录 ==========
async function ensureLoggedIn(page, cdp, acc) {
  // 先访问ZO子域名
  try { await page.goto(acc.zoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
  await sleep(5000);

  const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
  if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') {
    log(`✅ 已在子域名`);
    return true;
  }

  log('需要登录...');
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

  for (let a = 0; a < 8; a++) {
    const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
    if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { log('✅ 登录成功'); return true; }
    const widget = await findWidget(cdp);
    if (widget?.box && a < 3) {
      const { x, y, w, h: wh } = widget.box;
      await page.mouse.move(x + 28, y + wh / 2, { steps: 8 });
      await sleep(100); await page.mouse.down(); await sleep(50); await page.mouse.up();
      await sleep(3000);
    }
    const token = await page.evaluate(() => { try { const r = turnstile.getResponse(); return (r && r.length > 10) ? r : null; } catch (e) { return null; } });
    if (token) {
      await page.evaluate(tk => { const inp = document.querySelector('[name="cf-turnstile-response"]'); if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, tk); inp.dispatchEvent(new Event('change', { bubbles: true })); } }, token);
      await sleep(3000);
    }
    await sleep(2000);
  }
  return false;
}

// ========== ★ 核心：在ZO内部发送AI消息保活 ==========
async function sendKeepaliveMessage(page) {
  log('\n💬 [ZO内部保活] 发送AI消息...');

  // 等待ZO桌面充分加载（React SPA + 云电脑启动需要时间）
  await sleep(rand(5000, 10000));
  await page.screenshot({ path: join(LOG_DIR, `screen_${Date.now()}.png`) });

  // 获取页面状态
  const pageInfo = await page.evaluate(() => {
    const bodyText = document.body?.innerText?.substring(0, 500) || '';
    
    // 找所有输入框
    const inputs = [];
    for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', '.ProseMirror', 'input[type="text"]:not([type="hidden"])', '[class*="chat"] textarea', '[class*="chat"] input']) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.offsetParent !== null) {
            const rect = el.getBoundingClientRect();
            inputs.push({
              selector: sel,
              tag: el.tagName,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
              placeholder: el.placeholder || el.getAttribute('aria-label') || '',
              text: (el.textContent || '').substring(0, 30),
            });
          }
        }
      } catch(e) {}
    }

    // 找所有按钮
    const buttons = [];
    for (const btn of document.querySelectorAll('button, [role="button"], a[href]')) {
      if (btn.offsetParent !== null) {
        const t = (btn.textContent || '').trim();
        if (t.length > 0 && t.length < 50) {
          buttons.push(t);
        }
      }
    }

    return {
      bodyText: bodyText.substring(0, 200),
      inputs,
      buttons: buttons.slice(0, 20),
      url: location.href,
    };
  });

  log(`  URL: ${pageInfo.url}`);
  log(`  页面内容: "${pageInfo.bodyText.substring(0, 80)}"`);
  log(`  可见输入框: ${pageInfo.inputs.length}`);
  pageInfo.inputs.forEach(inp => {
    log(`    [${inp.selector}] ${inp.tag} ${inp.rect.w}x${inp.rect.h} @(${inp.rect.x},${inp.rect.y}) ph="${inp.placeholder}"`);
  });
  log(`  可见按钮(${pageInfo.buttons.length}): ${pageInfo.buttons.join(', ')}`);

  // 如果没找到输入框但有特定按钮，可能需要先点击
  if (pageInfo.inputs.length === 0) {
    // 尝试点击可能的入口
    const entryClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        const t = (el.textContent || '').toLowerCase();
        if (/chat|message|ask|new|ai|zo|send|开始|消息/.test(t) && el.offsetParent && t.length < 20) {
          el.click(); return t;
        }
      }
      return null;
    });
    if (entryClicked) {
      log(`  点击了: "${entryClicked}"`);
      await sleep(rand(3000, 6000));
      // 重新获取输入框
      const retry = await page.evaluate(() => {
        const inputs = [];
        for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', '.ProseMirror', 'input[type="text"]:not([type="hidden"])']) {
          try { const els = document.querySelectorAll(sel); for (const el of els) { if (el.offsetParent) { inputs.push({ selector: sel, placeholder: el.placeholder || '' }); } } } catch(e) {}
        }
        return inputs;
      });
      pageInfo.inputs = retry;
      log(`  重试后输入框: ${retry.length}`);
    }
  }

  // 发送消息
  if (pageInfo.inputs.length > 0) {
    const inp = pageInfo.inputs[0];
    const task = pick(KEEPALIVE_TASKS);
    log(`  ★ 发送保活任务: "${task}"`);

    // 聚焦输入框
    await page.evaluate(s => {
      const el = document.querySelector(s);
      if (el) { el.focus(); el.click(); }
    }, inp.selector);

    await sleep(rand(300, 800));

    // 拟人输入
    for (const ch of task) {
      await page.keyboard.type(ch);
      await sleep(rand(30, 120));
    }
    await sleep(rand(500, 1500));

    // 发送 (Enter)
    await page.keyboard.press('Enter');
    log('  ✅ 任务已发送');

    // 等待AI处理（模拟它正在工作 = 保活）
    await sleep(rand(15000, 30000));

    return true;
  } else {
    log('  ⚠ 未找到输入框，尝试替代方案...');

    // 替代方案：在页面随机操作模拟活跃
    for (let i = 0; i < rand(5, 8); i++) {
      await page.mouse.move(randF(200, 1000), randF(100, 700), { steps: rand(4, 8) });
      await sleep(rand(300, 800));
    }
    await page.mouse.wheel(0, rand(100, 300));
    await sleep(rand(1000, 3000));

    // 随机点击
    const btns = await page.evaluate(() => {
      return [...document.querySelectorAll('button, [role="button"], a')]
        .filter(b => b.offsetParent && (b.textContent || '').trim().length > 1)
        .map(b => (b.textContent || '').trim().substring(0, 40));
    });
    if (btns.length > 0) {
      const target = pick(btns.slice(0, 10));
      log(`  替代点击: "${target}"`);
      await page.evaluate(t => {
        for (const b of document.querySelectorAll('button, [role="button"], a')) {
          if (b.offsetParent && (b.textContent || '').trim().substring(0, 40) === t) { b.click(); return; }
        }
      }, target);
      await sleep(rand(5000, 10000));
    }

    return false;
  }
}

// ========== 主循环 ==========
async function main() {
  log('='.repeat(60));
  log('ZO 云电脑内部自保活系统');
  log('通过AI对话+终端命令保持ZO VM活跃');
  log('='.repeat(60));

  const accounts = loadAccounts();
  if (accounts.length === 0) { log('❌ 无账号'); process.exit(1); }

  const acc = accounts[0];
  log(`账号: ${acc.email} → ${acc.zoUrl}`);

  // 启动真实Chrome
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-overseas-keepalive'),
    {
      headless: false,
      executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
    }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 登录
  if (!await ensureLoggedIn(page, cdp, acc)) {
    log('❌ 登录失败');
    await context.close();
    return;
  }

  log('\n🛡️ 开始保活守护...');
  log(`  间隔: 10-20分钟(随机)`);
  log(`  策略: 发送AI终端命令任务`);

  let count = 0;

  // 立即执行一次
  log('\n首次保活...');
  await sendKeepaliveMessage(page);

  // 定时循环
  setInterval(async () => {
    count++;
    log(`\n${'='.repeat(40)}`);
    log(`保活周期 #${count}`);
    log(`${'='.repeat(40)}`);

    try {
      // 检查是否还在ZO
      const url = page.url();
      if (!url.includes('.zo.computer')) {
        log('⚠ 不在ZO页面，重新登录...');
        if (!await ensureLoggedIn(page, cdp, acc)) {
          log('❌ 重新登录失败，30分钟后重试');
          return;
        }
      }
      await sendKeepaliveMessage(page);
    } catch (e) {
      log(`⚠ 异常: ${e.message}`);
    }
  }, rand(10 * 60000, 20 * 60000)); // 10-20分钟

  log('\n守护模式运行中...');
  process.stdin.resume();
}

process.on('SIGINT', () => { log('退出'); process.exit(0); });
main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
