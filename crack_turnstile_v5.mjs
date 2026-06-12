/**
 * Turnstile 破解脚本 v5.0 — 基于三个核心洞察
 *
 * 洞察1: Turnstile 需要加载时间，不能打开链接就点
 * 洞察2: Cloudflare 收集浏览器操作数据，需要模拟真人行为
 * 洞察3: "Continue in browser" 是误导信息，不应点击
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'crack_v5');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';
const TURNSTILE_PATCH_FILE = join(__dirname, 'extension', 'turnstile-patch', 'script.js');

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'debug.log'), m + '\n'); };

function randBetween(a, b) { return a + Math.random() * (b - a); }

// 读取配置
const TURNSTILE_PATCH = readFileSync(TURNSTILE_PATCH_FILE, 'utf-8');
const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());
log(`邮箱: ${EMAIL}`);

// ========== 增强版 Turnstile Patch ==========
const ENHANCED_PATCH = TURNSTILE_PATCH + `
;(function() {
  if (window.__TURNSTILE_V5__) return;
  window.__TURNSTILE_V5__ = true;

  // 额外：Date.prototype.getTimezoneOffset 稳定性
  var origTz = Date.prototype.getTimezoneOffset;
  var stableOffset = -480; // UTC+8
  Date.prototype.getTimezoneOffset = function() {
    try { return stableOffset; } catch(e) { return origTz.call(this); }
  };

  // Canvas 噪声（微量）
  var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function() {
    try {
      var ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0 && this.width < 500 && this.height < 500) {
        var d = ctx.getImageData(0, 0, 1, 1);
        if (d.data[3] > 0) { d.data[3] = Math.max(0, d.data[3] - 1); ctx.putImageData(d, 0, 0); }
      }
    } catch(e) {}
    return origToDataURL.apply(this, arguments);
  };
})();
`;

// ========== Graph API ==========
async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access'
  });
  const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
  });
  const data = await resp.json();
  if (data.error) throw new Error(`Token: ${data.error_description}`);
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, afterTime) {
  const url = 'https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc';
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  const mail = await resp.json();
  if (!mail.value) return null;
  for (const msg of mail.value) {
    if (new Date(msg.receivedDateTime) < afterTime) continue;
    const combined = (msg.subject || '') + ' ' + (msg.body ? msg.body.content : '');
    if (!/zo/i.test(combined)) continue;
    const raws = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    for (let link of raws) {
      link = link.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
      if (/token=|verify|login|sign/i.test(link)) return link;
    }
  }
  return null;
}

// ========== ★ 核心：模拟真人行为 ==========

/**
 * 模拟真人在页面上的自然行为
 * Cloudflare 会收集鼠标移动、滚动、时间间隔等行为数据
 */
async function simulateHumanBehavior(page) {
  log('  模拟真人浏览行为...');
  const vp = page.viewportSize() || { width: 1440, height: 900 };

  // 1. 随机移动鼠标到页面几个位置（读页面内容）
  const positions = [
    { x: randBetween(300, 600), y: randBetween(100, 250), desc: '内容区域上方' },
    { x: randBetween(400, 800), y: randBetween(300, 500), desc: '内容区域中部' },
    { x: randBetween(200, 500), y: randBetween(450, 650), desc: '内容区域下方' },
    { x: randBetween(600, 900), y: randBetween(200, 400), desc: '页面右侧' },
    { x: randBetween(100, 350), y: randBetween(150, 350), desc: '页面左侧' },
  ];

  for (let i = 0; i < positions.length; i++) {
    const target = positions[i];
    // 从当前位置移动到目标（分多步）
    const steps = Math.floor(randBetween(6, 12));
    for (let s = 1; s <= steps; s++) {
      const progress = s / steps;
      // 贝塞尔曲线 + 随机抖动
      const wobbleX = Math.sin(progress * Math.PI) * (Math.random() - 0.5) * 15;
      const wobbleY = Math.cos(progress * Math.PI * 2) * (Math.random() - 0.5) * 10;
      await page.mouse.move(
        target.x + wobbleX,
        target.y + wobbleY
      );
      await sleep(randBetween(20, 60));
    }
    // 在目标位置停留
    await sleep(randBetween(300, 800));
  }

  // 2. 小幅度滚动（模拟阅读）
  await page.mouse.wheel(0, randBetween(80, 200));
  await sleep(randBetween(500, 1200));
  await page.mouse.wheel(0, randBetween(-30, -80));
  await sleep(randBetween(300, 700));

  // 3. 再移动几次鼠标
  for (let i = 0; i < 3; i++) {
    const rx = randBetween(200, vp.width - 200);
    const ry = randBetween(100, vp.height - 100);
    await page.mouse.move(rx, ry, { steps: Math.floor(randBetween(3, 6)) });
    await sleep(randBetween(200, 500));
  }

  log('  真人行为模拟完成');
}

