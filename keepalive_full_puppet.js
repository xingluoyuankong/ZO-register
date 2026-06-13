/**
 * ZO 全能保活脚本 — 运行在ZO VM内部
 * 
 * 功能:
 *   1. HTTP面板(端口3000) — 外部查看存活时间/状态
 *   2. 丰富拟人操作 — AI提问/新会话/鼠标轨迹/滚动/点击/输入
 *   3. 心跳日志 — /tmp/keepalive.log
 * 
 * 用法(xvfb下运行):
 *   xvfb-run -a node keepalive_full_puppet.js
 * 
 * 外部查看存活:
 *   访问 ZO域名:3000 (需要ZO端口转发)
 *   或者: curl http://localhost:3000/
 */

const http = require('http');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOG_FILE = '/tmp/keepalive.log';
const STATE_FILE = '/tmp/keepalive_state.json';
const PANEL_PORT = 3000;
const BASE_INTERVAL = 5 * 60 * 1000; // 基准5分钟
const JITTER = 7 * 60 * 1000;       // 随机波动+7分钟

// ========== 状态管理 ==========
let state = {
  started: new Date().toISOString(),
  lastAlive: new Date().toISOString(),
  cycleCount: 0,
  aiMessages: 0,
  mouseMoves: 0,
  scrolls: 0,
  newSessions: 0,
  clicks: 0,
  status: 'starting',
  currentAction: 'init',
};
let intervalHandle = null;

function saveState() {
  try {
    state.lastSave = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch(e) {}
}

function logAlive(msg) {
  const line = `${new Date().toISOString()} [${state.cycleCount}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

// ========== 辅助 ==========
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a,b) => Math.floor(a + Math.random() * (b - a + 1));
const rf = (a,b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// AI提问库（多样话题）
const QUESTIONS = [
  'Explain the differences between Python and JavaScript in 3 bullet points',
  'Write a short poem about cloud computing',
  'What is the best way to learn a new programming language?',
  'Tell me an interesting fact about space exploration',
  'How does machine learning differ from traditional programming?',
  'Explain Docker in simple terms for a beginner',
  'What are the key features of TypeScript?',
  'Write a simple bash script that lists files and shows disk usage',
  'Recommend 3 books for software developers',
  'What is the difference between SQL and NoSQL databases?',
  'Explain REST API concepts simply',
  'How do load balancers work?',
  'Create a simple HTML page with a button that shows current time',
  'What is the best VS Code extension for productivity?',
  'Explain the concept of async/await in JavaScript',
  'Write a regex pattern to validate email addresses',
  'How does Git branching work?',
  'What is the difference between HTTP and HTTPS?',
  'Write a function to check if a string is a palindrome',
  'What are microservices and when should you use them?',
];

// 新会话开启消息
const NEW_SESSION_MSGS = [
  'Start new conversation',
  'Clear chat history',
  'New chat',
  '新建会话',
  '创建新对话',
];

// ========== HTTP面板服务器 ==========
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>ZO KeepAlive Monitor</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#e0e0e0;font-family:system-ui;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#12122a;border:1px solid #2a2a4a;border-radius:16px;padding:32px;max-width:480px;width:90%}
h1{font-size:1.4em;margin-bottom:24px;color:#7cffb3;display:flex;align-items:center;gap:8px}
.status-dot{width:12px;height:12px;border-radius:50%;background:#7cffb3;animation:pulse 2s infinite;display:inline-block}
@keyframes pulse{50%{opacity:.4}}
.stat{margin:12px 0;display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1a1a3a}
.stat .label{color:#888}
.stat .value{font-family:monospace;font-size:1em}
.alive .value{color:#7cffb3}
.danger .value{color:#ff6b6b}
.footer{margin-top:24px;text-align:center;font-size:.8em;color:#555}
</style>
</head>
<body>
<div class="card">
  <h1><span class="status-dot"></span>ZO KeepAlive</h1>
  <div id="stats">Loading...</div>
  <div class="footer">Auto-refresh 30s | ZO Internal</div>
</div>
<script>
function update() {
  fetch('/api/state').then(r=>r.json()).then(s=>{
    const alive = new Date(s.lastAlive);
    const started = new Date(s.started);
    const now = new Date();
    const aliveSec = Math.floor((now-alive)/1000);
    const aliveMin = Math.floor(aliveSec/60);
    const uptimeSec = Math.floor((now-started)/1000);
    const uptimeH = Math.floor(uptimeSec/3600);
    const uptimeM = Math.floor((uptimeSec%3600)/60);

    let aliveClass = aliveSec < 600 ? 'alive' : (aliveSec < 900 ? '' : 'danger');
    let aliveText = aliveSec < 60 ? '刚刚' :
      aliveMin < 60 ? aliveMin+'分钟前' :
      Math.floor(aliveMin/60)+'小时'+aliveMin%60+'分前';

    document.getElementById('stats').innerHTML =
      '<div class="stat '+aliveClass+'"><span class="label">🟢 最后活跃</span><span class="value">'+aliveText+'</span></div>'+
      '<div class="stat"><span class="label">⏱ 运行时长</span><span class="value">'+uptimeH+'h '+uptimeM+'m</span></div>'+
      '<div class="stat"><span class="label">🔄 保活周期</span><span class="value">'+s.cycleCount+' 次</span></div>'+
      '<div class="stat"><span class="label">💬 AI消息</span><span class="value">'+s.aiMessages+' 条</span></div>'+
      '<div class="stat"><span class="label">🖱 鼠标操作</span><span class="value">'+s.mouseMoves+' 次</span></div>'+
      '<div class="stat"><span class="label">🆕 新会话</span><span class="value">'+s.newSessions+' 次</span></div>'+
      '<div class="stat"><span class="label">📜 滚动</span><span class="value">'+s.scrolls+' 次</span></div>'+
      '<div class="stat"><span class="label">👆 点击</span><span class="value">'+s.clicks+' 次</span></div>'+
      '<div class="stat"><span class="label">📌 当前操作</span><span class="value">'+s.currentAction+'</span></div>';
  });
}
update();setInterval(update,30000);
</script>
</body>
</html>`;

http.createServer((req, res) => {
  if (req.url === '/api/state' || req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(state));
  } else if (req.url === '/api/log' || req.url === '/log') {
    try {
      const log = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').slice(-50).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(log);
    } catch(e) { res.end('No log yet'); }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    res.end(DASHBOARD_HTML);
  }
}).listen(PANEL_PORT, () => {
  console.log(`[Panel] Dashboard at http://localhost:${PANEL_PORT}`);
});

// ========== ★ 拟人操作集合 ==========

// 1. 丰富鼠标轨迹（曲线、停顿、来回）
async function doMouseMove(page) {
  const actions = [];
  const n = rand(4, 10);
  let x = rf(100, 1100), y = rf(100, 650);
  for (let i = 0; i < n; i++) {
    const tx = rf(100, 1100), ty = rf(100, 650);
    const steps = rand(3, 8);
    for (let s = 1; s <= steps; s++) {
      const p = s / steps;
      const mx = x + (tx - x) * p + Math.sin(p * Math.PI * 1.5) * rf(-20, 20);
      const my = y + (ty - y) * p + Math.cos(p * Math.PI) * rf(-15, 15);
      await page.mouse.move(mx, my);
      await sleep(rand(15, 40));
    }
    x = tx; y = ty;
    if (Math.random() < 0.3) await sleep(rand(150, 500));
  }
  state.mouseMoves += n;
}

// 2. 随机滚动
async function doScroll(page) {
  const steps = rand(2, 5);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, rf(80, 400) * (Math.random() > 0.3 ? 1 : -1));
    await sleep(rand(200, 800));
  }
  state.scrolls += steps;
}

