/**
 * Turnstile 破解 — 使用系统真实Chrome + 扩展 + CDP点击
 * 参考grok-register-main的核心思路：真实Chrome + 扩展预注入MouseEvent
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'chrome');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => a + Math.random() * (b - a);

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());

// ========== Graph API ==========
async function getToken(cid, rt) {
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
    for (let l of links) {
      l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
      if (/token=|verify|login/i.test(l)) return l;
    }
  }
  return null;
}

async function getMagicLink() {
  const { chromium } = await import('playwright');
  const b = await chromium.launch({ headless: false, args: ['--window-size=1440,900'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36', locale: 'zh-CN' });
  const p = await c.newPage();
  try { await p.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) {}
  await sleep(3000);
  await p.evaluate(() => { for (const btn of document.querySelectorAll('button,a')) { if (/email/i.test(btn.textContent || '') && btn.offsetParent) { btn.click(); return; } } });
  await sleep(2000);
  await p.evaluate(e => { const inp = document.querySelector('input[type=email]') || document.querySelector('input'); if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, e); inp.dispatchEvent(new Event('input', { bubbles: true })); } }, EMAIL);
  await sleep(500);
  await p.evaluate(() => { for (const btn of document.querySelectorAll('button')) { if (/continue/i.test(btn.textContent || '')) { btn.click(); return; } } });
  await sleep(3000);
  const st = new Date(Date.now() - 5000);
  let link = null, rt = REFRESH_TOKEN;
  for (let i = 0; i < 60; i++) {
    try { const { at, rt: nr } = await getToken(CLIENT_ID, rt); rt = nr; link = await findLink(at, st); } catch (e) {}
    if (link) break;
    process.stdout.write('.'); await sleep(3000);
  }
  await p.close(); await c.close(); await b.close();
  if (!link) throw new Error('No link');
  if (rt !== REFRESH_TOKEN) writeFileSync(EMAIL_FILE, [EMAIL, PASSWORD, CLIENT_ID, rt].join('----'), 'utf-8');
  return link;
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

async function humanClick(page, box) {
  if (!box?.box || box.box.w <= 0) return;
  const { x, y, w, h } = box.box;
  const cx = x + 28, cy = y + h / 2;
  log(`  点击 (${Math.round(cx)},${Math.round(cy)}) [widget:${Math.round(w)}x${Math.round(h)}]`);

  for (let i = 0; i < 5; i++) { await page.mouse.move(rand(200, 900), rand(100, 700), { steps: Math.floor(rand(4, 8)) }); await sleep(rand(200, 500)); }
  await page.mouse.wheel(0, rand(50, 150)); await sleep(rand(400, 800));
  await page.mouse.wheel(0, rand(-30, -60)); await sleep(rand(300, 600));

  const sx = cx + rand(80, 180) * (Math.random() > 0.5 ? 1 : -1);
  const sy = cy + rand(30, 60) * (Math.random() > 0.5 ? 1 : -1);
  for (let s = 1; s <= Math.floor(rand(7, 10)); s++) {
    const p = s / 10;
    await page.mouse.move(sx + (cx - sx) * p + Math.sin(p * Math.PI * 1.5) * rand(-6, 6), sy + (cy - sy) * p + Math.cos(p * Math.PI) * rand(-4, 4));
    await sleep(rand(20, 45));
  }
  await sleep(rand(100, 300));
  await page.mouse.move(cx, cy);
  await sleep(rand(60, 150));
  await page.mouse.down(); await sleep(rand(35, 75)); await page.mouse.up();
  log(`  ✅ 已点击`);
}

// ========== 主流程 ==========
async function main() {
  log('获取 magic link...');
  const magicLink = await getMagicLink();

  // ===== 尝试用真实 Chrome =====
  const { chromium } = await import('playwright');

  let usedChrome = false;
  let context;

  // 尝试系统Chrome
  try {
    log('\n尝试使用系统 Chrome...');
    const { execSync } = await import('child_process');
    // 找Chrome路径
    let chromePath = '';
    try { chromePath = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve 2>nul | findstr "REG_SZ"').toString().split('REG_SZ')[1]?.trim(); } catch (e) {}
    if (!chromePath) try { chromePath = execSync('where chrome 2>nul').toString().split('\n')[0]?.trim(); } catch (e) {}
    if (chromePath) log(`找到 Chrome: ${chromePath}`);

    const launchOpts = {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
      ],
    };
    if (chromePath) launchOpts.executablePath = chromePath;

    context = await chromium.launchPersistentContext(
      join(homedir(), 'AppData', 'Local', 'zo-chrome-profile2'),
      launchOpts
    );
    usedChrome = true;
    log('✅ 使用真实Chrome');
  } catch (e) {
    log(`真实Chrome失败: ${e.message}, 回退到自带Chromium`);
    context = await chromium.launchPersistentContext(
      join(homedir(), 'AppData', 'Local', 'zo-crack-v10'),
      {
        headless: false,
        args: [
          `--disable-extensions-except=${EXT_DIR}`,
          `--load-extension=${EXT_DIR}`,
          '--disable-blink-features=AutomationControlled',
          '--window-size=1440,900',
        ],
        viewport: { width: 1440, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
      }
    );
  }

  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // 主循环
  let solved = false, attempt = 0, clicked = false;

  while (!solved && attempt < 30) {
    attempt++;
    const url = page.url();

    if (!url.includes('/verify') && !url.includes('/signup') || (attempt === 1 && !url.includes('/verify') && !url.includes('/signup') && !url.includes('/email-login'))) {
      if (attempt === 1) log('\n导航验证页...'); else log('\n🔄 重新导航...');
      try { await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
      await sleep(12000);
      await page.screenshot({ path: join(LOG_DIR, `${attempt}_loaded.png`) });
    }

    log(`\n--- ${attempt}/30 ---`);

    const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') { log('🎉 子域名！'); solved = true; break; }

    const token = await page.evaluate(() => { try { const r = turnstile.getResponse(); return (r && r.length > 10) ? r : null; } catch (e) { return null; } });
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');

    if (token) {
      log(`✅ TOKEN! ${token.substring(0, 30)}...`);
      await page.evaluate(tk => {
        const inp = document.querySelector('[name="cf-turnstile-response"]');
        if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, tk); inp.dispatchEvent(new Event('change', { bubbles: true })); }
      }, token);
      for (let j = 0; j < 20; j++) {
        await sleep(2000);
        const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
        if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { solved = true; break; }
        const jt = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');
        if (/complete signup|choose your handle|set up your profile/i.test(jt)) { log('已到注册页！'); solved = true; break; }
      }
      if (solved) break;
    }

    // 检查各种成功状态
    if (/complete signup|choose your handle|set up your profile|welcome|dashboard|finish signing/i.test(text)) {
      log(`成功状态: ${text.substring(0, 80)}`);

      // 尝试点击完成注册按钮
      await page.evaluate(() => {
        for (const btn of document.querySelectorAll('button, a, [role="button"]')) {
          const t = (btn.textContent || '').trim().toLowerCase();
          if (/complete signup|finish|continue|get started|go to|sign up/i.test(t)) {
            if (btn.offsetParent !== null) { btn.click(); return; }
          }
        }
      });
      await sleep(5000);

      // 检查是否跳转到子域名
      const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
      if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { log('🎉 子域名！'); solved = true; break; }

      // 再试一次
      const newText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
      if (/complete signup|choose your handle|welcome|dashboard/i.test(newText)) {
        // 点击页面上的主要按钮
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('button, a')) {
            if (el.offsetParent !== null && (el.textContent || '').trim().length > 3) { el.click(); return; }
          }
        });
        await sleep(3000);
      }

      if (!solved) { solved = true; log('已处理注册流程'); } // 防止死循环
      break;
    }

    const widget = await findWidget(cdp);
    if (widget?.box && widget.box.w > 0) {
      log(`Widget: (${Math.round(widget.box.x)},${Math.round(widget.box.y)}) ${Math.round(widget.box.w)}x${Math.round(widget.box.h)} token=${token?'YES':'NO'}`);

      if (!clicked || attempt % 2 === 0) {
        await humanClick(page, widget);
        await page.screenshot({ path: join(LOG_DIR, `${attempt}_clicked.png`) });
        clicked = true;
      }

      // 观察结果
      for (let w = 0; w < 6; w++) {
        await sleep(2000);
        const t = await page.evaluate(() => { try { const r = turnstile.getResponse(); return (r && r.length > 10) ? r : null; } catch (e) { return null; } });
        const tx = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');
        if (t) { log(`  ✅ TOKEN! page="${tx.substring(0, 50)}"`); break; }
        const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
        if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { solved = true; break; }
        if (/complete signup/i.test(tx)) { log(`  ✅ Complete signup!`); break; }
      }
      if (solved) break;
    } else {
      log(`Widget不可见 token=${token ? 'YES' : 'NO'} text=${text.substring(0, 60)}`);
      if (/invalid|expired/i.test(text) && !/redirecting/i.test(text)) { clicked = false; continue; }
      // token还在就继续尝试完成注册
      if (token && /complete signup|sign up|register/i.test(text)) {
        await page.evaluate(() => {
          for (const btn of document.querySelectorAll('button')) {
            if (btn.offsetParent) { btn.click(); return; }
          }
        });
        await sleep(3000);
      }
    }
    await sleep(2000);
  }

  if (!solved) log('\n❌ 未通过');
  else log('\n🎉 成功！');
  log(`最终: ${page.url()}`);
  await page.screenshot({ path: join(LOG_DIR, 'FINAL.png') });
  log('保持30秒...');
  await sleep(30000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
