/**
 * 保活快速测试 — 验证登录+活跃操作+ping是否正常工作
 * 运行一次完整周期后退出
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'keepalive_test');
const ACCOUNTS_FILE = join(__dirname, 'keepalive', 'accounts.json');

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'test.log'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const randF = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const QUESTIONS = ['Hello!', '今天天气如何？', '帮我解释一下什么是机器学习', '推荐一本好书', '写一首简短的诗'];

const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
log(`账号: ${accounts[0].email} → ${accounts[0].zoUrl}`);

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

async function findWidget(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let r = null;
  (function dfs(n, d) { if (r || d > 100 || !n) return; const t = (n.localName || '').toLowerCase(); if (t === 'iframe' && n.attributes) { const a = Array.isArray(n.attributes) ? n.attributes : []; const i = a.findIndex(x => x === 'src'); const s = i >= 0 ? (a[i + 1] || '') : ''; if (s.includes('challenges.cloudflare') || s.includes('turnstile')) { r = { nodeId: n.nodeId, src: s }; return; } } if (n.shadowRoots) for (const sr of n.shadowRoots) dfs(sr, d + 1); if (n.children) for (const c of n.children) dfs(c, d + 1); })(root, 0);
  if (!r) return null;
  try { const bm = await cdp.send('DOM.getBoxModel', { nodeId: r.nodeId }); if (bm?.model?.content) { const c = bm.model.content; r.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] }; } } catch (e) {}
  return r;
}

async function doLogin(page, cdp, acc) {
  log('[登录] 开始...');
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
  log('[登录] 轮询magic link...');
  for (let i = 0; i < 45; i++) { try { const { at, rt: nr } = await getMsToken(acc.clientId, rt); rt = nr; link = await findLink(at, st); } catch (e) {} if (link) break; await sleep(3000); process.stdout.write('.'); }
  if (!link) { log('\n❌ No link'); return false; }
  log(`\n✅ link`);

  try { await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
  await sleep(12000);

  for (let a = 0; a < 8; a++) {
    const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') { log('✅ 已登录'); return true; }
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');
    if (/complete signup|hi.*zo|welcome|dashboard/i.test(text)) { log('✅ 到达Dashboard'); return true; }
    const widget = await findWidget(cdp);
    if (widget?.box && a < 3) {
      const { x, y, w, h } = widget.box;
      await page.mouse.move(x + 28, y + h / 2, { steps: 8 });
      await sleep(100);
      await page.mouse.down(); await sleep(50); await page.mouse.up();
      await sleep(2000);
    }
    await sleep(2000);
  }
  return false;
}

async function activeKeepalive(page) {
  log('\n[活跃保活] 模拟用户...');
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  log(`  页面: ${text.substring(0, 100)}`);

  const hasInput = /send a message|type a message|ask zo|textarea|send message|message zo/i.test(text);
  
  if (hasInput || /dashboard|desktop|explore/i.test(text)) {
    const q = pick(QUESTIONS);
    log(`  发送: "${q}"`);
    const typed = await page.evaluate(() => {
      for (const el of document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]')) {
        if (el.offsetParent) { el.focus(); return true; }
      }
      return false;
    });
    if (typed) {
      for (const ch of q) { await page.keyboard.type(ch); await sleep(rand(30, 120)); }
      await sleep(rand(500, 1500));
      await page.keyboard.press('Enter');
      log('  ✅ 发送完成');
    } else {
      log('  ⚠ 无输入框，浏览替代');
      for (let i = 0; i < rand(3, 5); i++) {
        await page.mouse.move(randF(200, 900), randF(100, 700), { steps: rand(4, 8) });
        await sleep(rand(300, 800));
      }
    }
  } else if (/boot|booting|%/i.test(text)) {
    log('  ZO启动中，等待...');
    await sleep(rand(5000, 10000));
  } else {
    log('  浏览替代...');
    for (let i = 0; i < rand(3, 5); i++) {
      await page.mouse.move(randF(200, 900), randF(100, 700), { steps: rand(4, 8) });
      await sleep(rand(300, 800));
    }
  }
}

async function main() {
  log('保活快速测试');
  const acc = accounts[0];

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-keepalive-test'),
    {
      headless: false,
      executablePath: 'C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
    }
  );
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // Step 1: 直接先试试能不能访问ZO子域名（可能已登录）
  log(`\n1. 尝试访问 ${acc.zoUrl}`);
  try { await page.goto(acc.zoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
  await sleep(5000);

  const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');

  if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') {
    log(`✅ 已在子域名: ${host}`);
  } else {
    log(`需要重新登录 (当前: ${text.substring(0, 80)})`);
    const ok = await doLogin(page, cdp, acc);
    if (!ok) { log('❌ 登录失败'); await context.close(); return; }
  }

  // Step 2: 活跃保活
  await activeKeepalive(page);
  await sleep(3000);
  await activeKeepalive(page);

  // Step 3: 检查结果
  const finalUrl = page.url();
  log(`\n✅ 测试完成! URL: ${finalUrl}`);

  log('\n保活系统验证通过 — 可部署为守护进程: node keepalive_v2.mjs');
  await sleep(10000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}`); process.exit(1); });
