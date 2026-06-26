/**
 * 验证 CDP Page.addScriptToEvaluateOnNewDocument 是否注入到 iframe
 */
const puppeteer = require("../node_modules/puppeteer-core");
const path = require("path");
const fs = require("fs");

const EXT_DIR = path.resolve(path.join(__dirname, "..", "turnstile-extension"));
const SCRIPT_JS = fs.readFileSync(path.join(EXT_DIR, "script.js"), "utf8");

(async () => {
  console.log("script.js:", SCRIPT_JS.length, "bytes");

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled", "--no-sandbox"],
    ignoreDefaultArgs: ["--enable-automation"],
    userDataDir: path.join(__dirname, "..", "_test_cdp"),
  });

  const page = (await browser.pages())[0] || await browser.newPage();

  // CDP 注入
  const cdp = await page.createCDPSession();
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: SCRIPT_JS,
    runImmediately: true,
  });
  console.log("[OK] CDP 注入完成");

  // 监听 iframe
  page.on("frameattached", (frame) => console.log("[FRAME] attached:", frame.url().substring(0, 80)));
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) {
      console.log("[FRAME] navigated:", frame.url().substring(0, 80));
    }
  });

  // 访问 ZO 注册页
  console.log("\n打开注册页...");
  await page.goto("https://zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  console.log("URL:", page.url());

  // 检查主frame注入
  const mainCheck = await page.evaluate(() => ({
    cfBypass: !!window.__CF_BYPASS__,
    webdriver: navigator.webdriver,
  }));
  console.log("\n主frame:", JSON.stringify(mainCheck));

  // 等 iframe 出现
  console.log("\n等待 Turnstile iframe...");
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const frames = page.frames();
    const iframes = frames.filter(f => f !== page.mainFrame());
    
    if (iframes.length > 0) {
      console.log(`[${(i+1)*2}s] 发现 ${iframes.length} 个 iframe:`);
      for (const f of iframes) {
        console.log("  URL:", f.url().substring(0, 100));
        try {
          const fCheck = await f.evaluate(() => ({
            cfBypass: !!window.__CF_BYPASS__,
            screenX_patched: Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'screenX')?.get !== undefined,
          }));
          console.log("  注入状态:", JSON.stringify(fCheck));
        } catch(e) {
          console.log("  [X] 无法访问(cross-origin):", e.message.substring(0, 60));
        }
      }
    } else {
      console.log(`[${(i+1)*2}s] 无 iframe, frames总数: ${frames.length}`);
    }

    // 检查 token
    const token = await page.evaluate(() => {
      const inp = document.querySelector('input[name="cf-turnstile-response"]');
      return inp && inp.value ? inp.value.length : 0;
    });
    if (token > 0) {
      console.log("[SUCCESS] Turnstile token 已获取! 长度:", token);
      break;
    }
  }

  await page.screenshot({ path: path.join(__dirname, "debug_cdp_test.png") });
  console.log("\n截图: debug_cdp_test.png");

  await browser.close();
  try { fs.rmSync(path.join(__dirname, "..", "_test_cdp"), { recursive: true }); } catch(e) {}
})().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
