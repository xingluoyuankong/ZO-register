/**
 * ZO Keep-Alive 快速测试脚本
 * 测试 Cloudflare Turnstile 突破方案
 * 
 * 使用方法：
 * 1. 先启动浏览器（带 Turnstile Patcher 扩展）：
 *    start.bat
 *    或手动：
 *    msedge --remote-debugging-port=9222 --user-data-dir="%APPDATA%\zo-keepalive" --load-extension="E:\API获取工具\ZO注册\keepalive\turnstile-patch" --disable-extensions-except="E:\API获取工具\ZO注册\keepalive\turnstile-patch"
 * 
 * 2. 运行此测试：
 *    node test-turnstile.js
 */

const { chromium } = require('playwright');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const CDP_ENDPOINT = 'http://localhost:9222';
const GRAPH_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAPH_MAIL_URL = 'https://graph.microsoft.com/v1.0/me/messages';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ========== Graph API ==========
async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access'
  });
  const resp = await fetch(GRAPH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await resp.json();
  if (data.error) throw new Error('Token: ' + data.error_description);
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, afterTime) {
  const url = GRAPH_MAIL_URL + '?$top=10&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc';
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

async function pollMagicLink(clientId, refreshToken, afterTime) {
  let rt = refreshToken;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime);
      if (link) return { link, newRefreshToken: rt };
    } catch (e) { log('轮询错误: ' + e.message); }
    await sleep(3000);
  }
  return null;
}

// ========== Turnstile 处理 ==========
async function clickTurnstileCheckbox(page) {
  log('🔍 尝试定位并点击 Turnstile checkbox...');

  for (let attempt = 0; attempt < 25; attempt++) {
    // 方法A: 通过 boundingBox + 鼠标坐标点击（最可靠）
    const turnstileInfo = await page.evaluate(() => {
      // 查找 Turnstile iframe
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = (iframe.src || '').toLowerCase();
        if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
          const rect = iframe.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { found: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height, type: 'iframe' };
          }
        }
      }
      // 备选：cf-turnstile 容器
      const containers = document.querySelectorAll('.cf-turnstile, [data-sitekey]');
      for (const c of containers) {
        const rect = c.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { found: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height, type: 'container' };
        }
      }
      return { found: false };
    }).catch(() => ({ found: false }));

    if (turnstileInfo.found) {
      const { x, y, width, height, type } = turnstileInfo;
      // Turnstile checkbox 在 widget 左侧约 30px，垂直居中
      const clickX = x + 30;
      const clickY = y + height / 2;

      log(`🎯 定位到 Turnstile (${type}): (${x}, ${y}) ${width}x${height}`);
      log(`🖱️ 点击坐标: (${clickX.toFixed(0)}, ${clickY.toFixed(0)})`);

      // ★ 关键：模拟真人鼠标移动轨迹 + 自然延迟
      await page.mouse.move(clickX - 50, clickY - 30, { steps: 5 });
      await sleep(100 + Math.random() * 200);
      await page.mouse.move(clickX, clickY, { steps: 10 });
      await sleep(150 + Math.random() * 250);
      await page.mouse.click(clickX, clickY);

      log('✅ Turnstile checkbox 点击完成');

      // 等待验证结果
      for (let wait = 0; wait < 30; wait++) {
        await sleep(2000);
        const checkResult = await page.evaluate(() => {
          // 检查 turnstile response
          const inputs = document.querySelectorAll('[name="cf-turnstile-response"]');
          for (const input of inputs) {
            if (input.value && input.value.length > 20) return 'passed';
          }
          // 检查是否还在验证页
          const text = document.body.innerText.substring(0, 200);
          if (/choose your handle|set up your profile|display name|dashboard|welcome/i.test(text)) return 'navigated';
          return 'pending';
        }).catch(() => 'pending');

        if (checkResult === 'passed' || checkResult === 'navigated') {
          log('✅ Turnstile 验证通过！');
          return true;
        }
        if (wait % 3 === 0) log(`  等待验证结果... (${wait * 2}s)`);
      }
    }

    // 方法B: Shadow DOM 穿透
    const shadowClicked = await page.evaluate(() => {
      try {
        const widgets = document.querySelectorAll('.cf-turnstile, [data-sitekey]');
        for (const widget of widgets) {
          const sr = widget.shadowRoot;
          if (!sr) continue;
          const iframe = sr.querySelector('iframe');
          if (!iframe) continue;
          try {
            const iframeDoc = iframe.contentDocument;
            if (!iframeDoc) continue;
            const body = iframeDoc.querySelector('body');
            if (!body) continue;
            const innerSr = body.shadowRoot;
            if (!innerSr) continue;
            const checkbox = innerSr.querySelector('input[type="checkbox"]');
            if (checkbox) { checkbox.click(); return true; }
          } catch (e) {}
        }
      } catch (e) {}
      return false;
    }).catch(() => false);

    if (shadowClicked) {
      log('✅ Shadow DOM 穿透点击成功');
      await sleep(5000);
    }

    // 点击 "Continue in browser" 按钮
    const continueClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, div[role=button], span')) {
        if (/Continue in browser/i.test(el.textContent.trim()) && el.offsetParent !== null) {
          el.click(); return true;
        }
      }
      return false;
    }).catch(() => false);

    if (continueClicked) {
      log('👆 点击了 "Continue in browser"');
      await sleep(3000);
    }

    // 检查是否已经通过（页面导航走了）
    const currentUrl = page.url();
    const text = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => '');
    const hostname = (() => { try { return new URL(currentUrl).hostname; } catch(e) { return ''; } })();
    const isSubdomain = hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer';

    if (isSubdomain || /choose your handle|set up your profile|display name/i.test(text)) {
      log('✅ 已通过 Turnstile，页面已导航');
      return true;
    }

    if (attempt % 5 === 0) {
      log(`⏳ 等待 Turnstile... (${attempt}/25) url=${currentUrl.substring(0, 80)}`);
    }
    await sleep(3000);
  }

  log('⚠ Turnstile 处理超时');
  return false;
}

