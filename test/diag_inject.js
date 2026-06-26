/**
 * 验证 evaluateOnNewDocument 注入是否生效
 */
const puppeteer = require("../node_modules/puppeteer-core");
const path = require("path");
const fs = require("fs");

const EXT_DIR = path.resolve(path.join(__dirname, "..", "turnstile-extension"));
const SCRIPT_JS = fs.readFileSync(path.join(EXT_DIR, "script.js"), "utf8");

(async () => {
  console.log("script.js 大小:", SCRIPT_JS.length, "bytes");

  const exePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const tempDir = path.join(__dirname, "..", "_test_profile_3");
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: exePath,
    headless: false,
    args: [
      "--no-first-run", "--no-default-browser-check",
      "--disable-features=Translate", "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    userDataDir: tempDir,
  });

  const page = (await browser.pages())[0] || await browser.newPage();

  // 注入 bypass script
  await page.evaluateOnNewDocument(SCRIPT_JS);

  // 监听 frame 导航，注入到 iframe
  page.on("framenavigated", async (frame) => {
    if (frame === page.mainFrame()) return;
    try {
      await frame.evaluate(SCRIPT_JS);
      console.log("[INJECT] 已注入到 iframe:", frame.url().substring(0, 80));
    } catch(e) {}
  });

  // 测试1: about:blank 检测
  await page.goto("about:blank");
  await new Promise(r => setTimeout(r, 1000));
  const r1 = await page.evaluate(() => ({
    cfBypass: window.__CF_BYPASS__,
    webdriver: navigator.webdriver,
    plugins: navigator.plugins.length,
    hasChromeRuntime: !!(window.chrome && window.chrome.runtime),
  }));
  console.log("\n=== about:blank 检测 ===");
  console.log(JSON.stringify(r1, null, 2));
  console.log(r1.cfBypass === true ? "[SUCCESS] 注入生效!" : "[FAIL] 注入未生效");

  // 测试2: 访问 ZO 注册页
  console.log("\n=== 访问 ZO 注册页 ===");
  await page.goto("https://zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  console.log("URL:", page.url());

  // 等 Turnstile iframe 加载
  console.log("等待 Turnstile iframe...");
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const check = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe[src*="turnstile"], iframe[src*="challenges"]');
      const tokenInput = document.querySelector('input[name="cf-turnstile-response"]');
      return {
        iframeCount: iframes.length,
        tokenLen: tokenInput && tokenInput.value ? tokenInput.value.length : 0,
        bodySnippet: document.body.innerText.substring(0, 100).replace(/\n/g, ' '),
      };
    });
    console.log(`[${(i+1)*2}s] iframe: ${check.iframeCount}, token: ${check.tokenLen} chars, body: ${check.bodySnippet.substring(0,60)}`);
    
    if (check.tokenLen > 0) {
      console.log("[SUCCESS] Turnstile token 已获取! 长度:", check.tokenLen);
      break;
    }
  }

  await page.screenshot({ path: path.join(__dirname, "debug_inject_test.png") });
  console.log("\n截图已保存: debug_inject_test.png");

  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true }); } catch(e) {}
  console.log("完成");
})().catch(e => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
