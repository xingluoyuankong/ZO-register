/**
 * Turnstile 破解 v6.0 — CDP穿透Shadow DOM + 真人模拟 + 左偏点击
 *
 * 关键发现：Turnstile widget 在 Shadow DOM 内！
 * 路径：div::shadowRoot > iframe (challenges.cloudflare.com)
 * 常规 querySelector 找不到 → 必须用 CDP
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'crack_v6');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'log.txt'), m + '\n'); };
const rand = (a, b) => a + Math.random() * (b - a);

const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());

// ========== Graph API ==========
async function getMagicLink() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1440,900'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  const p = await ctx.newPage();

  try {
    await p.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {}
  await sleep(3000);

  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('button, a')) {
      if (/email/i.test(btn.textContent || '') && btn.offsetParent) { btn.click(); return; }
    }
  });
  await sleep(2000);

  await p.evaluate((email) => {
    const inp = document.querySelector('input[type=email]') || document.querySelector('input');
    if (inp) {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(inp, email);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, EMAIL);
  await sleep(500);

  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (/continue/i.test(btn.textContent || '')) { btn.click(); return; }
    }
  });
  await sleep(3000);

  const sendTime = new Date(Date.now() - 3000);
  let link = null;
  let rt = REFRESH_TOKEN;

  for (let i = 0; i < 30; i++) {
    try {
      const body = new URLSearchParams({
        client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: rt,
        scope: 'https://graph.microsoft.com/.default offline_access'
      });
      const tr = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
      });
      const td = await tr.json();
      if (td.error) { await sleep(3000); continue; }
      rt = td.refresh_token || rt;
      const mr = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc', {
        headers: { Authorization: 'Bearer ' + td.access_token }
      });
      const md = await mr.json();
      for (const msg of (md.value || [])) {
        if (new Date(msg.receivedDateTime) < sendTime) continue;
        const c = (msg.subject || '') + ' ' + (msg.body?.content || '');
        if (!/zo/i.test(c)) continue;
        const links = c.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
        for (let l of links) {
          l = l.replace(/[)\]>,;!?\s]+$/, '').replace(/&amp;/g, '&');
          if (/token=|verify|login/i.test(l)) { link = l; break; }
        }
        if (link) break;
      }
    } catch (e) {}
    if (link) break;
    process.stdout.write('.');
    await sleep(3000);
  }

  await p.close();
  await ctx.close();
  await browser.close();

  if (!link) throw new Error('No magic link');
  if (rt !== REFRESH_TOKEN) {
    writeFileSync(EMAIL_FILE, [EMAIL, PASSWORD, CLIENT_ID, rt].join('----'), 'utf-8');
  }
  return link;
}

// ========== ★ 通过 page.evaluate 穿透 Shadow DOM 获取 Turnstile widget 位置 ==========
async function findTurnstileWidget(page) {
  return await page.evaluate(() => {
    const results = [];

    // 方法1: 从 cf-chl-widget hidden input 出发，向上查找带 shadowRoot 的祖先
    const cfInput = document.querySelector('[id*="cf-chl-widget"][id$="_response"]') 
                 || document.querySelector('[name="cf-turnstile-response"]');
    
    if (cfInput) {
      // 向上遍历所有祖先，找带 shadowRoot 的
      let el = cfInput.parentElement;
      while (el) {
        if (el.shadowRoot) {
          // 在 shadowRoot 中查找 iframe
          const iframe = el.shadowRoot.querySelector('iframe');
          if (iframe) {
            const rect = iframe.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const src = (iframe.src || '').toLowerCase();
              if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
                results.push({
                  method: 'cf-input-ancestor',
                  x: rect.x, y: rect.y, w: rect.width, h: rect.height,
                  src: src.substring(0, 100),
                });
                break;
              }
            }
          }
        }
        el = el.parentElement;
      }
    }

    // 方法2: 遍历主 DOM 中所有元素的 shadowRoot
    function scanAllShadowRoots() {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) {
          const iframe = node.shadowRoot.querySelector('iframe');
          if (iframe) {
            const rect = iframe.getBoundingClientRect();
            const src = (iframe.src || '').toLowerCase();
            if (rect.width > 0 && rect.height > 0 && (src.includes('challenges.cloudflare') || src.includes('turnstile'))) {
              results.push({
                method: 'treewalker',
                x: rect.x, y: rect.y, w: rect.width, h: rect.height,
                src: src.substring(0, 100),
              });
              return;
            }
          }
          
          // 也检查 .cf-turnstile widget
          const widget = node.shadowRoot.querySelector('.cf-turnstile, [data-sitekey]');
          if (widget) {
            const rect = widget.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({
                method: 'treewalker-container',
                x: rect.x, y: rect.y, w: rect.width, h: rect.height,
              });
              return;
            }
          }
        }
      }
    }
    scanAllShadowRoots();

    // 方法3: 直接遍历所有 iframe（普通DOM树，不包括shadow）
    document.querySelectorAll('iframe').forEach(iframe => {
      const src = (iframe.src || '').toLowerCase();
      if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
        const rect = iframe.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push({
            method: 'direct',
            x: rect.x, y: rect.y, w: rect.width, h: rect.height,
            src: src.substring(0, 100),
          });
        }
      }
    });

    return results;
  });
}

// ========== ★ 模拟真人点击 ==========
async function humanClick(page, targetX, targetY) {
  log(`  模拟真人点击 (${Math.round(targetX)}, ${Math.round(targetY)})`);

  // 起始位置：远离目标
  const startX = targetX + rand(100, 250) * (Math.random() > 0.5 ? 1 : -1);
  const startY = targetY + rand(50, 150) * (Math.random() > 0.5 ? 1 : -1);

  // 阶段1：移动到目标附近（较快）
  const steps1 = Math.floor(rand(5, 8));
  for (let s = 1; s <= steps1; s++) {
    const p = s / steps1;
    const mx = startX + (targetX - startX) * p + Math.sin(p * Math.PI * 1.5) * rand(-8, 8);
    const my = startY + (targetY - startY) * p + Math.cos(p * Math.PI) * rand(-6, 6);
    await page.mouse.move(mx, my);
    await sleep(rand(25, 55));
  }

  // 阶段2：在目标附近微调（较慢，犹豫感）
  await sleep(rand(150, 400));
  for (let s = 0; s < 3; s++) {
    await page.mouse.move(targetX + rand(-4, 4), targetY + rand(-3, 3));
    await sleep(rand(50, 120));
  }

  // 阶段3：点击
  await page.mouse.move(targetX, targetY);
  await sleep(rand(60, 150));
  await page.mouse.down();
  await sleep(rand(40, 90));
  await page.mouse.up();

  log(`  ✅ 点击完成`);
}

// ========== ★ 主流程 ==========
async function main() {
  log('='.repeat(60));
  log('Turnstile 破解 v6.0 — CDP Shadow DOM + 真人模拟');
  log('='.repeat(60));

  // 1. 获取 magic link
  log('\n获取 magic link...');
  const magicLink = await getMagicLink();
  log(`✅ link: ${magicLink.substring(0, 80)}...`);

  // 2. 启动浏览器
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1440,900'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  // 3. 打开链接 + 等待 Turnstile 加载
  log('\n打开 magic link，等待 Turnstile 加载...');
  try {
    await page.goto(magicLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) { log(`导航: ${e.message}`); }

  // ★ 洞察1：耐心等待 Turnstile 充分加载
  log('等待 Turnstile 加载（12秒）...');
  await sleep(12000);
  await page.screenshot({ path: join(LOG_DIR, '01_loaded.png') });

  // ===== 主循环 =====
  let solved = false;
  let attempt = 0;

  while (!solved && attempt < 60) {
    attempt++;
    log(`\n=== 尝试 ${attempt} ===`);

    const url = page.url();
    const hostname = (() => { try { return new URL(url).hostname; } catch(e) { return ''; } })();
    if (hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer') {
      log('🎉 已在 ZO 子域名！'); solved = true; break;
    }

    // ★ 穿透 Shadow DOM 获取 Turnstile widget 位置
    const widgets = await findTurnstileWidget(page);
    log(`找到 ${widgets.length} 个 Turnstile widget`);

    if (widgets.length > 0) {
      const widget = widgets[0];
      log(`  widget: (${Math.round(widget.x)},${Math.round(widget.y)}) ${Math.round(widget.w)}x${Math.round(widget.h)}`);

      // ★ checkbox 在 widget 左侧约 28px，垂直居中
      const checkboxPos = {
        x: widget.x + 28,
        y: widget.y + widget.h / 2,
      };

      // 截图（调试用）
      await page.screenshot({ path: join(LOG_DIR, `${String(attempt).padStart(2,'0')}_before.png`) });

      // ★ 洞察2：先模拟真人浏览行为
      log('模拟真人行为...');
      // 随机移动鼠标到页面各处
      for (let i = 0; i < 4; i++) {
        await page.mouse.move(rand(200, 800), rand(100, 600), { steps: Math.floor(rand(4, 8)) });
        await sleep(rand(200, 600));
      }
      // 小幅度滚动
      await page.mouse.wheel(0, rand(50, 150));
      await sleep(rand(400, 800));
      await page.mouse.wheel(0, rand(-30, -60));
      await sleep(rand(300, 600));

      // ★ 点击 checkbox
      await humanClick(page, checkboxPos.x, checkboxPos.y);

      // ★ 等待验证结果
      log('等待验证...');
      for (let w = 0; w < 30; w++) {
        await sleep(2000);

        const curUrl = page.url();
        const chost = (() => { try { return new URL(curUrl).hostname; } catch(e) { return ''; } })();
        const isSubdomain = chost.endsWith('.zo.computer') && chost !== 'www.zo.computer';

        if (isSubdomain) {
          log('🎉 跳转到子域名！'); solved = true; break;
        }

        const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
        if (/choose your handle|set up your profile|welcome|dashboard/i.test(text)) {
          log('🎉 进入注册流程！'); solved = true; break;
        }

        // 检查 token
        const hasToken = await page.evaluate(() => {
          const inp = document.querySelector('[name="cf-turnstile-response"]');
          return !!(inp && inp.value && inp.value.length > 20);
        });
        if (hasToken) {
          log('✅ Token 已生成！'); solved = true; break;
        }

        // 过期处理
        if (/invalid|expired/i.test(text) && !/redirecting/i.test(text)) {
          log('⚠ Link expired，刷新...');
          try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
          await sleep(12000);
          break;
        }

        if (w % 5 === 0) log(`  ${w * 2}s... URL=${curUrl.substring(0,60)}`);
      }

      await page.screenshot({ path: join(LOG_DIR, `${String(attempt).padStart(2,'0')}_after.png`) });
      if (solved) break;
    } else {
      log('⚠ 未找到 Turnstile widget');
      // 检查页面文本
      const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
      log(`页面: ${text.substring(0, 150)}`);

      if (/choose your handle|set up your profile|welcome|dashboard/i.test(text)) {
        log('🎉 已进入注册！'); solved = true; break;
      }
      if (/invalid|expired/i.test(text) && !/redirecting/i.test(text)) {
        log('刷新...');
        try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
        await sleep(12000);
        continue;
      }
      await sleep(3000);
    }
  }

  if (!solved) log(`\n❌ 未破解`);
  else log(`\n🎉 成功！`);

  const finalUrl = page.url();
  log(`最终 URL: ${finalUrl.substring(0, 100)}`);
  await page.screenshot({ path: join(LOG_DIR, 'FINAL.png') });

  log('保持浏览器30秒...');
  await sleep(30000);
  await browser.close();
  log('完成');
}

main().catch(e => { log(`错误: ${e.message}\n${e.stack}`); process.exit(1); });
