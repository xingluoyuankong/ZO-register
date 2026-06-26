/**
 * 诊断脚本：验证 Turnstile 扩展是否能正确加载
 * 直接控制浏览器，打开一个含 Turnstile 的页面，检查扩展是否注入成功
 */
const puppeteer = require("../node_modules/puppeteer-core");
const path = require("path");
const fs = require("fs");

const EXT_DIR = path.join(__dirname, "..", "turnstile-extension");

(async () => {
  // 1. 检查扩展文件完整性
  console.log("=== Step 1: 检查扩展文件 ===");
  const files = ["manifest.json", "script.js", "background.js"];
  for (const f of files) {
    const fp = path.join(EXT_DIR, f);
    if (!fs.existsSync(fp)) {
      console.log(`[FAIL] ${f} 不存在!`);
      process.exit(1);
    }
    const content = fs.readFileSync(fp, "utf8");
    const hasBOM = content.charCodeAt(0) === 0xFEFF;
    console.log(`[OK] ${f} (${content.length} bytes, BOM: ${hasBOM})`);
  }

  // 2. 检查 manifest.json 内容
  console.log("\n=== Step 2: 检查 manifest.json ===");
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  console.log("name:", manifest.name);
  console.log("version:", manifest.version);
  console.log("content_scripts:", JSON.stringify(manifest.content_scripts, null, 2));
  console.log("background:", JSON.stringify(manifest.background, null, 2));
  const scriptFile = manifest.content_scripts[0].js[0];
  console.log("指向的脚本文件:", scriptFile);
  if (!fs.existsSync(path.join(EXT_DIR, scriptFile))) {
    console.log("[FAIL] manifest 指向的文件不存在:", scriptFile);
    process.exit(1);
  }
  console.log("[OK] 文件存在");

  // 3. 找 Chrome/Edge 路径
  console.log("\n=== Step 3: 找浏览器 ===");
  const chromePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  let exePath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      exePath = p;
      console.log("[OK] 找到浏览器:", p);
      break;
    }
  }
  if (!exePath) {
    console.log("[FAIL] 找不到 Chrome 或 Edge");
    process.exit(1);
  }

  // 4. 启动浏览器并加载扩展
  console.log("\n=== Step 4: 启动浏览器 ===");
  const launchArgs = [
    "--no-first-run", "--no-default-browser-check", "--disable-default-apps",
    "--disable-features=Translate", "--disable-blink-features=AutomationControlled",
    "--window-size=1440,900",
    "--no-sandbox", "--disable-component-update",
    "--load-extension=" + EXT_DIR,
  ];

  const browser = await puppeteer.launch({
    executablePath: exePath,
    headless: false,
    args: launchArgs,
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  console.log("[OK] 浏览器已启动");

  // 5. 检查扩展是否加载成功
  console.log("\n=== Step 5: 检查扩展加载 ===");
  const page = (await browser.pages())[0] || await browser.newPage();
  
  // 访问 chrome-extension://xxx/manifest.json 来验证扩展是否加载
  await page.goto("chrome://extensions/", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(e => {
    console.log("[WARN] 无法访问 chrome://extensions/:", e.message.substring(0, 100));
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(__dirname, "..", "plugin", "debug_extensions.png") });
  console.log("[OK] 扩展页面截图已保存: debug_extensions.png");

  // 6. 打开一个含 Turnstile 的测试页面
  console.log("\n=== Step 6: 打开测试页面 ===");
  // 用一个简单的测试页面检测 script.js 是否注入
  await page.goto("about:blank");
  
  // 检测 __CF_BYPASS__ 是否被设置（script.js 第一行就设置它）
  const testResult = await page.evaluate(() => {
    return {
      cfBypass: typeof window.__CF_BYPASS__ !== 'undefined' ? window.__CF_BYPASS__ : 'NOT SET',
      webdriver: navigator.webdriver,
      plugins: navigator.plugins.length,
      platform: navigator.platform,
      languages: JSON.stringify(navigator.languages),
      hasChromeRuntime: !!(window.chrome && window.chrome.runtime),
    };
  });
  console.log("注入检测结果:", JSON.stringify(testResult, null, 2));

  if (testResult.cfBypass === true) {
    console.log("[SUCCESS] 扩展注入成功! __CF_BYPASS__ = true");
  } else {
    console.log("[FAIL] 扩展未注入! __CF_BYPASS__ =", testResult.cfBypass);
    console.log("可能原因:");
    console.log("  1. 扩展未加载（检查 chrome://extensions/ 截图）");
    console.log("  2. manifest.json 配置有误");
    console.log("  3. script.js 有语法错误");
  }

  // 7. 访问实际含 Turnstile 的页面
  console.log("\n=== Step 7: 访问 ZO 注册页 ===");
  try {
    await page.goto("https://zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
    console.log("[OK] 页面已加载:", page.url());
    
    // 等待 Turnstile iframe 出现
    await new Promise(r => setTimeout(r, 5000));
    
    const turnstileCheck = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe[src*="turnstile"], iframe[src*="challenges"]');
      const tokenInput = document.querySelector('input[name="cf-turnstile-response"]');
      return {
        iframeCount: iframes.length,
        iframeSrcs: Array.from(iframes).map(f => f.src.substring(0, 100)),
        tokenValue: tokenInput ? (tokenInput.value ? tokenInput.value.substring(0, 30) + '...' : 'empty') : 'not found',
        cfBypass: window.__CF_BYPASS__,
      };
    });
    console.log("Turnstile 检测:", JSON.stringify(turnstileCheck, null, 2));
    
    await page.screenshot({ path: path.join(__dirname, "..", "plugin", "debug_turnstile_page.png") });
    console.log("[OK] Turnstile 页面截图已保存: debug_turnstile_page.png");
  } catch (e) {
    console.log("[WARN] 访问 ZO 页面失败:", e.message.substring(0, 150));
  }

  console.log("\n=== 诊断完成 ===");
  console.log("浏览器保持打开 30 秒供手动检查...");
  await new Promise(r => setTimeout(r, 30000));
  
  await browser.close();
  console.log("浏览器已关闭");
})().catch(e => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