/**
 * ★ 点击 Turnstile checkbox — 单击左偏位置
 * 用户洞察：Cloudflare Turnstile 的 checkbox 在 widget 左侧约 28-30px 处
 * 配合反检测补丁中的 screenX/screenY 偏移，模拟真人点击
 */
async function clickTurnstileCheckbox(page, turnstileBox) {
  const { x, y, w, h } = turnstileBox;
  
  // Checkbox 位置：左侧偏移 27-30px，垂直居中
  const checkboxOffsetX = 28;
  const clickX = x + checkboxOffsetX;
  const clickY = y + h / 2;
  
  log(`  Turnstile widget: (${Math.round(x)}, ${Math.round(y)}) ${Math.round(w)}x${Math.round(h)}`);
  log(`  目标checkbox: (${Math.round(clickX)}, ${Math.round(clickY)})`);

  // ★ 模拟真人从远处移动鼠标到 checkbox
  // 起始位置：随机选择远离 checkbox 的位置
  const startPositions = [
    { x: randBetween(x + w + 50, x + w + 200), y: randBetween(y - 100, y + h + 100) },
    { x: randBetween(x - 200, x - 50), y: randBetween(y + h + 50, y + h + 200) },
    { x: randBetween(x + w + 100, x + w + 250), y: randBetween(y + h, y + h + 150) },
  ];
  const start = startPositions[Math.floor(Math.random() * startPositions.length)];

  // 阶段1：快速移向 checkbox 附近
  log('  阶段1: 移动到 checkbox 附近...');
  const approachSteps = Math.floor(randBetween(5, 8));
  for (let s = 1; s <= approachSteps; s++) {
    const progress = s / approachSteps;
    const midX = start.x + (clickX - start.x) * progress + Math.sin(progress * Math.PI * 1.5) * randBetween(-10, 10);
    const midY = start.y + (clickY - start.y) * progress + Math.cos(progress * Math.PI) * randBetween(-8, 8);
    await page.mouse.move(midX, midY);
    await sleep(randBetween(25, 55));
  }

  // 阶段2：在 checkbox 附近迟疑一下，然后微调位置
  await sleep(randBetween(200, 500));
  await page.mouse.move(clickX + randBetween(-3, 3), clickY + randBetween(-3, 3));
  await sleep(randBetween(100, 300));

  // 阶段3：精确移到 checkbox 并点击
  log('  阶段2: 点击 checkbox');
  await page.mouse.move(clickX, clickY);
  await sleep(randBetween(80, 200));
  
  // ★ 关键：按下和释放之间要有自然的延迟
  await page.mouse.down();
  await sleep(randBetween(40, 90));
  await page.mouse.up();

  log('  ✅ checkbox 点击完成');
}