// 3. 随机点击页面元素
async function doClick(page) {
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button,a,[role="button"],[role="tab"],div[role="button"]')]
      .filter(e => e.offsetParent && (e.textContent || '').trim().length > 0 && (e.textContent||'').trim().length < 50);
    if (els.length === 0) return null;
    const el = els[Math.floor(Math.random() * els.length)];
    try { el.click(); return el.textContent.trim(); } catch(e) { return null; }
  });
  if (clicked) { state.clicks++; await sleep(rand(800, 2500)); }
}

// 4. 发送AI问题
async function doAIQuestion(page) {
  // 找输入框
  const found = await page.evaluate(() => {
    for (const sel of ['textarea','[contenteditable="true"]','[role="textbox"]','input[type="text"]:not([type="hidden"])']) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent) { el.focus(); el.click(); return sel; }
    }
    return null;
  });
  if (!found) return false;

  const q = pick(QUESTIONS);
  for (const ch of q) { await page.keyboard.type(ch); await sleep(rand(20, 80)); }
  await sleep(rand(400, 1200));
  await page.keyboard.press('Enter');
  state.aiMessages++;
  logAlive(`AI sent: "${q.substring(0,50)}"`);
  await sleep(rand(20000, 40000)); // 等AI回复
  return true;
}

// 5. 开新会话
async function doNewSession(page) {
  const opened = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button,[role="button"],a')) {
      const t = (el.textContent || '').trim().toLowerCase();
      if ((t.includes('new chat') || t.includes('new conversation') || t.includes('新') && t.includes('话') || t === '+' || t === '新会话') && el.offsetParent) {
        el.click(); return true;
      }
    }
    return false;
  });
  if (opened) { state.newSessions++; await sleep(rand(3000, 6000)); }
  return opened;
}

