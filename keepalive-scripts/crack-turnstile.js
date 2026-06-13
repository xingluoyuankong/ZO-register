/**
 * 直接破解 Turnstile v2
 * 从 ZO 首页开始完整登录流程，到 Turnstile 出现时精准点击
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 测试邮箱
const TEST_EMAIL = 'colemanbroovp9xyduj92hubhn@outlook.com';

(async () => {
  console.log('🔗 连接浏览器...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  
  // 先关闭已有的 ZO 页面
  for (const p of ctx.pages()) {
    if (p.url().includes('zo.computer')) {
      await p.close().catch(() => {});
    }
  }
  
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  
  // ===== Step 1: 打开 ZO 首页 =====
  console.log('\n📍 Step 1: 打开 ZO 首页');
  await page.goto('https://www.zo.computer', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-step1-home.png') });
  
  // 打印页面上的按钮和链接
  const links = await page.evaluate(() => {
    const all = [...document.querySelectorAll('a, button')];
    return all.map(el => ({
      tag: el.tagName,
      text: el.innerText.trim().substring(0, 50),
      href: el.href || '',
      visible: el.offsetWidth > 0,
    })).filter(l => l.text);
  });
  console.log('页面上的可点击元素:');
  links.forEach(l => console.log(`  ${l.tag} "${l.text}" ${l.visible ? '✅' : '❌'}`));
  
  // ===== Step 2: 点击 Log in =====
  console.log('\n📍 Step 2: 点击 Log in');
  const loginBtn = page.locator('a, button').filter({ hasText: /log in/i }).first();
  if (await loginBtn.count() > 0) {
    await loginBtn.click();
    await sleep(3000);
  } else {
    // 直接导航
    await page.goto('https://www.zo.computer/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-step2-login.png') });
  console.log('当前 URL:', page.url());
  
  // 检查页面内容
  const loginPageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('页面内容:', loginPageText.substring(0, 300));
  
  // ===== Step 3: 查找并点击 Email 登录按钮 =====
  console.log('\n📍 Step 3: 查找 Email 登录入口');
  
  // 检查所有按钮
  const btns = await page.evaluate(() => {
    const all = [...document.querySelectorAll('a, button, [role="button"], input[type="submit"]')];
    return all.map(el => ({
      tag: el.tagName,
      text: el.innerText.trim().substring(0, 50),
      type: el.type || '',
      href: el.href || '',
      visible: el.offsetWidth > 0,
      rect: el.getBoundingClientRect().toJSON(),
    })).filter(l => l.visible && l.text);
  });
  console.log('可见按钮:');
  btns.forEach(b => console.log(`  ${b.tag} "${b.text}" at (${Math.round(b.rect.x)},${Math.round(b.rect.y)})`));
  
  // 查找包含 email 的按钮
  const emailBtn = page.locator('a, button, [role="button"]').filter({ hasText: /email|邮箱/i }).first();
  if (await emailBtn.count() > 0) {
    console.log('点击 Email 按钮...');
    await emailBtn.click();
    await sleep(2000);
  } else {
    console.log('没有找到 Email 按钮，可能已经在输入邮箱页面');
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-step3-email-btn.png') });
  
  // ===== Step 4: 输入邮箱 =====
  console.log('\n📍 Step 4: 输入邮箱');
  
  // 查找输入框
  const inputs = await page.evaluate(() => {
    const all = [...document.querySelectorAll('input, textarea')];
    return all.map(el => ({
      type: el.type,
      name: el.name,
      placeholder: el.placeholder,
      visible: el.offsetWidth > 0,
      rect: el.getBoundingClientRect().toJSON(),
    })).filter(i => i.visible);
  });
  console.log('可见输入框:', JSON.stringify(inputs, null, 2));
  
  const emailInput = page.locator('input[type="email"], input[name*="email"], input[placeholder*="email" i]').first();
  if (await emailInput.count() > 0) {
    console.log(`输入邮箱: ${TEST_EMAIL}`);
    await emailInput.fill(TEST_EMAIL);
    await sleep(500);
  } else {
    // 尝试任何可见的 text input
    const anyInput = page.locator('input:visible').first();
    if (await anyInput.count() > 0) {
      console.log(`在第一个输入框输入邮箱: ${TEST_EMAIL}`);
      await anyInput.fill(TEST_EMAIL);
      await sleep(500);
    } else {
      console.log('❌ 没有找到输入框！');
    }
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-step4-email-filled.png') });
  
  // ===== Step 5: 点击 Continue =====
  console.log('\n📍 Step 5: 点击 Continue');
  const continueBtn = page.locator('button, [role="button"], input[type="submit"]').filter({ hasText: /continue|submit|发送|下一步|next/i }).first();
  if (await continueBtn.count() > 0) {
    console.log('点击 Continue...');
    await continueBtn.click();
    await sleep(3000);
  } else {
    console.log('没有找到 Continue 按钮');
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-step5-after-continue.png') });
  console.log('当前 URL:', page.url());
  
  // ===== Step 6: 等待并检测 Turnstile =====
  console.log('\n📍 Step 6: 检测 Cloudflare Turnstile');
  
  // 反复检查 Turnstile 是否出现
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    
    const checkResult = await page.evaluate(() => {
      const result = {
        url: window.location.href,
        iframes: [],
        hasTurnstileContainer: false,
        bodyText: document.body.innerText.substring(0, 300),
      };
      
      // 检查所有 iframe
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const rect = iframe.getBoundingClientRect();
        result.iframes.push({
          src: iframe.src ? iframe.src.substring(0, 100) : '',
          x: rect.x, y: rect.y, w: rect.width, h: rect.height,
          visible: rect.width > 0 && rect.height > 0,
        });
      }
      
      // 检查 Turnstile 容器
      const container = document.querySelector('.cf-turnstile, [data-sitekey], #cf-turnstile, cf-turnstile');
      if (container) {
        result.hasTurnstileContainer = true;
        const rect = container.getBoundingClientRect();
        result.turnstileContainer = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      }
      
      return result;
    });
    
    console.log(`\n  [检查 ${i+1}] URL: ${checkResult.url.substring(0, 80)}`);
    console.log(`  Iframes: ${checkResult.iframes.length}`);
    checkResult.iframes.forEach(f => {
      console.log(`    ${f.visible ? '👁️' : '🙈'} [${f.w}x${f.h}] at (${f.x},${f.y}) src=${f.src.substring(0, 60)}`);
    });
    console.log(`  Turnstile容器: ${checkResult.hasTurnstileContainer}`);
    console.log(`  页面内容: ${checkResult.bodyText.substring(0, 150)}`);
    
    // 检查是否有 Turnstile iframe
    const turnstileIframe = checkResult.iframes.find(f =>
      f.src.includes('challenges.cloudflare') ||
      f.src.includes('turnstile') ||
      f.src.includes('cf-chl')
    );
    
    if (turnstileIframe) {
      console.log('\n🎯🎯🎯 找到 Turnstile iframe！开始点击！');
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-turnstile-found.png') });
      
      // 尝试点击复选框
      const clicked = await clickTurnstileCheckbox(page, cdp, turnstileIframe);
      
      if (clicked) {
        // 等待验证结果
        console.log('等待验证结果...');
        await sleep(5000);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-after-click.png') });
        
        // 检查是否通过
        const afterStatus = await page.evaluate(() => ({
          url: window.location.href,
          bodyText: document.body.innerText.substring(0, 300),
          stillHasTurnstile: !!document.querySelector('iframe[src*="challenges.cloudflare"]'),
        }));
        console.log('点击后状态:', JSON.stringify(afterStatus, null, 2));
        
        if (!afterStatus.url.includes('/email-login') && !afterStatus.url.includes('/login')) {
          console.log('\n🎉🎉🎉 可能已通过！');
        }
        
        // 如果还有 Turnstile，多试几次
        for (let retry = 0; retry < 5; retry++) {
          const stillThere = await page.evaluate(() =>
            !!document.querySelector('iframe[src*="challenges.cloudflare"]')
          );
          if (!stillThere) {
            console.log('🎉 Turnstile 已消失！');
            break;
          }
          console.log(`重试点击 ${retry + 1}...`);
          await sleep(3000);
          await clickTurnstileCheckbox(page, cdp, turnstileIframe);
          await sleep(5000);
        }
        
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-final.png') });
        console.log('最终 URL:', page.url());
      }
      break;
    }
    
    // 检查是否已经跳转（没有 Turnstile 就直接过了）
    if (!checkResult.url.includes('zo.computer') && !checkResult.url.includes('login')) {
      console.log('已跳转到其他页面，可能不需要 Turnstile');
      break;
    }
  }
  
  // 最终截图
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'v2-end.png') });
  console.log('\n✅ 完成！请检查 screenshots/ 目录');
  
  browser.close();
})();

async function clickTurnstileCheckbox(page, cdp, iframeInfo) {
  // Turnstile checkbox 在 iframe 内左侧
  // 典型尺寸: 300x65 或 304x76
  // checkbox 大约在 x=26~30, y=height/2
  
  const offsets = [
    { x: 28, y: Math.floor(iframeInfo.h / 2) },
    { x: 26, y: Math.floor(iframeInfo.h * 0.45) },
    { x: 30, y: Math.floor(iframeInfo.h * 0.55) },
    { x: 24, y: Math.floor(iframeInfo.h * 0.4) },
    { x: 32, y: Math.floor(iframeInfo.h * 0.6) },
  ];
  
  for (const offset of offsets) {
    const targetX = Math.floor(iframeInfo.x + offset.x);
    const targetY = Math.floor(iframeInfo.y + offset.y);
    
    console.log(`  点击位置: (${targetX}, ${targetY}) 偏移(${offset.x}, ${offset.y})`);
    
    // 移动鼠标 - 模拟人类
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.max(0, targetX - 60), y: Math.max(0, targetY - 30),
    });
    await sleep(80 + Math.random() * 150);
    
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: targetX, y: targetY,
    });
    await sleep(50 + Math.random() * 100);
    
    // 按下
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: targetX, y: targetY,
      button: 'left', buttons: 1, clickCount: 1,
    });
    await sleep(40 + Math.random() * 60);
    
    // 释放
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: targetX, y: targetY,
      button: 'left', buttons: 0, clickCount: 1,
    });
    
    console.log('  ✅ 点击已发送');
    await sleep(3000);
    
    // 检查是否成功
    const stillHasTurnstile = await page.evaluate(() =>
      !!document.querySelector('iframe[src*="challenges.cloudflare"]')
    );
    
    if (!stillHasTurnstile) {
      console.log('  🎉 Turnstile 已消失，验证可能通过！');
      return true;
    }
  }
  
  return false;
}