// ========== Turnstile DOM 分析 ==========
async function analyzePageDOM(page) {
  log('=== 页面 DOM 分析 ===');
  
  const analysis = await page.evaluate(() => {
    const result = {
      url: location.href,
      bodyText: (document.body?.innerText || '').substring(0, 600),
      iframes: [],
      turnstileContainers: [],
      cloudflareElements: [],
      shadowElements: [],
      allButtons: [],
      scripts: [],
    };

    // 1. 所有 iframe（含可见性）
    document.querySelectorAll('iframe').forEach(iframe => {
      const rect = iframe.getBoundingClientRect();
      const cs = getComputedStyle(iframe);
      result.iframes.push({
        src: (iframe.src || '').substring(0, 150),
        name: iframe.name || '',
        id: iframe.id || '',
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        visible: rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
        opacity: cs.opacity,
        zIndex: cs.zIndex,
      });
    });

    // 2. Turnstile 容器
    document.querySelectorAll('.cf-turnstile, [data-sitekey]').forEach(el => {
      const rect = el.getBoundingClientRect();
      result.turnstileContainers.push({
        tag: el.tagName,
        className: (el.className || '').toString(),
        hasShadow: !!el.shadowRoot,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        visible: rect.width > 0 && rect.height > 0,
        dataset: JSON.stringify(el.dataset || {}),
      });
    });

    // 3. Cloudflare 相关元素
    document.querySelectorAll('[id*="cf-"], [class*="cf-"], [id*="challenge"], [class*="challenge"], [id*="turnstile"], [class*="turnstile"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      result.cloudflareElements.push({
        tag: el.tagName,
        id: el.id || '',
        className: (el.className || '').toString().substring(0, 100),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        visible: rect.width > 0 && rect.height > 0,
        text: (el.textContent || '').trim().substring(0, 80),
      });
    });

    // 4. Shadow DOM 探查（尝试穿透）
    document.querySelectorAll('.cf-turnstile, [data-sitekey]').forEach(el => {
      if (el.shadowRoot) {
        const children = [];
        el.shadowRoot.querySelectorAll('*').forEach(child => {
          const cr = child.getBoundingClientRect();
          children.push({
            tag: child.tagName,
            id: child.id || '',
            className: (child.className || '').toString().substring(0, 60),
            rect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) },
          });
        });
        result.shadowElements.push({ parent: el.tagName + '.' + el.className, children });
      }
    });

    // 5. 所有按钮
    document.querySelectorAll('button, [role="button"], input[type="submit"], a.btn, a[href="#"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        result.allButtons.push({
          text: (el.textContent || '').trim().substring(0, 60),
          tag: el.tagName,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
      }
    });

    // 6. 加载的 Cloudflare/Turnstile scripts
    document.querySelectorAll('script[src]').forEach(s => {
      const src = s.src;
      if (src.includes('cloudflare') || src.includes('turnstile') || src.includes('cf')) {
        result.scripts.push(src);
      }
    });

    return result;
  });

  // 打印分析结果
  log(`URL: ${analysis.url.substring(0, 100)}`);
  log(`Body: ${analysis.bodyText.substring(0, 200)}`);
  
  log(`\n=== Iframes (${analysis.iframes.length}) ===`);
  analysis.iframes.forEach(f => {
    log(`  ${f.visible ? '👁' : '🙈'} [${f.rect.w}x${f.rect.h}] @(${f.rect.x},${f.rect.y}) src="${f.src.substring(0,100)}"`);
  });

  log(`\n=== Turnstile 容器 (${analysis.turnstileContainers.length}) ===`);
  analysis.turnstileContainers.forEach(t => {
    log(`  ${t.visible ? '👁' : '🙈'} ${t.tag}.${t.className} [${t.rect.w}x${t.rect.h}] @(${t.rect.x},${t.rect.y}) shadow=${t.hasShadow} data=${t.dataset}`);
  });

  log(`\n=== CF 相关元素 (${analysis.cloudflareElements.length}) ===`);
  analysis.cloudflareElements.slice(0, 10).forEach(c => {
    log(`  ${c.tag}#${c.id}.${c.className} [${c.rect.w}x${c.rect.h}] @(${c.rect.x},${c.rect.y}) "${c.text}"`);
  });

  log(`\n=== Shadow DOM (${analysis.shadowElements.length}) ===`);
  analysis.shadowElements.forEach(s => {
    log(`  Shadow in ${s.parent}: ${s.children.length} children`);
    s.children.slice(0, 10).forEach(c => {
      log(`    ${c.tag}#${c.id}.${c.className} [${c.rect.w}x${c.rect.h}] @(${c.rect.x},${c.rect.y})`);
    });
  });

  log(`\n=== 按钮 (${analysis.allButtons.length}) ===`);
  analysis.allButtons.forEach(b => {
    log(`  ${b.tag} "${b.text}" @(${b.rect.x},${b.rect.y})`);
  });

  log(`\n=== CF Scripts ===`);
  analysis.scripts.forEach(s => log(`  ${s}`));

  return analysis;
}

