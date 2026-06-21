/**
 * ZO 完整注册流程 — 拟人化操作 v1.0
 * 
 * 包含：Turnstile绕过 → Handle注册 → 个性化选项随机选择/跳过 → 完成
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, 'ext-crack');
const LOG_DIR = join(__dirname, 'logs', 'full');
const EMAIL_DIR = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用';

// 确保目录存在
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const randF = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// 读取所有可用邮箱
const emailFiles = (() => {
  try { return readdirSync(EMAIL_DIR).filter(f => f.endsWith('.txt') && !f.includes('combo')); }
  catch(e) { return []; }
})();
if (emailFiles.length === 0) { console.error('无可用邮箱'); process.exit(1); }

// 选择第一个未使用过的邮箱
const EMAIL_FILE = join(EMAIL_DIR, emailFiles[0]);
const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());
log(`邮箱: ${EMAIL}`);

// ========== Graph API ==========
async function getMsToken(cid, rt) {
  const b = new URLSearchParams({ client_id: cid, grant_type: 'refresh_token', refresh_token: rt, scope: 'https://graph.microsoft.com/.default offline_access' });
  const r = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b.toString() });
  const d = await r.json();
  if (d.error) throw new Error(d.error_description);
  return { at: d.access_token, rt: d.refresh_token || rt };
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
    try { const { at, rt: nr } = await getMsToken(CLIENT_ID, rt); rt = nr; link = await findMagicLink(at, st); } catch (e) {}
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

// ========== 拟人操作 ==========

// 随机生成handle
function genHandle() {
  const prefixes = ['user', 'dev', 'coder', 'builder', 'maker', 'creator', 'hacker', 'thinker'];
  const prefix = pick(prefixes);
  const suffix = Array.from({ length: rand(4, 7) }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[rand(0, 35)]).join('');
  return prefix + suffix;
}

// 真人鼠标移动
async function humanMove(page, tx, ty) {
  const sx = randF(150, 800), sy = randF(100, 600);
  const steps = rand(6, 12);
  for (let s = 1; s <= steps; s++) {
    const p = s / steps;
    await page.mouse.move(
      sx + (tx - sx) * p + Math.sin(p * Math.PI * 1.5) * randF(-8, 8),
      sy + (ty - sy) * p + Math.cos(p * Math.PI) * randF(-5, 5)
    );
    await sleep(rand(15, 45));
  }
  await page.mouse.move(tx, ty);
}

// 拟人浏览
async function humanBrowse(page, duration = 3000) {
  const vp = page.viewportSize() || { width: 1440, height: 900 };
  const n = rand(2, 5);
  for (let i = 0; i < n; i++) {
    await humanMove(page, randF(200, vp.width - 200), randF(100, vp.height - 200));
    await sleep(rand(200, 600));
  }
  if (Math.random() > 0.3) {
    await page.mouse.wheel(0, rand(30, 150));
    await sleep(rand(300, 800));
  }
  await sleep(duration - n * 300);
}

// 拟人输入（逐字）
async function humanType(page, selector, text) {
  const el = await page.$(selector);
  if (!el) return;
  await el.click();
  await sleep(rand(100, 300));
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(rand(30, 120));
  }
}

// 随机点击按钮
async function clickRandomButton(page, patterns) {
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('button, [role="button"], a.btn')]
      .filter(b => b.offsetParent !== null)
      .map(b => ({ text: (b.textContent || '').trim().substring(0, 60), tag: b.tagName }));
  });
  for (const pat of patterns) {
    const match = btns.find(b => new RegExp(pat, 'i').test(b.text));
    if (match) {
      await page.evaluate(t => {
        for (const el of document.querySelectorAll('button, [role="button"], a.btn')) {
          if (el.offsetParent && (el.textContent || '').trim().substring(0, 60) === t) { el.click(); return true; }
        }
      }, match.text);
      return true;
    }
  }
  return false;
}

// ========== Turnstile点击 ==========
async function clickTurnstile(page, box) {
  if (!box?.box || box.box.w <= 0) return;
  const { x, y, w, h } = box.box;
  const cx = x + 28, cy = y + h / 2;
  log(`  点击Turnstile (${Math.round(cx)},${Math.round(cy)})`);

  await humanBrowse(page, 2000);
  await humanMove(page, cx, cy);
  await sleep(rand(60, 200));
  await page.mouse.down();
  await sleep(rand(30, 70));
  await page.mouse.up();
}

// ========== 阶段2: 填写Handle ==========
async function doHandle(page) {
  log('\n=== 阶段2: 填写Handle ===');
  await sleep(rand(2000, 4000));

  const handle = genHandle();
  log(`  随机Handle: ${handle}`);

  // 找输入框
  const filled = await page.evaluate(h => {
    for (const inp of document.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="submit"])')) {
      if (inp.offsetParent) {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(inp, h);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, handle);

  if (!filled) {
    log('  ⚠ 未找到输入框');
    await page.screenshot({ path: join(LOG_DIR, 'debug_handle.png') });
    return false;
  }

  // 拟人停顿
  await sleep(rand(800, 2500));

  // 点Continue
  const clicked = await clickRandomButton(page, ['continue', 'next', 'submit', 'save', 'create']);
  log(`  Continue: ${clicked}`);
  await sleep(rand(2000, 4000));
  return true;
}

// ========== 阶段3: 个性化选项（随机选择）==========
async function doOnboarding(page) {
  log('\n=== 阶段3: 个性化选项 ===');

  // 等待一下让页面加载
  await sleep(rand(2000, 4000));

  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  log(`  页面: ${text.substring(0, 100)}`);

  // 检查是否已经在子域名（完成注册）
  const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
  if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') {
    return 'done';
  }

  // 检测当前步骤类型
  const stepType = (() => {
    if (/what do you want to build|what brings you|your goal|purpose/i.test(text)) return 'purpose';
    if (/experience|skill|level|familiar|programming/i.test(text)) return 'experience';
    if (/theme|appearance|dark|light/i.test(text)) return 'theme';
    if (/name|display name|full name|your name/i.test(text)) return 'name';
    if (/notifications|email updates/i.test(text)) return 'notifications';
    if (/skip|not now|maybe later/i.test(text)) return 'skippable';
    if (/welcome|getting started|set up/i.test(text)) return 'welcome';
    if (/terms|privacy|agree/i.test(text)) return 'terms';
    if (/plan|pricing|subscription|pro|free/i.test(text)) return 'plan';
    if (/done|finish|complete|go to/i.test(text)) return 'complete';
    return 'unknown';
  })();

  log(`  检测到步骤: ${stepType}`);

  // 根据不同步骤做拟人化选择
  switch (stepType) {
    case 'purpose': {
      // 30%概率选择一个选项，70%跳过
      if (Math.random() < 0.3) {
        const options = ['build app', 'web app', 'automation', 'learning', 'personal project', 'ai agent'];
        const choice = pick(options);
        log(`  选择用途: ${choice}`);
        await clickRandomButton(page, [choice]);
        await sleep(rand(1000, 2500));
      }
      break;
    }
    case 'experience': {
      // 40%概率选一个
      if (Math.random() < 0.4) {
        const options = ['intermediate', 'beginner', 'advanced', 'some experience'];
        log(`  选择经验: ${pick(options)}`);
        await clickRandomButton(page, options);
        await sleep(rand(1000, 2500));
      }
      break;
    }
    case 'theme': {
      // 50%选dark，50%跳过
      if (Math.random() < 0.5) {
        log('  选择dark主题');
        await clickRandomButton(page, ['dark', 'dark mode']);
        await sleep(rand(1000, 2000));
      }
      break;
    }
    case 'name': {
      // 60%填名字
      if (Math.random() < 0.6) {
        const names = ['Alex', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Quinn', 'Sam'];
        const name = pick(names);
        log(`  填写名字: ${name}`);
        await page.evaluate(n => {
          for (const inp of document.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="submit"])')) {
            if (inp.offsetParent) {
              const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              s.call(inp, n);
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              return;
            }
          }
        }, name);
        await sleep(rand(800, 1800));
      }
      break;
    }
    case 'plan': {
      // 总是选free
      log('  选择free/免费方案');
      await clickRandomButton(page, ['free', 'basic', 'continue with free', 'free plan', 'start free']);
      await sleep(rand(1500, 3000));
      break;
    }
    case 'terms': {
      // 同意条款
      log('  同意条款');
      await clickRandomButton(page, ['agree', 'accept', 'i agree', 'continue']);
      await sleep(rand(1000, 2000));
      break;
    }
    case 'skippable':
    case 'welcome':
    case 'notifications': {
      // 随机：30%点skip，70%点continue/next
      if (Math.random() < 0.3) {
        log('  点击Skip');
        await clickRandomButton(page, ['skip', 'not now', 'maybe later', 'skip for now']);
      }
      break;
    }
    case 'complete':
    case 'unknown': {
      // 点continue/go/finish
      await clickRandomButton(page, ['continue', 'next', 'go to', 'let\'s go', 'get started', 'finish', 'done', 'skip']);
      await sleep(rand(2000, 3500));
      break;
    }
  }

  // 检查结果
  const newHost = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
  if (newHost.endsWith('.zo.computer') && newHost !== 'www.zo.computer') {
    return 'done';
  }

  return stepType;
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('ZO 完整注册流程 - 拟人化操作');
  log('='.repeat(60));

  log('阶段1: 获取 magic link...');
  const magicLink = await getMagicLink();

  // 启动真实Chrome + 扩展
  log('\n启动真实Chrome + Turnstile扩展...');
  const { chromium } = await import('playwright');

  const context = await chromium.launchPersistentContext(
    join(homedir(), 'AppData', 'Local', 'zo-full-register'),
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

  // ===== Turnstile阶段 =====
  log('\n=== 阶段1.5: Turnstile验证 ===');
  let tsPassed = false, attempt = 0;

  while (!tsPassed && attempt < 20) {
    attempt++;
    const url = page.url();

    if (!url.includes('/verify') || attempt === 1) {
      if (attempt === 1) log('导航到验证页...');
      try { await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
      await sleep(12000);
    }

    log(`\nTS尝试 ${attempt}`);

    const host = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') { tsPassed = true; break; }

    const token = await page.evaluate(() => { try { const r = turnstile.getResponse(); return (r && r.length > 10) ? r : null; } catch (e) { return null; } });
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');

    if (/complete signup|hi.*zo.*set up|getting started|welcome/i.test(text)) {
      log(`✅ Turnstile通过: ${text.substring(0, 60)}`);
      tsPassed = true; break;
    }

    const widget = await findWidget(cdp);
    if (widget?.box && widget.box.w > 0) {
      if (attempt <= 2 || attempt % 3 === 0) await clickTurnstile(page, widget);
      for (let w = 0; w < 6; w++) {
        await sleep(2000);
        try {
          const h = (() => { try { return new URL(page.url()).hostname; } catch (e) { return ''; } })();
          if (h.endsWith('.zo.computer') && h !== 'www.zo.computer') { tsPassed = true; break; }
          const t = await page.evaluate(() => { try { return turnstile.getResponse(); } catch (e) { return null; } });
          if (t && t.length > 10) { log('✅ TOKEN!'); tsPassed = true; break; }
          const tx = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');
          if (/complete signup|hi.*zo|set up/i.test(tx)) { tsPassed = true; break; }
        } catch (e) { tsPassed = true; break; }
      }
    } else if (token) {
      // token存在但widget不可见
      await page.evaluate(tk => {
        const inp = document.querySelector('[name="cf-turnstile-response"]');
        if (inp) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, tk); inp.dispatchEvent(new Event('change', { bubbles: true })); }
      }, token);
      await sleep(3000);
      const cx = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');
      if (/complete signup|hi.*zo|set up/i.test(cx)) { tsPassed = true; break; }
    }

    if (/invalid|expired/i.test(text) && !/redirecting/i.test(text)) { log('Expired, 重导航'); await sleep(2000); continue; }
    await sleep(2000);
  }

  await page.screenshot({ path: join(LOG_DIR, 'ts_passed.png') });

  if (!tsPassed) { log('❌ Turnstile未通过'); await context.close(); return; }
  log('🎉 Turnstile通过！');

  // ===== 注册流程 =====
  log('\n=== 阶段2~N: 注册流程 ===');

  const completedSteps = new Set();
  let stepCount = 0, MAX_STEPS = 30;

  while (stepCount < MAX_STEPS) {
    stepCount++;
    const url = page.url();
    const host = (() => { try { return new URL(url).hostname; } catch (e) { return ''; } })();

    // 成功：到达子域名
    if (host.endsWith('.zo.computer') && host !== 'www.zo.computer') {
      log(`\n🎉🎉🎉 注册完成！${url}`);
      break;
    }

    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');

    // 检测handle输入页
    if (/choose.*handle|pick.*handle|create.*handle|handle.*required/i.test(text)) {
      if (!completedSteps.has('handle')) {
        await doHandle(page);
        completedSteps.add('handle');
        continue;
      }
    }

    // 检测名字输入
    if (/your name|display name|full name|what.*name/i.test(text) && !text.includes('handle')) {
      if (!completedSteps.has('name')) {
        log('\n=== 填写名字 ===');
        const names = ['Alex', 'Jordan', 'Taylor', 'Casey', 'Riley'];
        const name = pick(names);
        log(`  名字: ${name}`);
        await page.evaluate(n => {
          for (const inp of document.querySelectorAll('input[type="text"], input:not([type="hidden"]):not([type="submit"])')) {
            if (inp.offsetParent) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(inp, n); inp.dispatchEvent(new Event('input', { bubbles: true })); return; }
          }
        }, name);
        await sleep(rand(800, 2000));
        await clickRandomButton(page, ['continue', 'next']);
        completedSteps.add('name');
        continue;
      }
    }

    // 通用onboarding处理
    const stepType = await doOnboarding(page);
    if (stepType === 'done') break;

    if (!completedSteps.has(stepType) && stepType !== 'unknown') {
      completedSteps.add(stepType);
    }

    // 如果卡住了，尝试点continue/skip
    await clickRandomButton(page, ['continue', 'next', 'skip', 'skip for now', 'not now', 'done', 'finish', 'complete', 'go to']);
    await sleep(rand(2000, 4000));

    await page.screenshot({ path: join(LOG_DIR, `step_${String(stepCount).padStart(2, '0')}.png`) });
  }

  // 最终结果
  const finalUrl = page.url();
  const finalHost = (() => { try { return new URL(finalUrl).hostname; } catch (e) { return ''; } })();
  log(`\n最终结果: ${finalUrl}`);

  if (finalHost.endsWith('.zo.computer') && finalHost !== 'www.zo.computer') {
    log(`🎉 注册成功！ZO地址: ${finalHost}`);
    writeFileSync(join(LOG_DIR, 'SUCCESS.txt'), `email=${EMAIL}\nhandle=${finalHost.split('.')[0]}\nurl=${finalUrl}\ntime=${new Date().toISOString()}\n`, 'utf-8');
  }

  await page.screenshot({ path: join(LOG_DIR, 'FINAL.png') });
  log('\n浏览器保持60秒...');
  await sleep(60000);
  await context.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
