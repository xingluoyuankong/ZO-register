/**
 * ZO 套娃自保活 — 在ZO云电脑内部部署xvfb+chromium自动化
 * 
 * 架构: 本地Chrome登录ZO → ZO AI终端安装xvfb/puppeteer → ZO VM内运行自保活脚本
 * 
 * 核心: ZO VM内部用xvfb虚拟桌面跑puppeteer，模拟人类操作ZO网站
 * 效果: ZO VM自己访问自己 = 内部活跃 = 永不睡眠
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'matryoshka');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const randF = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ========== ZO内部自保活脚本 (将在ZO VM里运行) ==========
const INNER_KEEPALIVE_SCRIPT = `// ZO内部套娃自保活脚本 — 在ZO VM内通过xvfb+puppeteer循环
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function rand(a,b) { return Math.floor(a + Math.random()*(b-a+1)); }
function randF(a,b) { return a + Math.random()*(b-a); }
function pick(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

const KEEPALIVE_INTERVAL = rand(5*60000, 12*60000);

const ACTIONS = [
  // 1. 随机鼠标移动
  async (page) => {
    for(let i=0;i<rand(3,8);i++){
      await page.mouse.move(randF(100,1200), randF(100,800));
      await sleep(rand(200,600));
    }
  },
  // 2. 滚动
  async (page) => {
    await page.mouse.wheel(0, rand(100,400));
    await sleep(rand(500,1500));
    await page.mouse.wheel(0, rand(-50,-200));
  },
  // 3. 随机点击页面元素
  async (page) => {
    const btns = await page.evaluate(()=>[...document.querySelectorAll('button,a,[role="button"]')].filter(e=>e.offsetParent).map(e=>e.textContent.trim()).filter(t=>t&&t.length<30));
    if(btns.length>0){const t=pick(btns);try{await page.click('text='+t,{timeout:3000})}catch(e){}}
  },
  // 4. 发送AI消息
  async (page) => {
    const msgs=['Hello','today天气如何？帮我写一首诗','列出/tmp目录内容','创建文件/tmp/alive_'+Date.now()+'.txt并写入当前时间','run free -h','run uptime','run ls /tmp'];
    const msg=pick(msgs);
    try {
      const inp=await page.$('textarea,[contenteditable]');
      if(inp){await inp.click();for(const c of msg){await page.keyboard.type(c);await sleep(rand(30,100))};await page.keyboard.press('Enter');}
    }catch(e){}
  }
];

async function cycle(){
  console.log('[Matryoshka] 保活周期开始');
  let browser;
  try {
    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu']});
    const ctx=await browser.newContext({viewport:{width:1280,height:720}});
    const page=await ctx.newPage();
    
    // 访问ZO
    await page.goto('https://www.zo.computer',{waitUntil:'domcontentloaded',timeout:30000});
    await sleep(rand(3000,6000));
    
    // 随机执行2-4个操作
    const actions=[...ACTIONS].sort(()=>Math.random()-0.5).slice(0,rand(2,4));
    for(const action of actions){
      try{await action(page)}catch(e){}
      await sleep(rand(1000,3000));
    }
    
    await sleep(rand(2000,5000));
    await ctx.close();
    console.log('[Matryoshka] 周期完成');
  }catch(e){
    console.log('[Matryoshka] 错误:',e.message);
  }finally{
    if(browser)try{await browser.close()}catch(e){}
  }
}

console.log('[Matryoshka] 启动,间隔:',Math.round(KEEPALIVE_INTERVAL/60000),'min');
cycle();
setInterval(cycle, KEEPALIVE_INTERVAL);
`;

// ========== 账号 ==========
const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
const acc = accounts[0];
log(`账号: ${acc.email} → ${acc.zoUrl}`);

// ========== Graph API ==========
async function getMsToken(cid, rt) {
  const b = new URLSearchParams({ client_id: cid, grant_type: 'refresh_token', refresh_token: rt, scope: 'https://graph.microsoft.com/.default offline_access' });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const d = await r.json(); if (d.error) throw new Error(d.error_description);
  return { at: d.access_token, rt: d.refresh_token || rt };
}
async function findLink(at, after) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', { headers: { Authorization: 'Bearer ' + at } });
  const d = await r.json();
  for (const m of (d.value || [])) { if (new Date(m.receivedDateTime) < after) continue; const c = (m.subject||'')+' '+(m.body?.content||''); if (!/zo/i.test(c)) continue; const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi)||[]; for (let l of links) { l = l.replace(/[)\]>,;!?\s]+$/,'').replace(/&amp;/g,'&'); if (/token=|verify|login/i.test(l)) return l; } }
  return null;
}

// CDP找widget
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName || '').toLowerCase(); if (t === 'iframe' && n.attributes) { const a = Array.isArray(n.attributes) ? n.attributes : []; const i = a.findIndex(x => x === 'src'); const s = i >= 0 ? (a[i + 1] || '') : ''; if (s.includes('challenges.cloudflare') || s.includes('turnstile')) { r = { nodeId: n.nodeId, src: s }; return; } } if (n.shadowRoots) for (const sr of n.shadowRoots) dfs(sr, d + 1); if (n.children) for (const c of n.children) dfs(c, d + 1); if (n.contentDocument) dfs(n.contentDocument, d + 1); })(root, 0);
  if (!r) return null;
  try { const bm = await cdp.send('DOM.getBoxModel', { nodeId: r.nodeId }); if (bm?.model?.content) { const c = bm.model.content; r.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] }; } } catch (e) {}
  return r;
}

// ========== 登录ZO ==========
async function loginToZO(page, cdp) {
  log('登录ZO...');
  try { await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) {}
  await sleep(3000);
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent||'') && btn.offsetParent) { btn.click(); return; } } });
  await sleep(2000);
  await page.evaluate(e => { const inp = document.querySelector('input[type=email]')||document.querySelector('input'); if(inp){ const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(inp,e); inp.dispatchEvent(new Event('input',{bubbles:true})); } }, acc.email);
  await sleep(500);
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button')) { if (/continue/i.test(btn.textContent||'')) { btn.click(); return; } } });
  await sleep(3000);

  const st = new Date(Date.now() - 5000);
  let link = null, rt = acc.refreshToken;
  for (let i = 0; i < 45; i++) { try { const { at, rt: nr } = await getMsToken(acc.clientId, rt); rt = nr; link = await findLink(at, st); } catch (e) {} if (link) break; await sleep(3000); }
  if (!link) { log('❌ 无link'); return false; }
  log('✅ magic link');

  try { await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
  await sleep(12000);
  for (let a = 0; a < 10; a++) {
    const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
    if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { log('✅ 已登录ZO桌面'); return true; }
    const widget = await findWidget(cdp);
    if (widget?.box && widget.box.w > 0 && a < 3) {
      const { x, y, h: bh } = widget.box;
      try { await page.mouse.move(x + 28, y + bh / 2, { steps: 8 }); await sleep(100); await page.mouse.down(); await sleep(50); await page.mouse.up(); } catch (e) {}
      await sleep(3000);
    }
    await sleep(2000);
  }
  return false;
}

// ========== ★ 在ZO AI中部署套娃保活脚本 ==========
async function deployInnerKeepalive(page) {
  log('\n=== 部署ZO内部套娃保活脚本 ===');

  // 等ZO桌面加载
  await sleep(rand(10000, 20000));

  // Step 1: 安装环境
  const setupCmd = `sudo apt update && sudo apt install -y xvfb chromium-browser nodejs npm && npm install playwright && npx playwright install chromium`;

  log('Step 1: 安装xvfb+chromium+puppeteer...');
  await sendZOCommand(page, setupCmd);

  // Step 2: 创建保活脚本
  log('Step 2: 创建内部保活脚本...');
  // 用base64避免引号转义问题
  const b64Script = Buffer.from(INNER_KEEPALIVE_SCRIPT).toString('base64');
  const createScriptCmd = `echo '${b64Script}' | base64 -d > /home/user/keepalive.js && echo '脚本已创建'`;
  await sendZOCommand(page, createScriptCmd);

  // Step 3: 启动保活
  log('Step 3: 启动保活守护进程...');
  const startCmd = `cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "PID=$!" && sleep 3 && cat /tmp/keepalive.log`;
  await sendZOCommand(page, startCmd);

  log('\n✅ 部署完成！ZO内部套娃保活已启动');
  return true;
}

// ========== 通过ZO AI发送命令 ==========
async function sendZOCommand(page, cmd) {
  log(`  发送命令 (${cmd.length} chars)...`);

  // 找AI输入框
  const found = await page.evaluate(() => {
    for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="text"]:not([type="hidden"])']) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent) { el.focus(); el.click(); return sel; }
    }
    return null;
  });

  if (!found) {
    log('  ⚠ 未找到AI输入框');
    return false;
  }

  // 输入命令
  for (const ch of cmd) {
    await page.keyboard.type(ch);
    await sleep(rand(15, 40));
  }
  await sleep(rand(500, 1500));
  await page.keyboard.press('Enter');
  log('  ✅ 已发送，等待执行(60s)...');

  // 等待Zo AI执行命令
  await sleep(rand(50000, 70000));

  return true;
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('ZO 套娃自保活 — 在ZO VM内用xvfb跑浏览器自动化');
  log('='.repeat(60));

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-matryoshka'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 1. 登录ZO
  if (!await loginToZO(page, cdp)) { log('❌ 登录失败'); await context.close(); return; }

  // 2. 等待ZO云电脑完全启动
  log('\n等待ZO云电脑启动(60s)...');
  await sleep(60000);

  // 3. 部署内部套娃保活
  await deployInnerKeepalive(page);

  log('\n' + '='.repeat(60));
  log('✅ ZO套娃保活已部署完成！');
  log('ZO VM内部现在运行着:');
  log('  - xvfb (虚拟桌面)');
  log('  - Chromium (无头浏览器)');
  log('  - keepalive.js (定时循环保活)');
  log('');
  log('进程每5-12分钟自动执行:');
  log('  1. 启动Chromium访问ZO网站');
  log('  2. 随机鼠标移动/滚动/点击');
  log('  3. 发送AI消息');
  log('  = ZO服务器内部活跃 = 永不睡眠');
  log('='.repeat(60));

  // 验证: 检查进程
  log('\n验证保活状态...');
  await sendZOCommand(page, 'ps aux | grep keepalive | grep -v grep');
  await sendZOCommand(page, 'cat /tmp/keepalive.log');

  log('\n保持浏览器打开60秒查看结果...');
  await sleep(60000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
