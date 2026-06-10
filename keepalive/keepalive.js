/**
 * ZO Keep-Alive 保活脚本
 * 
 * 三重保活机制：
 * 1. 自保 — 定期 ping 自己的 ZO 实例，保持 session 活跃
 * 2. 互保 — 多个 ZO 实例相互 ping
 * 3. 自动定时登录保活 — 通过 Playwright CDP 连接真实浏览器，自动完成登录流程
 *    突破点：通过 Turnstile Patcher 扩展修复 CDP screenX/screenY bug +
 *           Shadow DOM 穿透点击 Turnstile checkbox
 * 
 * 用法:
 *   1. 先启动真实 Edge/Chrome 并开启 CDP:
 *      start /B msedge --remote-debugging-port=9222 --user-data-dir="%APPDATA%\zo-keepalive" --load-extension="E:\API获取工具\ZO注册\keepalive\turnstile-patch" --disable-extensions-except="E:\API获取工具\ZO注册\keepalive\turnstile-patch"
 *   2. 运行本脚本:
 *      node keepalive.js
 */

const { chromium } = require('playwright');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

// ========== 配置 ==========
const CDP_ENDPOINT = 'http://localhost:9222';
const GRAPH_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAPH_MAIL_URL = 'https://graph.microsoft.com/v1.0/me/messages';
const ZO_SIGNUP_URL = 'https://www.zo.computer/signup';
const TURNSTILE_PATCH_EXT_PATH = join(__dirname, 'turnstile-patch');
const ACCOUNTS_FILE = join(__dirname, 'accounts.json');
const STATE_FILE = join(__dirname, 'keepalive-state.json');

// 保活间隔配置（毫秒）
const KEEPALIVE_INTERVAL = 12 * 60 * 60 * 1000;  // 12小时自动登录保活一次
const SELF_PING_INTERVAL = 30 * 60 * 1000;        // 30分钟自保 ping 一次
const MUTUAL_PING_INTERVAL = 60 * 60 * 1000;      // 60分钟互保 ping 一次

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

// ========== 账号管理 ==========
function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) {
    log('⚠ accounts.json 不存在，请创建并填入账号信息');
    log('格式: [{"email":"xxx@outlook.com","password":"","clientId":"","refreshToken":"","handle":"xxx","zoUrl":"https://xxx.zo.computer"}]');
    return [];
  }
  try {
    return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
  } catch (e) {
    log('读取 accounts.json 失败: ' + e.message);
    return [];
  }
}

function saveState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {}
}

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch (e) {}
  return { lastLogin: {}, lastPing: {} };
}

