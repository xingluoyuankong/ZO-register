/**
 * ZO KeepAlive 保活系统 v2.0
 * 
 * 问题根因：ZO免费版闲置10-30分钟自动休眠(Server-side idle detection)
 * 解决方案：模拟真实用户活跃操作，定期发送消息+点击+浏览
 * 
 * 三层保活：
 * 1. 活跃保活(5-10min) — 发送AI消息、点击页面、浏览内容（防休眠）
 * 2. Ping保活(30min) — 定期访问ZO子域名（防session过期）
 * 3. 登录保活(12h) — 自动重新登录（防token过期）
 * 
 * 运行: node keepalive_v2.mjs
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'keepalive');
const STATE_FILE = join(__dirname, 'logs', 'keepalive', 'state.json');
const EMAIL_DIR = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用';
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'keepalive.log'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const randF = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// 活跃操作的问题库 (模拟真人与Zo AI对话)
const ACTIVE_QUESTIONS = [
  'Hello, what can you do?',
  '帮我解释一下什么是机器学习',
  'Python和JavaScript有什么区别？',
  '给我讲一个有趣的小故事',
  '如何提高编程效率？',
  '推荐几本好书吧',
  '什么是大语言模型？',
  '帮我写一首简短的诗',
  '人工智能的未来发展趋势是什么？',
  '如何保持学习的动力？',
  '介绍一下量子计算的基本概念',
  '有什么好的时间管理方法？',
  '解释一下区块链技术',
  '推荐一些提升思维的方法',
  '什么是API？简单解释一下',
  '如何开始学习一门新语言？',
  '云计算和本地部署有什么区别？',
  '给我一个有趣的科学冷知识',
  '什么是深度学习？',
  '如何培养创造性思维？',
  '介绍一下太空探索的最新进展',
  '怎样写出好的代码注释？',
  '什么是自然语言处理？',
  '推荐一些提高效率的工具',
  '数据结构和算法为什么重要？',
  '介绍一下人工智能的应用场景',
  '如何做好项目管理？',
  '什么是开源软件？',
  '解释一下网络安全的基本概念',
  '怎样快速定位和修复代码bug？',
];

// ========== 账号加载 ==========
function loadAccounts() {
  // 优先用 accounts.json
  if (existsSync(ACCOUNTS_FILE)) {
    try {
      const accs = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
      if (accs.length > 0) return accs;
    } catch(e) {}
  }

  // 从邮箱目录读取
  try {
    const files = readdirSync(EMAIL_DIR).filter(f => f.endsWith('.txt') && !f.includes('combo'));
    return files.map(f => {
      const c = readFileSync(join(EMAIL_DIR, f), 'utf-8').trim();
      const [email, password, clientId, refreshToken] = c.split('----').map(s => s.trim());
      return { email, password, clientId, refreshToken };
    });
  } catch(e) {
    log('无法加载账号');
    return [];
  }
}

function saveAccounts(accounts) {
  try { writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8'); } catch(e) {}
}

function loadState() {
  try { if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch(e) {}
  return {};
}

function saveState(state) {
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8'); } catch(e) {}
}

// ========== Graph API ==========
async function getMsToken(clientId, refreshToken) {
  const b = new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'https://graph.microsoft.com/.default offline_access' });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const d = await r.json();
  if (d.error) throw new Error(d.error_description);
  return { at: d.access_token, rt: d.refresh_token || refreshToken };
}

async function findMagicLink(at, after) {
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

// ========== CDP找widget ==========
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName || '').toLowerCase(); if (t === 'iframe' && n.attributes) { const a = Array.isArray(n.attributes) ? n.attributes : []; const i = a.findIndex(x => x === 'src'); const s = i >= 0 ? (a[i + 1] || '') : ''; if (s.includes('challenges.cloudflare') || s.includes('turnstile')) { r = { nodeId: n.nodeId, src: s }; return; } } if (n.shadowRoots) for (const sr of n.shadowRoots) dfs(sr, d + 1); if (n.children) for (const c of n.children) dfs(c, d + 1); if (n.contentDocument) dfs(n.contentDocument, d + 1); })(root, 0);
  if (!r) return null;
  try { const bm = await cdp.send('DOM.getBoxModel', { nodeId: r.nodeId }); if (bm?.model?.content) { const c = bm.model.content; r.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] }; } } catch (e) {}
  return r;
}

// ========== Turnstile点击 ==========
async function clickTurnstile(page, box) {
  if (!box?.box || box.box.w <= 0) return;
  const { x, y, w, h } = box.box;
  const cx = x + 28, cy = y + h / 2;
  log(`  TS点击 (${Math.round(cx)},${Math.round(cy)})`);
  for (let i = 0; i < 3; i++) { await page.mouse.move(randF(150, 900), randF(100, 700), { steps: rand(4, 8) }); await sleep(rand(200, 500)); }
  await page.mouse.move(cx, cy, { steps: rand(6, 10) });
  await sleep(rand(60, 200));
  await page.mouse.down(); await sleep(rand(30, 70)); await page.mouse.up();
}

// ========== 完整登录流程 ==========
async function doLogin(page, cdp, account) {
  const { email, clientId, refreshToken } = account;
  log(`  [登录] ${email}`);

  // 1. 发送magic link
  try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) {}
  await sleep(3000);
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent || '') && btn.offsetParent) { btn.click(); return; } } });
  await sleep(2000);
  await page.evaluate(e => { const inp = document.querySelector('input[type=email]') || document.querySelector('input'); if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, e); inp.dispatchEvent(new Event('input', { bubbles: true })); } }, email);
  await sleep(500);
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button')) { if (/continue/i.test(btn.textContent || '')) { btn.click(); return; } } });
  await sleep(3000);

  // 2. 轮询magic link
  const st = new Date(Date.now() - 5000);
  let link = null, rt = refreshToken;
  for (let i = 0; i < 45; i++) {
    try { const { at, rt: nr } = await getMsToken(clientId, rt); rt = nr; link = await findMagicLink(at, st); } catch (e) {}
    if (link) break;
    await sleep(3000);
  }
  if (!link) { log('  ❌ 无magic link'); return false; }

  // 更新refresh token
  if (rt !== refreshToken) {
    account.refreshToken = rt;
    saveAccounts([account]);
  }

  // 3. 打开link+Turnstile
  try { await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
  await sleep(12000);

  for (let a = 0; a < 10; a++) {
    const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') { log('  ✅ 已登录子域名'); return true; }

    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
    if (/complete signup|hi.*zo|let.*set up|getting started|welcome|dashboard/i.test(text)) {
      log('  ✅ 进入注册/Dashboard');
      return true;
    }

    const widget = await findWidget(cdp);
    if (widget?.box && widget.box.w > 0 && a <= 2) {
      await clickTurnstile(page, widget);
      await sleep(3000);
    }

    const token = await page.evaluate(() => { try { const r = turnstile.getResponse(); return (r && r.length > 10) ? r : null; } catch (e) { return null; } });
    if (token) {
      await page.evaluate(tk => {
        const inp = document.querySelector('[name="cf-turnstile-response"]');
        if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, tk); inp.dispatchEvent(new Event('change', { bubbles: true })); }
      }, token);
      await sleep(3000);
    }
    await sleep(2000);
  }

  return false;
}

// ========== ★ 核心：活跃保活 — 模拟真实用户操作 ==========
async function activeKeepalive(page) {
  log(`\n💬 [活跃保活] 模拟用户操作...`);

  // 等待页面充分加载（ZO是React SPA）
  await sleep(rand(3000, 6000));

  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  const url = page.url();

  // 检测ZO AI输入框（多种可能的选择器）
  const inputFound = await page.evaluate(() => {
    const selectors = [
      'textarea', '[contenteditable="true"]', '[role="textbox"]',
      '[data-testid="chat-input"]', '[class*="chat"] textarea',
      '[class*="message"] textarea', '[placeholder*="message" i]',
      '[placeholder*="ask" i]', '[placeholder*="type" i]',
      '.ProseMirror', '[contenteditable]', 'input[type="text"]'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return sel;
      } catch(e) {}
    }
    return null;
  });

  log(`  页面: ${text.substring(0, 80) || '(动态渲染中)'}`);
  log(`  输入框: ${inputFound || '未找到'}`);

  if (inputFound || /dashboard|desktop|explore|chat/i.test(text) || !text) {
    // ★ 发送AI消息（模拟活跃使用）
    const question = pick(ACTIVE_QUESTIONS);
    log(`  发送消息: "${question}"`);

    // 用找到的选择器聚焦输入框
    let typed = false;
    if (inputFound) {
      typed = await page.evaluate(sel => {
        try { const el = document.querySelector(sel); if (el) { el.focus(); el.click(); return true; } } catch(e) {}
        return false;
      }, inputFound);
    }
    if (!typed) {
      typed = await page.evaluate(() => {
        for (const el of document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]')) {
          if (el.offsetParent !== null) { el.focus(); el.click(); return true; }
        }
        return false;
      });
    }

    if (typed) {
      // 拟人输入
      for (const ch of question) {
        await page.keyboard.type(ch);
        await sleep(rand(30, 120));
      }
      await sleep(rand(500, 1500));

      // 按Enter发送
      await page.keyboard.press('Enter');
      log(`  ✅ 消息已发送`);
    } else {
      // 找不到输入框，尝试点击页面元素保持活跃
      log('  ⚠ 找不到输入框，模拟浏览...');
      for (let i = 0; i < rand(3, 6); i++) {
        await page.mouse.move(randF(200, 900), randF(100, 700), { steps: rand(4, 8) });
        await sleep(rand(300, 800));
      }
      await page.mouse.wheel(0, rand(50, 200));
      await sleep(rand(500, 1000));
    }
  } else if (/boot|booting|starting|loading|%/i.test(text)) {
    log('  ZO正在启动/加载中，等待...');
    await sleep(rand(5000, 15000));
  } else {
    // 随机浏览行为
    log('  模拟浏览...');
    for (let i = 0; i < rand(4, 7); i++) {
      await page.mouse.move(randF(200, 900), randF(100, 700), { steps: rand(4, 8) });
      await sleep(rand(300, 800));
    }
    await page.mouse.wheel(0, rand(80, 250));
    await sleep(rand(500, 1500));

    // 随机点击按钮
    const btns = await page.evaluate(() => {
      return [...document.querySelectorAll('button, a, [role="button"]')]
        .filter(b => b.offsetParent && (b.textContent || '').trim().length > 1 && !/logout|sign out/i.test(b.textContent))
        .map(b => b.textContent.trim().substring(0, 40));
    });
    if (btns.length > 0) {
      const target = pick(btns.slice(0, 10));
      log(`  点击: "${target}"`);
      await page.evaluate(t => {
        for (const b of document.querySelectorAll('button, a, [role="button"]')) {
          if (b.offsetParent && (b.textContent || '').trim().substring(0, 40) === t) { b.click(); return; }
        }
      }, target);
    }
  }

  await sleep(rand(2000, 5000));
  log('  活跃操作完成');
}

// ========== Ping保活 ==========
async function pingKeepalive(page, account) {
  const { zoUrl, handle } = account;
  const url = zoUrl || (handle ? `https://${handle}.zo.computer` : null);
  if (!url) return;

  log(`\n🔗 [Ping] ${url}`);
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes(url.replace('https://', ''))) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(rand(3000, 6000));
    }
    log(`  ✅ Ping完成`);
  } catch (e) {
    log(`  ❌ Ping失败: ${e.message}`);
  }
}

// ========== 主循环 ==========
async function main() {
  log('='.repeat(60));
  log('ZO KeepAlive 保活系统 v2.0');
  log('='.repeat(60));

  const accounts = loadAccounts();
  if (accounts.length === 0) { log('❌ 无账号'); process.exit(1); }
  log(`加载 ${accounts.length} 个账号`);

  // 加载状态
  const state = loadState();

  // 启动Chrome + 扩展
  log('\n启动Chrome + Turnstile扩展...');
  const { chromium } = await import('playwright');

  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-keepalive-profile'),
    {
      headless: false,
      executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
      ],
    }
  );

  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 对每个账号进行初始登录
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    log(`\n${'='.repeat(40)}`);
    log(`账号 [${i + 1}/${accounts.length}]: ${acc.email}`);

    if (!acc.handle && !acc.zoUrl) {
      log('  新账号，需要先注册...');
      // 这里可以调用full_register.mjs的逻辑
      continue;
    }

    // 检查是否需要登录
    const lastLogin = state[acc.email]?.lastLogin || 0;
    const hoursSince = (Date.now() - lastLogin) / 3600000;

    if (hoursSince > 8 || !lastLogin) {
      log('  需要重新登录...');
      const ok = await doLogin(page, cdp, acc);
      if (ok) {
        state[acc.email] = { ...(state[acc.email] || {}), lastLogin: Date.now(), lastActive: Date.now() };
        saveState(state);
      }
    } else {
      log(`  上次登录: ${Math.round(hoursSince)}h前，跳过`);
      // 仍然ping一下确保在线
      await pingKeepalive(page, acc);
    }

    await sleep(rand(3000, 8000));
  }

  // ===== 开始保活守护循环 =====
  log('\n' + '='.repeat(60));
  log('✅ 保活守护启动');
  log(`  活跃保活间隔: 5-10分钟 (随机)`);
  log(`  Ping保活间隔: 15-30分钟 (随机)`);
  log(`  登录保活间隔: 8-12小时`);
  log('='.repeat(60));

  let activeCount = 0, pingCount = 0;
  const activeCycle = rand(5 * 60000, 10 * 60000); // 5-10min
  const pingCycle = rand(15 * 60000, 30 * 60000);  // 15-30min
  const loginCycle = rand(8 * 3600000, 12 * 3600000); // 8-12h

  // 活跃保活定时器
  setInterval(async () => {
    activeCount++;
    log(`\n💬 活跃保活 #${activeCount} ---`);
    for (const acc of accounts) {
      try {
        // 先确保在正确页面
        const url = page.url();
        if (!url.includes('.zo.computer')) {
          await pingKeepalive(page, acc);
        }
        await activeKeepalive(page);
        state[acc.email] = { ...(state[acc.email] || {}), lastActive: Date.now() };
        saveState(state);
      } catch (e) {
        log(`  ⚠ ${acc.email} 活跃保活异常: ${e.message}`);
      }
      await sleep(rand(2000, 5000));
    }
  }, activeCycle);

  // Ping保活定时器
  setInterval(async () => {
    pingCount++;
    log(`\n🔗 Ping保活 #${pingCount} ---`);
    for (const acc of accounts) {
      await pingKeepalive(page, acc);
      await sleep(rand(2000, 4000));
    }
  }, pingCycle);

  // 登录保活定时器
  setInterval(async () => {
    log('\n🔑 登录保活 ---');
    for (const acc of accounts) {
      log(`  重新登录: ${acc.email}`);
      try {
        await doLogin(page, cdp, acc);
        state[acc.email] = { ...(state[acc.email] || {}), lastLogin: Date.now() };
        saveState(state);
      } catch (e) {
        log(`  ❌ ${acc.email}: ${e.message}`);
      }
      await sleep(rand(5000, 10000));
    }
  }, loginCycle);

  // 立即执行一轮活跃保活
  log('\n首次活跃保活...');
  for (const acc of accounts) {
    await pingKeepalive(page, acc);
    await activeKeepalive(page);
  }

  // 守护运行
  log('\n🛡️ 守护模式运行中...');
  process.stdin.resume();
}

process.on('SIGINT', () => { log('退出守护'); process.exit(0); });

main().catch(e => { log(`致命错误: ${e.message}\n${e.stack}`); process.exit(1); });
