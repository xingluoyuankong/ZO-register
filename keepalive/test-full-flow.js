/**
 * ZO 保活测试脚本 v3 - 正确处理 Cloudflare Turnstile 复选框
 * 
 * 流程：
 * 1. 打开邮箱验证链接
 * 2. 等待 Cloudflare Turnstile 出现
 * 3. 找到并点击 Turnstile 左边的复选框
 * 4. 等待验证通过或超时
 * 5. 超时则刷新重试
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const CONFIG = {
  cdpEndpoint: 'http://localhost:9222',
  emailDir: 'C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用\\6',
  maxRetry: 3,           // 最大刷新重试次数
  turnstileTimeout: 30000, // Turnstile 验证超时(ms)
  clickRetry: 5,         // 点击复选框重试次数
};

// ========== 工具函数 ==========

/**
 * 从邮箱目录读取所有账号
 */
function loadAccounts() {
  const files = fs.readdirSync(CONFIG.emailDir)
    .filter(f => f.endsWith('.txt'));
  
  const accounts = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(CONFIG.emailDir, file), 'utf-8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    // 第一行是邮箱，后面可能有密码
    accounts.push({
      email: lines[0],
      password: lines[1] || '',
      file: file,
    });
  }
  return accounts;
}

/**
 * 等待指定时间
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 使用 CDP Input.dispatchMouseEvent 发送真实的鼠标事件
 * 这是最关键的函数 - 绕过 Turnstile 的检测
 */
async function dispatchRealClick(cdpSession, x, y) {
  console.log(`  [CDP] 发送鼠标事件到 (${x}, ${y})`);
  
  // 模拟真实人类操作：先移动鼠标到目标位置附近，再移动过去，然后点击
  await cdpSession.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: Math.max(0, x - 50),
    y: Math.max(0, y - 30),
  });
  await sleep(100 + Math.random() * 200);
  
  // 移动到目标位置
  await cdpSession.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
  });
  await sleep(50 + Math.random() * 150);
  
  // 按下
  await cdpSession.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await sleep(50 + Math.random() * 80);
  
  // 释放
  await cdpSession.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  
  return true;
}

// ========== 核心功能 ==========

/**
 * 获取 Turnstile iframe 和复选框信息
 * Turnstile 结构：
 * <iframe src="challenges.cloudflare.com">
 *   #document
 *     <html>
 *       <body>
 *         <div id="challenge-stage"> (Shadow DOM host)
 *           #shadow-root
 *             <input type="checkbox">  ← 这就是我们要点的！
 */
async function getTurnstileInfo(page, cdpSession) {
  // 方法1: 通过页面中的 Turnstile iframe 来定位
  const info = await page.evaluate(() => {
    const result = {
      found: false,
      iframeSrc: null,
      widgetType: null,
      turnstileContainer: null,
    };
    
    // 查找 Turnstile iframe
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.src && (
        iframe.src.includes('challenges.cloudflare') ||
        iframe.src.includes('turnstile') ||
        iframe.src.includes('cf-chl')
      )) {
        result.found = true;
        result.iframeSrc = iframe.src;
        result.iframeRect = iframe.getBoundingClientRect();
        break;
      }
    }
    
    // 检查是否有 .cf-turnstile 容器
    const container = document.querySelector('.cf-turnstile, [data-sitekey], #cf-turnstile');
    if (container) {
      result.turnstileContainer = container.getBoundingClientRect();
    }
    
    // 尝试获取 widget 类型（managed vs non-managed）
    if (window.turnstile && window.turnstile.getResponse) {
      result.widgetType = 'api-available';
    }
    
    return result;
  });
  
  return info;
}

/**
 * 尝试找到并点击 Turnstile 复选框
 * 
 * 核心策略：
 * 1. 找到页面上 Turnstile iframe 的位置
 * 2. 计算复选框在 iframe 内的偏移位置
 * 3. 使用 CDP 发送精确的鼠标事件
 */
