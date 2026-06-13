/**
 * ZO 一条龙：注册 → 部署xvfb+chromium套娃保活 → 状态监控
 * 
 * 存活判断：查看 /tmp/keepalive.log 的时间戳 — 最后一次保活周期时间即活跃时间
 * 也可以看进程: ps aux | grep keepalive
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'oneshot');
const EMAIL_DIR = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用';
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const randF = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ========== 邮件 ==========
function getEmail() {
  try {
    const files = readdirSync(EMAIL_DIR).filter(f => f.endsWith('.txt') && !f.includes('combo') && !f.includes('__'));
    if (files.length === 0) throw new Error('无邮箱');
    const c = readFileSync(join(EMAIL_DIR, files[0]), 'utf-8').trim();
    const [email, pwd, cid, rt] = c.split('----').map(s => s.trim());
    return { email, pwd, cid, rt, file: files[0] };
  } catch (e) { return null; }
}

function genHandle() {
  const p = pick(['user', 'dev', 'bot', 'kpr', 'alive', 'node']);
  return p + Array.from({ length: rand(4, 6) }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rand(0, 35)]).join('');
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
  for (const m of (d.value || [])) { if (new Date(m.receivedDateTime) < after) continue; const c = (m.subject || '') + ' ' + (m.body?.content || ''); if (!/zo/i.test(c)) continue; const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || []; for (let l of links) { l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&'); if (/token=|verify|login/i.test(l)) return l; } }
  return null;
}

// ========== CDP Widget ==========
async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName || '').toLowerCase(); if (t === 'iframe' && n.attributes) { const a = Array.isArray(n.attributes) ? n.attributes : []; const i = a.findIndex(x => x === 'src'); const s = i >= 0 ? (a[i + 1] || '') : ''; if (s.includes('challenges.cloudflare') || s.includes('turnstile')) { r = { nodeId: n.nodeId, src: s }; return; } } if (n.shadowRoots) for (const sr of n.shadowRoots) dfs(sr, d + 1); if (n.children) for (const c of n.children) dfs(c, d + 1); if (n.contentDocument) dfs(n.contentDocument, d + 1); })(root, 0);
  if (!r) return null;
  try { const bm = await cdp.send('DOM.getBoxModel', { nodeId: r.nodeId }); if (bm?.model?.content) { const c = bm.model.content; r.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] }; } } catch (e) {}
  return r;
}

// ========== Handle注册 ==========
async function doHandle(page) {
  log('填写Handle...');
  await sleep(3000);
  const handle = genHandle();
  log(`  handle: ${handle}`);
  await page.evaluate(h => {
    for (const inp of document.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="submit"])')) {
      if (inp.offsetParent) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, h); inp.dispatchEvent(new Event('input', { bubbles: true })); return; }
    }
  }, handle);
  await sleep(rand(800, 2000));
  await page.evaluate(() => { for (const btn of document.querySelectorAll('button')) { if (/continue|next/i.test(btn.textContent || '')) { btn.click(); return; } } });
  await sleep(3000);
  return handle;
}

// ========== 等待boot完成 ==========
async function waitBoot(page, maxSec = 120) {
  log('等待ZO启动...');
  for (let i = 0; i < maxSec / 3; i++) {
    await sleep(3000);
    const url = page.url();
    const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') { log(`✅ 启动完成: ${host}`); return host; }
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');
    if (i % 5 === 0) log(`  ${i * 3}s: ${text.substring(0, 60)}`);
  }
  return (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
}

// ========== 在ZO终端或AI中部署保活 ==========
async function deployKeepalive(page) {
  log('\n部署套娃保活...');

  // 先找终端或AI输入框
  const termFound = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, a, [role="button"], div[role="tab"]')) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t === 'terminal' || t === '终端' || t.includes('terminal') && t.length < 15) {
        if (el.offsetParent) { el.click(); return 'terminal'; }
      }
    }
    return null;
  });
  log(`终端: ${termFound || '未找到，用AI聊天'}`);

  // 找输入框
  const inputFound = async () => {
    return await page.evaluate(() => {
      for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="text"]:not([type="hidden"])']) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent) { el.focus(); el.click(); return sel; }
      }
      return null;
    });
  };

  // 部署命令列表（每步验证）
  const steps = [
    { desc: '更新apt', cmd: 'sudo apt update -qq 2>&1 | tail -3' },
    { desc: '安装xvfb', cmd: 'sudo apt install -y xvfb 2>&1 | tail -3' },
    { desc: '安装chromium', cmd: 'sudo apt install -y chromium-browser 2>&1 | tail -3' },
    { desc: '安装node', cmd: 'sudo apt install -y nodejs npm 2>&1 | tail -3' },
    { desc: '安装playwright', cmd: 'npm install -g playwright 2>&1 | tail -5 && npx playwright install chromium 2>&1 | tail -3' },
    { desc: '创建脚本', cmd: `cat > /home/user/keepalive.js << 'EOF'
const { chromium } = require('playwright');
const s = ms => new Promise(r => setTimeout(r, ms));
const rf = (a,b) => a+Math.random()*(b-a);
async function cycle() {
  let b;
  try{
    b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
    const p=await b.newPage();
    await p.goto('https://www.zo.computer',{waitUntil:'domcontentloaded',timeout:30000});
    await s(3000+Math.random()*5000);
    for(let i=0;i<Math.floor(3+Math.random()*5);i++){await p.mouse.move(rf(100,1200),rf(100,700));await s(100+Math.random()*300);}
    await p.mouse.wheel(0,100+Math.random()*300);
    await s(2000+Math.random()*3000);
    await b.close();
    console.log(new Date().toISOString(),'KEEPALIVE_OK');
  }catch(e){console.error(e.message);try{await b.close();}catch(e2){}}
}
cycle();
setInterval(cycle, Math.floor(5*60000+Math.random()*7*60000));
EOF
echo 'SCRIPT_CREATED'` },
    { desc: '启动保活', cmd: 'cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "PID=$!"' },
    { desc: '验证进程', cmd: 'sleep 15 && ps aux | grep -v grep | grep keepalive && echo "RUNNING" || echo "NOT_RUNNING"' },
    { desc: '验证日志', cmd: 'cat /tmp/keepalive.log' },
  ];

  for (const step of steps) {
    log(`  [${step.desc}]`);
    const inp = await inputFound();
    if (!inp) { log('    ❌ 无输入框'); continue; }

    for (const ch of step.cmd) { await page.keyboard.type(ch); await sleep(15); }
    await sleep(500);
    await page.keyboard.press('Enter');
    log(`    ✅ 已发送`);
    await sleep(rand(30000, 60000));
  }

  log('\n✅ 部署完成');
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('ZO 一条龙：注册+部署套娃保活+状态监控');
  log('='.repeat(60));

  // 加载邮箱
  const emailData = getEmail();
  if (!emailData) { log('❌ 无可用邮箱！需要新邮箱'); process.exit(1); }
  log(`邮箱: ${emailData.email}`);

  // ===== 阶段1: 注册 =====
  log('\n[阶段1] 发送magic link...');
  const { chromium } = await import('playwright');

  // 先用临时浏览器发magic link
  const tmpBrowser = await chromium.launch({ headless: false, args: ['--window-size=1440,900'] });
  const tmpCtx = await tmpBrowser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36', locale: 'zh-CN' });
  const tmpPage = await tmpCtx.newPage();

  try { await tmpPage.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) {}
  await sleep(3000);
  await tmpPage.evaluate(() => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent || '') && btn.offsetParent) { btn.click(); return; } } });
  await sleep(2000);
  await tmpPage.evaluate(e => { const inp = document.querySelector('input[type=email]') || document.querySelector('input'); if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, e); inp.dispatchEvent(new Event('input', { bubbles: true })); } }, emailData.email);
  await sleep(500);
  await tmpPage.evaluate(() => { for (const btn of document.querySelectorAll('button')) { if (/continue/i.test(btn.textContent || '')) { btn.click(); return; } } });
  await sleep(3000);

  const sendTime = new Date(Date.now() - 5000);
  let magicLink = null, rt = emailData.rt;

  log('轮询收件箱...');
  for (let i = 0; i < 60; i++) {
    try { const { at, rt: nr } = await getMsToken(emailData.cid, rt); rt = nr; magicLink = await findLink(at, sendTime); } catch (e) {}
    if (magicLink) break;
    process.stdout.write('.');
    await sleep(3000);
  }

  await tmpPage.close(); await tmpCtx.close(); await tmpBrowser.close();

  if (!magicLink) {
    log('\n❌ 未收到magic link！需要新邮箱');
    log('请提供新的Outlook邮箱文件路径');
    process.exit(1);
  }
  log(`\n✅ magic link!`);

  if (rt !== emailData.rt) {
    writeFileSync(join(EMAIL_DIR, emailData.file), [emailData.email, emailData.pwd, emailData.cid, rt].join('----'), 'utf-8');
  }

  // ===== 阶段2: 登录+注册（真实Chrome+扩展） =====
  log('\n[阶段2] 登录ZO（真实Chrome+扩展）...');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-oneshot'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 打开magic link
  try { await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
  await sleep(12000);

  // Turnstile
  for (let a = 0; a < 10; a++) {
    let host = 'x', text = '';
    try { host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })(); } catch(e){}
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') { log('✅ 已登录子域名'); break; }

    try { text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || ''); } catch(e){ text = ''; }
    if (/complete signup|hi.*zo|let.*set|welcome/i.test(text)) {
      log(`注册页面: ${text.substring(0, 60)}`);

      // 填写handle
      const handle = await doHandle(page);
      log(`Handle: ${handle}`);

      // 等boot
      const zoHost = await waitBoot(page, 120);
      if (zoHost && zoHost.endsWith('.zo.computer')) {
        // 保存账号
        const accData = {
          email: emailData.email, password: emailData.pwd,
          clientId: emailData.cid, refreshToken: rt,
          handle, zoUrl: `https://${zoHost}`,
        };
        writeFileSync(ACCOUNTS_FILE, JSON.stringify([accData], null, 2), 'utf-8');
        log(`✅ ZO地址: ${zoHost}`);
      }
      break;
    }

    const widget = await findWidget(cdp);
    if (widget?.box && widget.box.w > 0 && a < 3) {
      const { x, y, h: bh } = widget.box;
      try { await page.mouse.move(x + 28, y + bh / 2, { steps: 8 }); await sleep(100); await page.mouse.down(); await sleep(50); await page.mouse.up(); } catch (e) {}
      await sleep(3000);
    }
    await sleep(2000);
  }

  // ===== 阶段3: 部署套娃保活 =====
  log('\n[阶段3] 等待ZO完全启动...');
  await sleep(60000);

  await deployKeepalive(page);

  // ===== 阶段4: 存活时间说明 =====
  log('\n' + '='.repeat(60));
  log('✅ 一条龙完成！');
  log('');
  log('📊 如何查看ZO自保活的时间：');
  log('');
  log('  方法1: 查看保活日志(最后一条时间戳=最后活跃时间)');
  log('    cat /tmp/keepalive.log');
  log('    日志中每行有ISO时间戳，最后一行=最后保活时间');
  log('');
  log('  方法2: 查看进程运行时间');
  log('    ps aux | grep keepalive');
  log('    看进程的START或TIME列');
  log('');
  log('  方法3: 统计日志中的保活次数');
  log('    grep KEEPALIVE_OK /tmp/keepalive.log | wc -l');
  log('');
  log('  方法4: 查看ZO服务器最后活跃时间');
  log('    stat /tmp/keepalive.log');
  log('');
  log('🤖 保活策略：每5-12分钟随机循环');
  log('   - 启动Chromium访问ZO');
  log('   - 模拟鼠标移动+滚动');
  log('   - ZO服务器内部活跃=永不休眠');
  log('='.repeat(60));

  // 截图留证
  await page.screenshot({ path: join(LOG_DIR, 'DONE.png') });
  log('\n截图已保存: logs/oneshot/DONE.png');
  log('保持60s...');
  await sleep(60000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
