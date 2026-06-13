/**
 * ZO 全能保活 v3 — 本地面板 + 外部Webhook心跳
 *
 * 外部查看存活:
 *   配置 WEBHOOK_URL 环境变量 → 每周期POST状态到外部
 *   或用 ZO终端: cat /tmp/keepalive.log
 *   或用 ZO终端: curl localhost:3000
 */

const http = require('http');
const https = require('https');
const { chromium } = require('playwright');
const fs = require('fs');

const LOG_FILE = '/tmp/keepalive.log';
const STATE_FILE = '/tmp/keepalive_state.json';
const PANEL_PORT = 80;
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const BASE_INTERVAL = 5 * 60 * 1000;
const JITTER = 7 * 60 * 1000;

// ========== 状态 ==========
let state = {
  started: new Date().toISOString(),
  lastAlive: new Date().toISOString(),
  cycleCount: 0, aiMessages: 0, mouseMoves: 0,
  scrolls: 0, newSessions: 0, clicks: 0,
  status: 'running', currentAction: 'init',
};
let intervalHandle;

function ssave() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch(e) {}
}
function llog(msg) {
  const line = `${new Date().toISOString()} [${state.cycleCount}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a,b) => Math.floor(a+Math.random()*(b-a+1));
const rf = (a,b) => a+Math.random()*(b-a);
const pick = a => a[Math.floor(Math.random()*a.length)];

const Q = [
  'Explain Python vs JavaScript in 3 points',
  'Write a short poem about cloud computing',
  'What is the best way to learn coding?',
  'Tell me an interesting science fact',
  'How does machine learning work?',
  'Explain Docker in simple terms',
  'Write a bash script for disk usage',
  'Recommend 3 programming books',
  'SQL vs NoSQL differences',
  'Explain REST API concepts',
  'How does Git branching work?',
  'What are microservices?',
  'Write a palindrome checker function',
  'Explain async/await in JavaScript',
  'Create a simple HTML page',
];

// ========== Webhook心跳 ==========
function sendWebhook() {
  if (!WEBHOOK_URL) return;
  try {
    const data = JSON.stringify({ ...state, type: 'keepalive_heartbeat' });
    const url = new URL(WEBHOOK_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      timeout: 10000,
    }, res => { llog(`Webhook: ${res.statusCode}`); });
    req.on('error', e => llog(`Webhook err: ${e.message}`));
    req.write(data);
    req.end();
  } catch(e) {}
}

// ========== HTTP面板(内部) ==========
const HTML = `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="30"><title>ZO Alive</title><style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a1a;color:#e0e0e0;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#12122a;border:1px solid#2a2a4a;border-radius:16px;padding:32px;max-width:480px;width:90%}
h1{font-size:1.3em;margin-bottom:20px;color:#7cffb3}.dot{width:10px;height:10px;border-radius:50%;background:#7cffb3;animation:pulse 2s infinite;display:inline-block}
@keyframes pulse{50%{opacity:.3}}
.stat{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid#1a1a3a;font-size:.95em}
.stat .l{color:#888}.alive .v{color:#7cffb3}.danger .v{color:#ff6b6b}
.v{font-family:monospace}.ft{margin-top:20px;text-align:center;font-size:.75em;color:#555}
.ext{color:#ffa500;margin-top:8px}
</style></head><body><div class="card">
<h1><span class="dot"></span>ZO KeepAlive Monitor</h1>
<div id="s">Loading...</div>
<div class="ft">30s auto-refresh | ZO internal (localhost:3000)</div>
</div><script>
fetch('/api/state').then(r=>r.json()).then(s=>{
const a=new Date(s.lastAlive),st=new Date(s.started),n=new Date();
const sec=Math.floor((n-a)/1000),min=Math.floor(sec/60);
const use=Math.floor((n-st)/1000),uh=Math.floor(use/3600),um=Math.floor((use%3600)/60);
const ac=sec<600?'alive':(sec<900?'':'danger');
const at=sec<60?'刚刚':min<60?min+'分钟前':Math.floor(min/60)+'h'+min%60+'m前';
document.getElementById('s').innerHTML=
'<div class="stat '+ac+'"><span class="l">最后活跃</span><span class="v">'+at+'</span></div>'+
'<div class="stat"><span class="l">运行时长</span><span class="v">'+uh+'h '+um+'m</span></div>'+
'<div class="stat"><span class="l">保活次数</span><span class="v">'+s.cycleCount+'</span></div>'+
'<div class="stat"><span class="l">AI消息</span><span class="v">'+s.aiMessages+'</span></div>'+
'<div class="stat"><span class="l">鼠标操作</span><span class="v">'+s.mouseMoves+'</span></div>'+
'<div class="stat"><span class="l">新会话</span><span class="v">'+s.newSessions+'</span></div>'+
'<div class="stat"><span class="l">滚动</span><span class="v">'+s.scrolls+'</span></div>'+
'<div class="stat"><span class="l">点击</span><span class="v">'+s.clicks+'</span></div>'+
'<div class="stat"><span class="l">当前</span><span class="v">'+s.currentAction+'</span></div>'+
'<div class="stat"><span class="l">下次</span><span class="v">'+(s.nextCycle||'?')+'</span></div>'
})</script></body></html>`;

http.createServer((req, res) => {
  if (req.url === '/api/state' || req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(state));
  } else if (req.url === '/api/log' || req.url === '/log') {
    try { res.end(fs.readFileSync(LOG_FILE, 'utf-8').split('\n').slice(-50).join('\n')); } catch(e) { res.end(''); }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    res.end(HTML);
  }
}).listen(PANEL_PORT, () => console.log(`[Panel] :${PANEL_PORT}`));

// ========== 拟人操作 ==========
async function doMouse(page) {
  let x = rf(100, 1100), y = rf(100, 650);
  for (let i = 0; i < rand(5, 12); i++) {
    const tx = rf(100, 1100), ty = rf(100, 650), st = rand(3, 8);
    for (let s = 1; s <= st; s++) {
      const p = s / st;
      await page.mouse.move(x + (tx-x)*p + Math.sin(p*Math.PI*1.5)*rf(-15,15), y + (ty-y)*p + Math.cos(p*Math.PI)*rf(-10,10));
      await sleep(rand(15, 35));
    }
    x = tx; y = ty;
    if (Math.random() < 0.3) await sleep(rand(150, 500));
  }
  state.mouseMoves += rand(5, 12);
}

async function doScroll(page) {
  for (let i = 0; i < rand(2, 5); i++) {
    await page.mouse.wheel(0, rf(80, 400) * (Math.random() > 0.3 ? 1 : -1));
    await sleep(rand(200, 800));
  }
  state.scrolls += rand(2, 5);
}

async function doClick(page) {
  const ok = await page.evaluate(() => {
    const e = [...document.querySelectorAll('button,a,[role="button"]')].filter(x => x.offsetParent && (x.textContent||'').trim().length > 0 && (x.textContent||'').trim().length < 50);
    if (!e.length) return false;
    try { e[Math.floor(Math.random()*e.length)].click(); return true; } catch(ex) { return false; }
  });
  if (ok) { state.clicks++; await sleep(rand(800, 2000)); }
}

async function doAI(page) {
  const got = await page.evaluate(() => {
    const el = document.querySelector('textarea,[contenteditable="true"],[role="textbox"]');
    if (el && el.offsetParent) { el.focus(); el.click(); return true; }
    return false;
  });
  if (!got) return;
  const q = pick(Q);
  for (const c of q) { await page.keyboard.type(c); await sleep(rand(20, 80)); }
  await sleep(rand(400, 1200));
  await page.keyboard.press('Enter');
  state.aiMessages++;
  llog(`AI: "${q.substring(0, 50)}"`);
  await sleep(rand(20000, 40000));
}

async function doNewSession(page) {
  const ok = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button,[role="button"],a')) {
      const t = (el.textContent||'').toLowerCase();
      if (t.includes('new') && t.length < 20 && el.offsetParent) { el.click(); return true; }
    }
    return false;
  });
  if (ok) { state.newSessions++; await sleep(rand(3000, 6000)); }
}

async function doNav(page) {
  const urls = ['/', '/pricing', '/blog', '/tutorials'];
  const u = pick(urls);
  try {
    await page.goto('https://www.zo.computer' + u, { waitUntil: 'domcontentloaded', timeout: 20000 });
    llog(`Nav: ${u}`);
    await sleep(rand(2000, 5000));
  } catch(e) {}
}

// ========== 主周期 ==========
async function cycle() {
  const start = Date.now();
  state.cycleCount++;
  state.status = 'running';
  let browser;

  try {
    state.currentAction = 'launch';
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/137 Safari/537.36',
      locale: 'zh-CN',
    })).newPage();

    state.currentAction = 'goto';
    await page.goto('https://www.zo.computer', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(rand(3000, 8000));

    // 随机组合操作
    const ops = [];
    if (Math.random() < 0.6) ops.push(['AI', () => doAI(page)]);
    if (Math.random() < 0.25) ops.push(['Session', () => doNewSession(page)]);
    if (Math.random() < 0.8) ops.push(['Mouse', () => doMouse(page)]);
    if (Math.random() < 0.7) ops.push(['Scroll', () => doScroll(page)]);
    if (Math.random() < 0.45) ops.push(['Click', () => doClick(page)]);
    if (Math.random() < 0.15) ops.push(['Nav', () => doNav(page)]);
    ops.sort(() => Math.random() - 0.5);

    for (const [name, fn] of ops) {
      state.currentAction = name;
      try { llog(`[${name}]`); await fn(); } catch(e) { llog(`[${name}] err: ${e.message}`); }
      await sleep(rand(500, 1500));
    }

    state.lastAlive = new Date().toISOString();
    state.status = 'idle';
    state.currentAction = 'sleep';
    ssave();
    sendWebhook();
    llog(`OK (${Math.round((Date.now()-start)/1000)}s)`);

  } catch(e) {
    llog(`FATAL: ${e.message}`);
    state.status = 'error';
  } finally {
    if (browser) try { await browser.close(); } catch(e) {}
  }

  const next = BASE_INTERVAL + Math.random() * JITTER;
  state.nextCycle = new Date(Date.now() + next).toISOString();
  ssave();
  intervalHandle = setTimeout(cycle, next);
}

console.log('[KeepAlive] v3 Puppet + Panel :3000');
if (WEBHOOK_URL) console.log('[KeepAlive] Webhook:', WEBHOOK_URL);
ssave();
cycle();

process.on('SIGINT', () => { if(intervalHandle)clearTimeout(intervalHandle); ssave(); process.exit(0); });
process.on('SIGTERM', () => { if(intervalHandle)clearTimeout(intervalHandle); ssave(); process.exit(0); });