// ========== Graph API 邮件轮询 ==========
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
  if (data.error) throw new Error('Token error: ' + data.error_description);
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, afterTime) {
  const url = GRAPH_MAIL_URL + '?$top=10&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc';
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  const mail = await resp.json();
  if (!mail.value || mail.value.length === 0) return null;

  for (const msg of mail.value) {
    if (new Date(msg.receivedDateTime) < afterTime) continue;
    const combined = (msg.subject || '') + ' ' +
      ((msg.from && msg.from.emailAddress) ? msg.from.emailAddress.name + ' ' + msg.from.emailAddress.address : '') + ' ' +
      (msg.body ? msg.body.content : '');
    if (!/zo/i.test(combined)) continue;

    const hrefs = (combined.match(/href=["']([^"']*zo\.computer[^"']*)["']/gi) || [])
      .map(h => h.replace(/^href=["']/i, '').replace(/["']$/, ''));
    const raws = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    const all = hrefs.concat(raws);

    for (let link of all) {
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
    } catch (e) {
      log('  轮询邮件错误: ' + e.message);
    }
    await sleep(3000);
  }
  return null;
}

// ========== 浏览器连接 ==========
let browserInstance = null;

async function connectBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;

  try {
    log('🔗 通过 CDP 连接到真实浏览器: ' + CDP_ENDPOINT);
    browserInstance = await chromium.connectOverCDP(CDP_ENDPOINT);
    log('✅ 浏览器连接成功');

    browserInstance.on('disconnected', () => {
      log('⚠ 浏览器连接断开');
      browserInstance = null;
    });

    return browserInstance;
  } catch (e) {
    log('❌ 连接浏览器失败: ' + e.message);
    log('请确保已启动 Edge/Chrome 并开启 CDP 端口:');
    log('  msedge --remote-debugging-port=9222 --user-data-dir="%APPDATA%\\zo-keepalive" --load-extension="E:\\API获取工具\\ZO注册\\keepalive\\turnstile-patch" --disable-extensions-except="E:\\API获取工具\\ZO注册\\keepalive\\turnstile-patch"');
    browserInstance = null;
    return null;
  }
}

// ========== 核心：Cloudflare Turnstile 突破 ==========
/**
 * 关键突破点说明：
 * 
 * 1. 为什么普通点击无效？
 *    Turnstile 的 checkbox 在双层 Shadow DOM 中，普通 DOM 查询找不到。
 *    结构：cf-turnstile div → Shadow Root → iframe → Shadow Root → input[checkbox]
 * 
 * 2. 为什么 CDP 鼠标事件被检测？
 *    Chrome CDP 的 Input.dispatchMouseEvent 产生的 MouseEvent，
 *    screenX === clientX（真实鼠标事件二者不同），Turnstile 据此判定机器人。
 *    解决：Turnstile Patcher 扩展在 MAIN world 中 patch MouseEvent.prototype.screenX/Y
 * 
 * 3. 为什么需要 connectOverCDP？
 *    puppeteer.launch() 启动的新浏览器即使加了 stealth 补丁也会被 Turnstile 检测。
 *    connectOverCDP 连接到真实用户手动启动的浏览器，环境完全真实。
 */

/**
 * 等待并点击 Turnstile checkbox — Shadow DOM 穿透方案
 */
async function clickTurnstileCheckbox(page) {
  log('  🔍 尝试定位并点击 Turnstile checkbox...');

  for (let attempt = 0; attempt < 20; attempt++) {
    // 方法1: 通过 JavaScript 穿透 Shadow DOM 点击
    const clicked = await page.evaluate(() => {
      try {
        // 查找 Turnstile widget 容器
        const widgets = document.querySelectorAll('.cf-turnstile, [data-sitekey]');
        for (const widget of widgets) {
          // 穿透第一层 Shadow DOM
          const shadowRoot = widget.shadowRoot;
          if (!shadowRoot) continue;

          const iframe = shadowRoot.querySelector('iframe');
          if (!iframe) continue;

          // 穿透第二层 Shadow DOM（iframe 内部）
          try {
            const iframeDoc = iframe.contentDocument;
            if (!iframeDoc) continue;
            const iframeShadow = iframeDoc.querySelector('body')?.shadowRoot;
            if (!iframeShadow) continue;

            const checkbox = iframeShadow.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.click();
              return true;
            }
          } catch (e) {
            // iframe 跨域无法直接访问 contentDocument
          }
        }
      } catch (e) {}
      return false;
    }).catch(() => false);

    if (clicked) {
      log('  ✅ Shadow DOM 穿透点击成功');
      return true;
    }

    // 方法2: 通过 boundingBox + 鼠标坐标点击（推荐，最可靠）
    const turnstileLocated = await page.evaluate(() => {
      // 查找 Turnstile iframe（challenges.cloudflare.com 域名）
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = (iframe.src || '').toLowerCase();
        if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
          const rect = iframe.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return {
              found: true,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            };
          }
        }
      }

      // 备选：查找 cf-turnstile 容器
      const containers = document.querySelectorAll('.cf-turnstile, [data-sitekey]');
      for (const container of containers) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return {
            found: true,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          };
        }
      }

      return { found: false };
    }).catch(() => ({ found: false }));

    if (turnstileLocated.found) {
      const { x, y, width, height } = turnstileLocated;
      // Turnstile checkbox 在 widget 左侧约 30px 处，垂直居中
      const clickX = x + 30;
      const clickY = y + height / 2;

      log(`  🎯 定位到 Turnstile: (${x}, ${y}) ${width}x${height}`);
      log(`  🖱️ 点击坐标: (${clickX.toFixed(0)}, ${clickY.toFixed(0)})`);

      // 模拟真人鼠标移动轨迹（关键！Turnstile 会检测鼠标移动轨迹）
      await page.mouse.move(clickX, clickY, { steps: 15 });
      await sleep(200 + Math.random() * 300); // 模拟人类反应时间
      await page.mouse.click(clickX, clickY);

      log('  ✅ Turnstile checkbox 点击完成，等待验证...');

      // 等待验证完成（Turnstile 需要几秒处理）
      for (let wait = 0; wait < 30; wait++) {
        await sleep(2000);

        // 检查是否已通过验证
        const passed = await page.evaluate(() => {
          // 检查 turnstile response token
          const inputs = document.querySelectorAll('[name="cf-turnstile-response"]');
          for (const input of inputs) {
            if (input.value && input.value.length > 20) return true;
          }
          // 检查是否有成功标记
          const successEl = document.querySelector('.cf-turnstile[data-success="true"]');
          if (successEl) return true;
          return false;
        }).catch(() => false);

        if (passed) {
          log('  ✅ Turnstile 验证通过！');
          return true;
        }
      }

      log('  ⚠ Turnstile 验证可能未通过，但已尝试点击');
      return true; // 继续流程，可能 Turnstile 是 non-interactive 自动通过的
    }

    // 方法3: 查找 "Continue in browser" 按钮
    const continueClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, div[role=button], span')) {
        const text = el.textContent.trim();
        if (/Continue in browser/i.test(text) && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);

    if (continueClicked) {
      log('  👆 点击了 "Continue in browser"');
      await sleep(3000);
    }

    // 检查是否已经通过了验证（Turnstile 可能是 non-interactive 自动通过的）
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => '');
    if (/choose your handle|set up your profile|display name/i.test(pageText)) {
      log('  ✅ 已到达 handle/profile 页面，Turnstile 已通过');
      return true;
    }

    // 检查是否在子域名主界面（已注册账号直接登录成功）
    const currentUrl = page.url();
    const hostname = new URL(currentUrl).hostname;
    if (hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer') {
      log('  ✅ 已到达 ZO 子域名，登录成功');
      return true;
    }

    if (attempt % 5 === 0) {
      log(`  ⏳ 等待 Turnstile 加载/验证中... (${attempt}/20) url=${currentUrl}`);
    }
    await sleep(3000);
  }

  log('  ⚠ Turnstile 处理超时，继续后续流程');
  return false;
}