async function clickTurnstileCheckbox(page, cdpSession) {
  console.log('\n[Turnstile] 开始查找复选框...');
  
  // 先等待 Turnstile 加载
  await sleep(2000);
  
  // 获取 Turnstile 信息
  const info = await getTurnstileInfo(page, cdpSession);
  console.log('[Turnstile] 信息:', JSON.stringify({
    found: info.found,
    hasIframe: !!info.iframeSrc,
    iframeSrc: info.iframeSrc ? info.iframeSrc.substring(0, 60) : null,
  }));
  
  if (!info.found) {
    console.log('[Turnstile] ❌ 未找到 Turnstile iframe');
    return false;
  }
  
  // 获取 iframe 的屏幕坐标
  const iframeElement = await page.evaluateHandle(() => {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.src && iframe.src.includes('challenges.cloudflare')) {
        return iframe;
      }
    }
    return null;
  });
  
  if (!iframeElement) {
    console.log('[Turnstile] ❌ 无法获取 iframe 元素句柄');
    return false;
  }
  
  const iframeBox = await iframeElement.boundingBox();
  if (!iframeBox) {
    console.log('[Turnstile] ❌ 无法获取 iframe 边界框');
    return false;
  }
  
  console.log(`[Turnstile] iframe 位置: x=${iframeBox.x}, y=${iframeBox.y}, w=${iframeBox.width}, h=${iframeBox.height}`);
  
  // Turnstile checkbox 通常在 iframe 内的固定相对位置
  // 对于 managed mode (非 invisible)，checkbox 大约在:
  // - 水平方向: 距离左边约 25-30px
  // - 垂直方向: 距离顶部约 (高度/2) 或居中略偏上
  
  // 根据截图分析，checkbox 在 Turnstile widget 的左侧中间位置
  // 典型 Turnstile 尺寸: 300x65 (标准), 304x76 (带 logo)
  
  const checkboxOffsetX = 28;   // 复选框距离 iframe 左边的偏移
  const checkboxOffsetY = Math.floor(iframeBox.height / 2);  // 垂直居中
  
  const targetX = Math.floor(iframeBox.x + checkboxOffsetX);
  const targetY = Math.floor(iframeBox.y + checkboxOffsetY);
  
  console.log(`[Turnstile] 目标点击位置: (${targetX}, ${targetY})`);
  console.log(`[Turnstile] 偏移量: offsetX=${checkboxOffsetX}, offsetY=${checkboxOffsetY}`);
  
  // 使用 CDP 发送真实鼠标事件
  await dispatchRealClick(cdpSession, targetX, targetY);
  console.log('[Turnstile] ✅ 已发送点击事件');
  
  return true;
}

/**
 * 等待 Turnstile 验证结果
 * @returns {string} 'success' | 'timeout' | 'error'
 */
async function waitForTurnstileResult(page, timeout = CONFIG.turnstileTimeout) {
  console.log(`\n[验证] 等待结果 (超时: ${timeout}ms)...`);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const status = await page.evaluate(() => {
      // 检查是否还在当前页面
      const url = window.location.href;
      
      // 检查是否显示错误消息
      const bodyText = document.body.innerText.toLowerCase();
      const hasInvalidLink = bodyText.includes('invalid or expired');
      const hasError = bodyText.includes('error') || bodyText.includes('failed');
      
      // 检查 Turnstile 是否还存在
      const hasTurnstile = !!document.querySelector(
        'iframe[src*="challenges.cloudflare"], .cf-turnstile, [data-sitekey]'
      );
      
      // 检查是否已经跳转（URL 变了）
      const stillOnVerifyPage = url.includes('/email-login/verify');
      
      return {
        url,
        hasInvalidLink,
        hasError,
        hasTurnstile,
        stillOnVerifyPage,
        bodyTextPreview: document.body.innerText.substring(0, 200),
      };
    });
    
    console.log(`  [${Math.round((Date.now()-startTime)/1000)}s] ` +
      `Turnstile存在=${status.hasTurnstile}, ` +
      `仍在验证页=${status.stillOnVerifyPage}, ` +
      `无效链接=${status.hasInvalidLink}`);
    
    // 成功：不在验证页了，说明跳转了
    if (!status.stillOnVerifyPage) {
      console.log(`[验证] ✅ 成功！已跳转到: ${status.url.substring(0, 80)}`);
      return 'success';
    }
    
    // 失败：显示 invalid or expired
    if (status.hasInvalidLink) {
      console.log('[验证] ❌ 验证失败: Invalid or expired login link');
      return 'error';
    }
    
    // Turnstile 消失但还没跳转 - 可能正在处理中
    if (!status.hasTurnstile && status.stillOnVerifyPage) {
      console.log('[验证] ⏳ Turnstile 已消失，等待跳转...');
    }
    
    await sleep(2000);
  }
  
  console.log('[验证] ⏰ 超时');
  return 'timeout';
}

/**
 * 处理单个账号的完整登录流程
 */