// ========== 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('Turnstile 破解 v5.0 — 真人行为模拟 + 左偏点击');
  log('='.repeat(60));

  const { chromium } = await import('playwright');

  // 启动浏览器
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  // ★ 注入 Turnstile 反检测补丁
  await context.addInitScript({ content: ENHANCED_PATCH });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  // ===== 阶段1: 获取 magic link =====
  log('\n[阶段1] 发送 magic link...');
  
  // 先打开一个空白页模拟自然行为
  await page.goto('about:blank');
  await sleep(500);
  
  // 导航到 signup
  try {
    await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    log(`导航超时: ${e.message}`);
  }
  await sleep(randBetween(2000, 4000)); // 等待页面稳定
  await page.screenshot({ path: join(LOG_DIR, '01_signup.png') });

  // 点击 Email 按钮
  const clicked = await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button, a, [role="button"]')) {
      const t = (btn.textContent || '').trim().toLowerCase();
      if ((t.includes('email') && t.includes('sign')) || t.includes('email me')) {
        if (btn.offsetParent !== null) { btn.click(); return 'clicked'; }
      }
    }
    return 'not found';
  });
  log(`Email按钮: ${clicked}`);
  await sleep(randBetween(1500, 2500));

  // 填写邮箱
  await page.evaluate((email) => {
    const inp = document.querySelector('input[type="email"]') || document.querySelector('input#email') || document.querySelector('input[name*="email"]');
    if (inp) {
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, email);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, EMAIL);
  await sleep(randBetween(300, 600));
  await page.screenshot({ path: join(LOG_DIR, '02_email_filled.png') });

  // 点击 Continue
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (/continue/i.test(btn.textContent?.trim() || '')) { btn.click(); return; }
    }
  });
  await sleep(randBetween(2000, 3500));
  await page.screenshot({ path: join(LOG_DIR, '03_sent.png') });
  
  const sendTime = new Date(Date.now() - 5000);
  log(`发送时间: ${sendTime.toISOString()}`);

  // 轮询 magic link
  log('轮询收件箱...');
  let rt = REFRESH_TOKEN;
  let magicLink = null;
  const signupUrl = page.url();
  
  for (let i = 0; i < 60; i++) {
    try {
      const { accessToken, newRefreshToken } = await getMailToken(CLIENT_ID, rt);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, sendTime);
      if (link) { magicLink = link; break; }
    } catch (e) {}
    if (i % 10 === 0) process.stdout.write(`\n  `);
    process.stdout.write('.');
    await sleep(3000);
  }
  
  if (!magicLink) {
    log('\n❌ 未收到 magic link');
    await browser.close();
    return;
  }
  
  log(`\n✅ magic link: ${magicLink.substring(0, 80)}...`);
  
  // 更新 refresh token
  if (rt !== REFRESH_TOKEN) {
    writeFileSync(EMAIL_FILE, [EMAIL, PASSWORD, CLIENT_ID, rt].join('----'), 'utf-8');
  }

  // ===== 阶段2: 打开 magic link + 等待 Turnstile 加载 =====
  log('\n[阶段2] 打开 magic link，等待 Turnstile 加载...');

  // 首次导航
  try {
    await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log(`导航超时: ${e.message}`);
  }

  // ★ 洞察1：给 Turnstile 足够的时间加载（8-15秒）
  log('等待 Turnstile 加载（10秒）...');
  await sleep(randBetween(8000, 12000));
  await page.screenshot({ path: join(LOG_DIR, '10_after_load.png') });

  // ===== 主循环：反复尝试 =====
  let solved = false;
  let attempt = 0;
  let linkExpired = false;

  while (!solved && attempt < 60) {
    attempt++;
    log(`\n${'='.repeat(40)}`);
    log(`尝试 ${attempt}/60`);

    // 检查当前 URL 和状态
    const currentUrl = page.url();
    const hostname = (() => { try { return new URL(currentUrl).hostname; } catch(e) { return ''; } })();
    const isSubdomain = hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer';

    if (isSubdomain) {
      log('🎉 已进入 ZO 子域名，注册成功！');
      solved = true;
      break;
    }

    // 进行 DOM 分析
    const analysis = await analyzePageDOM(page);
    await page.screenshot({ path: join(LOG_DIR, `attempt_${String(attempt).padStart(2,'0')}.png`) });

    // 检查是否有 Turnstile widget
    const visibleContainers = analysis.turnstileContainers.filter(t => t.visible);
    const visibleCfIframes = analysis.iframes.filter(f =>
      f.visible && (f.src.includes('challenges.cloudflare') || f.src.includes('turnstile'))
    );

    log(`可见 Turnstile 容器: ${visibleContainers.length}, 可见 CF iframe: ${visibleCfIframes.length}`);

    if (visibleContainers.length > 0 || visibleCfIframes.length > 0) {
      // ★ 找到 Turnstile，开始真人行为模拟 + 点击
      
      // 确定 Turnstile widget 的位置
      let turnstileBox = null;
      
      if (visibleCfIframes.length > 0) {
        const cf = visibleCfIframes[0];
        turnstileBox = { x: cf.rect.x, y: cf.rect.y, w: cf.rect.w, h: cf.rect.h };
        log(`使用 CF iframe 坐标`);
      } else if (visibleContainers.length > 0) {
        const tc = visibleContainers[0];
        turnstileBox = { x: tc.rect.x, y: tc.rect.y, w: tc.rect.w, h: tc.rect.h };
        log(`使用 Turnstile 容器坐标`);
      }

      if (turnstileBox) {
        // ★ 洞察2：先模拟真人浏览行为
        await simulateHumanBehavior(page);

        // ★ 洞察3（隐含）：不点任何按钮，直接找 Turnstile checkbox 点
        await clickTurnstileCheckbox(page, turnstileBox);

        // ★ 洞察1：点击后等待验证完成（不能立即再次操作）
        log('等待验证结果（最多60秒）...');
        for (let w = 0; w < 30; w++) {
          await sleep(2000);

          const checkUrl = page.url();
          const chostname = (() => { try { return new URL(checkUrl).hostname; } catch(e) { return ''; } })();
          const cIsSub = chostname.endsWith('.zo.computer') && chostname !== 'www.zo.computer';

          if (cIsSub) {
            log('🎉 验证通过！已跳转到 ZO 子域名');
            solved = true;
            break;
          }

          const checkText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
          if (/choose your handle|set up your profile|display name|welcome|dashboard/i.test(checkText)) {
            log('🎉 验证通过！进入注册流程');
            solved = true;
            break;
          }

          // 检查 token
          const hasToken = await page.evaluate(() => {
            const inp = document.querySelector('[name="cf-turnstile-response"]');
            return !!(inp && inp.value && inp.value.length > 20);
          });
          if (hasToken) {
            log('✅ 检测到 turnstile token');
            solved = true;
            break;
          }

          // 检查是否过期
          if (/invalid|expired/i.test(checkText) && !/redirecting/i.test(checkText)) {
            log('⚠ Link expired');
            linkExpired = true;
            break;
          }

          // 检查 Turnstile 是否还在
          const tsStill = await page.evaluate(() => {
            const iframes = document.querySelectorAll('iframe');
            for (const f of iframes) {
              if (f.src.includes('challenges.cloudflare') && f.getBoundingClientRect().width > 0) return true;
            }
            return false;
          });

          if (w % 3 === 0) {
            log(`  ${w * 2}s: ${tsStill ? 'Turnstile还在' : 'Turnstile已消失'} URL=${checkUrl.substring(0,60)}`);
          }

          if (!tsStill) {
            log('Turnstile 已消失，验证可能完成或失败');
            // 等一下看是否跳转
            await sleep(3000);
            const finalUrl = page.url();
            const finalHost = (() => { try { return new URL(finalUrl).hostname; } catch(e) { return ''; } })();
            if (finalHost.endsWith('.zo.computer') && finalHost !== 'www.zo.computer') {
              log('🎉 跳转到子域名！');
              solved = true;
              break;
            }
            // Turnstile 消失了但没跳转，可能是需要重新验证
            break;
          }
        }

        if (solved) break;
      }
    } else {
      // 没有找到 Turnstile
      log('⚠ 当前页面没有可见的 Turnstile 元素');
      
      // 检查页面文本
      const text = analysis.bodyText;
      log(`页面文本: ${text.substring(0, 200)}`);

      if (/dashboard|welcome|choose your handle|set up your profile/i.test(text)) {
        log('🎉 已进入注册流程，无需 Turnstile！');
        solved = true;
        break;
      }

      if (/invalid|expired/i.test(text)) {
        linkExpired = true;
      }

      // 等待一下，可能 Turnstile 还在加载
      log(`等待 3 秒后重新分析...`);
      await sleep(3000);
    }

    // ★ 处理过期：刷新页面重新获取 Turnstile
    if (linkExpired) {
      log('刷新页面重新获取 Turnstile...');
      linkExpired = false;
      
      try {
        // 方法1：刷新当前页面
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        log(`刷新失败: ${e.message}`);
        // 方法2：导航到原始链接
        try {
          await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e2) {
          log(`导航也失败: ${e2.message}`);
        }
      }
      
      // ★ 耐心等待 Turnstile 加载
      await sleep(randBetween(8000, 12000));
      continue;
    }

    // 等待后重试
    await sleep(randBetween(2000, 4000));
  }

  if (!solved) {
    log(`\n❌ 60次尝试后仍未破解 Turnstile`);
  }

  // 最终状态
  const finalUrl = page.url();
  const finalText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  log(`\n最终 URL: ${finalUrl}`);
  log(`最终页面: ${finalText.substring(0, 300)}`);
  await page.screenshot({ path: join(LOG_DIR, 'FINAL.png') });

  log('\n保持浏览器 60 秒...');
  await sleep(60000);
  await browser.close();
  log('脚本结束');
}

main().catch(e => {
  log(`致命错误: ${e.message}\n${e.stack}`);
  process.exit(1);
});