// 6. 随机输入+删除（模拟打字又删掉）
async function doRandomTyping(page) {
  const found = await page.evaluate(() => {
    const el = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    if (el && el.offsetParent) { el.focus(); return true; }
    return false;
  });
  if (!found) return;
  const chars = rand(3, 15);
  for (let i = 0; i < chars; i++) {
    await page.keyboard.type('abcdefghijklmnopqrstuvwxyz '[rand(0,26)]);
    await sleep(rand(30, 100));
  }
  await sleep(rand(500, 1500));
  for (let i = 0; i < chars; i++) {
    await page.keyboard.press('Backspace');
    await sleep(rand(20, 50));
  }
}

// 7. 浏览不同页面
async function doNavigate(page) {
  const pages = [
    'https://www.zo.computer', '/pricing', '/blog',
    '/tutorials', '/zh-CN',
  ];
  const url = pick(pages);
  try {
    await page.goto(url.startsWith('http') ? url : 'https://www.zo.computer' + url,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    logAlive(`Navigated: ${url}`);
    await sleep(rand(2000, 5000));
  } catch(e) { logAlive(`Nav failed: ${e.message}`); }
}

// ========== 主保活周期 ==========
async function keepaliveCycle() {
  const cycleStart = Date.now();
  state.cycleCount++;
  state.status = 'running';

  let browser;
  try {
    state.currentAction = 'launching browser';
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-setuid-sandbox']
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
      locale: 'zh-CN',
    });
    const page = await ctx.newPage();

    // 访问ZO
    state.currentAction = 'navigating to ZO';
    await page.goto('https://www.zo.computer', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(rand(3000, 7000));

    // ===== 随机排列执行操作 =====
    const operations = [];

    // AI提问: 60%概率
    if (Math.random() < 0.6) operations.push(['AI提问', () => doAIQuestion(page)]);

    // 新会话: 25%概率
    if (Math.random() < 0.25) operations.push(['新会话', () => doNewSession(page)]);

    // 鼠标移动: 80%概率
    if (Math.random() < 0.8) operations.push(['鼠标移动', () => doMouseMove(page)]);

    // 滚动: 70%概率
    if (Math.random() < 0.7) operations.push(['滚动', () => doScroll(page)]);

    // 点击: 50%概率
    if (Math.random() < 0.5) operations.push(['点击', () => doClick(page)]);

    // 随机打字: 30%概率
    if (Math.random() < 0.3) operations.push(['随机输入', () => doRandomTyping(page)]);

    // 页面导航: 20%概率
    if (Math.random() < 0.2) operations.push(['页面导航', () => doNavigate(page)]);

    // Shuffle
    operations.sort(() => Math.random() - 0.5);

    // 执行
    for (const [name, fn] of operations) {
      state.currentAction = name;
      try {
        logAlive(`  [${name}] start`);
        await fn();
        logAlive(`  [${name}] done`);
      } catch(e) {
        logAlive(`  [${name}] err: ${e.message}`);
      }
      await sleep(rand(500, 1500));
    }

    state.lastAlive = new Date().toISOString();
    state.status = 'idle';
    state.currentAction = 'sleeping';
    saveState();
    logAlive(`Cycle done (${Math.round((Date.now()-cycleStart)/1000)}s)`);

  } catch(e) {
    logAlive(`Cycle error: ${e.message}`);
    state.status = 'error';
  } finally {
    if (browser) try { await browser.close(); } catch(e) {}
  }

  // 下次执行时间：基准+随机抖动
  const nextInterval = BASE_INTERVAL + Math.random() * JITTER;
  state.nextCycle = new Date(Date.now() + nextInterval).toISOString();
  saveState();

  intervalHandle = setTimeout(keepaliveCycle, nextInterval);
}

// ========== 启动 ==========
console.log('[KeepAlive] ZO全能保活启动');
console.log(`[KeepAlive] 面板: http://localhost:${PANEL_PORT}`);
console.log(`[KeepAlive] 间隔: ${BASE_INTERVAL/60000}-${(BASE_INTERVAL+JITTER)/60000}分钟(随机)`);

state.status = 'running';
saveState();

// 立即执行第一次
keepaliveCycle();

// 优雅退出
process.on('SIGINT', () => {
  console.log('[KeepAlive] 收到退出信号');
  if (intervalHandle) clearTimeout(intervalHandle);
  state.status = 'stopped';
  saveState();
  process.exit(0);
});
process.on('SIGTERM', () => {
  if (intervalHandle) clearTimeout(intervalHandle);
  state.status = 'stopped';
  saveState();
  process.exit(0);
});