// ========== 主测试流程 ==========
async function main() {
  // 加载账号
  const accountsFile = join(__dirname, 'accounts.json');
  if (!existsSync(accountsFile)) {
    log('❌ accounts.json 不存在');
    process.exit(1);
  }
  const accounts = JSON.parse(readFileSync(accountsFile, 'utf-8'));
  if (accounts.length === 0) {
    log('❌ 没有账号');
    process.exit(1);
  }

  const account = accounts[0];
  log(`📝 使用账号: ${account.email}`);

  // 连接浏览器
  log('🔗 连接到 CDP 浏览器...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    log('✅ 浏览器连接成功');
  } catch (e) {
    log('❌ 连接失败: ' + e.message);
    log('请先启动浏览器:');
    log('  msedge --remote-debugging-port=9222 --user-data-dir="%APPDATA%\\zo-keepalive" --load-extension="E:\\API获取工具\\ZO注册\\keepalive\\turnstile-patch" --disable-extensions-except="E:\\API获取工具\\ZO注册\\keepalive\\turnstile-patch"');
    process.exit(1);
  }

  try {
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    const page = await context.newPage();

    // Step 1: 打开 ZO 登录页
    log('[1/6] 打开 ZO 登录页...');
    await page.goto('https://www.zo.computer/signup', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);

    // Step 2: 点击邮件登录按钮
    log('[2/6] 点击邮件登录按钮...');
    for (let i = 0; i < 5; i++) {
      const clicked = await page.evaluate(() => {
        for (const sel of ['button', 'a', 'div[role=button]']) {
          for (const el of document.querySelectorAll(sel)) {
            if (/email\s*(me\s*)?(a\s*)?(sign[-\s]*up|login)?\s*link|continue\s*with\s*email/i.test(el.textContent || '')) {
              if (el.offsetParent !== null) { el.click(); return true; }
            }
          }
        }
        return false;
      }).catch(() => false);
      if (clicked) break;
      await sleep(2000);
    }
    await sleep(2000);

    // Step 3: 填写邮箱
    log('[3/6] 填写邮箱: ' + account.email);
    await page.evaluate((email) => {
      const inp = document.querySelector('input[type=email]') || document.querySelector('input#email');
      if (!inp) return false;
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, email);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, account.email).catch(() => {});
    await sleep(500);

    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (/^Continue$/i.test(btn.textContent.trim())) { btn.click(); return; }
      }
    }).catch(() => {});
    await sleep(4000);

    // Step 4: 轮询 magic link
    log('[4/6] 轮询收件箱...');
    const sendTime = new Date(Date.now() - 3000);
    const result = await pollMagicLink(account.clientId, account.refreshToken, sendTime);
    if (!result) {
      log('❌ 3分钟内未收到 magic link');
      await page.close().catch(() => {});
      process.exit(1);
    }
    log('✅ 收到 magic link!');

    // Step 5: 打开 magic link（Turnstile 在这里出现）
    log('[5/6] 打开 magic link — ★ 即将遇到 Cloudflare Turnstile ★');
    const cdpSession = await page.context().newCDPSession(page);
    try { await cdpSession.send('Network.clearBrowserCookies'); } catch (e) {}
    try { await cdpSession.send('Network.clearBrowserCache'); } catch (e) {}
    try { await cdpSession.detach(); } catch (e) {}

    try {
      await page.goto(result.link, { waitUntil: 'networkidle', timeout: 60000 });
    } catch (navErr) {
      log('⚠ 导航超时，继续: ' + navErr.message);
    }
    await sleep(3000);

    // ★★★ 核心：处理 Turnstile ★★★
    log('[5b/6] ★ 处理 Cloudflare Turnstile 人机验证 ★');
    await clickTurnstileCheckbox(page);

    // Step 6: 等待完成
    log('[6/6] 等待登录完成...');
    for (let i = 0; i < 60; i++) {
      const url = page.url();
      const text = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => '');
      const hostname = (() => { try { return new URL(url).hostname; } catch(e) { return ''; } })();
      const isSubdomain = hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer';

      if (isSubdomain || /dashboard|welcome|choose your handle|set up your profile/i.test(text)) {
        log('🎉 登录保活成功！URL: ' + url);
        break;
      }

      // 处理 onboarding
      if (/go to your zo/i.test(text)) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('button, a, div[role=button]')) {
            if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
          }
        }).catch(() => {});
      }

      if (i % 5 === 0) log(`⏳ 等待中... (${i * 3}s)`);
      await sleep(3000);
    }

    // 截图
    const screenshotDir = join(__dirname, 'screenshots');
    if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, `test-${Date.now()}.png`) });
    log('📸 截图已保存');

    await page.close().catch(() => {});
  } catch (e) {
    log('❌ 测试失败: ' + e.message);
  } finally {
    // 不关闭浏览器（CDP 连接的浏览器由用户手动管理）
    log('测试完成');
  }
}

main().catch(e => {
  log('致命错误: ' + e.message);
  process.exit(1);
});
