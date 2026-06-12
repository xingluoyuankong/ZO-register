/**
 * Turnstile 破解脚本 v4.0
 * 策略：注入反检测补丁 + CDP精准点击checkbox左侧
 * 用户洞察：Turnstile验证框的checkbox在iframe/widget左侧约28px处，点击该位置即可触发验证
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs', 'crack');
const EMAIL_FILE = 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\sanchezquinncu3w1kkhtuc74@outlook.com.txt';
const TURNSTILE_PATCH_FILE = join(__dirname, 'extension', 'turnstile-patch', 'script.js');

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const log = msg => { const m = `[${now()}] ${msg}`; console.log(m); appendFileSync(join(LOG_DIR, 'debug.log'), m + '\n'); };

// 读取 Turnstile Patch
const TURNSTILE_PATCH = readFileSync(TURNSTILE_PATCH_FILE, 'utf-8');

// 读取邮箱信息
const emailContent = readFileSync(EMAIL_FILE, 'utf-8').trim();
const [EMAIL, PASSWORD, CLIENT_ID, REFRESH_TOKEN] = emailContent.split('----').map(s => s.trim());
log(`使用邮箱: ${EMAIL}`);

// ========== 增强版 Turnstile Patch（注入到浏览器上下文级别）==========
const ENHANCED_PATCH = TURNSTILE_PATCH + `
;(function() {
  'use strict';
  if (window.__TURNSTILE_ENHANCED__) return;
  window.__TURNSTILE_ENHANCED__ = true;
  
  // ★ 额外：拦截 canvas fingerprinting
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    // Turnstile 可能用 canvas 做指纹
    try {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        // 添加微量噪声
        const imgData = ctx.getImageData(0, 0, 1, 1);
        imgData.data[3] = Math.max(0, imgData.data[3] - 1);
        ctx.putImageData(imgData, 0, 0);
      }
    } catch(e) {}
    return origToDataURL.apply(this, args);
  };
  
  // ★ 额外：拦截 AudioContext fingerprinting
  if (typeof AudioContext !== 'undefined') {
    const origCreateOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function() {
      const osc = origCreateOscillator.call(this);
      const origStart = osc.start;
      osc.start = function(when) { return origStart.call(this, when || 0); };
      return osc;
    };
  }
  
  // ★ 修复 timezone offset 一致性
  // CDP 浏览器可能返回奇怪的 timezone
  const origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
  const offset = -480; // UTC+8 (Asia/Shanghai)
  Date.prototype.getTimezoneOffset = function() { return offset; };
  
  console.log('[TurnstileEnhanced] canvas/audio/timezone patches applied');
})();
`;

// ========== Graph API 函数 ==========
async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access'
  });
  const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
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

async function pollMagicLink(clientId, refreshToken, afterTime, maxSec = 180) {
  let rt = refreshToken;
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime);
      if (link) return { link, newRefreshToken: rt };
    } catch (e) { log(`轮询错误: ${e.message}`); }
    await sleep(3000);
    process.stdout.write('.');
  }
  return null;
}

// ========== Turnstile DOM 深度分析 ==========
async function analyzeTurnstile(page, cdp) {
  log('=== Turnstile 深度分析 ===');
  
  // 1. 获取页面基本信息
  const pageInfo = await page.evaluate(() => {
    const info = {
      url: location.href,
      title: document.title,
      bodyText: document.body?.innerText?.substring(0, 500) || '(no body)',
    };
    return info;
  });
  log(`URL: ${pageInfo.url}`);
  log(`Title: ${pageInfo.title}`);
  log(`Body: ${pageInfo.bodyText.substring(0, 100)}`);
  
  // 2. 通过 CDP 获取所有 iframe（包括 Shadow DOM 中的）
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  
  // 递归查找所有节点
  function findIframes(node, path = '') {
    const results = [];
    if (!node) return results;
    const currentPath = path ? `${path} > ${node.nodeName || '#' + node.nodeType}` : (node.nodeName || 'root');
    
    if (node.nodeName === 'IFRAME') {
      results.push({ ...node, domPath: currentPath });
    }
    
    if (node.children) {
      for (const child of node.children) {
        results.push(...findIframes(child, currentPath));
      }
    }
    
    // 也检查 Shadow DOM
    if (node.shadowRoots) {
      for (const sr of node.shadowRoots) {
        results.push(...findIframes(sr, currentPath + '::shadow'));
      }
    }
    if (node.contentDocument) {
      results.push(...findIframes(node.contentDocument, currentPath + '::content'));
    }
    
    return results;
  }
  
  const iframes = findIframes(root);
  log(`CDP 发现 ${iframes.length} 个 iframe`);
  
  // 获取每个 iframe 的详细信息
  const iframeDetails = [];
  for (const iframe of iframes) {
    try {
      const nodeId = iframe.nodeId;
      if (!nodeId) continue;
      
      // 获取属性
      const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
      const attrs = {};
      for (let i = 0; i < attributes.length - 1; i += 2) {
        attrs[attributes[i]] = attributes[i + 1];
      }
      
      // 获取 box model
      let box = null;
      try {
        const boxModel = await cdp.send('DOM.getBoxModel', { nodeId });
        if (boxModel?.model) {
          const c = boxModel.model.content;
          box = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] };
        }
      } catch (e) {}
      
      iframeDetails.push({
        src: (attrs.src || '').substring(0, 120),
        name: attrs.name || '',
        id: attrs.id || '',
        domPath: iframe.domPath,
        box,
        contentDocumentNodeId: iframe.contentDocument?.nodeId || null,
      });
    } catch (e) {}
  }
  
  iframeDetails.forEach((f, i) => {
    log(`  Iframe[${i}]: src="${f.src}" box=${JSON.stringify(f.box)} path=${f.domPath}`);
  });
  
  // 3. 查找 Turnstile widget 容器
  const cfContainers = await page.evaluate(() => {
    const containers = [];
    
    // 查找所有 .cf-turnstile 元素
    document.querySelectorAll('.cf-turnstile, [data-sitekey]').forEach(el => {
      const rect = el.getBoundingClientRect();
      containers.push({
        tag: el.tagName,
        id: el.id || '',
        className: el.className || '',
        hasShadow: !!el.shadowRoot,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        visible: rect.width > 0 && rect.height > 0,
        innerHTML: el.innerHTML?.substring(0, 200) || '',
      });
    });
    
    // 检查 window.turnstile
    const tsInfo = {
      hasTurnstile: typeof window.turnstile !== 'undefined',
      turnstileKeys: typeof window.turnstile !== 'undefined' ? Object.keys(window.turnstile).join(',') : 'N/A',
    };
    
    return { containers, tsInfo };
  });
  
  log(`Turnstile 容器: ${cfContainers.containers.length} 个`);
  cfContainers.containers.forEach(c => {
    log(`  容器: ${c.tag}#${c.id} .${c.className} shadow=${c.hasShadow} visible=${c.visible} rect=(${Math.round(c.rect.x)},${Math.round(c.rect.y)}) ${Math.round(c.rect.w)}x${Math.round(c.rect.h)}`);
    log(`  innerHTML: ${c.innerHTML.substring(0, 100)}`);
  });
  log(`window.turnstile: ${cfContainers.tsInfo.hasTurnstile} keys=${cfContainers.tsInfo.turnstileKeys}`);
  
  // 4. 查找所有包含 "verify" / "challenge" / "human" 的文本
  const challengeTexts = await page.evaluate(() => {
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (text && /verify|challenge|human|captcha|checking|cloudflare|turnstile/i.test(text) && text.length < 300) {
        texts.push(text.substring(0, 200));
      }
    }
    return texts;
  });
  log(`页面中的挑战文本: ${challengeTexts.length} 条`);
  challengeTexts.slice(0, 5).forEach(t => log(`  "${t}"`));
  
  // 5. 获取所有 Cloudflare 相关 iframe 的 box
  const cfIframes = iframeDetails.filter(f =>
    f.src.includes('challenges.cloudflare') ||
    f.src.includes('turnstile') ||
    f.src.includes('cf-chl')
  );
  
  return {
    pageInfo,
    iframeDetails,
    cfIframes,
    cfContainers,
    challengeTexts,
  };
}

// ========== Turnstile 点击策略 ==========
async function clickTurnstileCheckbox(page, cdp, analysis) {
  log('=== 尝试点击 Turnstile checkbox ===');
  
  // 策略A: 如果找到了 Cloudflare iframe，直接通过坐标点击
  if (analysis.cfIframes.length > 0) {
    for (const cfIframe of analysis.cfIframes) {
      if (!cfIframe.box || cfIframe.box.w <= 0 || cfIframe.box.h <= 0) {
        log(`  CF iframe 不可见，跳过`);
        continue;
      }
      
      const box = cfIframe.box;
      // ★ 用户洞察：checkbox 在 widget 左侧约28px处，垂直居中
      // Turnstile checkbox widget 典型尺寸: 300x65 (normal) 或 大约 304x78 (expanded)
      // Checkbox 在 widget 左边缘 + 28~30px 处
      const clickX = box.x + 28;
      const clickY = box.y + box.h / 2;
      
      log(`  CF iframe box: (${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.w)}x${Math.round(box.h)}`);
      log(`  目标点击: (${Math.round(clickX)}, ${Math.round(clickY)})`);
      
      // 模拟真人移动 + 点击
      const startX = clickX - 80 + Math.random() * 40;
      const startY = clickY - 30 + Math.random() * 20;
      
      // Step 1: 移动到起始位置
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: startX, y: startY,
      });
      await sleep(50 + Math.random() * 100);
      
      // Step 2: 分几步移动到目标（模拟真人轨迹）
      const steps = 8 + Math.floor(Math.random() * 5);
      for (let s = 1; s <= steps; s++) {
        const progress = s / steps;
        // 添加贝塞尔曲线效果
        const midX = startX + (clickX - startX) * progress + Math.sin(progress * Math.PI) * (Math.random() - 0.5) * 8;
        const midY = startY + (clickY - startY) * progress + Math.sin(progress * Math.PI) * (Math.random() - 0.5) * 6;
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: midX, y: midY,
        });
        await sleep(15 + Math.random() * 25);
      }
      
      // Step 3: 精确移动到目标
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: clickX, y: clickY,
      });
      await sleep(30 + Math.random() * 70);
      
      // Step 4: 按下
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: clickX, y: clickY,
        button: 'left', buttons: 1, clickCount: 1,
      });
      await sleep(30 + Math.random() * 50);
      
      // Step 5: 释放
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: clickX, y: clickY,
        button: 'left', buttons: 0, clickCount: 1,
      });
      
      log(`  ✅ CDP 点击已发送`);
      return true;
    }
  }
  
  // 策略B: 通过 Shadow DOM 穿透点击（在页面 evaluate 中）
  log('  尝试 Shadow DOM 穿透...');
  const shadowResult = await page.evaluate(() => {
    try {
      // 找 .cf-turnstile 容器
      const widgets = document.querySelectorAll('.cf-turnstile, [data-sitekey]');
      for (const widget of widgets) {
        const sr = widget.shadowRoot;
        if (!sr) continue;
        
        const iframe = sr.querySelector('iframe');
        if (!iframe) continue;
        
        // 尝试在 iframe 内找 checkbox
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) continue;
          
          const body = iframeDoc.querySelector('body');
          if (!body) continue;
          
          const innerSr = body.shadowRoot;
          if (!innerSr) continue;
          
          // 找 checkbox
          const checkbox = innerSr.querySelector('input[type="checkbox"]');
          if (checkbox) {
            checkbox.click();
            return { method: 'shadow-dom-checkbox', success: true };
          }
          
          // 找不到 checkbox，点击 body 区域
          const clickTarget = innerSr.querySelector('label, div, [role="checkbox"]');
          if (clickTarget) {
            clickTarget.click();
            return { method: 'shadow-dom-body', success: true };
          }
        } catch (e) {
          // 跨域 iframe，无法访问内容
          return { method: 'shadow-dom-blocked', error: 'cross-origin iframe' };
        }
      }
    } catch (e) {
      return { method: 'shadow-dom-error', error: e.message };
    }
    return { method: 'shadow-dom-not-found' };
  });
  
  log(`  Shadow DOM 结果: ${JSON.stringify(shadowResult)}`);
  
  // 策略C: 直接通过 document.querySelector 找任何可见 iframe 并点击
  if (!shadowResult?.success) {
    log('  尝试通过 page.evaluate 直接点击 iframe...');
    const directResult = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = (iframe.src || '').toLowerCase();
        if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
          const rect = iframe.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // 在 iframe 的 checkbox 位置创建一个点击事件
            iframe.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + 28,
              clientY: rect.top + rect.height / 2,
            }));
            return { method: 'direct-iframe-click', rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
          }
        }
      }
      return { method: 'no-iframe-found' };
    });
    log(`  直接点击结果: ${JSON.stringify(directResult)}`);
  }
  
  return false;
}

// ========== 主流程 ==========
async function main() {
  log('========================================');
  log('Turnstile 破解脚本 v4.0 启动');
  log('========================================');
  
  // 1. 启动浏览器
  log('[1/5] 启动浏览器...');
  const { chromium } = await import('playwright');
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--window-size=1440,900',
      '--no-sandbox',
    ],
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
  
  // 2. 打开 ZO 注册页
  log('[2/5] 打开 ZO 注册页...');
  try {
    await page.goto('https://www.zo.computer/signup', { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    log(`导航超时: ${e.message}`);
  }
  await sleep(3000);
  await page.screenshot({ path: join(LOG_DIR, 's1_signup.png') });
  
  // 分析当前页面
  let pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
  log(`页面内容: ${pageText.substring(0, 150)}`);
  
  // 3. 点击 "Email me a sign-up link"
  log('[3/5] 发送 magic link...');
  
  // 先尝试点击 Email 按钮
  const emailBtnClicked = await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button, a, [role="button"]')) {
      const txt = (btn.textContent || '').trim();
      if (/email me/i.test(txt) || /continue with email/i.test(txt) || /email.*sign.*up/i.test(txt)) {
        if (btn.offsetParent !== null) { btn.click(); return true; }
      }
    }
    return false;
  });
  log(`点击 Email 按钮: ${emailBtnClicked}`);
  await sleep(2000);
  
  // 截图
  await page.screenshot({ path: join(LOG_DIR, 's2_email_btn.png') });
  
  // 填写邮箱
  const emailFilled = await page.evaluate((email) => {
    const inp = document.querySelector('input[type="email"]') 
      || document.querySelector('input#email') 
      || document.querySelector('input[name*="email"]')
      || document.querySelector('input:not([type="hidden"]):not([type="submit"])');
    if (!inp) return false;
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, email);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, EMAIL);
  log(`填写邮箱: ${emailFilled}`);
  await sleep(500);
  
  // 截图
  await page.screenshot({ path: join(LOG_DIR, 's3_email_filled.png') });
  
  // 点击 Continue
  const continueClicked = await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button, input[type="submit"]')) {
      if (/continue/i.test(btn.textContent?.trim() || '')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  log(`点击 Continue: ${continueClicked}`);
  await sleep(3000);
  
  // 截图
  await page.screenshot({ path: join(LOG_DIR, 's4_after_continue.png') });
  
  const sendTime = new Date(Date.now() - 5000);
  log(`发送时间: ${sendTime.toISOString()}`);
  
  // 4. 轮询 magic link
  log('[4/5] 轮询 magic link...');
  let rt = REFRESH_TOKEN;
  const result = await pollMagicLink(CLIENT_ID, rt, sendTime, 180);
  
  if (!result) {
    log('❌ 未收到 magic link');
    // 等待一下看页面是否已经变化
    await sleep(10000);
    const url = page.url();
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
    log(`当前 URL: ${url}`);
    log(`当前页面: ${text}`);
    await page.screenshot({ path: join(LOG_DIR, 'sx_no_link.png') });
    return;
  }
  
  log(`✅ 收到 magic link`);
  
  // 更新 refresh token
  if (result.newRefreshToken !== REFRESH_TOKEN) {
    log('更新 refresh token...');
    writeFileSync(EMAIL_FILE, [EMAIL, PASSWORD, CLIENT_ID, result.newRefreshToken].join('----'), 'utf-8');
  }
  
  // 5. 打开 magic link（Turnstile 出现的地方）
  log('[5/5] 打开 magic link - 即将遇到 Turnstile...');
  
  try {
    await page.goto(result.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log(`导航超时: ${e.message}`);
  }
  await sleep(5000);
  
  // ★★★ 主循环：反复分析和尝试破解 Turnstile ★★★
  let turnstileSolved = false;
  let attemptCount = 0;
  const MAX_ATTEMPTS = 50;
  
  while (!turnstileSolved && attemptCount < MAX_ATTEMPTS) {
    attemptCount++;
    log(`\n===== Turnstile 破解尝试 ${attemptCount}/${MAX_ATTEMPTS} =====`);
    
    // 截图
    await page.screenshot({ path: join(LOG_DIR, `ts_${attemptCount}_before.png`) });
    
    // 检查当前状态
    const currentUrl = page.url();
    const currentText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
    log(`当前 URL: ${currentUrl.substring(0, 100)}`);
    log(`页面内容: ${currentText.substring(0, 200)}`);
    
    // 检查是否已经通过
    const hostname = (() => { try { return new URL(currentUrl).hostname; } catch(e) { return ''; } })();
    const isSubdomain = hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer';
    
    if (isSubdomain || /dashboard|welcome|choose your handle|set up your profile|display name/i.test(currentText)) {
      log('🎉🎉🎉 已通过 Turnstile！');
      turnstileSolved = true;
      break;
    }
    
    // 检查是否有 continue in browser
    if (/continue in browser/i.test(currentText)) {
      log('发现 "Continue in browser" 按钮，点击...');
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('button, a, div[role="button"], span')) {
          if (/Continue in browser/i.test(el.textContent?.trim() || '') && el.offsetParent !== null) {
            el.click(); return true;
          }
        }
      });
      await sleep(3000);
      continue;
    }
    
    // 检查是否有 "checking" 或 "verifying" 状态
    if (/checking|verifying|please wait/i.test(currentText)) {
      log('正在验证中，等待...');
      await sleep(3000);
      continue;
    }
    
    // 检查 link expired
    if (/expired|invalid|link has expired/i.test(currentText)) {
      log('⚠️ Link expired! 刷新页面重新获取 Turnstile...');
      
      // 刷新页面
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        log(`刷新失败: ${e.message}`);
      }
      await sleep(5000);
      continue;
    }
    
    // ★ 深度分析 Turnstile
    const analysis = await analyzeTurnstile(page, cdp);
    
    // ★ 尝试点击 Turnstile checkbox
    if (analysis.cfIframes.length > 0 || analysis.cfContainers.containers.length > 0) {
      log('发现 Turnstile 元素，开始点击...');
      await clickTurnstileCheckbox(page, cdp, analysis);
      
      // 等待验证结果
      log('等待验证结果（最多30秒）...');
      for (let wait = 0; wait < 15; wait++) {
        await sleep(2000);
        
        const checkUrl = page.url();
        const checkText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '');
        const chostname = (() => { try { return new URL(checkUrl).hostname; } catch(e) { return ''; } })();
        const cisSubdomain = chostname.endsWith('.zo.computer') && chostname !== 'www.zo.computer';
        
        if (cisSubdomain || /dashboard|welcome|choose your handle|set up your profile/i.test(checkText)) {
          log('🎉 Turnstile 验证通过！页面已跳转');
          turnstileSolved = true;
          break;
        }
        
        // 检查是否有 turnstile response token
        const hasToken = await page.evaluate(() => {
          const inputs = document.querySelectorAll('[name="cf-turnstile-response"]');
          for (const inp of inputs) {
            if (inp.value && inp.value.length > 20) return true;
          }
          return false;
        });
        if (hasToken) {
          log('✅ 检测到 cf-turnstile-response token，可能已通过');
          turnstileSolved = true;
          break;
        }
        
        // 检测是否还在验证中
        if (/checking|verifying|please wait/i.test(checkText)) {
          log(`  验证中... (${(wait + 1) * 2}s)`);
          continue;
        }
        
        // 检测是否过期
        if (/expired|invalid/i.test(checkText) && !/redirecting/i.test(checkText)) {
          log('  Link 已过期，需要刷新');
          break;
        }
        
        log(`  等待中... (${(wait + 1) * 2}s)`);
      }
      
      await page.screenshot({ path: join(LOG_DIR, `ts_${attemptCount}_after.png`) });
      
      if (turnstileSolved) break;
    } else {
      log('⚠️ 未找到 Turnstile 元素！');
      log('  可能原因: Turnstile 未渲染、在iframe中无法检测、页面不是验证页');
      
      // 尝试刷新页面
      if (attemptCount % 3 === 0) {
        log('  尝试刷新页面...');
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {}
        await sleep(5000);
      } else {
        await sleep(3000);
      }
      
      continue;
    }
    
    // 等待下一次尝试
    await sleep(2000);
  }
  
  if (!turnstileSolved) {
    log(`❌ ${MAX_ATTEMPTS}次尝试后仍未通过 Turnstile`);
    await page.screenshot({ path: join(LOG_DIR, 'FAILED_final.png') });
    log('请检查截图: ' + join(LOG_DIR, 'FAILED_final.png'));
  }
  
  // 最终状态
  const finalUrl = page.url();
  const finalText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  log(`\n最终 URL: ${finalUrl}`);
  log(`最终页面: ${finalText.substring(0, 300)}`);
  
  await page.screenshot({ path: join(LOG_DIR, 'FINAL_result.png') });
  
  // 保持浏览器打开一段时间，方便观察
  log('\n⏸️ 浏览器保持打开 120 秒...');
  log(`日志和截图保存在: ${LOG_DIR}`);
  await sleep(120000);
  
  log('关闭浏览器...');
  await browser.close();
  log('脚本完成');
}

main().catch(e => {
  log(`致命错误: ${e.message}\n${e.stack}`);
  process.exit(1);
});