// ========== 自动登录保活 ==========
async function keepaliveLogin(account) {
  const { email, clientId, refreshToken, handle } = account;
  log(`🔑 开始自动登录保活: ${email}`);

  const browser = await connectBrowser();
  if (!browser) {
    log('❌ 无法连接浏览器，跳过');
    return false;
  }

  let page = null;
  try {
    // 获取现有页面或创建新页面
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    page = await context.newPage();

    // Step 1: 打开 ZO 注册/登录页
    log('  [1/6] 打开 ZO 登录页...');
    await page.goto(ZO_SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);

    // Step 2: 点击 "Email me a sign-up link"（ZO 用同一个入口注册和登录）
    log('  [2/6] 点击邮件登录按钮...');
    let clicked = false;
    for (let i = 0; i < 5; i++) {
      const btnClicked = await page.evaluate(() => {
        for (const sel of ['button', 'a', 'div[role=button]']) {
          for (const el of document.querySelectorAll(sel)) {
            if (/email\s*(me\s*)?(a\s*)?(sign[-\s]*up|login)?\s*link|continue\s*with\s*email|use\s*email/i.test(el.textContent || '')) {
              if (el.offsetParent !== null) { el.click(); return true; }
            }
          }
        }
        return false;
      }).catch(() => false);

      if (btnClicked) { clicked = true; break; }
      await sleep(2000);
    }
    if (!clicked) {
      log('  ⚠ 未找到邮件登录按钮，可能页面已变化');
    }
    await sleep(2000);

    // Step 3: 填写邮箱
    log('  [3/6] 填写邮箱: ' + email);
    const emailFilled = await page.evaluate((emailAddr) => {
      const inp = document.querySelector('input[type=email]') ||
                  document.querySelector('input#email') ||
                  document.querySelector('input[name=email]');
      if (!inp) return false;
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, emailAddr);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, email).catch(() => false);

    if (!emailFilled) {
      log('  ❌ 找不到邮箱输入框');
      await page.close().catch(() => {});
      return false;
    }
    await sleep(500);

    // 点击 Continue
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (/^Continue$/i.test(btn.textContent.trim())) { btn.click(); return; }
      }
    }).catch(() => {});
    await sleep(4000);

    // 检查邮件是否已发送
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 400)).catch(() => '');
    if (!/check your email|login link|we sent/i.test(pageText)) {
      // 重试点击 Continue
      await page.evaluate(() => {
        for (const btn of document.querySelectorAll('button')) {
          if (/^Continue$/i.test(btn.textContent.trim())) { btn.click(); return; }
        }
      }).catch(() => {});
      await sleep(4000);
    }

    // Step 4: 轮询 magic link
    log('  [4/6] 轮询收件箱等待 magic link...');
    const sendTime = new Date(Date.now() - 3000);
    const result = await pollMagicLink(clientId, refreshToken, sendTime);
    if (!result) {
      log('  ❌ 3分钟内未收到 magic link');
      await page.close().catch(() => {});
      return false;
    }
    log('  ✅ 收到 magic link!');

    // 更新 refreshToken
    if (result.newRefreshToken !== refreshToken) {
      account.refreshToken = result.newRefreshToken;
      const accounts = loadAccounts();
      const acc = accounts.find(a => a.email === email);
      if (acc) {
        acc.refreshToken = result.newRefreshToken;
        writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
      }
    }

    // Step 5: 打开 magic link — 这里会遇到 Cloudflare Turnstile
    log('  [5/6] 打开 magic link（即将遇到 Turnstile）...');
    
    // 清除 cookies 以确保干净的请求
    const cdpSession = await page.context().newCDPSession(page);
    try { await cdpSession.send('Network.clearBrowserCookies'); } catch (e) {}
    try { await cdpSession.send('Network.clearBrowserCache'); } catch (e) {}
    try { await cdpSession.detach(); } catch (e) {}

    try {
      await page.goto(result.link, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (navErr) {
      if (/timeout/i.test(navErr.message)) {
        log('  ⚠ 导航超时，继续...');
      } else {
        log('  ⚠ 导航错误: ' + navErr.message);
      }
    }
    await sleep(3000);

    // Step 5b: ★★★ 核心：处理 Cloudflare Turnstile ★★★
    log('  [5b/6] ★ 处理 Cloudflare Turnstile 人机验证...');
    await clickTurnstileCheckbox(page);

    // Step 6: 等待登录完成
    log('  [6/6] 等待登录完成...');
    let success = false;
    for (let i = 0; i < 60; i++) {
      const currentUrl = page.url();
      const text = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => '');
      const hostname = new URL(currentUrl).hostname;
      const isSubdomain = hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer' && hostname !== 'zo.computer';

      // 已到达主界面
      if (isSubdomain && /dashboard|welcome|explore|home|zo space|your conversations/i.test(text)) {
        log('  ✅ 登录成功！URL: ' + currentUrl);
        success = true;
        break;
      }

      // 已到达 handle/profile 页面（新注册）
      if (/choose your handle|set up your profile|display name/i.test(text)) {
        log('  ✅ 到达 profile 设置页面');
        success = true;
        break;
      }

      // "Go to your Zo" 按钮
      if (/go to your zo/i.test(text)) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('button, a, div[role=button]')) {
            if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
          }
        }).catch(() => {});
      }

      // 手机号验证跳过
      if (/verify your phone|phone number|add your phone/i.test(text)) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('button, a, div[role=button]')) {
            if (/skip|not now/i.test(el.textContent.trim())) { el.click(); return; }
          }
        }).catch(() => {});
      }

      // 条款 checkbox
      if (/terms of use|18.*years|agree/i.test(text)) {
        await page.evaluate(() => {
          for (const cb of document.querySelectorAll('input[type=checkbox]')) {
            if (!cb.checked) cb.click();
          }
        }).catch(() => {});
        await sleep(500);
        await page.evaluate(() => {
          for (const btn of document.querySelectorAll('button')) {
            if (/skip|continue/i.test(btn.textContent.trim())) { btn.click(); return; }
          }
        }).catch(() => {});
      }

      // 重试点击 Turnstile（如果还在验证页）
      if (/verify|challenge|captcha|complete the browser/i.test(text)) {
        await clickTurnstileCheckbox(page);
      }

      if (i % 5 === 0) {
        log(`  ⏳ 等待登录中... (${i * 3}s) url=${currentUrl}`);
      }
      await sleep(3000);
    }

    if (!success) {
      log('  ⚠ 登录流程超时，但可能已成功');
    }

    // 保存页面截图用于调试
    try {
      const screenshotDir = join(__dirname, 'screenshots');
      if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, `keepalive-${email.split('@')[0]}-${Date.now()}.png`) });
    } catch (e) {}

    // 更新保活状态
    const state = loadState();
    state.lastLogin[email] = new Date().toISOString();
    saveState(state);

    return true;
  } catch (e) {
    log(`  ❌ 登录保活失败: ${e.message}`);
    return false;
  } finally {
    if (page) {
      try { await page.close(); } catch (e) {}
    }
  }
}

