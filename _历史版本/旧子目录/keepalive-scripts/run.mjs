/**
 * Turnstile 最终破解 — Chrome扩展 + CDP Shadow DOM 穿透点击
 * 
 * 核心改进：
 * 1. 加载真实Chrome扩展（world:MAIN + all_frames），MouseEvent patch对iframe内有效
 * 2. CDP穿透Shadow DOM，获取widget坐标
 * 3. 点击checkbox → 等token → 注入hidden input → 自动跳转
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join('E:\\API获取工具\\ZO注册', 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'run');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => a + Math.random() * (b - a);

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());
log(`邮箱: ${EMAIL}`);

// ========== Graph API ==========
async function getToken(clientId, rt) {
  const b = new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: rt, scope: 'https://graph.microsoft.com/.default offline_access' });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const d = await r.json();
  if (d.error) throw new Error(d.error_description);
  return { at: d.access_token, rt: d.refresh_token || rt };
}

async function findLink(at, afterTime) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', { headers: { Authorization: 'Bearer ' + at } });
  const d = await r.json();
  for (const m of (d.value || [])) {
    if (new Date(m.receivedDateTime) < afterTime) continue;
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

// ========== 发送+获取 magic link (快速) ==========
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
  for (let i = 0; i < 45; i++) {
    try { const { at, rt: nr } = await getToken(CLIENT_ID, rt); rt = nr; link = await findLink(at, st); } catch (e) {}
    if (link) break;
    process.stdout.write('.');
    await sleep(3000);
  }
  await p.close(); await c.close(); await b.close();
  if (!link) throw new Error('No magic link');
  if (rt !== REFRESH_TOKEN) writeFileSync(EMAIL_FILE, [EMAIL, PASSWORD, CLIENT_ID, rt].join('----'), 'utf-8');
  log(`Magic link已获取`);
  return link;
}

// ========== CDP 穿透 Shadow DOM 找 Turnstile widget ==========
async function findWidgetBox(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let found = null;

  function dfs(node, depth) {
    if (found || depth > 100 || !node) return;
    const tag = (node.localName || '').toLowerCase();
    if (tag === 'iframe' && node.attributes) {
      const attrs = Array.isArray(node.attributes) ? node.attributes : [];
      const si = attrs.findIndex(a => a === 'src');
      const src = si >= 0 ? (attrs[si + 1] || '') : '';
      if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
        found = { nodeId: node.nodeId, src };
        return;
      }
    }
    if (node.shadowRoots) for (const sr of node.shadowRoots) dfs(sr, depth + 1);
    if (node.children) for (const c of node.children) dfs(c, depth + 1);
    if (node.contentDocument) dfs(node.contentDocument, depth + 1);
  }
  dfs(root, 0);
  if (!found) return null;

  try {
    const bm = await cdp.send('DOM.getBoxModel', { nodeId: found.nodeId });
    if (bm?.model?.content) {
      const c = bm.model.content;
      found.box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] };
    }
  } catch (e) {}
  return found;
}

// ========== 真人行为 + 点击 checkbox ==========
async function clickCheckbox(page, box) {
  if (!box?.box || box.box.w <= 0) return false;
  const { x, y, w, h } = box.box;
  const cx = x + 28, cy = y + h / 2;

  // 模拟浏览
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(rand(200, 900), rand(100, 700), { steps: Math.floor(rand(4, 8)) });
    await sleep(rand(200, 500));
  }
  await page.mouse.wheel(0, rand(50, 150));
  await sleep(rand(400, 800));
  await page.mouse.wheel(0, rand(-30, -60));
  await sleep(rand(300, 600));

  // 移向checkbox
  const sx = cx + rand(80, 180) * (Math.random() > 0.5 ? 1 : -1);
  const sy = cy + rand(30, 60) * (Math.random() > 0.5 ? 1 : -1);
  for (let s = 1; s <= Math.floor(rand(7, 10)); s++) {
    const p = s / (Math.floor(rand(7, 10)));
    await page.mouse.move(
      sx + (cx - sx) * p + Math.sin(p * Math.PI * 1.5) * rand(-6, 6),
      sy + (cy - sy) * p + Math.cos(p * Math.PI) * rand(-4, 4)
    );
    await sleep(rand(20, 45));
  }
  await sleep(rand(100, 300));
  await page.mouse.move(cx, cy);
  await sleep(rand(60, 150));

  // 点击
  await page.mouse.down();
  await sleep(rand(35, 75));
  await page.mouse.up();

  log(`  ✅ 点击 (${Math.round(cx)}, ${Math.round(cy)})`);
  return true;
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(50));

  // ===== 阶段1: 获取 magic link =====
  log('获取 magic link...');
  const magicLink = await getMagicLink();

  // ===== 阶段2: 启动带扩展的浏览器 =====
  log('\n启动带扩展的浏览器...');
  const { chromium } = await import('playwright');

  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-ext-crack-profile'),
    {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
        '--no-sandbox',
      ],
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    }
  );

  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');

  // ===== 阶段3: 主循环 =====
  let solved = false, attempt = 0, clicked = false;

  while (!solved && attempt < 30) {
    attempt++;

    // 导航（首次或过期后）
    const url = page.url();
    if (!url.includes('/verify') || attempt === 1) {
      if (attempt === 1) log('\n导航到验证页...');
      else log('\n🔄 重新导航...');
      try { await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
      await sleep(12000); // Turnstile 加载时间
      await page.screenshot({ path: join(LOG_DIR, `a${attempt}_loaded.png`) });
    }

    log(`\n--- 第 ${attempt} 次 ---`);

    const curUrl = page.url();
    const host = (() => { try { return new URL(curUrl).hostname; } catch (e) { return ''; } })();

    // 检查成功
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') {
      log('🎉 已登录子域名！'); solved = true; break;
    }

    // 检查token
    const token = await page.evaluate(() => {
      try { const r = turnstile.getResponse(); return (r && r.length > 10) ? r : null; }
      catch (e) { return null; }
    });

    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');

    if (/choose your handle|set up your profile|welcome|dashboard/i.test(text)) {
      log('🎉 进入注册流程！'); solved = true; break;
    }

    // 找到widget
    const widget = await findWidgetBox(cdp);

    if (widget?.box && widget.box.w > 0) {
      log(`Widget: (${Math.round(widget.box.x)},${Math.round(widget.box.y)}) ${Math.round(widget.box.w)}x${Math.round(widget.box.h)} token=${token ? 'YES' : 'NO'}`);

      // 每3次尝试就点击一次
      if (!clicked || attempt % 2 === 0) {
        await clickCheckbox(page, widget);
        await page.screenshot({ path: join(LOG_DIR, `a${attempt}_after_click.png`) });
        clicked = true;
      }

      // 观察token
      log('等待token...');
      for (let w = 0; w < 10; w++) {
        await sleep(2000);
        const t = await page.evaluate(() => { try { const r = turnstile.getResponse(); return (r && r.length > 10) ? r : null; } catch (e) { return null; } });
        const u = page.url();
        const h = (() => { try { return new URL(u).hostname; } catch (e) { return ''; } })();

        if (t) {
          log(`✅ TOKEN! ${t.substring(0, 30)}...`);
          // 注入到hidden input
          await page.evaluate(tk => {
            const inp = document.querySelector('[name="cf-turnstile-response"]');
            if (inp) {
              const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              s.call(inp, tk);
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              inp.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, t);
          // 等跳转
          for (let j = 0; j < 15; j++) {
            await sleep(2000);
            const jh = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
            if (jh.endsWith('.zo.computer') && jh !== 'www.zo.computer') { solved = true; break; }
          }
          if (solved) break;
        }
        if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { log('🎉 跳转！'); solved = true; break; }

        if (w % 3 === 0) log(`  ${w * 2}s: token=${t ? 'YES' : 'NO'}`);
      }
      if (solved) break;
    } else {
      log(`Widget不可见 token=${token ? 'YES' : 'NO'}`);
      if (/invalid|expired/i.test(text) && !/redirecting/i.test(text)) {
        clicked = false; continue; // 会触发重新导航
      }
    }

    // 检查过期
    if (/invalid|expired/i.test(text) && !/redirecting/i.test(text)) {
      log('⚠ Link expired');
      clicked = false;
      await sleep(2000);
      continue;
    }

    await sleep(2000);
  }

  if (!solved) log('\n❌ 未通过');
  else log('\n🎉 成功！');

  log(`最终URL: ${page.url().substring(0, 100)}`);
  await page.screenshot({ path: join(LOG_DIR, 'FINAL.png') });
  log('保持30秒...');
  await sleep(30000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
