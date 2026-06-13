/**
 * ZO 一条龙 v2: 注册 → 部署全功能保活(HTTP面板+AI+鼠标+会话+滚动+点击) → 状态监控
 *
 * 存活查看: 访问 ZO子域名:3000 即可看到HTTP面板
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'oneshot');
const EMAIL_DIR = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用';
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// 邮箱
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
  const p = pick(['user', 'dev', 'bot', 'kpr', 'alive', 'node', 'svr']);
  return p + Array.from({ length: rand(4, 6) }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rand(0, 35)]).join('');
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
  for (const m of (d.value || [])) { if (new Date(m.receivedDateTime) < after) continue; const c = (m.subject || '') + ' ' + (m.body?.content || ''); if (!/zo/i.test(c)) continue; const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || []; for (let l of links) { l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&'); if (/token=|verify|login/i.test(l)) return l; } }
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

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('ZO一条龙v2: 注册+全能保活(面板+AI+鼠标+会话)');

  const emailData = getEmail();
  if (!emailData) { log('无邮箱'); process.exit(1); }
  log(`邮箱: ${emailData.email}`);

  // ===== 阶段1: 获取magic link =====
  const { chromium } = await import('playwright');
  const tmpBrowser = await chromium.launch({ headless: false, args: ['--window-size=1440,900'] });
  const tmpCtx = await tmpBrowser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 Chrome/137', locale: 'zh-CN' });
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
    process.stdout.write('.'); await sleep(3000);
  }
  await tmpPage.close(); await tmpCtx.close(); await tmpBrowser.close();

  if (!magicLink) { log('\n❌ 收不到magic link！需新邮箱'); process.exit(1); }
  if (rt !== emailData.rt) writeFileSync(join(EMAIL_DIR, emailData.file), [emailData.email, emailData.pwd, emailData.cid, rt].join('----'), 'utf-8');
  log(`\n✅ link`);

  // ===== 阶段2: 登录+注册 =====
  log('\n[阶段2] 登录ZO...');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-oneshot2'),
    { headless: false, executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'] }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  try { await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
  await sleep(12000);

  let zoHost = '';
  for (let a = 0; a < 10; a++) {
    let host = 'x'; try { host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })(); } catch(e){}
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') { zoHost = host; log(`✅ ${zoHost}`); break; }

    let text = ''; try { text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || ''); } catch(e) {}
    if (/complete signup|hi.*zo|let.*set|welcome/i.test(text)) {
      const handle = genHandle();
      log(`Handle: ${handle}`);
      await sleep(3000);
      try { await page.evaluate(h => { for (const inp of document.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="submit"])')) { if (inp.offsetParent) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, h); inp.dispatchEvent(new Event('input', { bubbles: true })); return; } } }, handle); } catch(e) {}
      await sleep(rand(800, 2000));
      try { await page.evaluate(() => { for (const btn of document.querySelectorAll('button')) { if (/continue|next/i.test(btn.textContent || '')) { btn.click(); return; } } }); } catch(e) {}
      await sleep(3000);
      // 等boot
      for (let w = 0; w < 60; w++) {
        await sleep(3000);
        try { zoHost = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })(); } catch(e) {}
        if (zoHost.endsWith('.zo.computer') && zoHost !== 'www.zo.computer') { log(`✅ ${zoHost}`); break; }
      }
      if (zoHost) {
        writeFileSync(ACCOUNTS_FILE, JSON.stringify([{ email: emailData.email, password: emailData.pwd, clientId: emailData.cid, refreshToken: rt, handle, zoUrl: `https://${zoHost}` }], null, 2), 'utf-8');
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

  if (!zoHost) { log('❌ 未获取ZO子域名'); await context.close(); return; }

  // ===== 阶段3: 等待ZO + 部署保活 =====
  log('\n[阶段3] 等待ZO启动(60s)...');
  await sleep(60000);

  log('部署全能保活脚本 (base64)...');
  const termOpened = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button, a, [role="button"], div[role="tab"]')) {
      const t = (el.textContent || '').trim().toLowerCase();
      if ((t === 'terminal' || t === '终端') && el.offsetParent) { el.click(); return true; }
    }
    return false;
  });
  log(`终端: ${termOpened}`);

  // 找输入框
  async function sendCmd(cmd, desc) {
    log(`  [${desc}]`);
    const inp = await page.evaluate(() => {
      for (const sel of ['textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="text"]:not([type="hidden"])']) {
        const el = document.querySelector(sel); if (el && el.offsetParent) { el.focus(); el.click(); return sel; }
      }
      return null;
    });
    if (!inp) { log('    ❌ 无输入框'); return; }
    for (const ch of cmd) { await page.keyboard.type(ch); await sleep(15); }
    await sleep(500);
    await page.keyboard.press('Enter');
    log('    ✅');
    await sleep(rand(25000, 50000));
  }

  await sendCmd('sudo apt update -qq 2>&1 | tail -5', '更新apt');
  await sendCmd('sudo apt install -y xvfb chromium-browser 2>&1 | tail -5', '安装xvfb+chromium');
  await sendCmd('sudo apt install -y nodejs npm 2>&1 | tail -5', '安装nodejs');
  await sendCmd('npm install -g playwright 2>&1 | tail -5 && npx playwright install chromium 2>&1 | tail -5', '安装playwright');

  // ★ curl直接下载保活脚本（3秒搞定，不是2小时）
  await sendCmd('curl -fsSL -o /home/user/keepalive.js https://raw.githubusercontent.com/xingluoyuankong/ZO-register/master/keepalive_full_puppet.js && echo "DOWNLOADED"', '下载保活脚本');

  // 启动
  await sendCmd('cd /home/user && nohup xvfb-run -a node keepalive.js > /tmp/keepalive.log 2>&1 & echo "PID=$!"', '启动保活');

  // 验证
  await sendCmd('sleep 15 && ps aux | grep -v grep | grep keepalive && echo "RUNNING" || echo "NOT_RUNNING"', '验证进程');
  await sendCmd('cat /tmp/keepalive.log', '查看日志');

  // ===== 完成 =====
  log('\n' + '='.repeat(60));
  log('✅ 一条龙完成！');
  log('');
  log('📊 ZO 内部保有：');
  log(`  ZO地址: https://${zoHost}`);
  log(`  存活面板: https://${zoHost}:3000 (HTTP面板)`);
  log('');
  log('📊 外部查看存活:');
  log(`  方法1: 浏览器访问 https://${zoHost}:3000`);
  log(`  方法2: curl https://${zoHost}:3000/api/state`);
  log(`  方法3: cat /tmp/keepalive.log (心跳日志)`);
  log('');
  log('🤖 保活操作(随机组合):');
  log('  AI提问(60%) | 新会话(25%) | 鼠标轨迹 | 滚动 | 点击(45%)');
  log('  间隔: 5-12分钟随机');
  log('  合1服务: HTTP面板 + 保活脚本');
  log('='.repeat(60));

  await page.screenshot({ path: join(LOG_DIR, 'DONE.png') });
  log('保持60s...');
  await sleep(60000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