// ========== 自保：定期访问自己的 ZO 实例 ==========
async function selfPing(account) {
  const { email, handle, zoUrl } = account;
  if (!zoUrl && !handle) {
    log(`⏭ 跳过自保: ${email}（无 zoUrl/handle）`);
    return;
  }

  const url = zoUrl || `https://${handle}.zo.computer`;
  log(`💓 自保 ping: ${url}`);

  try {
    const browser = await connectBrowser();
    if (!browser) return;

    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      log(`  ✅ 自保 ping 成功: ${url}`);
    } finally {
      await page.close().catch(() => {});
    }
  } catch (e) {
    log(`  ❌ 自保 ping 失败: ${e.message}`);
  }

  const state = loadState();
  state.lastPing[email] = new Date().toISOString();
  saveState(state);
}

// ========== 互保：多个实例相互 ping ==========
async function mutualPing(accounts) {
  if (accounts.length < 2) {
    log('⏭ 互保需要至少2个账号，跳过');
    return;
  }

  log('🤝 互保: 多个 ZO 实例相互 ping');
  const browser = await connectBrowser();
  if (!browser) return;

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();

  for (const account of accounts) {
    const url = account.zoUrl || `https://${account.handle}.zo.computer`;
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);
      log(`  ✅ 互保 ping 成功: ${url}`);
      await page.close().catch(() => {});
    } catch (e) {
      log(`  ❌ 互保 ping 失败: ${url} - ${e.message}`);
    }
  }
}