async function processAccount(browser, account, index) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📧 处理账号 ${index + 1}: ${account.email}`);
  console.log(`${'='.repeat(60)}`);
  
  const context = browser.contexts()[0];
  let page;
  
  try {
    page = await context.newPage();
    
    // 创建 CDP session 用于发送底层鼠标事件
    const cdpSession = await page.context().newCDPSession(page);
    
    for (let retry = 0; retry <= CONFIG.maxRetry; retry++) {
      if (retry > 0) {
        console.log(`\n🔄 第 ${retry} 次重试...`);
        await sleep(2000);
        
        // 刷新页面
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(3000);
      } else {
        // 第一次访问 - 构造验证链接
        // ZO 的邮件格式: https://www.zo.computer/email-login/verify?token=<token>
        const verifyUrl = `https://www.zo.computer/email-login/verify?token=${account.email}`;
        console.log(`\n🔗 打开验证链接...`);
        console.log(`   URL: ${verifyUrl.substring(0, 80)}...`);
        
        await page.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // 等待页面加载
        console.log('⏳ 等待页面完全加载...');
        await sleep(5000);
        
        // 截图查看初始状态
        const screenshotPath = path.join(__dirname, 'screenshots', `initial-${index}.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(`📸 初始截图: ${screenshotPath}`);
        
        // 打印当前页面信息
        const pageInfo = await page.evaluate(() => ({
          url: window.location.href,
          title: document.title,
          text: document.body.innerText.substring(0, 500),
        }));
        console.log(`📄 当前 URL: ${pageInfo.url.substring(0, 100)}`);
        console.log(`📄 页面标题: ${pageInfo.title}`);
        console.log(`📄 页面内容预览:\n${pageInfo.text.substring(0, 300)}`);
      }
      
      // 检查是否已经有 Turnstile
      const hasTurnstile = await page.evaluate(() => {
        return !!document.querySelector(
          'iframe[src*="challenges.cloudflare"], .cf-turnstile, [data-sitekey]'
        );
      });
      
      if (!hasTurnstile) {
        console.log('⚠️ 未发现 Turnstile，可能需要等待...');
        await sleep(5000);
      }
      
      // 尝试点击 Turnstile 复选框
      const clicked = await clickTurnstileCheckbox(page, cdpSession);
      
      if (!clicked) {
        console.log('❌ 无法找到或点击 Turnstile 复选框');
        
        // 截图用于调试
        const debugScreenshot = path.join(__dirname, 'screenshots', `debug-no-turnstile-${index}-${retry}.png`);
        await page.screenshot({ path: debugScreenshot });
        console.log(`📸 调试截图: ${debugScreenshot}`);
        
        if (retry < CONFIG.maxRetry) {
          continue;
        }
        break;
      }
      
      // 点击后截图
      const afterClickScreenshot = path.join(__dirname, 'screenshots', `after-click-${index}-${retry}.png`);
      await sleep(2000);
      await page.screenshot({ path: afterClickScreenshot });
      console.log(`📸 点击后截图: ${afterClickScreenshot}`);
      
      // 等待验证结果
      const result = await waitForTurnstileResult(page);
      
      if (result === 'success') {
        console.log(`\n🎉 账号 ${account.email} 登录成功！`);
        
        // 最终状态截图
        const successScreenshot = path.join(__dirname, 'screenshots', `success-${index}.png`);
        await page.screenshot({ path: successScreenshot });
        
        return true;
      } else if (result === 'error') {
        console.log(`⚠️ 验证失败，将刷新重试...`);
        continue;
      } else {
        console.log(`⏰ 验证超时，将刷新重试...`);
        continue;
      }
    }
    
    console.log(`\n❌ 账号 ${account.email} 经过 ${CONFIG.maxRetry + 1} 次尝试后仍失败`);
    return false;
    
  } catch (err) {
    console.error(`💥 处理账号出错:`, err.message);
    return false;
  } finally {
    if (page) {
      // 不关闭页面，方便手动检查
      console.log(`📌 保留页面供检查`);
    }
  }
}

// ========== 主程序 ==========

(async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       ZO 保活系统 v3 - Cloudflare Turnstile 突破版      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  // 确保截图目录存在
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  
  // 连接到浏览器
  console.log(`\n🔗 连接浏览器: ${CONFIG.cdpEndpoint}`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CONFIG.cdpEndpoint);
    console.log('✅ 浏览器连接成功');
    console.log(`   版本: ${browser.version()}`);
  } catch (e) {
    console.error('❌ 连接浏览器失败:', e.message);
    console.error('\n请确保浏览器正在运行:');
    console.error('  msedge.exe --remote-debugging-port=9222 --load-extension=./turnstile-patch ...');
    process.exit(1);
  }
  
  // 加载账号
  console.log(`\n📂 加载账号: ${CONFIG.emailDir}`);
  let accounts;
  try {
    accounts = loadAccounts();
    console.log(`✅ 加载 ${accounts.length} 个账号`);
    console.log(`   前3个: ${accounts.slice(0, 3).map(a => a.email).join(', ')}`);
  } catch (e) {
    console.error('❌ 加载账号失败:', e.message);
    process.exit(1);
  }
  
  // 只测试前2个账号
  const testAccounts = accounts.slice(0, 2);
  console.log(`\n🧪 本次测试 ${testAccounts.length} 个账号`);
  
  // 处理每个账号
  const results = [];
  for (let i = 0; i < testAccounts.length; i++) {
    const success = await processAccount(browser, testAccounts[i], i);
    results.push({ email: testAccounts[i].email, success });
    
    // 账号间间隔
    if (i < testAccounts.length - 1) {
      console.log('\n⏳ 等待 5 秒后处理下一个账号...');
      await sleep(5000);
    }
  }
  
  // 结果汇总
  console.log('\n' + '='.repeat(60));
  console.log('📊 结果汇总');
  console.log('='.repeat(60));
  for (const r of results) {
    console.log(`  ${r.success ? '✅' : '❌'} ${r.email}`);
  }
  const successCount = results.filter(r => r.success).length;
  console.log(`\n总计: ${successCount}/${results.length} 成功`);
  
  browser.close();
  console.log('\n完成！');
})();