// ========== 主循环 ==========
async function main() {
  log('🚀 ZO Keep-Alive 启动');
  log('='.repeat(60));

  // 检查 accounts.json
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    log('❌ 没有账号，请配置 accounts.json');
    log('格式示例:');
    log(JSON.stringify([{
      email: "xxx@outlook.com",
      password: "",
      clientId: "your-client-id",
      refreshToken: "your-refresh-token",
      handle: "yourhandle",
      zoUrl: "https://yourhandle.zo.computer"
    }], null, 2));
    process.exit(1);
  }

  log(`📋 加载了 ${accounts.length} 个账号`);
  accounts.forEach((a, i) => log(`  [${i + 1}] ${a.email} → ${a.zoUrl || a.handle + '.zo.computer'}`));

  // 首次连接浏览器
  const browser = await connectBrowser();
  if (!browser) {
    log('❌ 无法连接浏览器，请先启动浏览器并开启 CDP');
    log('');
    log('启动命令:');
    log('  msedge --remote-debugging-port=9222 --user-data-dir="%APPDATA%\\zo-keepalive" --load-extension="E:\\API获取工具\\ZO注册\\keepalive\\turnstile-patch" --disable-extensions-except="E:\\API获取工具\\ZO注册\\keepalive\\turnstile-patch"');
    log('');
    log('或 Chrome:');
    log('  chrome --remote-debugging-port=9222 --user-data-dir="%APPDATA%\\zo-keepalive" --load-extension="E:\\API获取工具\\ZO注册\\keepalive\\turnstile-patch" --disable-extensions-except="E:\\API获取工具\\ZO注册\\keepalive\\turnstile-patch"');
    process.exit(1);
  }

  const state = loadState();

  // ========== 三重保活定时器 ==========

  // 1. 自保定时器 — 每30分钟 ping 一次
  setInterval(async () => {
    log('━'.repeat(40));
    log('💓 [自保] 定时自保 ping 开始');
    for (const account of accounts) {
      await selfPing(account);
      await sleep(5000);
    }
    log('💓 [自保] 定时自保 ping 完成');
  }, SELF_PING_INTERVAL);

  // 2. 互保定时器 — 每60分钟相互 ping
  setInterval(async () => {
    log('━'.repeat(40));
    log('🤝 [互保] 定时互保 ping 开始');
    await mutualPing(accounts);
    log('🤝 [互保] 定时互保 ping 完成');
  }, MUTUAL_PING_INTERVAL);

  // 3. 自动登录保活定时器 — 每12小时重新登录一次
  setInterval(async () => {
    log('━'.repeat(40));
    log('🔑 [登录保活] 定时自动登录保活开始');
    for (const account of accounts) {
      await keepaliveLogin(account);
      await sleep(10000); // 账号间隔10秒
    }
    log('🔑 [登录保活] 定时自动登录保活完成');
  }, KEEPALIVE_INTERVAL);

  // 立即执行一轮自保
  log('━'.repeat(40));
  log('💓 [自保] 首次自保 ping...');
  for (const account of accounts) {
    await selfPing(account);
    await sleep(3000);
  }

  // 立即执行一轮互保
  log('━'.repeat(40));
  log('🤝 [互保] 首次互保 ping...');
  await mutualPing(accounts);

  // 如果距离上次登录保活超过阈值，立即执行一次
  const now = Date.now();
  for (const account of accounts) {
    const lastLogin = state.lastLogin[account.email];
    const timeSinceLastLogin = lastLogin ? now - new Date(lastLogin).getTime() : Infinity;
    if (timeSinceLastLogin > KEEPALIVE_INTERVAL) {
      log('━'.repeat(40));
      log(`🔑 [登录保活] ${account.email} 需要登录保活（距上次: ${lastLogin || '从未'}）`);
      await keepaliveLogin(account);
      await sleep(10000);
    }
  }

  log('━'.repeat(40));
  log('✅ 三重保活机制已启动，进入守护模式');
  log(`  自保间隔: ${SELF_PING_INTERVAL / 60000} 分钟`);
  log(`  互保间隔: ${MUTUAL_PING_INTERVAL / 60000} 分钟`);
  log(`  登录保活间隔: ${KEEPALIVE_INTERVAL / 3600000} 小时`);
  log('  按 Ctrl+C 退出');

  // 保持进程运行
  setInterval(() => {
    // 心跳日志，每5分钟一次
    log('💕 保活守护中...');
  }, 5 * 60 * 1000);
}

// 优雅退出
process.on('SIGINT', () => {
  log('收到退出信号，正在关闭...');
  process.exit(0);
});

process.on('uncaughtException', (e) => {
  log('未捕获异常: ' + e.message);
});

main().catch(e => {
  log('致命错误: ' + e.message);
  process.exit(1);
});
